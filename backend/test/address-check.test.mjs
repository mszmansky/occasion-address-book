import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAddressChecker, createGoogleClient, friendlyCase, interpret, splitUnit } from '../src/lib/address-check.mjs';
import { createMemoryRepo } from './helpers.mjs';

// A Google reply for a US address, trimmed to the parts the app reads.
const result = (over = {}) => ({
  verdict: { addressComplete: true, validationGranularity: 'SUB_PREMISE', possibleNextAction: 'ACCEPT' },
  address: { postalAddress: { addressLines: ['123 N Main St Apt 4B'], locality: 'Royal Oak', administrativeArea: 'MI', postalCode: '48067-1234' } },
  uspsData: {
    standardizedAddress: { firstAddressLine: '123 N MAIN ST APT 4B', city: 'ROYAL OAK', state: 'MI', zipCode: '48067', zipCodeExtension: '1234' },
    dpvConfirmation: 'Y',
  },
  ...over,
});

// A pretend Google: records calls, answers with `answer(url, body)`.
function fakeFetch(answer = () => ({ status: 200, body: { result: result() } })) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body ?? '{}') });
    const { status, body = {} } = answer(String(url), init);
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const key = async () => 'test-key';

test('Post Office capitals become friendly case', () => {
  assert.equal(friendlyCase('123 N MAIN ST APT 4B'), '123 N Main St Apt 4B');
  assert.equal(friendlyCase('PO BOX 12'), 'PO Box 12');
  assert.equal(friendlyCase('1ST AVE NE'), '1st Ave NE');
  assert.equal(friendlyCase('WINSTON-SALEM'), 'Winston-Salem');
});

test('the apartment moves to its own line', () => {
  assert.deepEqual(splitUnit('1 RIVERFRONT CTR W APT 804'), { line1: '1 RIVERFRONT CTR W', line2: 'APT 804' });
  assert.deepEqual(splitUnit('500 WOODWARD AVE STE 2100'), { line1: '500 WOODWARD AVE', line2: 'STE 2100' });
  assert.deepEqual(splitUnit('12 ELM ST # 3'), { line1: '12 ELM ST', line2: '# 3' });
  assert.deepEqual(splitUnit('PO BOX 12'), { line1: 'PO BOX 12', line2: '' });
  assert.deepEqual(splitUnit('100 UNIVERSITY DR'), { line1: '100 UNIVERSITY DR', line2: '' });
});

test('the verdict follows Post Office delivery-point confirmation', () => {
  assert.deepEqual(interpret(result()), { status: 'confirmed', suggested: { line1: '123 N Main St', line2: 'Apt 4B', city: 'Royal Oak', state: 'MI', zip: '48067-1234' } });
  const dpv = (d) => interpret(result({ uspsData: { ...result().uspsData, dpvConfirmation: d } })).status;
  assert.equal(dpv('D'), 'needs-unit');
  assert.equal(dpv('S'), 'unit-unconfirmed');
  assert.equal(dpv('N'), 'not-found');
  assert.equal(interpret(result({ uspsData: { ...result().uspsData, dpvVacant: 'Y' } })).vacant, true);
  assert.deepEqual(interpret(null), { status: 'not-found' });
});

test('without Post Office data, Google\'s own verdict decides', () => {
  const base = { address: { postalAddress: { addressLines: ['9 Oak Ct'], locality: 'Troy', administrativeArea: 'mi', postalCode: '48083' } } };
  assert.deepEqual(interpret({ ...base, verdict: { addressComplete: true, validationGranularity: 'PREMISE' } }),
    { status: 'confirmed', suggested: { line1: '9 Oak Ct', line2: '', city: 'Troy', state: 'MI', zip: '48083' } });
  assert.equal(interpret({ ...base, verdict: { possibleNextAction: 'CONFIRM_ADD_SUBPREMISES' } }).status, 'needs-unit');
  assert.deepEqual(interpret({ ...base, verdict: { validationGranularity: 'ROUTE', hasUnconfirmedComponents: true } }), { status: 'not-found' });
});

