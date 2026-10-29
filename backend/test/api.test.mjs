import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, householdEmails } from '../src/lib/api.mjs';
import { createCognitoVerifier } from '../src/lib/auth.mjs';
import { createMemoryRepo, createFakeMailer, createFakeFiles, createTokenFactory, REGION, USER_POOL_ID, CLIENT_ID } from './helpers.mjs';

// Stand-in for the Cognito user pool: email -> permanent account id ("sub").
function createFakeDirectory(existing = {}) {
  const users = new Map(Object.entries(existing));
  const invited = [];
  const signedIn = new Set(Object.keys(existing)); // accounts given up front have signed in
  const off = new Set();
  const admins = new Set();
  const account = (email) => ({ sub: users.get(email), username: users.get(email), email, status: signedIn.has(email) ? 'active' : 'invited', enabled: !off.has(users.get(email)), createdAt: '2026-10-01T00:00:00.000Z' });
  return {
    invited, users, admins, off,
    async invite(email) {
      if (users.has(email) && signedIn.has(email)) return { sub: users.get(email), invited: false, exists: true };
      if (users.has(email)) { invited.push(email); return { sub: users.get(email), invited: true, resent: true }; }
      const sub = `user-${email.split('@')[0]}`;
      users.set(email, sub);
      invited.push(email);
      return { sub, invited: true };
    },
    async listUsers() { return [...users.keys()].map(account); },
    async groupMembers() { return [...admins]; },
    async getBySub(sub) { const e = [...users].find(([, s]) => s === sub)?.[0]; return e ? account(e) : null; },
    async setEnabled(username, on) { if (on) off.delete(username); else off.add(username); },
    async deleteUser(username) { for (const [e, s] of users) if (s === username) users.delete(e); },
    changeEmail(from, to) { const sub = users.get(from); users.delete(from); users.set(to, sub); },
  };
}

