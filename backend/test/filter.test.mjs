import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCount, emptyFilter, filterChips, filterOptions, matchesFilter } from '../../frontend/filter-core.js';

const H = [
  { id: 'a', labelName: 'The Lees', groups: ['Family', 'Christmas'], address: { line1: '1 Oak', city: 'Troy', state: 'MI', zip: '48083' }, members: [{ firstName: 'Bob', email: 'bob@x.com' }] },
  { id: 'b', labelName: 'The Abbotts', groups: ['Work'], address: { line1: '2 Elm', city: 'troy ', state: 'mi', zip: '48084' } },
  { id: 'c', labelName: 'Grandma Rose', groups: ['Family'], address: { line1: '3 Pine', city: 'Columbus', state: 'OH', zip: '43004' }, emails: ['rose@x.com'] },
  { id: 'd', labelName: 'The Wus', groups: [], address: { city: 'Rochester Hills', state: 'MI' }, pendingUpdate: { address: {} } },
];
const ids = (f) => H.filter((h) => matchesFilter(h, { ...emptyFilter(), ...f })).map((h) => h.id).join('');

test('no filter matches everyone', () => {
  assert.equal(ids({}), 'abcd');
  assert.equal(activeCount(emptyFilter()), 0);
});

test('groups: any or all of several', () => {
  assert.equal(ids({ groups: ['Family'] }), 'ac');
  assert.equal(ids({ groups: ['Family', 'Work'] }), 'abc');
  assert.equal(ids({ groups: ['Family', 'Christmas'], groupMode: 'all' }), 'a');
  assert.equal(ids({ groups: ['family'] }), 'ac', 'ignores case');
});

test('city, state and ZIP (spelling differences ignored); filters combine', () => {
  assert.equal(ids({ cities: ['Troy'] }), 'ab');
  assert.equal(ids({ cities: ['Troy', 'Columbus'] }), 'abc');
  assert.equal(ids({ states: ['MI'] }), 'abd');
  assert.equal(ids({ zip: '480' }), 'ab');
  assert.equal(ids({ zip: '48083' }), 'a');
  assert.equal(ids({ states: ['MI'], groups: ['Family'] }), 'a', 'in Michigan AND in Family');
});

test('email, mailing address and review', () => {
  assert.equal(ids({ email: 'yes' }), 'ac');
  assert.equal(ids({ email: 'no' }), 'bd');
  assert.equal(ids({ address: 'complete' }), 'abc');
  assert.equal(ids({ address: 'missing' }), 'd');
  assert.equal(ids({ review: true }), 'd');
});

test('options list each group, city and state once, with counts', () => {
  const o = filterOptions(H);
  assert.deepEqual(o.groups, [{ value: 'Christmas', count: 1 }, { value: 'Family', count: 2 }, { value: 'Work', count: 1 }]);
  assert.deepEqual(o.cities.map((c) => [c.value, c.count]), [['Columbus', 1], ['Rochester Hills', 1], ['Troy', 2]]);
  assert.deepEqual(o.states.map((c) => [c.value, c.count]), [['MI', 3], ['OH', 1]]);
});

test('chips and the active count', () => {
  const f = { ...emptyFilter(), groups: ['Family', 'Work'], states: ['MI'], email: 'no', zip: '480' };
  assert.equal(activeCount(f), 4);
  const chips = filterChips(f);
  assert.deepEqual(chips.map((c) => c.label), ['Group: Family', 'Group: Work', 'In any of these groups', 'State: MI', 'ZIP starts with 480', 'No email']);
  assert.deepEqual(chips[0].remove, { groups: ['Work'] });
});