test('sends the address to Google with the key', async () => {
  const fetchFn = fakeFetch();
  const client = createGoogleClient({ getApiKey: key, fetchFn });
  await client.lookup({ line1: '123 Main', line2: 'Apt 4', city: 'Royal Oak', state: 'MI', zip: '48067-1234' });
  await client.lookup({ line1: '1 Elm', state: 'MI', zip: '48067' });
  assert.equal(fetchFn.calls[0].url, 'https://addressvalidation.googleapis.com/v1:validateAddress?key=test-key');
  assert.deepEqual(fetchFn.calls[0].body, {
    address: { regionCode: 'US', addressLines: ['123 Main', 'Apt 4'], locality: 'Royal Oak', administrativeArea: 'MI', postalCode: '48067-1234' },
    enableUspsCass: true,
  });
  assert.deepEqual(fetchFn.calls[1].body.address, { regionCode: 'US', addressLines: ['1 Elm'], administrativeArea: 'MI', postalCode: '48067' });
});

test('errors are explained', async () => {
  let status = 403;
  const client = createGoogleClient({ getApiKey: key, fetchFn: fakeFetch(() => ({ status, body: { error: { message: 'API key not valid' } } })) });
  const quiet = console.error; console.error = () => {};
  try { await assert.rejects(client.lookup({ line1: 'x', state: 'MI' }), (e) => e.status === 502 && /API key/.test(e.message)); } finally { console.error = quiet; }
  status = 400; await assert.rejects(client.lookup({ line1: 'x', state: 'MI' }), { status: 400 });
  status = 429; await assert.rejects(client.lookup({ line1: 'x', state: 'MI' }), { status: 429 });
  status = 500; await assert.rejects(client.lookup({ line1: 'x', state: 'MI' }), { status: 502 });
});

test('no API key: checks are off', async () => {
  const checker = createAddressChecker({ repo: createMemoryRepo(), client: createGoogleClient({ getApiKey: async () => null, fetchFn: fakeFetch() }) });
  assert.deepEqual(await checker.status(), { enabled: false });
  await assert.rejects(checker.check({ line1: '1 Elm', state: 'MI', city: 'Troy' }), { status: 503 });
});

test('stops at the monthly limit and opens up again when the Pacific month turns', async () => {
  let t = new Date('2026-10-21T22:00:00Z');
  const fetchFn = fakeFetch();
  const checker = createAddressChecker({ repo: createMemoryRepo(), now: () => t, limit: 3, client: createGoogleClient({ getApiKey: key, fetchFn }) });
  const addr = { line1: '123 Main', state: 'MI', city: 'Royal Oak' };
  const first = await checker.check(addr);
  assert.equal(first.result.status, 'confirmed');
  assert.deepEqual(first.checks, { enabled: true, limit: 3, used: 1, remaining: 2, availableAt: null });
  await checker.check(addr);
  const third = await checker.check(addr);
  assert.deepEqual([third.checks.remaining, third.checks.availableAt], [0, '2026-11-01T08:00:00.000Z']);
  await assert.rejects(checker.check(addr), (e) => e.status === 429 && e.extra.checks.remaining === 0 && e.extra.checks.used === 3);
  assert.equal(fetchFn.calls.length, 3); // Google was not called for the refused one
  t = new Date('2026-11-01T06:30:00Z'); // still October 31 in California
  assert.equal((await checker.status()).remaining, 0);
  t = new Date('2026-11-01T08:00:00Z');
  assert.equal((await checker.status()).remaining, 3);
  await checker.check(addr);
  assert.equal(fetchFn.calls.length, 4);
});

test('two checks at once cannot both take the last one', async () => {
  const fetchFn = fakeFetch();
  const checker = createAddressChecker({ repo: createMemoryRepo(), limit: 1, client: createGoogleClient({ getApiKey: key, fetchFn }) });
  const addr = { line1: '1 Elm', state: 'MI', city: 'Troy' };
  const results = await Promise.allSettled([checker.check(addr), checker.check(addr)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(fetchFn.calls.length, 1);
  assert.equal((await checker.status()).used, 1);
});