async function setup({ media = createFakeFiles(), addressChecker, mailer = createFakeMailer(), allowedEmails = '*', files = createFakeFiles(), directory = createFakeDirectory({ 'kim@example.com': 'user-kim', 'mike@example.com': 'user-1' }) } = {}) {
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
    media,
    addressChecker,
    now: () => clock,
    log: { error() {} },
    pause: async () => {},
  });
  // claims: who's calling; book: which address book (owner's account id), like the app's x-book header.
  const call = async (method, path, body, { token, claims, book } = {}) => {
    const auth = token === null ? undefined : `Bearer ${token ?? await tokens.sign(claims)}`;
    const res = await api({
      rawPath: path.split('?')[0],
      queryStringParameters: Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? '')),
      requestContext: { http: { method } },
      headers: { ...(auth ? { authorization: auth } : {}), ...(book ? { 'x-book': book } : {}) },
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
  assert.match((await call('POST', '/households', { labelName: '' })).body.error, /Household Greeting is required/);
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

  assert.match((await call('POST', `/occasions/${occ.id}/invites`, { householdIds: [a.id] })).body.error, /Design the email first/);
  await call('PUT', `/occasions/${occ.id}`, { ...occ, invite: { subject: 'Come over!', message: 'Join us for cocoa.\n\nKids welcome.' } });

  const test = await call('POST', `/occasions/${occ.id}/invites`, { test: true });
  assert.equal(test.body.sentTo, 'mike@example.com');
  assert.match(mailer.sent[0].subject, /^\[Test\] Come over!/);

  const res = (await call('POST', `/occasions/${occ.id}/invites`, { householdIds: [a.id, b.id, c.id] })).body.results;
  assert.deepEqual(res.map((r) => r.status), ['sent', 'skipped', 'failed']);
  assert.match(res[2].reason, /sandbox/);
  const sent = mailer.sent[1];
  assert.deepEqual(sent.to, ['john@example.com'], 'the default contact: first person with an email');
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
  assert.equal(hh.addressRequest.repliedAt, hh.pendingUpdate.receivedAt, 'the reply is noted on the request');

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

// Mike is user-1. Kim already has an account; Joe gets invited.
const KIM = { sub: 'user-kim', email: 'kim@example.com' };
const as = (who, book) => ({ claims: who, ...(book ? { book } : {}) });

test('sharing: people keep their own book and open shared ones; edit vs view only', async () => {
  const { call, mailer, directory } = await setup();
  const joe = { sub: 'user-joe', email: 'joe@example.com' };
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky', returnName: 'The Szmanskys', returnAddress: { line1: '1 Home Rd', city: 'Troy', state: 'MI', zip: '48083' } });
  const lees = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;

  assert.match((await call('POST', '/shares', { email: 'mike@example.com', role: 'edit' })).body.error, /your own/);
  assert.match((await call('POST', '/shares', { email: 'kim@example.com', role: 'admin' })).body.error, /Can edit/);
  let res = await call('POST', '/shares', { email: 'Kim@Example.com', role: 'edit' });
  assert.deepEqual([res.status, res.body.share.id, res.body.share.invited], [200, 'user-kim', undefined]);
  assert.match(mailer.sent.at(-1).subject, /Mike Szmansky shared their address book/);
  res = await call('POST', '/shares', { email: 'joe@example.com', role: 'view' });
  assert.deepEqual([res.body.share.id, res.body.share.invited], ['user-joe', true]);
  assert.deepEqual(directory.invited, ['joe@example.com']);

  // Kim has her own private book, plus Mike's.
  await call('PUT', '/me', { firstName: 'Kim' }, as(KIM));
  await call('POST', '/households', { labelName: 'Kim’s friend' }, as(KIM));
  const books = (await call('GET', '/books', undefined, as(KIM))).body.books;
  assert.deepEqual(books.map((b) => [b.id, b.role, b.own ?? false, b.ownerName ?? '']), [['user-kim', 'owner', true, ''], ['user-1', 'edit', false, 'Mike Szmansky']]);
  assert.deepEqual((await call('GET', '/households', undefined, as(KIM))).body.households.map((h) => h.labelName), ['Kim’s friend'], 'her own book by default');
  assert.deepEqual((await call('GET', '/households', undefined, as(KIM, 'user-1'))).body.households.map((h) => h.labelName), ['The Lees']);
  assert.equal((await call('GET', '/households')).body.households.length, 1, "Mike doesn't see Kim's private book");

  // In Mike's book Kim edits; her name and return address are still hers.
  let me = (await call('GET', '/me', undefined, as(KIM, 'user-1'))).body;
  assert.deepEqual([me.book.id, me.book.role, me.book.canEdit, me.profile.firstName, me.profile.returnName], ['user-1', 'edit', true, 'Kim', undefined]);
  assert.equal((await call('POST', '/households', { labelName: 'The Abbotts' }, as(KIM, 'user-1'))).status, 200);
  assert.equal((await call('GET', '/households')).body.households.length, 2, 'Mike sees what Kim added to his book');
  await call('PUT', '/me', { returnAddress: { line1: '2 New Rd', city: 'Troy', state: 'MI', zip: '48083' } }, as(KIM, 'user-1'));
  assert.equal((await call('GET', '/me')).body.profile.returnAddress.line1, '1 Home Rd', "Mike's return address is untouched");
  assert.equal((await call('GET', '/me', undefined, as(KIM))).body.profile.returnAddress.line1, '2 New Rd', 'hers, in her own book');
  assert.equal((await call('GET', '/me', undefined, as(KIM, 'user-1'))).body.profile.returnAddress.line1, '2 New Rd', "and in Mike's");
  // Occasions belong to each book.
  await call('POST', '/occasions', { name: "Mike's cards" });
  await call('POST', '/occasions', { name: "Kim's party" }, as(KIM));
  assert.deepEqual((await call('GET', '/occasions', undefined, as(KIM, 'user-1'))).body.occasions.map((o) => o.name), ["Mike's cards"]);
  assert.deepEqual((await call('GET', '/occasions', undefined, as(KIM))).body.occasions.map((o) => o.name), ["Kim's party"]);
  // Kim manages sharing of her own book even while Mike's is open, never Mike's.
  assert.deepEqual((await call('GET', '/shares', undefined, as(KIM, 'user-1'))).body.shares, []);

  // Joe (view only) reads Mike's book but can't change it or send; his own book is fully his.
  me = (await call('GET', '/me', undefined, as(joe, 'user-1'))).body;
  assert.deepEqual([me.book.role, me.book.canEdit], ['view', false]);
  assert.equal((await call('GET', '/households', undefined, as(joe, 'user-1'))).body.households.length, 2);
  const occ = (await call('GET', '/occasions')).body.occasions[0];
  for (const [m, path, body] of [['POST', '/households', { labelName: 'X' }], ['PUT', `/households/${lees.id}`, { labelName: 'X' }],
    ['DELETE', `/households/${lees.id}`], ['POST', '/occasions', { name: 'X' }], ['PUT', `/occasions/${occ.id}/tags`, { add: [lees.id] }],
    ['POST', `/occasions/${occ.id}/mailed`, { householdIds: [lees.id], mailed: true }], ['POST', `/households/${lees.id}/address-request`, {}]]) {
    const r = await call(m, path, body, as(joe, 'user-1'));
    assert.deepEqual([r.status, r.body.code], [403, 'view_only'], `${m} ${path}`);
  }
  assert.equal((await call('POST', '/households', { labelName: 'Joe’s own' }, as(joe))).status, 200, 'his own book is fine');
  const jr = await call('PUT', '/me', { returnName: 'The Joes' }, as(joe, 'user-1'));
  assert.equal(jr.body.profile.returnName, 'The Joes', 'his return address is his own, even with view-only access to the open book');
  assert.equal((await call('GET', '/me')).body.profile.returnName, 'The Szmanskys', "Mike's is untouched");

  // Books not shared with you are off limits.
  assert.equal((await call('GET', '/households', undefined, as(joe, 'user-kim'))).body.code, 'book_gone');
  assert.equal((await call('GET', '/households', undefined, as(joe, '../x'))).status, 400);

  // Changing access and stopping sharing.
  await call('PUT', '/shares/user-joe', { role: 'edit' });
  assert.equal((await call('POST', '/households', { labelName: 'Y' }, as(joe, 'user-1'))).status, 200);
  await call('DELETE', '/shares/user-kim');
  assert.equal((await call('GET', '/households', undefined, as(KIM, 'user-1'))).body.code, 'book_gone');
  assert.deepEqual((await call('GET', '/books', undefined, as(KIM))).body.books.map((b) => b.id), ['user-kim']);
  assert.equal((await call('GET', '/households', undefined, as(KIM))).body.households.length, 1, 'her own book is untouched');
});

test('sharing: someone can have several books shared with them', async () => {
  const { call } = await setup();
  const ann = { sub: 'user-ann', email: 'ann@example.com' };
  await call('POST', '/shares', { email: 'kim@example.com', role: 'edit' });
  await call('PUT', '/me', { firstName: 'Ann' }, as(ann));
  assert.equal((await call('POST', '/shares', { email: 'kim@example.com', role: 'view' }, as(ann))).status, 200);
  const books = (await call('GET', '/books', undefined, as(KIM))).body.books;
  assert.deepEqual(books.map((b) => [b.id, b.role]), [['user-kim', 'owner'], ['user-ann', 'view'], ['user-1', 'edit']]);
});

test("sharing: an address check sent by a shared editor lands in the owner's book and notifies the sender", async () => {
  const { call, mailer } = await setup();
  await call('POST', '/shares', { email: 'kim@example.com', role: 'edit' });
  const h = (await call('POST', '/households', { labelName: 'The Lees', emails: ['lee@example.com'], address: { line1: '1 A', city: 'Troy', state: 'MI', zip: '48083' } })).body.household;
  await call('POST', `/households/${h.id}/address-request`, {}, as(KIM, 'user-1'));
  const token = /#t=([\w-]+)/.exec(mailer.sent.at(-1).text)[1];
  assert.equal(mailer.sent.at(-1).replyTo, 'kim@example.com');
  await call('POST', `/public/address/${token}`, { address: { line1: '9 New St', city: 'Troy', state: 'MI', zip: '48084' } }, { token: null });
  assert.equal(mailer.sent.at(-1).to, 'kim@example.com');
  assert.equal((await call('GET', '/households')).body.households[0].pendingUpdate.address.line1, '9 New St');
});

test('sharing follows the account, not the email: either side can change their email', async () => {
  const { call, directory } = await setup();
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky' });
  await call('POST', '/households', { labelName: 'The Lees' });
  await call('POST', '/shares', { email: 'kim@example.com', role: 'edit' });

  directory.changeEmail('kim@example.com', 'kim.new@example.com');
  const kimNew = { sub: 'user-kim', email: 'kim.new@example.com' };
  assert.deepEqual((await call('GET', '/books', undefined, as(kimNew))).body.books.map((b) => b.id), ['user-kim', 'user-1']);
  assert.equal((await call('GET', '/households', undefined, as(kimNew, 'user-1'))).body.households.length, 1);
  assert.deepEqual((await call('GET', '/shares')).body.shares.map((x) => [x.id, x.email]), [['user-kim', 'kim.new@example.com']]);

  // Someone else signing in with Kim's old email gets nothing of Mike's.
  const stranger = { sub: 'user-stranger', email: 'kim@example.com' };
  assert.deepEqual((await call('GET', '/books', undefined, as(stranger))).body.books.map((b) => b.id), ['user-stranger']);
  assert.equal((await call('GET', '/households', undefined, as(stranger, 'user-1'))).body.code, 'book_gone');

  // Mike changes his email: Kim still has his book, showing his new email.
  const mikeNew = { sub: 'user-1', email: 'mike.new@example.com' };
  await call('GET', '/me', undefined, as(mikeNew));
  const shared = (await call('GET', '/books', undefined, as(kimNew))).body.books[1];
  assert.deepEqual([shared.ownerName, shared.ownerEmail], ['Mike Szmansky', 'mike.new@example.com']);
});

test('shares saved by earlier versions move over at sign-in', async () => {
  const { call, repo } = await setup();
  await call('POST', '/households', { labelName: 'The Lees' });
  // First version (keyed by email) for Kim; second version (one book per person) for Joe.
  await repo.batchPut([
    { PK: 'USER#user-1', SK: 'SHARE#kim@example.com', email: 'kim@example.com', role: 'edit', sharedAt: '2026-10-20T00:00:00Z' },
    { PK: 'SHARED#kim@example.com', SK: 'BOOK', email: 'kim@example.com', role: 'edit', ownerSub: 'user-1', sharedAt: '2026-10-20T00:00:00Z' },
    { PK: 'USER#user-1', SK: 'SHARE#user-joe', memberSub: 'user-joe', email: 'joe@example.com', role: 'view', sharedAt: '2026-10-21T00:00:00Z' },
    { PK: 'MEMBER#user-joe', SK: 'BOOK', memberSub: 'user-joe', email: 'joe@example.com', role: 'view', ownerSub: 'user-1', sharedAt: '2026-10-21T00:00:00Z' },
  ]);
  // The owner can manage both before they sign in.
  assert.deepEqual((await call('GET', '/shares')).body.shares.map((x) => x.id), ['joe@example.com', 'kim@example.com'].map((e) => (e.startsWith('joe') ? 'user-joe' : e)));

  assert.deepEqual((await call('GET', '/books', undefined, as(KIM))).body.books.map((b) => [b.id, b.role]), [['user-kim', 'owner'], ['user-1', 'edit']]);
  const joe = { sub: 'user-joe', email: 'joe@example.com' };
  assert.equal((await call('GET', '/households', undefined, as(joe, 'user-1'))).body.households.length, 1, 'opening the book directly migrates too');
  assert.deepEqual((await call('GET', '/shares')).body.shares.map((x) => [x.id, x.role]), [['user-joe', 'view'], ['user-kim', 'edit']]);
  const leftovers = [...repo.rows.values()].filter((r) => r.PK.startsWith('SHARED#') || (r.PK.startsWith('MEMBER#') && r.SK === 'BOOK') || r.SK === 'SHARE#kim@example.com');
  assert.deepEqual(leftovers, []);

  // An email-keyed share can be stopped before the person ever signs in.
  await repo.batchPut([
    { PK: 'USER#user-1', SK: 'SHARE#ann@example.com', email: 'ann@example.com', role: 'view', sharedAt: '2026-10-20T00:00:00Z' },
    { PK: 'SHARED#ann@example.com', SK: 'BOOK', email: 'ann@example.com', role: 'view', ownerSub: 'user-1', sharedAt: '2026-10-20T00:00:00Z' },
  ]);
  await call('DELETE', `/shares/${encodeURIComponent('ann@example.com')}`);
  assert.equal(await repo.get('SHARED#ann@example.com', 'BOOK'), null);
});

test('Trash: delete moves to the bin, restore brings everything back, 30 days then gone', async () => {
  const { call, repo, setClock } = await setup();
  const lees = (await call('POST', '/households', { labelName: 'The Lees', address: { city: 'Troy', state: 'MI' } })).body.household;
  const rose = (await call('POST', '/households', { labelName: 'Grandma Rose' })).body.household;
  const cards = (await call('POST', '/occasions', { name: 'Christmas cards' })).body.occasion;
  const party = (await call('POST', '/occasions', { name: 'Party' })).body.occasion;
  await call('PUT', `/occasions/${cards.id}/tags`, { add: [lees.id, rose.id] });
  await call('PUT', `/occasions/${party.id}/tags`, { add: [lees.id] });
  await call('POST', `/occasions/${cards.id}/mailed`, { householdIds: [lees.id], mailed: true });

  // Delete a household: gone from lists and occasion lists, but in the bin.
  assert.equal((await call('DELETE', `/households/${lees.id}`)).body.trashed, true);
  assert.deepEqual((await call('GET', '/households')).body.households.map((h) => h.labelName), ['Grandma Rose']);
  assert.equal((await call('GET', `/occasions/${cards.id}`)).body.tags.length, 1);
  let bin = (await call('GET', '/trash')).body;
  assert.equal(bin.days, 30);
  assert.deepEqual(bin.items.map((i) => [i.type, i.name, i.detail, i.deletedBy]), [['household', 'The Lees', 'Troy, MI', 'mike@example.com']]);

  // Delete an occasion with its list.
  await call('DELETE', `/occasions/${party.id}`);
  assert.deepEqual((await call('GET', '/occasions')).body.occasions.map((o) => o.name), ['Christmas cards']);
  bin = (await call('GET', '/trash')).body.items;
  assert.deepEqual(bin.map((i) => [i.type, i.name]), [['occasion', 'Party'], ['household', 'The Lees']]);

  // Restore the household: back on Christmas cards (still mailed); not on Party, which is in the bin.
  let r = (await call('POST', `/trash/household/${lees.id}/restore`)).body;
  assert.deepEqual([r.household.labelName, r.relinked], ['The Lees', 1]);
  const tags = (await call('GET', `/occasions/${cards.id}`)).body.tags;
  assert.ok(tags.find((t) => t.householdId === lees.id).mailedAt);
  assert.equal((await call('POST', `/trash/household/${lees.id}/restore`)).status, 404, 'already out of the bin');

  // Restore the occasion: its list comes back for households that exist.
  r = (await call('POST', `/trash/occasion/${party.id}/restore`)).body;
  assert.equal(r.relinked, 1);
  assert.deepEqual((await call('GET', `/occasions/${party.id}`)).body.tags.map((t) => t.householdId), [lees.id]);

  // Delete forever, and empty the bin.
  await call('DELETE', `/households/${rose.id}`);
  await call('DELETE', `/occasions/${cards.id}`);
  await call('DELETE', `/trash/household/${rose.id}`);
  assert.deepEqual((await call('GET', '/trash')).body.items.map((i) => i.name), ['Christmas cards']);
  assert.equal((await call('DELETE', '/trash')).body.emptied, 1);
  assert.equal((await call('GET', '/trash')).body.items.length, 0);

  // After 30 days an item is gone, even before DynamoDB's own clean-up runs.
  await call('DELETE', `/households/${lees.id}`);
  const row = [...repo.rows.values()].find((x) => x.SK.startsWith('TRASH#'));
  assert.ok(row.ttl > 0, 'DynamoDB removes it on its own via ttl');
  setClock('2026-11-30T15:00:00Z');
  assert.equal((await call('GET', '/trash')).body.items.length, 1, 'still there on day 29');
  setClock('2026-12-01T15:00:01Z'); // 30 days after it was deleted
  assert.equal((await call('GET', '/trash')).body.items.length, 0);
  assert.equal((await call('POST', `/trash/household/${lees.id}/restore`)).status, 404);
  assert.equal([...repo.rows.values()].filter((x) => x.SK.startsWith('TRASH#')).length, 0, 'purged');
});

test('Trash in a shared book: editors restore, view only can look', async () => {
  const { call } = await setup();
  const kim = { claims: { sub: 'user-kim', email: 'kim@example.com' }, book: 'user-1' };
  const joe = { claims: { sub: 'user-joe', email: 'joe@example.com' }, book: 'user-1' };
  await call('POST', '/shares', { email: 'kim@example.com', role: 'edit' });
  await call('POST', '/shares', { email: 'joe@example.com', role: 'view' });
  const h = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;
  await call('DELETE', `/households/${h.id}`, undefined, kim);
  assert.equal((await call('GET', '/trash')).body.items[0].deletedBy, 'kim@example.com');
  assert.equal((await call('GET', '/trash', undefined, joe)).body.items.length, 1);
  assert.equal((await call('POST', `/trash/household/${h.id}/restore`, undefined, joe)).status, 403);
  assert.equal((await call('DELETE', '/trash', undefined, joe)).status, 403);
  assert.equal((await call('POST', `/trash/household/${h.id}/restore`, undefined, kim)).status, 200);
  assert.equal((await call('GET', '/trash', undefined, { claims: { sub: 'user-kim', email: 'kim@example.com' } })).body.items.length, 0, "Kim's own book has its own bin");
});

test('default contact: one per household, and invitations go to it unless changed', async () => {
  const { call, mailer } = await setup();
  const h = (await call('POST', '/households', { labelName: 'The Smiths', members: [
    { firstName: 'John', lastName: 'Smith', email: 'john@x.com' },
    { firstName: 'Mary', lastName: 'Smith', email: 'mary@x.com', primary: true },
    { firstName: 'Sam', lastName: 'Smith', email: 'sam@x.com', primary: true },
  ] })).body.household;
  assert.deepEqual(h.members.map((m) => m.primary ?? false), [false, true, false], 'only the first ticked one counts');
  assert.equal(h.members[0].birthday, undefined);
  const lees = (await call('POST', '/households', { labelName: 'The Lees', emails: ['lees@x.com'] })).body.household;
  const occ = (await call('POST', '/occasions', { name: 'Party', invite: { message: 'Come!' } })).body.occasion;
  await call('PUT', `/occasions/${occ.id}/tags`, { add: [h.id, lees.id] });

  const send = async (recipients) => {
    mailer.sent.length = 0;
    await call('POST', `/occasions/${occ.id}/invites`, { householdIds: [h.id, lees.id], recipients });
    return mailer.sent.map((m) => m.to);
  };
  assert.deepEqual(await send(), [['mary@x.com'], ['lees@x.com']], 'default contact; a household with no people uses its own address');
  assert.deepEqual(await send({ [h.id]: h.members[0].id }), [['john@x.com'], ['lees@x.com']], 'someone else instead');
  assert.deepEqual(await send({ [h.id]: 'all' }), [['john@x.com', 'mary@x.com', 'sam@x.com'], ['lees@x.com']], 'everyone');
  assert.deepEqual(await send({ [h.id]: 'nobody-by-that-id' }), [['mary@x.com'], ['lees@x.com']], 'unknown choice falls back to the default');
  const tag = (await call('GET', `/occasions/${occ.id}`)).body.tags.find((t) => t.householdId === h.id);
  assert.deepEqual(tag.invitedTo, ['mary@x.com']);
});

test('address checks: off until set up, then validated and passed to the checker', async () => {
  let { call } = await setup();
  assert.deepEqual((await call('GET', '/address-check')).body, { checks: { enabled: false } });
  assert.equal((await call('POST', '/address-check', { address: { line1: '1 Elm', city: 'Troy', state: 'MI' } })).status, 503);

  const seen = [];
  const addressChecker = {
    async status() { return { enabled: true, limit: 55, used: 0, remaining: 55, availableAt: null }; },
    async check(a) { seen.push(a); return { result: { status: 'confirmed', suggested: a }, checks: await this.status() }; },
  };
  ({ call } = await setup({ addressChecker }));
  assert.equal((await call('GET', '/address-check')).body.checks.remaining, 55);
  let r = await call('POST', '/address-check', { address: { line1: '1 Elm', city: 'Troy' } });
  assert.deepEqual([r.status, r.body.error], [400, 'Enter the street, state, and the city or ZIP first']);
  r = await call('POST', '/address-check', { address: { line1: '1 Elm', city: 'Toronto', state: 'ON', country: 'Canada' } });
  assert.deepEqual([r.status, r.body.error], [400, 'Address checks only work for US addresses']);
  r = await call('POST', '/address-check', { address: { line1: ' 1 Elm ', state: 'MI', zip: '48083', country: 'USA' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.status, 'confirmed');
  assert.deepEqual(seen, [{ line1: '1 Elm', line2: undefined, city: undefined, state: 'MI', zip: '48083', country: 'USA' }]);
});

test('address checks: the monthly limit reaches the browser with when it opens up again', async () => {
  const checks = { enabled: true, limit: 55, used: 55, remaining: 0, availableAt: '2026-11-01T15:20:00.000Z' };
  const { HttpError } = await import('../src/lib/auth.mjs');
  const addressChecker = {
    async status() { return checks; },
    async check() { const e = new HttpError(429, 'The address checks for this month are used up.'); e.extra = { checks }; throw e; },
  };
  const { call } = await setup({ addressChecker });
  const r = await call('POST', '/address-check', { address: { line1: '1 Elm', city: 'Troy', state: 'MI' } });
  assert.equal(r.status, 429);
  assert.deepEqual(r.body.checks, checks);
});

test('occasion types: cards, invitations, emails; old "other" reads as cards', async () => {
  const { call, repo } = await setup();
  for (const kind of ['card', 'invite', 'email']) assert.equal((await call('POST', '/occasions', { name: kind, kind })).body.occasion.kind, kind);
  assert.equal((await call('POST', '/occasions', { name: 'g', kind: 'email', greetStyle: 'person' })).body.occasion.greetStyle, 'person');
  assert.equal((await call('POST', '/occasions', { name: 'g', kind: 'email', greetStyle: 'nope' })).body.occasion.greetStyle, 'informal');
  assert.equal((await call('POST', '/occasions', { name: 'c', kind: 'card', nameStyle: 'informal' })).body.occasion.nameStyle, 'informal');
  assert.equal((await call('POST', '/occasions', { name: 'c', kind: 'card', nameStyle: 'nickname' })).status, 400);
  assert.equal((await call('POST', '/occasions', { name: 'x', kind: 'other' })).body.occasion.kind, 'card');
  assert.equal((await call('POST', '/occasions', { name: 'x', kind: 'party' })).status, 400);
  await repo.put({ PK: 'USER#user-1', SK: 'OCC#old', id: 'old', name: 'Old', kind: 'other', createdAt: '2025-01-01T00:00:00Z' });
  assert.equal((await call('GET', '/occasions/old')).body.occasion.kind, 'card');
  assert.equal((await call('GET', '/occasions')).body.occasions.find((o) => o.id === 'old').kind, 'card');
});

test('designs are cleaned when saved and kept when the occasion is edited', async () => {
  const { call } = await setup();
  const o = (await call('POST', '/occasions', { name: 'Party', kind: 'invite' })).body.occasion;
  let r = await call('PUT', `/occasions/${o.id}/design`, { html: '<p style="color:#ff0000">Hi {{greeting}}</p><script>x()</script>', background: '#fef3c7', font: 'great-vibes' });
  assert.equal(r.status, 200);
  const { updatedAt, updatedBy, updatedByName, ...design } = r.body.occasion.design;
  assert.deepEqual(design, { html: '<p style="color:#ff0000">Hi {{greeting}}</p>', background: '#fef3c7', font: 'great-vibes' });
  assert.ok(updatedAt && updatedBy === 'user-1');
  assert.equal((await call('PUT', `/occasions/${o.id}/design`, { html: 'x', background: 'red' })).status, 400);
  assert.equal((await call('PUT', `/occasions/${o.id}/design`, { html: 'x', font: 'comic-sans' })).status, 400);
  assert.equal((await call('PUT', `/occasions/${o.id}/design`, { html: 'x', border: 'zigzag' })).status, 400);
  r = await call('PUT', `/occasions/${o.id}/design`, { html: '<img src="https://x.example/a.png" align="left" style="float:left;margin:0 16px 12px 0;border:3px solid #9f1239">', border: 'double', borderColor: '#14532d' });
  assert.deepEqual([r.body.occasion.design.border, r.body.occasion.design.borderColor], ['double', '#14532d']);
  assert.match(r.body.occasion.design.html, /align="left" style="float:left;margin:0 16px 12px 0;border:3px solid #9f1239"/);
  r = await call('PUT', `/occasions/${o.id}/design`, { html: '<p style="color:#ff0000">Hi {{greeting}}</p><script>x()</script>', background: '#fef3c7', font: 'great-vibes', border: 'none', borderColor: '#000000' });
  assert.equal((await call('PUT', `/occasions/${o.id}/design`, { html: 'x'.repeat(100_001) })).status, 400);
  r = await call('PUT', `/occasions/${o.id}`, { name: 'Party!', kind: 'invite' });
  assert.equal(r.body.occasion.design.html, '<p style="color:#ff0000">Hi {{greeting}}</p>');
});

test('pictures for designs: signed upload to a public, unguessable address', async () => {
  const { call } = await setup();
  const o = (await call('POST', '/occasions', { name: 'Party', kind: 'email' })).body.occasion;
  const r = await call('POST', `/occasions/${o.id}/images`, { type: 'image/png', size: 1234 });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/cards.example.com\/media\/[0-9a-f]{32}\.png$/);
  assert.match(r.body.uploadUrl, /^https:\/\/s3.example\/media\/[0-9a-f]{32}\.png\?put&type=image%2Fpng&size=1234$/);
  assert.equal((await call('POST', `/occasions/${o.id}/images`, { type: 'image/svg+xml', size: 10 })).status, 400);
  assert.equal((await call('POST', `/occasions/${o.id}/images`, { type: 'image/png', size: 6 * 1024 * 1024 })).status, 400);
});

test('emails: a designed email to one chosen person with the chosen greeting', async () => {
  const { call, mailer } = await setup();
  const h = (await call('POST', '/households', smiths)).body.household;
  const o = (await call('POST', '/occasions', { name: 'Football', kind: 'email', invite: { subject: 'Beer and wings' } })).body.occasion;
  assert.equal((await call('POST', `/occasions/${o.id}/invites`, { householdIds: [h.id] })).status, 400); // no design yet
  await call('PUT', `/occasions/${o.id}/design`, { html: '<p>Hey {{greeting}}, game at {{time}}</p>' });
  await call('PUT', `/occasions/${o.id}/tags`, { add: [h.id] });
  const john = h.members.find((m) => m.firstName === 'John');
  const r = await call('POST', `/occasions/${o.id}/invites`, { householdIds: [h.id], recipients: { [h.id]: john.id }, greetings: { [h.id]: 'John' } });
  assert.deepEqual(r.body.results.map((x) => [x.status, x.to]), [['sent', ['john@example.com']]]);
  const sent = mailer.sent.at(-1);
  assert.equal(sent.subject, 'Beer and wings');
  assert.match(sent.html, /Hey John, game at/);
});

test('emails: people ticked on the list get it; the greeting can still name the whole household', async () => {
  const { call, mailer } = await setup();
  const h = (await call('POST', '/households', { labelName: 'The Smith Family', greeting: 'Kim and Jim', members: [
    { firstName: 'Jim', lastName: 'Smith', email: 'jim@example.com', primary: true }, { firstName: 'Kim', lastName: 'Smith', email: 'kim@example.com' }, { firstName: 'Baby', lastName: 'Smith' }] })).body.household;
  const [jim, kim, baby] = h.members;
  const o = (await call('POST', '/occasions', { name: 'Party', kind: 'email' })).body.occasion;
  await call('PUT', `/occasions/${o.id}/design`, { html: '<p>Dear {{greeting}},</p>' });
  let r = await call('PUT', `/occasions/${o.id}/tags`, { people: { [h.id]: [kim.id] } });
  assert.deepEqual(r.body.tags.map((t) => t.to), [[kim.id]]);
  assert.equal((await call('PUT', `/occasions/${o.id}/tags`, { people: { [h.id]: [baby.id] } })).status, 400); // no email
  r = await call('POST', `/occasions/${o.id}/invites`, { householdIds: [h.id], greetings: { [h.id]: 'Kim and Jim' } });
  assert.deepEqual(r.body.results[0].to, ['kim@example.com']);
  assert.match(mailer.sent.at(-1).html, /Dear Kim and Jim,/);
  r = await call('PUT', `/occasions/${o.id}/tags`, { people: { [h.id]: [jim.id, kim.id] } });
  assert.deepEqual(r.body.tags[0].to, [jim.id, kim.id]);
  r = await call('POST', `/occasions/${o.id}/invites`, { householdIds: [h.id] });
  assert.deepEqual(r.body.results[0].to, ['jim@example.com', 'kim@example.com']);
  r = await call('PUT', `/occasions/${o.id}/tags`, { people: { [h.id]: [] } });
  assert.deepEqual(r.body.tags, []); // nobody ticked: off the list
});

test('two people editing at once: the second save is refused with the other version, and can be forced', async () => {
  const { call, setClock } = await setup({ directory: undefined });
  const mike = { sub: 'user-1', email: 'mike@example.com' };
  const jordan = { sub: 'user-jordan', email: 'jordan@example.com' };
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky' }, { claims: mike });
  await call('POST', '/shares', { email: 'jordan@example.com', role: 'edit' }, { claims: mike });
  await call('PUT', '/me', { firstName: 'Jordan', lastName: 'Reyes' }, { claims: jordan });
  const asJordan = { claims: jordan, book: 'user-1' };
  const h = (await call('POST', '/households', { labelName: 'The Smith Family' }, { claims: mike })).body.household;

  // Both open it; Jordan saves first.
  setClock('2026-11-01T15:01:00Z');
  let r = await call('PUT', `/households/${h.id}`, { labelName: 'The Smiths', baseUpdatedAt: h.updatedAt }, asJordan);
  assert.equal(r.status, 200);
  setClock('2026-11-01T15:02:00Z');
  r = await call('PUT', `/households/${h.id}`, { labelName: 'Smith Family', baseUpdatedAt: h.updatedAt }, { claims: mike });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'conflict');
  assert.equal(r.body.changedBy, 'Jordan Reyes');
  assert.equal(r.body.error, 'Jordan Reyes changed this while you were editing it');
  assert.equal(r.body.current.labelName, 'The Smiths');
  // "Save mine anyway": resend from their version.
  r = await call('PUT', `/households/${h.id}`, { labelName: 'Smith Family', baseUpdatedAt: r.body.current.updatedAt }, { claims: mike });
  assert.equal(r.status, 200);
  assert.equal(r.body.household.labelName, 'Smith Family');
  // Without a base (older app), saves go through as before.
  assert.equal((await call('PUT', `/households/${h.id}`, { labelName: 'X' }, asJordan)).status, 200);

  // Occasions and designs: separate stamps, so details and design don't clash.
  const o = (await call('POST', '/occasions', { name: 'Party', kind: 'invite' }, { claims: mike })).body.occasion;
  setClock('2026-11-01T15:03:00Z');
  const d1 = (await call('PUT', `/occasions/${o.id}/design`, { html: '<p>v1</p>', baseUpdatedAt: null }, asJordan)).body.occasion;
  r = await call('PUT', `/occasions/${o.id}`, { name: 'Party!', kind: 'invite', baseUpdatedAt: o.updatedAt }, { claims: mike });
  assert.equal(r.status, 200); // the design save didn't touch the details
  assert.equal(r.body.occasion.design.html, '<p>v1</p>');
  r = await call('PUT', `/occasions/${o.id}/design`, { html: '<p>mine</p>', baseUpdatedAt: null }, { claims: mike });
  assert.equal(r.status, 409);
  assert.equal(r.body.changedBy, 'Jordan Reyes');
  assert.equal(r.body.current.design.html, '<p>v1</p>');
  r = await call('PUT', `/occasions/${o.id}/design`, { html: '<p>mine</p>', baseUpdatedAt: d1.design.updatedAt }, { claims: mike });
  assert.equal(r.status, 200);
  r = await call('PUT', `/occasions/${o.id}`, { name: 'Party?', kind: 'invite', baseUpdatedAt: o.updatedAt }, asJordan);
  assert.equal(r.status, 409);
  assert.equal(r.body.changedBy, 'Mike Szmansky');
});

test('password changed: the notice goes to the account email, in its time zone, not more than once in a few seconds', async () => {
  const { call, mailer, setClock } = await setup();
  setClock('2026-10-22T16:51:00Z');
  await call('GET', '/me?tz=America/Detroit');
  assert.equal((await call('GET', '/me', undefined)).status, 200);
  let r = await call('POST', '/me/password-changed', {});
  assert.deepEqual(r.body, { sent: true });
  const m = mailer.sent.at(-1);
  assert.deepEqual([m.to, m.subject], ['mike@example.com', 'Your Occasions Address Book password was changed']);
  assert.match(m.text, /was changed on Thursday, October 22, 2026 at 12:51 PM EDT\./);
  assert.match(m.text, /If it wasn't you, reset your password right away/);
  r = await call('POST', '/me/password-changed', {});
  assert.deepEqual(r.body, { sent: false });
  setClock('2026-10-22T16:52:00Z');
  assert.deepEqual((await call('POST', '/me/password-changed', {})).body, { sent: true });
});

test('address verified: saving with the address a check confirmed marks it; changing the address clears it', async () => {
  const confirmed = { line1: '12 Oak St', line2: '', city: 'Troy', state: 'MI', zip: '48083-2101' };
  const addressChecker = {
    async status() { return { enabled: true, limit: 1000, used: 0, remaining: 1000, availableAt: null }; },
    async check(a) {
      const status = /nowhere/i.test(a.line1) ? 'not-found' : 'confirmed';
      return { result: { status, suggested: status === 'confirmed' ? confirmed : { ...a, zip: '00000' } }, checks: await this.status() };
    },
  };
  const { call } = await setup({ addressChecker });
  // Typed address that was never checked: not verified.
  let h = (await call('POST', '/households', { labelName: 'The Oaks', address: { line1: '12 oak street', city: 'troy', state: 'mi' } })).body.household;
  assert.equal(h.addressVerifiedAt, undefined);
  // Check, then save with the suggested address (any spacing or case): verified.
  await call('POST', '/address-check', { address: { line1: '12 oak street', city: 'troy', state: 'mi' } });
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oaks', address: { ...confirmed, line1: '12  OAK st' }, baseUpdatedAt: h.updatedAt })).body.household;
  assert.ok(h.addressVerifiedAt);
  // The app can't claim it on its own.
  const other = (await call('POST', '/households', { labelName: 'X', address: { line1: '1 Elm', city: 'Troy', state: 'MI', zip: '48083' }, addressVerifiedAt: '2026-01-01T00:00:00Z' })).body.household;
  assert.equal(other.addressVerifiedAt, undefined);
  // Editing something else keeps it; changing the address drops it.
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oak Family', address: confirmed, baseUpdatedAt: h.updatedAt })).body.household;
  assert.ok(h.addressVerifiedAt);
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oak Family', address: { ...confirmed, line2: 'Apt 2' }, baseUpdatedAt: h.updatedAt })).body.household;
  assert.equal(h.addressVerifiedAt, undefined);
  // A check that wasn't confirmed never verifies.
  await call('POST', '/address-check', { address: { line1: '9 Nowhere Ln', city: 'Troy', state: 'MI' } });
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oak Family', address: { line1: '9 Nowhere Ln', city: 'Troy', state: 'MI', zip: '00000' }, baseUpdatedAt: h.updatedAt })).body.household;
  assert.equal(h.addressVerifiedAt, undefined);
  // The building confirmed but not the apartment: still verified.
  const apt = { line1: '1 Riverfront Ctr W', line2: 'Apt 804', city: 'Flint', state: 'MI', zip: '48502-1320' };
  addressChecker.check = async () => ({ result: { status: 'unit-unconfirmed', suggested: apt }, checks: await addressChecker.status() });
  await call('POST', '/address-check', { address: { ...apt, line1: '1 Riverfront Center W', zip: '48502' } });
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oak Family', address: apt, baseUpdatedAt: h.updatedAt })).body.household;
  assert.ok(h.addressVerifiedAt);
  // Back to the confirmed address within the week: verified again.
  h = (await call('PUT', `/households/${h.id}`, { labelName: 'The Oak Family', address: confirmed, baseUpdatedAt: h.updatedAt })).body.household;
  assert.ok(h.addressVerifiedAt);
});

test('duplicate an occasion: same settings and list, "Copy of" name, fresh mailed and sent marks', async () => {
  const { call } = await setup();
  const a = (await call('POST', '/households', { labelName: 'The Smiths', members: [{ firstName: 'John', email: 'john@example.com' }] })).body.household;
  const b = (await call('POST', '/households', { labelName: 'The Lees' })).body.household;
  const o = (await call('POST', '/occasions', { name: 'Holiday open house', kind: 'invite', date: '2026-12-19', time: '7:00 PM', location: 'Our place', nameStyle: 'formal', greetStyle: 'household', notes: 'Bring chips' })).body.occasion;
  await call('PUT', `/occasions/${o.id}/design`, { html: '<p>Hi {{greeting}}</p>', background: '#fef3c7' });
  await call('PUT', `/occasions/${o.id}/tags`, { add: [a.id, b.id] });
  await call('POST', `/occasions/${o.id}/mailed`, { householdIds: [a.id], mailed: true });
  await call('DELETE', `/households/${b.id}`); // gone from the address book: not copied

  const r = await call('POST', `/occasions/${o.id}/duplicate`);
  assert.equal(r.status, 200);
  const copy = r.body.occasion;
  assert.notEqual(copy.id, o.id);
  assert.deepEqual([copy.name, copy.kind, copy.date, copy.time, copy.location, copy.nameStyle, copy.greetStyle, copy.notes, copy.design.html],
    ['Copy of Holiday open house', 'invite', '2026-12-19', '7:00 PM', 'Our place', 'formal', 'household', 'Bring chips', '<p>Hi {{greeting}}</p>']);
  assert.equal(r.body.copied, 1);
  const got = (await call('GET', `/occasions/${copy.id}`)).body;
  assert.deepEqual(got.tags.map((t) => [t.householdId, t.mailedAt]), [[a.id, undefined]]);
  assert.equal((await call('GET', '/occasions')).body.occasions.length, 2);
  assert.equal((await call('POST', '/occasions/nope/duplicate')).status, 404);
});

// ---------- admin ----------
const ADMIN = { claims: { 'cognito:groups': ['admin'] } };

test('only admins can manage accounts, and /me says who is one', async () => {
  const { call, directory, repo } = await setup();
  directory.admins.add('user-1');
  assert.equal((await call('GET', '/me')).body.isAdmin, undefined);
  assert.equal((await call('GET', '/me', undefined, ADMIN)).body.isAdmin, true);
  const no = await call('GET', '/admin/users');
  assert.equal(no.status, 403);
  await repo.put({ PK: 'ACCOUNT#user-kim', SK: 'LOGIN', at: '2026-10-27T14:05:00.000Z' });
  const res = await call('GET', '/admin/users', undefined, ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users.map((u) => u.lastLoginAt), ['2026-10-27T14:05:00.000Z', undefined], 'blank until they sign in');
  assert.deepEqual(res.body.users.map((u) => [u.email, u.status, u.enabled, !!u.admin]), [
    ['kim@example.com', 'active', true, false],
    ['mike@example.com', 'active', true, true],
  ]);
});

test('admins invite people and re-send invitations', async () => {
  const { call, directory } = await setup();
  let res = await call('POST', '/admin/users', { email: 'Joe@Example.com' }, ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(directory.invited, ['joe@example.com']);
  assert.equal(res.body.users.find((u) => u.email === 'joe@example.com').status, 'invited');
  assert.match((await call('POST', '/admin/users', { email: 'kim@example.com' }, ADMIN)).body.error, /already has an account/);
  assert.match((await call('POST', '/admin/users', { email: 'nope' }, ADMIN)).body.error, /not a valid email/);
  res = await call('POST', '/admin/users/user-joe/resend', undefined, ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(directory.invited, ['joe@example.com', 'joe@example.com']);
  assert.match((await call('POST', '/admin/users/user-kim/resend', undefined, ADMIN)).body.error, /already signed in/);
  assert.equal((await call('POST', '/admin/users/user-nobody/resend', undefined, ADMIN)).status, 404);
});

test('a turned-off account is locked out at once, and can be turned back on', async () => {
  const { call } = await setup();
  const KIM = { claims: { sub: 'user-kim', email: 'kim@example.com' } };
  assert.equal((await call('GET', '/me', undefined, KIM)).status, 200);
  let res = await call('POST', '/admin/users/user-kim/disable', undefined, ADMIN);
  assert.equal(res.body.users.find((u) => u.id === 'user-kim').enabled, false);
  res = await call('GET', '/me', undefined, KIM); // her sign-in token is still unexpired
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'account_off');
  await call('POST', '/admin/users/user-kim/enable', undefined, ADMIN);
  assert.equal((await call('GET', '/me', undefined, KIM)).status, 200);
  assert.match((await call('POST', '/admin/users/user-1/disable', undefined, ADMIN)).body.error, /your own account/);
  assert.equal((await call('POST', '/admin/users/user-kim/explode', undefined, ADMIN)).status, 404);
});

test('deleting an account removes its data and its sharing on both sides', async () => {
  const { call, repo, files, directory } = await setup();
  const KIM = { claims: { sub: 'user-kim', email: 'kim@example.com' } };
  directory.users.set('ann@example.com', 'user-ann');
  const ANN = { claims: { sub: 'user-ann', email: 'ann@example.com' } };
  // Kim has a household and a photo, shares her book with Ann, and Mike shares his with Kim.
  await call('POST', '/households', smiths, KIM);
  const { id } = (await call('POST', '/me/avatar', { type: 'image/jpeg', size: 1000 }, KIM)).body;
  files.put?.(`avatars/user-kim/${id}.jpg`, 1000);
  await call('POST', `/me/avatar/${id}/complete`, { type: 'image/jpeg' }, KIM);
  await call('POST', '/shares', { email: 'ann@example.com', role: 'edit' }, KIM);
  await call('POST', '/shares', { email: 'kim@example.com', role: 'view' });
  assert.equal((await repo.query('USER#user-kim')).length > 0, true);

  const res = await call('DELETE', '/admin/users/user-kim', undefined, ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users.map((u) => u.email), ['ann@example.com', 'mike@example.com']);
  assert.deepEqual(await repo.query('USER#user-kim'), []);
  assert.deepEqual(await repo.query('MEMBER#user-kim'), []);
  assert.deepEqual(await repo.query('MEMBER#user-ann', 'BOOK#'), []);
  assert.deepEqual((await call('GET', '/shares')).body.shares, []);
  assert.equal(await files.size(`avatars/user-kim/${id}.jpg`), null);
  assert.equal((await call('GET', '/me', undefined, KIM)).status, 401);
  assert.equal((await call('GET', '/me', undefined, ANN)).status, 200);
  assert.match((await call('DELETE', '/admin/users/user-1', undefined, ADMIN)).body.error, /your own account/);
  assert.equal((await call('DELETE', '/admin/users/user-kim')).status, 403);
});

test('admins set the inactivity timeout everyone gets', async () => {
  const { call } = await setup();
  assert.deepEqual((await call('GET', '/me')).body.settings, { idleMinutes: 30 });
  assert.equal((await call('PUT', '/admin/settings', { idleMinutes: 45 })).status, 403);
  assert.deepEqual((await call('GET', '/admin/settings', undefined, ADMIN)).body.settings, { idleMinutes: 30 });
  const res = await call('PUT', '/admin/settings', { idleMinutes: 45 }, ADMIN);
  assert.deepEqual(res.body.settings, { idleMinutes: 45 });
  assert.equal((await call('GET', '/me', undefined, { claims: { sub: 'user-kim', email: 'kim@example.com' } })).body.settings.idleMinutes, 45);
  assert.match((await call('PUT', '/admin/settings', { idleMinutes: 2 }, ADMIN)).body.error, /between 5 and 480/);
  assert.match((await call('PUT', '/admin/settings', { idleMinutes: 12.5 }, ADMIN)).body.error, /whole number/);
});

test('sharing: anyone a book is shared with can copy a household into their own book', async () => {
  const { call } = await setup();
  const KIMC = { sub: 'user-kim', email: 'kim@example.com' };
  const h = (await call('POST', '/households', { ...smiths, notes: 'Gate code 1234', groups: ['Family'] })).body.household;
  const occ = (await call('POST', '/occasions', { name: 'Cards', kind: 'card' })).body.occasion;
  await call('PUT', `/occasions/${occ.id}/tags`, { add: [h.id] });
  await call('POST', '/shares', { email: 'kim@example.com', role: 'view' });
  // View only is enough: it writes only to Kim's own book.
  const res = await call('POST', `/households/${h.id}/copy-to-mine`, undefined, as(KIMC, 'user-1'));
  assert.equal(res.status, 200);
  const mine = (await call('GET', '/households', undefined, as(KIMC))).body.households;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].labelName, 'The Smith Family');
  assert.equal(mine[0].notes, 'Gate code 1234');
  assert.notEqual(mine[0].id, h.id);
  assert.equal((await call('GET', '/households')).body.households.length, 1, "the owner's book is unchanged");
  const again = await call('POST', `/households/${h.id}/copy-to-mine`, undefined, as(KIMC, 'user-1'));
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already in your address book/);
  assert.equal((await call('POST', `/households/${h.id}/copy-to-mine`)).status, 400, 'the owner has it already');
  assert.equal((await call('POST', `/households/${h.id}/copy-to-mine`, undefined, as({ sub: 'user-joe', email: 'joe@example.com' }, 'user-1'))).status, 403, 'not shared with Joe');
});

