import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAddressChecker, createUspsClient, friendlyCase, interpret } from '../src/lib/usps.mjs';
import { createMemoryRepo } from './helpers.mjs';

const reply = (over = {}) => ({
  address: { streetAddress: '123 N MAIN ST', secondaryAddress: 'APT 4B', city: 'ROYAL OAK', state: 'MI', ZIPCode: '48067', ZIPPlus4: '1234' },
  additionalInfo: { DPVConfirmation: 'Y' },
  ...over,
});

// A pretend USPS: records calls, answers with `answer(url)`.
function fakeFetch(answer = () => ({ status: 200, body: reply() })) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/v3/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 28800 }) };
    const { status, body = {}, headers = {} } = answer(String(url));
    return { ok: status < 300, status, json: async () => body, headers: { get: (k) => headers[k] } };
  };
  fn.calls = calls;
  return fn;
}
const creds = async () => ({ clientId: 'id', clientSecret: 'secret' });

test('USPS capitals become friendly case', () => {
  assert.equal(friendlyCase('123 N MAIN ST APT 4B'), '123 N Main St Apt 4B');
  assert.equal(friendlyCase('PO BOX 12'), 'PO Box 12');
  assert.equal(friendlyCase('1ST AVE NE'), '1st Ave NE');
  assert.equal(friendlyCase('WINSTON-SALEM'), 'Winston-Salem');
});

test('the verdict follows USPS delivery-point confirmation', () => {
  assert.deepEqual(interpret(reply()), { status: 'confirmed', suggested: { line1: '123 N Main St', line2: 'Apt 4B', city: 'Royal Oak', state: 'MI', zip: '48067-1234' } });
  assert.equal(interpret(reply({ additionalInfo: { DPVConfirmation: 'D' } })).status, 'needs-unit');
  assert.equal(interpret(reply({ additionalInfo: { DPVConfirmation: 'S' } })).status, 'unit-unconfirmed');
  assert.equal(interpret(reply({ additionalInfo: { DPVConfirmation: 'N' } })).status, 'not-found');
  assert.deepEqual(interpret(null), { status: 'not-found' });
});

test('signs in once, sends the address, and reuses the token', async () => {
  const fetchFn = fakeFetch();
  const usps = createUspsClient({ getCredentials: creds, fetchFn });
  await usps.lookup({ line1: '123 Main', line2: 'Apt 4', city: 'Royal Oak', state: 'MI', zip: '48067-1234' });
  await usps.lookup({ line1: '1 Elm', state: 'MI', zip: '48067' });
  const tokenCalls = fetchFn.calls.filter((c) => c.url.endsWith('/token'));
  assert.equal(tokenCalls.length, 1);
  assert.deepEqual(JSON.parse(tokenCalls[0].init.body), { client_id: 'id', client_secret: 'secret', grant_type: 'client_credentials' });
  const q = new URL(fetchFn.calls[1].url).searchParams;
  assert.equal(fetchFn.calls[1].url.split('?')[0], 'https://apis.usps.com/addresses/v3/address');
  assert.deepEqual(Object.fromEntries(q), { streetAddress: '123 Main', state: 'MI', secondaryAddress: 'Apt 4', city: 'Royal Oak', ZIPCode: '48067', ZIPPlus4: '1234' });
  assert.equal(fetchFn.calls[1].init.headers.authorization, 'Bearer tok');
});

test('not found comes back as null; other errors are explained', async () => {
  let status = 404;
  const usps = createUspsClient({ getCredentials: creds, fetchFn: fakeFetch(() => ({ status, body: { error: { message: 'Address Not Found.' } } })) });
  assert.equal(await usps.lookup({ line1: 'x', state: 'MI', city: 'y' }), null);
  status = 400;
  assert.equal(await usps.lookup({ line1: 'x', state: 'MI', city: 'y' }), null);
  status = 500;
  await assert.rejects(usps.lookup({ line1: 'x', state: 'MI', city: 'y' }), { status: 502 });
});

test('no credentials: checks are off', async () => {
  const checker = createAddressChecker({ repo: createMemoryRepo(), usps: createUspsClient({ getCredentials: async () => null, fetchFn: fakeFetch() }) });
  assert.deepEqual(await checker.status(), { enabled: false });
  await assert.rejects(checker.check({ line1: '1 Elm', state: 'MI', city: 'Troy' }), { status: 503 });
});

test('stops at the hourly limit and opens up again as the hour rolls on', async () => {
  let t = new Date('2026-10-21T22:00:30Z');
  const fetchFn = fakeFetch();
  const checker = createAddressChecker({ repo: createMemoryRepo(), now: () => t, limit: 3, usps: createUspsClient({ getCredentials: creds, fetchFn }) });
  const addr = { line1: '123 Main', state: 'MI', city: 'Royal Oak' };
  const first = await checker.check(addr);
  assert.equal(first.result.status, 'confirmed');
  assert.deepEqual(first.checks, { enabled: true, limit: 3, used: 1, remaining: 2, availableAt: null });
  t = new Date('2026-10-21T22:20:00Z'); await checker.check(addr);
  t = new Date('2026-10-21T22:40:00Z'); const third = await checker.check(addr);
  assert.equal(third.checks.remaining, 0);
  assert.equal(third.checks.availableAt, '2026-10-21T23:00:00.000Z'); // when the 22:00 check leaves the hour
  const lookups = () => fetchFn.calls.filter((c) => c.url.includes('/addresses/')).length;
  await assert.rejects(checker.check(addr), (e) => e.status === 429 && e.extra.checks.remaining === 0);
  assert.equal(lookups(), 3); // USPS was not called for the refused one
  t = new Date('2026-10-21T23:00:10Z');
  assert.equal((await checker.status()).remaining, 1);
  await checker.check(addr);
  assert.equal(lookups(), 4);
});

test('if USPS itself says the limit is reached, checks pause for the time it gives', async () => {
  const t = new Date('2026-10-21T22:00:00Z');
  const checker = createAddressChecker({
    repo: createMemoryRepo(), now: () => t,
    usps: createUspsClient({ getCredentials: creds, fetchFn: fakeFetch(() => ({ status: 429, headers: { 'retry-after': '600' } })) }),
  });
  await assert.rejects(checker.check({ line1: '1 Elm', state: 'MI', city: 'Troy' }), (e) => e.status === 429 && e.extra.checks.availableAt === '2026-10-21T22:10:00.000Z');
  const s = await checker.status();
  assert.equal(s.remaining, 0);
});
