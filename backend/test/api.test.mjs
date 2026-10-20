import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, householdEmails } from '../src/lib/api.mjs';
import { createCognitoVerifier } from '../src/lib/auth.mjs';
import { createMemoryRepo, createFakeMailer, createTokenFactory, REGION, USER_POOL_ID, CLIENT_ID } from './helpers.mjs';

async function setup({ mailer = createFakeMailer(), allowedEmails = '*' } = {}) {
  const repo = createMemoryRepo();
  const tokens = await createTokenFactory();
  let clock = new Date('2026-11-01T15:00:00Z');
  const api = createApi({
    repo,
    mailer,
    verify: createCognitoVerifier({ region: REGION, userPoolId: USER_POOL_ID, clientId: CLIENT_ID, allowedEmails, jwks: tokens.jwks }),
    appUrl: 'https://cards.example.com',
    now: () => clock,
    log: { error() {} },
    pause: async () => {},
  });
  const call = async (method, path, body, { token, claims } = {}) => {
    const auth = token === null ? undefined : `Bearer ${token ?? await tokens.sign(claims)}`;
    const res = await api({
      rawPath: path,
      requestContext: { http: { method } },
      headers: auth ? { authorization: auth } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { repo, mailer, tokens, call, setClock: (d) => { clock = new Date(d); } };
}

const smiths = {
  labelName: 'The Smith Family',
  formalName: 'Mr. and Mrs. John Smith',
  greeting: 'John and Mary',
  address: { line1: '123 Maple St', city: 'Troy', state: 'mi', zip: '48083' },
  emails: ['smiths@example.com'],
  members: [
    { firstName: 'John', lastName: 'Smith', email: 'john@example.com' },
    { firstName: 'Mary', lastName: 'Smith', email: 'SMITHS@example.com' },
    { firstName: '', lastName: '' },
  ],
  groups: 'Family, Christmas, family',
};

test('requires a valid Cognito ID token from this pool and app client', async () => {
  const { call, tokens } = await setup();
  assert.equal((await call('GET', '/households', undefined, { token: null })).status, 401);
  assert.equal((await call('GET', '/households', undefined, { token: 'nope' })).status, 401);
  // Another pool, another app client, an access token, or an expired token are all refused.
  assert.equal((await call('GET', '/households', undefined, { token: await tokens.sign({}, { issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Other' }) })).status, 401);
  assert.equal((await call('GET', '/households', undefined, { token: await tokens.sign({}, { audience: 'other-client' }) })).status, 401);
  assert.equal((await call('GET', '/households', undefined, { token: await tokens.sign({ token_use: 'access' }) })).status, 401);
  assert.equal((await call('GET', '/households', undefined, { token: await tokens.sign({}, { expiresIn: '-1m' }) })).status, 401);
  // An unconfirmed email is refused.
  assert.equal((await call('GET', '/households', undefined, { claims: { email_verified: false } })).status, 403);
  assert.equal((await call('GET', '/households')).status, 200);
});

test('allow list blocks other accounts', async () => {
  const { call } = await setup({ allowedEmails: 'mike@example.com' });
  assert.equal((await call('GET', '/me')).status, 200);
  assert.equal((await call('GET', '/me', undefined, { claims: { sub: 'u2', email: 'x@example.com' } })).status, 403);
});

test('household create cleans input and is private to its owner', async () => {
  const { call } = await setup();
  const res = await call('POST', '/households', smiths);
  assert.equal(res.status, 200);
  const h = res.body.household;
  assert.equal(h.address.state, 'MI');
  assert.deepEqual(h.groups, ['Family', 'Christmas']);
  assert.equal(h.members.length, 2, 'blank person row dropped');
  assert.deepEqual(householdEmails(h), ['smiths@example.com', 'john@example.com']);

  const other = { claims: { sub: 'user-2', email: 'other@example.com' } };
  assert.equal((await call('GET', '/households', undefined, other)).body.households.length, 0);
  assert.equal((await call('PUT', `/households/${h.id}`, smiths, other)).status, 404);
  assert.equal((await call('DELETE', `/households/${h.id}`, undefined, other)).status, 404);
});

test('household validation', async () => {
  const { call } = await setup();
  assert.match((await call('POST', '/households', { labelName: '' })).body.error, /Name on envelope is required/);
  assert.match((await call('POST', '/households', { labelName: 'X', emails: 'bad' })).body.error, /not a valid email/);
  assert.match((await call('POST', '/households', { labelName: 'X', members: [{ email: 'a@b.co' }] })).body.error, /Give person 1 a name/);
});

test('import reports the failing row', async () => {
  const { call } = await setup();
  const bad = await call('POST', '/households/import', { households: [smiths, { labelName: '' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Row 2:/);
  const ok = await call('POST', '/households/import', { households: [smiths, { labelName: 'The Lees' }] });
  assert.equal(ok.body.imported, 2);
  assert.equal((await call('GET', '/households')).body.households.length, 2);
});

test('occasions: tag, mark mailed, copy to next year, delete cleans up', async () => {
  const { call, repo } = await setup();
  const a = (await call('POST', '/households', smiths)).body.household;
  const b = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;
  const occ = (await call('POST', '/occasions', { name: 'Christmas cards 2026', kind: 'card', date: '2026-12-25' })).body.occasion;

  let tags = (await call('PUT', `/occasions/${occ.id}/tags`, { add: [a.id, b.id] })).body.tags;
  assert.equal(tags.length, 2);
  assert.equal((await call('PUT', `/occasions/${occ.id}/tags`, { add: ['nothere'] })).status, 404);

  tags = (await call('POST', `/occasions/${occ.id}/mailed`, { householdIds: [a.id], mailed: true })).body.tags;
  assert.ok(tags.find((t) => t.householdId === a.id).mailedAt);
  assert.ok(!tags.find((t) => t.householdId === b.id).mailedAt);

  const list = (await call('GET', '/occasions')).body.occasions;
  assert.deepEqual(list[0].counts, { tagged: 2, mailed: 1, invited: 0 });

  // Deleting a household drops it from every occasion.
  await call('DELETE', `/households/${b.id}`);
  const next = await call('POST', '/occasions', { name: 'Christmas cards 2027', copyFrom: occ.id });
  assert.equal(next.body.copied, 1);
  const copied = (await call('GET', `/occasions/${next.body.occasion.id}`)).body.tags;
  assert.equal(copied[0].householdId, a.id);
  assert.equal(copied[0].mailedAt, undefined, 'fresh mailed state');

  tags = (await call('PUT', `/occasions/${occ.id}/tags`, { remove: [a.id] })).body.tags;
  assert.equal(tags.length, 0);

  await call('DELETE', `/occasions/${next.body.occasion.id}`);
  assert.equal([...repo.rows.values()].filter((r) => r.SK.startsWith('TAG#')).length, 0);
});

test('invites: one email per household, skips no-email, records failures', async () => {
  const mailer = createFakeMailer({ failFor: ['bounce@example.com'] });
  const { call } = await setup({ mailer });
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky' });
  const a = (await call('POST', '/households', smiths)).body.household;
  const b = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;
  const c = (await call('POST', '/households', { labelName: 'The Bounces', emails: ['bounce@example.com'] })).body.household;
  const occ = (await call('POST', '/occasions', { name: 'Holiday open house', kind: 'invite', date: '2026-12-12', time: '7 PM' })).body.occasion;
  await call('PUT', `/occasions/${occ.id}/tags`, { add: [a.id, b.id, c.id] });

  assert.match((await call('POST', `/occasions/${occ.id}/invites`, { householdIds: [a.id] })).body.error, /invitation message/);
  await call('PUT', `/occasions/${occ.id}`, { ...occ, invite: { subject: 'Come over!', message: 'Join us for cocoa.\n\nKids welcome.' } });

  const test = await call('POST', `/occasions/${occ.id}/invites`, { test: true });
  assert.equal(test.body.sentTo, 'mike@example.com');
  assert.match(mailer.sent[0].subject, /^\[Test\] Come over!/);

  const res = (await call('POST', `/occasions/${occ.id}/invites`, { householdIds: [a.id, b.id, c.id] })).body.results;
  assert.deepEqual(res.map((r) => r.status), ['sent', 'skipped', 'failed']);
  assert.match(res[2].reason, /sandbox/);
  const sent = mailer.sent[1];
  assert.deepEqual(sent.to, ['smiths@example.com', 'john@example.com']);
  assert.equal(sent.replyTo, 'mike@example.com');
  assert.equal(sent.fromName, 'Mike Szmansky');
  assert.match(sent.text, /Dear John and Mary/);
  assert.match(sent.text, /When: Saturday, December 12, 2026 at 7 PM/);
  assert.match(sent.html, /Kids welcome/);

  const tags = (await call('GET', `/occasions/${occ.id}`)).body.tags;
  assert.ok(tags.find((t) => t.householdId === a.id).invitedAt);
  assert.ok(tags.find((t) => t.householdId === c.id).inviteError);
});

test('address-update link: request, public view, reply, review, expiry', async () => {
  const { call, mailer, setClock, repo } = await setup();
  const h = (await call('POST', '/households', smiths)).body.household;
  assert.match((await call('POST', `/households/${(await call('POST', '/households', { labelName: 'No Email' })).body.household.id}/address-request`, {})).body.error, /Add an email/);

  const req = await call('POST', `/households/${h.id}/address-request`, { message: 'New year, new list!' });
  assert.equal(req.status, 200);
  const link = /https:\/\/cards\.example\.com\/update\.html#t=([\w-]+)/.exec(mailer.sent[0].text);
  assert.ok(link, 'email carries the link');
  const token = link[1];
  // The raw token is never stored, only its hash.
  assert.ok(![...repo.rows.keys()].some((k) => k.includes(token)));

  const view = await call('GET', `/public/address/${token}`, undefined, { token: null });
  assert.equal(view.status, 200);
  assert.equal(view.body.labelName, 'The Smith Family');
  assert.equal(view.body.address.line1, '123 Maple St');

  const bad = await call('POST', `/public/address/${token}`, { address: { line1: '' } }, { token: null });
  assert.equal(bad.status, 400);

  const reply = await call('POST', `/public/address/${token}`, {
    address: { line1: '9 Oak Ct', city: 'Rochester Hills', state: 'MI', zip: '48307' }, note: 'We moved!',
  }, { token: null });
  assert.equal(reply.status, 200);
  assert.equal(mailer.sent.at(-1).to, 'mike@example.com', 'owner notified');

  let hh = (await call('GET', '/households')).body.households.find((x) => x.id === h.id);
  assert.equal(hh.address.line1, '123 Maple St', 'nothing changes until accepted');
  assert.equal(hh.pendingUpdate.address.line1, '9 Oak Ct');

  hh = (await call('POST', `/households/${h.id}/pending/accept`)).body.household;
  assert.equal(hh.address.line1, '9 Oak Ct');
  assert.equal(hh.pendingUpdate, undefined);
  assert.equal((await call('POST', `/households/${h.id}/pending/accept`)).status, 409);

  // "Still correct" confirms without a review step.
  await call('POST', `/public/address/${token}`, { unchanged: true }, { token: null });
  hh = (await call('GET', '/households')).body.households.find((x) => x.id === h.id);
  assert.ok(hh.addressConfirmedAt);
  assert.equal(hh.pendingUpdate, undefined);

  setClock('2026-12-15T00:00:00Z');
  assert.equal((await call('GET', `/public/address/${token}`, undefined, { token: null })).status, 404);
  assert.equal((await call('GET', '/public/address/short', undefined, { token: null })).status, 404);
});

test('profile print offsets are bounded', async () => {
  const { call } = await setup();
  const ok = await call('PUT', '/me', { print: { labelOffsetX: 0.05 }, returnAddress: { line1: '1 Main', city: 'Troy', state: 'mi', zip: '48083' } });
  assert.equal(ok.body.profile.print.labelOffsetX, 0.05);
  assert.equal(ok.body.profile.print.envelopeOffsetY, 0);
  assert.equal(ok.body.profile.returnAddress.state, 'MI');
  assert.equal((await call('PUT', '/me', { print: { labelOffsetY: 3 } })).status, 400);
});
