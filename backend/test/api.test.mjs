import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, householdEmails } from '../src/lib/api.mjs';
import { createCognitoVerifier } from '../src/lib/auth.mjs';
import { createMemoryRepo, createFakeMailer, createFakeFiles, createTokenFactory, REGION, USER_POOL_ID, CLIENT_ID } from './helpers.mjs';

function createFakeDirectory(existing = []) {
  const users = new Set(existing);
  const invited = [];
  return { invited, async invite(email) { if (users.has(email)) return { invited: false, exists: true }; users.add(email); invited.push(email); return { invited: true }; } };
}

async function setup({ mailer = createFakeMailer(), allowedEmails = '*', files = createFakeFiles(), directory = createFakeDirectory(['kim@example.com']) } = {}) {
  const repo = createMemoryRepo();
  const tokens = await createTokenFactory();
  let clock = new Date('2026-11-01T15:00:00Z');
  const api = createApi({
    repo,
    mailer,
    verify: createCognitoVerifier({ region: REGION, userPoolId: USER_POOL_ID, clientId: CLIENT_ID, allowedEmails, jwks: tokens.jwks }),
    appUrl: 'https://cards.example.com',
    files,
    directory,
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
  return { repo, mailer, files, directory, tokens, call, setClock: (d) => { clock = new Date(d); } };
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

test('profile photo: upload, replace, remove, and private to its owner', async () => {
  const { call, files } = await setup();
  assert.match((await call('POST', '/me/avatar', { type: 'image/gif', size: 10 })).body.error, /JPEG, PNG or WebP/);
  assert.match((await call('POST', '/me/avatar', { type: 'image/jpeg', size: 6 * 1024 * 1024 })).body.error, /up to 5 MB/);

  const first = (await call('POST', '/me/avatar', { type: 'image/jpeg', size: 1000 })).body;
  assert.match(first.uploadUrl, /avatars\/user-1\/[a-f0-9]{16}\.jpg\?put/);
  // Completing before the browser's upload arrived is refused.
  assert.equal((await call('POST', `/me/avatar/${first.id}/complete`, { type: 'image/jpeg' })).status, 409);
  files.put(`avatars/user-1/${first.id}.jpg`, 1000);
  let profile = (await call('POST', `/me/avatar/${first.id}/complete`, { type: 'image/jpeg' })).body.profile;
  assert.match(profile.avatarUrl, new RegExp(`avatars/user-1/${first.id}\\.jpg\\?get`));
  assert.equal(profile.avatar, undefined, 'the storage key is not sent to the browser');
  assert.ok((await call('GET', '/me')).body.profile.avatarUrl);

  // A new photo replaces the old file.
  const second = (await call('POST', '/me/avatar', { type: 'image/jpeg', size: 900 })).body;
  files.put(`avatars/user-1/${second.id}.jpg`, 900);
  await call('POST', `/me/avatar/${second.id}/complete`, { type: 'image/jpeg' });
  assert.deepEqual([...files.objects.keys()], [`avatars/user-1/${second.id}.jpg`]);

  // Saving other settings keeps the photo.
  profile = (await call('PUT', '/me', { firstName: 'Mike' })).body.profile;
  assert.ok(profile.avatarUrl);

  // Another user can't complete someone else's upload into their own profile.
  const other = { claims: { sub: 'user-2', email: 'other@example.com' } };
  assert.equal((await call('POST', `/me/avatar/${second.id}/complete`, { type: 'image/jpeg' }, other)).status, 409);

  profile = (await call('DELETE', '/me/avatar')).body.profile;
  assert.equal(profile.avatarUrl, undefined);
  assert.equal(files.objects.size, 0);
});

test('sharing: edit and view-only access to the owner\'s book', async () => {
  const { call, mailer, directory } = await setup();
  const kim = { claims: { sub: 'user-kim', email: 'kim@example.com' } };     // has an account already
  const joe = { claims: { sub: 'user-joe', email: 'joe@example.com' } };     // doesn't yet
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky', returnName: 'The Szmanskys', returnAddress: { line1: '1 Home Rd', city: 'Troy', state: 'MI', zip: '48083' } });
  const h = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;

  // Only valid, other people; only the owner manages sharing.
  assert.match((await call('POST', '/shares', { email: 'mike@example.com', role: 'edit' })).body.error, /your own email/);
  assert.match((await call('POST', '/shares', { email: 'kim@example.com', role: 'admin' })).body.error, /Can edit/);

  let res = await call('POST', '/shares', { email: 'Kim@Example.com', role: 'edit' });
  assert.equal(res.status, 200);
  assert.equal(res.body.share.invited, undefined, 'Kim already had an account');
  assert.equal(mailer.sent.at(-1).to, 'kim@example.com');
  assert.match(mailer.sent.at(-1).subject, /Mike Szmansky shared their address book/);
  res = await call('POST', '/shares', { email: 'joe@example.com', role: 'view' });
  assert.equal(res.body.share.invited, true);
  assert.deepEqual(directory.invited, ['joe@example.com']);
  assert.match(mailer.sent.at(-1).text, /temporary password/);
  assert.deepEqual((await call('GET', '/shares')).body.shares.map((x) => [x.email, x.role]), [['joe@example.com', 'view'], ['kim@example.com', 'edit']]);

  // Kim (edit) works in Mike's book, with Mike's return address and her own name.
  await call('PUT', '/me', { firstName: 'Kim' }, kim);
  let me = (await call('GET', '/me', undefined, kim)).body;
  assert.deepEqual([me.book.role, me.book.canEdit, me.book.ownerName], ['edit', true, 'Mike Szmansky']);
  assert.equal(me.profile.firstName, 'Kim');
  assert.equal(me.profile.returnName, 'The Szmanskys');
  assert.deepEqual((await call('GET', '/households', undefined, kim)).body.households.map((x) => x.labelName), ['The Lees']);
  assert.equal((await call('POST', '/households', { labelName: 'The Abbotts' }, kim)).status, 200);
  assert.equal((await call('GET', '/households')).body.households.length, 2, 'Mike sees what Kim added');
  // Kim can edit the shared return address; Mike sees it.
  await call('PUT', '/me', { returnAddress: { line1: '2 New Rd', city: 'Troy', state: 'MI', zip: '48083' } }, kim);
  assert.equal((await call('GET', '/me')).body.profile.returnAddress.line1, '2 New Rd');
  assert.equal((await call('GET', '/me', undefined, kim)).body.profile.firstName, 'Kim', 'her own name is untouched');
  // But sharing settings are the owner's.
  assert.equal((await call('GET', '/shares', undefined, kim)).status, 403);
  assert.equal((await call('POST', '/shares', { email: 'x@example.com', role: 'edit' }, kim)).status, 403);

  // Joe (view only) can read and print, but not change or send.
  me = (await call('GET', '/me', undefined, joe)).body;
  assert.deepEqual([me.book.role, me.book.canEdit], ['view', false]);
  assert.equal((await call('GET', '/households', undefined, joe)).body.households.length, 2);
  const occ = (await call('POST', '/occasions', { name: 'Cards' })).body.occasion;
  assert.equal((await call('GET', `/occasions/${occ.id}`, undefined, joe)).status, 200);
  for (const [m, path, body] of [['POST', '/households', { labelName: 'X' }], ['PUT', `/households/${h.id}`, { labelName: 'X' }],
    ['DELETE', `/households/${h.id}`], ['POST', '/occasions', { name: 'X' }], ['PUT', `/occasions/${occ.id}/tags`, { add: [h.id] }],
    ['POST', `/occasions/${occ.id}/mailed`, { householdIds: [h.id], mailed: true }], ['POST', `/households/${h.id}/address-request`, {}],
    ['PUT', '/me', { returnName: 'Hacked' }]]) {
    const r = await call(m, path, body, joe);
    assert.equal(r.status, 403, `${m} ${path}`);
    assert.equal(r.body.code, 'view_only');
  }
  assert.equal((await call('PUT', '/me', { firstName: 'Joe' }, joe)).status, 200, 'his own name is fine');

  // Mike changes Joe to edit, then stops sharing with Kim.
  await call('PUT', '/shares/joe@example.com', { role: 'edit' });
  assert.equal((await call('POST', '/households', { labelName: 'Y' }, joe)).status, 200);
  await call('DELETE', '/shares/kim@example.com');
  me = (await call('GET', '/me', undefined, kim)).body;
  assert.equal(me.book.role, 'owner', 'Kim is back in her own book');
  assert.equal((await call('GET', '/households', undefined, kim)).body.households.length, 0);

  // Someone already sharing another book can't be added to a second one.
  const ann = { claims: { sub: 'user-ann', email: 'ann@example.com' } };
  assert.match((await call('POST', '/shares', { email: 'joe@example.com', role: 'view' }, ann)).body.error, /already has another address book/);
});

test('sharing: an address check sent by a shared editor lands in the owner\'s book and notifies the sender', async () => {
  const { call, mailer } = await setup();
  const kim = { claims: { sub: 'user-kim', email: 'kim@example.com' } };
  await call('POST', '/shares', { email: 'kim@example.com', role: 'edit' });
  const h = (await call('POST', '/households', { labelName: 'The Lees', emails: ['lee@example.com'], address: { line1: '1 A', city: 'Troy', state: 'MI', zip: '48083' } })).body.household;
  await call('POST', `/households/${h.id}/address-request`, {}, kim);
  const token = /#t=([\w-]+)/.exec(mailer.sent.at(-1).text)[1];
  assert.equal(mailer.sent.at(-1).replyTo, 'kim@example.com');
  await call('POST', `/public/address/${token}`, { address: { line1: '9 New St', city: 'Troy', state: 'MI', zip: '48084' } }, { token: null });
  assert.equal(mailer.sent.at(-1).to, 'kim@example.com');
  const lees = (await call('GET', '/households')).body.households.find((x) => x.id === h.id);
  assert.equal(lees.pendingUpdate.address.line1, '9 New St', 'the reply is in the shared book');
});
