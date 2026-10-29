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
  // Everything else on the card comes too: in the note for people, and as X-OAB- fields for this app.
  assert.match(cards[0], /CATEGORIES:Family\r\n/);
  assert.match(cards[0], /NOTE:Household: The Smith Family\\nGroups: Family\\nNotes: private\r\n/);
  assert.match(cards[0], /X-OAB-HOUSEHOLD:The Smith Family\r\n/);
  assert.match(cards[0], /X-OAB-NOTES:private\r\n/);
});

test('a vCard from this app brings the whole household back', async () => {
  const { parseVcards, contactsToHouseholds } = await import('../../frontend/vcard-core.js');
  const h = {
    labelName: 'The Smith Family', formalName: 'Mr. and Mrs. John Smith', greeting: 'John and Mary', phone: '(248) 555-0100',
    address: { line1: '12 Oak St', line2: 'Apt 4', city: 'Troy', state: 'MI', zip: '48083' },
    members: [
      { firstName: 'John', lastName: 'Smith', email: 'john@example.com', phone: '(248) 555-0101' },
      { firstName: 'Mary', lastName: 'Smith', email: 'mary@example.com', primary: true },
      { firstName: 'Liz', lastName: 'Jones' },
    ],
    groups: ['Family', 'Christmas, cards'], notes: 'Gate code 1234\nDog: Max',
  };
  const v = householdToVcard(h);
  assert.match(v.replace(/\r\n /g, ''), /NOTE:Household: The Smith Family\\nFormal greeting: Mr. and Mrs. John Smith\\nInformal greeting: John and Mary\\nGroups: Family\\, Christmas\\, cards/);
  assert.match(v, /TEL;TYPE=HOME:\(248\) 555-0100/);
  const [back] = contactsToHouseholds(parseVcards(v));
  assert.equal(back.labelName, 'The Smith Family', 'kept, though Liz has another last name');
  assert.equal(back.formalName, 'Mr. and Mrs. John Smith');
  assert.equal(back.greeting, 'John and Mary');
  assert.equal(back.phone, '(248) 555-0100');
  assert.deepEqual(back.groups, ['Family', 'Christmas, cards']);
  assert.equal(back.notes, 'Gate code 1234\nDog: Max');
  assert.deepEqual(back.members.map((m) => [m.firstName, m.lastName, m.email, m.phone, m.primary]), [
    ['John', 'Smith', 'john@example.com', '(248) 555-0101', false],
    ['Mary', 'Smith', 'mary@example.com', undefined, true],
    ['Liz', 'Jones', undefined, undefined, false],
  ]);
  assert.deepEqual(back.address, { ...h.address, country: '' });
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

test('reads an Apple Contacts export and groups people at the same address', async () => {
  const { parseVcards, contactsToHouseholds } = await import('../../frontend/vcard-core.js');
  const { formatPhone } = await import('../../frontend/csv-core.js');
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Apple Inc.//macOS 15.0//EN',
    'N:Smith;John;;;', 'FN:John Smith',
    'EMAIL;type=INTERNET;type=HOME;type=pref:John@Example.com',
    'TEL;type=CELL;type=VOICE;type=pref:2485550101',
    'item1.ADR;type=HOME;type=pref:;;123 Maple Street\\nApt 4;Willow Bend;MI;49002;United States',
    'item1.X-ABADR:us',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDA',
    ' sLCxkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN',
    'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Smith;Mary;;;', 'FN:Mary Smith',
    'EMAIL;type=INTERNET:mary@example.com',
    'item1.ADR;type=HOME:;;123 Maple Street\\nApt 4;Willow Bend;MI;49002;United States',
    'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', "N:O'Brien;Grandma Rose;;;", "FN:Grandma Rose O'Brien",
    'ADR;TYPE=HOME:;;40 Lake Drive;Juniper Ridge;MI;49004;', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:Acme Plumbing', 'ORG:Acme Plumbing;', 'TEL;TYPE=WORK:555-0100', 'END:VCARD',
  ].join('\r\n');
  const contacts = parseVcards(vcf);
  assert.equal(contacts.length, 4);
  const { homePhone, note, categories, household, formalName, greeting, primary, notes, ...plain } = contacts[0];
  assert.deepEqual([homePhone, note, categories, household, primary], ['', '', [], '', false]);
  assert.deepEqual(plain, {
    firstName: 'John', lastName: 'Smith', fullName: 'John Smith', org: '', email: 'john@example.com', phone: '2485550101',
    address: { line1: '123 Maple Street', line2: 'Apt 4', city: 'Willow Bend', state: 'MI', zip: '49002', country: 'United States' },
  });
  const hh = contactsToHouseholds(contacts, { phoneFormat: formatPhone });
  assert.deepEqual(hh.map((h) => [h.labelName, h.greeting]), [
    ['The Smith Family', 'John and Mary'], ["Grandma Rose O'Brien", 'Grandma Rose'], ['Acme Plumbing', undefined],
  ]);
  assert.equal(hh[0].address.country, '');
  assert.deepEqual(hh[0].members.map((m) => [m.firstName, m.email, m.phone, m.primary]), [['John', 'john@example.com', '(248) 555-0101', true], ['Mary', 'mary@example.com', undefined, false]]);
  assert.equal(hh[2].labelName, 'Acme Plumbing');
});

test('vCard 2.1 quoted-printable and vCard 4.0 parameters', async () => {
  const { parseVcards } = await import('../../frontend/vcard-core.js');
  const v21 = ['BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;',
    'ADR;HOME;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;;Stra=C3=9Fe 1=0D=0A=', 'Hinterhaus;Berlin;;10115;Germany', 'EMAIL;PREF;INTERNET:j@example.de', 'END:VCARD'].join('\r\n');
  const [c] = parseVcards(v21);
  assert.deepEqual([c.firstName, c.lastName, c.email], ['Jürgen', 'Müller', 'j@example.de']);
  assert.deepEqual(c.address, { line1: 'Straße 1', line2: 'Hinterhaus', city: 'Berlin', state: '', zip: '10115', country: 'Germany' });
  const v4 = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Ann Lee', 'N:Lee;Ann;;;', 'EMAIL;TYPE=work:ann@work.example', 'EMAIL;TYPE="home,pref":ann@home.example',
    'TEL;VALUE=uri;TYPE="voice,cell":tel:+1-248-555-0199', 'END:VCARD'].join('\n');
  const [d] = parseVcards(v4);
  assert.deepEqual([d.email, d.phone], ['ann@home.example', '+1-248-555-0199']);
});