test('printer settings keep the envelope sizes someone uses', async () => {
  const { call } = await setup();
  assert.equal((await call('GET', '/me')).body.profile.print.envelopes, undefined, 'the app starts with A2 and A7');
  const res = await call('PUT', '/me', { print: { envelopes: ['a2', 'n10', 'n10'] } });
  assert.deepEqual(res.body.profile.print.envelopes, ['a2', 'n10']);
  assert.equal((await call('PUT', '/me', { print: { labelOffsetX: 0.1 } })).body.profile.print.envelopes.length, 2, 'kept when not sent');
  assert.match((await call('PUT', '/me', { print: { envelopes: [] } })).body.error, /at least one of the envelope sizes/);
  assert.deepEqual((await call('PUT', '/me', { print: { labels: ['avery5163'] } })).body.profile.print.labels, ['avery5163']);
  assert.match((await call('PUT', '/me', { print: { labels: [] } })).body.error, /at least one of the label sizes/);
  assert.equal((await call('PUT', '/me', { print: { envelopes: ['<b>'] } })).status, 400);
});

test('emails: each household gets RSVP buttons and a calendar invite; answers land on the list and notify the sender', async () => {
  const { call, mailer, repo } = await setup();
  await call('PUT', '/me', { firstName: 'Mike', lastName: 'Szmansky' });
  await call('GET', '/me?tz=America/Detroit');
  const h = (await call('POST', '/households', smiths)).body.household;
  const o = (await call('POST', '/occasions', { name: 'Holiday Party', kind: 'email', date: '2026-12-19', time: '7:00 PM', location: '14 Cherry Lane' })).body.occasion;
  await call('PUT', `/occasions/${o.id}/design`, { html: '<p>Dear {{greeting}}</p>' });
  await call('PUT', `/occasions/${o.id}/tags`, { add: [h.id] });
  await call('POST', `/occasions/${o.id}/invites`, { householdIds: [h.id] });
  const sent = mailer.sent.at(-1);
  const token = /rsvp\.html#t=([\w-]+)/.exec(sent.html)[1];
  for (const a of ['yes', 'maybe', 'no']) assert.ok(sent.html.includes(`rsvp.html#t=${token}&amp;a=${a}`), a);
  assert.match(sent.html, /Add to calendar/);
  assert.match(sent.text, /RSVP: https:\/\/cards\.example\.com\/rsvp\.html#t=/);
  assert.match(sent.calendar, /DTSTART:20261220T000000Z/);
  assert.match(sent.calendar, /ORGANIZER;CN="Mike Szmansky":mailto:mike@example\.com/);
  assert.match(sent.calendar.replace(/\r\n /g, ''), /ATTENDEE;CN="[^"]+";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:/);

  // The guest's page: no sign-in.
  let r = await call('GET', `/public/rsvp/${token}`, undefined, { token: null });
  assert.deepEqual([r.body.occasion, r.body.date, r.body.time, r.body.household, r.body.fromName, r.body.calendar, r.body.rsvp], ['Holiday Party', 'Saturday, December 19, 2026', '7:00 PM', 'The Smith Family', 'Mike Szmansky', true, null]);
  assert.match((await call('POST', `/public/rsvp/${token}`, { answer: 'sure' }, { token: null })).body.error, /Yes, Maybe or No/);
  r = await call('POST', `/public/rsvp/${token}`, { answer: 'yes', count: 3, note: 'Bringing pie' }, { token: null });
  assert.equal(r.body.saved, true);
  const tag = (await call('GET', `/occasions/${o.id}`)).body.tags[0];
  assert.deepEqual([tag.rsvp.answer, tag.rsvp.count, tag.rsvp.note], ['yes', 3, 'Bringing pie']);
  const notice = mailer.sent.at(-1);
  assert.deepEqual([notice.to, notice.subject], ['mike@example.com', 'RSVP from The Smith Family: Yes (3 people)']);
  // Changing their mind replaces the answer; No has no head count.
  await call('POST', `/public/rsvp/${token}`, { answer: 'no', count: 3 }, { token: null });
  assert.deepEqual((await call('GET', `/occasions/${o.id}`)).body.tags[0].rsvp.answer, 'no');
  assert.equal((await call('GET', `/occasions/${o.id}`)).body.tags[0].rsvp.count, undefined);

  // "Add to calendar" downloads the invite.
  const api = (await setup()).call; // a separate app can't see it
  assert.equal((await api('GET', `/public/rsvp/${token}`, undefined, { token: null })).status, 404);
  assert.equal((await call('GET', '/public/rsvp/not-a-real-token-at-all', undefined, { token: null })).status, 404);
  assert.ok(await repo.get(`RSVP#${(await import('node:crypto')).createHash('sha256').update(token).digest('hex')}`, 'RSVP'));
});

test('emails: a test email has working RSVP buttons that save nothing; no date means no calendar invite', async () => {
  const { call, mailer } = await setup();
  const o = (await call('POST', '/occasions', { name: 'Someday', kind: 'email' })).body.occasion;
  await call('PUT', `/occasions/${o.id}/design`, { html: '<p>Hi</p>' });
  await call('POST', `/occasions/${o.id}/invites`, { test: true });
  const sent = mailer.sent.at(-1);
  assert.equal(sent.calendar, undefined);
  assert.doesNotMatch(sent.html, /Add to calendar/);
  const token = /rsvp\.html#t=([\w-]+)/.exec(sent.html)[1];
  assert.equal((await call('GET', `/public/rsvp/${token}`, undefined, { token: null })).body.test, true);
  const r = await call('POST', `/public/rsvp/${token}`, { answer: 'yes', count: 2 }, { token: null });
  assert.deepEqual([r.body.saved, r.body.test], [false, true]);
});

test('the sign-in trigger never blocks a sign-in', async () => {
  const { handler } = await import('../src/handlers/cognito-post-authentication.mjs');
  const event = { request: { userAttributes: { sub: 'user-kim' } } };
  assert.equal(await handler(event), event, 'without a table it does nothing and lets the sign-in through');
});

test('custom designs: up to 3 named designs per kind; the same name replaces; they are each person’s own', async () => {
  const { call } = await setup();
  const KIMC = { claims: { sub: 'user-kim', email: 'kim@example.com' } };
  const d = (html) => ({ html, background: '#ffffff', font: 'georgia' });
  for (const n of ['Party', 'Dinner', 'Brunch']) assert.equal((await call('POST', '/designs', { kind: 'email', name: n, design: d(`<p>${n}</p>`) })).status, 200);
  let r = await call('POST', '/designs', { kind: 'email', name: 'Picnic', design: d('<p>x</p>') });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'designs_full');
  assert.deepEqual([...r.body.names].sort(), ['Brunch', 'Dinner', 'Party']);
  r = await call('POST', '/designs', { kind: 'email', name: 'party', design: d('<p>New party</p>') }); // replaces "Party"
  assert.equal(r.status, 200);
  assert.equal(r.body.designs.filter((x) => x.kind === 'email').length, 3);
  assert.equal(r.body.designs.find((x) => x.name === 'party').design.html, '<p>New party</p>');
  assert.equal((await call('POST', '/designs', { kind: 'invite', name: 'Picnic', design: d('<p>x</p>') })).status, 200, 'invitations have their own 3');
  assert.match((await call('POST', '/designs', { kind: 'email', name: '', design: d('x') })).body.error, /Design name is required/);
  assert.equal((await call('POST', '/designs', { kind: 'email', name: 'X', design: d('<script>alert(1)</script><p>ok</p>') })).status, 409);
  assert.deepEqual((await call('GET', '/designs', undefined, KIMC)).body.designs, [], "Kim doesn't see Mike's");
  const dinner = (await call('GET', '/designs')).body.designs.find((x) => x.name === 'Dinner');
  r = await call('DELETE', `/designs/${dinner.id}`);
  assert.deepEqual(r.body.designs.filter((x) => x.kind === 'email').map((x) => x.name).sort(), ['Brunch', 'party']);
  assert.equal((await call('DELETE', `/designs/${dinner.id}`)).status, 404);
  // An occasion's design remembers its name and where it came from.
  const o = (await call('POST', '/occasions', { name: 'P', kind: 'email' })).body.occasion;
  const saved = (await call('PUT', `/occasions/${o.id}/design`, { ...d('<p>hi</p>'), name: 'Brunch', customId: 'abc123' })).body.occasion.design;
  assert.deepEqual([saved.name, saved.customId], ['Brunch', 'abc123']);
});
