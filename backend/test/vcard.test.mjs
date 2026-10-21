import { test } from 'node:test';
import assert from 'node:assert/strict';
import { householdToVcard, foldLine, fileBaseName } from '../../frontend/vcard-core.js';
import { householdsToCsv, parseCsv } from '../../frontend/csv-core.js';

const smith = {
  labelName: 'The Smith Family',
  address: { line1: '12 Oak St', line2: 'Apt 4', city: 'Troy', state: 'MI', zip: '48083' },
  members: [
    { firstName: 'John', lastName: 'Smith', email: 'john@example.com', phone: '248-555-0101' },
    { firstName: 'Mary', lastName: 'Smith' },
  ],
  groups: ['Family'], notes: 'private',
};

test('one card per person, each with the household address', () => {
  const v = householdToVcard(smith);
  const cards = v.split('BEGIN:VCARD').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /\r\nN:Smith;John;;;\r\nFN:John Smith\r\n/);
  assert.match(cards[0], /EMAIL;TYPE=INTERNET:john@example.com/);
  assert.match(cards[0], /TEL;TYPE=CELL:248-555-0101/);
  assert.match(cards[1], /FN:Mary Smith/);
  for (const c of cards) assert.match(c, /ADR;TYPE=HOME:;;12 Oak St\\nApt 4;Troy;MI;48083;\r\n/);
  assert.ok(v.endsWith('END:VCARD\r\n'));
  assert.doesNotMatch(v, /private|Family/); // notes and groups stay in the app
});

test('a household with no named people is one card named after the greeting', () => {
  const v = householdToVcard({ labelName: 'The Lake House', address: { city: 'Traverse City', state: 'MI' }, members: [{ email: 'lake@example.com' }] });
  assert.equal(v.split('BEGIN:VCARD').length - 1, 1);
  assert.match(v, /FN:The Lake House/);
  assert.match(v, /EMAIL;TYPE=INTERNET:lake@example.com/);
  assert.match(v, /ADR;TYPE=HOME:;;;Traverse City;MI;;/);
});

test('special characters are escaped and long lines folded', () => {
  const v = householdToVcard({ labelName: 'X', members: [{ firstName: 'Ann; Jr', lastName: 'Lee, PhD' }], address: {} });
  assert.match(v, /N:Lee\\, PhD;Ann\\; Jr;;;/);
  assert.doesNotMatch(v, /ADR/);
  const long = 'NOTE:' + 'é'.repeat(60);
  const folded = foldLine(long);
  for (const line of folded.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.equal(folded.split('\r\n ').join(''), long);
});

test('file names are safe', () => {
  assert.equal(fileBaseName({ labelName: 'The Smith/Jones Family: "2026"' }), 'The SmithJones Family 2026');
  assert.equal(fileBaseName({ labelName: '' }), 'Household');
});

test('a single household exports as CSV that the import reads back', () => {
  const rows = parseCsv(householdsToCsv([smith]));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'The Smith Family');
});
