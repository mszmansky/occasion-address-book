import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressBookReport } from '../../frontend/report.js';

test('the Address book report numbers each household and shows all of its card', () => {
  const { body, css } = addressBookReport([
    {
      labelName: 'The Smith Family', formalName: 'Mr. and Mrs. John Smith', greeting: 'John & Mary',
      address: { line1: '123 Maple St', line2: 'Apt 4', city: 'Troy', state: 'MI', zip: '48083' }, addressVerifiedAt: '2026-10-01T12:00:00Z',
      phone: '248-555-0100', emails: ['smiths@example.com'], groups: ['Family', 'Christmas'], notes: 'Gate code 1234\nDog: Max',
      members: [{ firstName: 'John', lastName: 'Smith', relationship: 'Dad', email: 'john@example.com', phone: '248-555-0101', primary: true }, { firstName: 'Mary', lastName: 'Smith' }],
      pendingUpdate: { address: {} },
    },
    { labelName: 'Kim Lee', address: {} },
  ], { title: 'Address book', filters: ['Group: Family'], printed: new Date('2026-10-28T14:00:00Z') });
  for (const s of ['The Smith Family', 'Mr. and Mrs. John Smith', 'John &amp; Mary', '123 Maple St', 'Apt 4', 'Troy, MI  48083', '✓ Verified Oct 1, 2026',
    'New address to review', '248-555-0100', 'smiths@<wbr>example.com', 'Family', 'Christmas', 'Gate code 1234\nDog: Max', 'John Smith', '· Dad', 'Default contact',
    'john@<wbr>example.com', '248-555-0101', 'Mary Smith', 'No address', '2 households · Group: Family · Printed Oct 28, 2026']) assert.ok(body.includes(s), s);
  assert.deepEqual([...body.matchAll(/<td class="n">(\d+)<\/td>/g)].map((m) => m[1]), ['1', '2']);
  assert.match(css, /@page \{ size: 11in 8.5in/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.ok(!addressBookReport([{ labelName: '<b>x</b>' }]).body.includes('<b>x'));
});
