import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, guessMapping, looksLikeHeader, buildHouseholds, householdsToCsv } from '../../frontend/csv-core.js';
import { parseHousehold } from '../src/lib/api.mjs';

test('parses quotes, commas and CRLF', () => {
  const rows = parseCsv('﻿Name,Address\r\n"Smith, John","12 ""Big"" St"\r\n\r\nLee,9 Oak\n');
  assert.deepEqual(rows, [['Name', 'Address'], ['Smith, John', '12 "Big" St'], ['Lee', '9 Oak']]);
});

test('guesses columns from a typical holiday card list', () => {
  const header = ['First Name', 'Last Name', 'Spouse', 'Street Address', 'Apt', 'City', 'State', 'Zip Code', 'E-mail', 'Group'];
  assert.ok(looksLikeHeader(header));
  const map = guessMapping(header);
  assert.deepEqual(map, ['firstName', 'lastName', 'spouse', 'line1', 'line2', 'city', 'state', 'zip', 'email', 'groups']);
  const { households, skipped } = buildHouseholds([
    ['John', 'Smith', 'Mary', '123 Maple', '', 'Troy', 'MI', '48083', 'john@x.com', 'Family; Christmas'],
    ['', '', '', '1 Nowhere', '', '', '', '', '', ''],
  ], map);
  assert.equal(skipped.length, 1);
  const h = households[0];
  assert.equal(h.labelName, 'John & Mary Smith');
  assert.equal(h.greeting, 'John and Mary');
  assert.deepEqual(h.groups, ['Family', 'Christmas']);
  assert.equal(h.members.length, 2);
  assert.deepEqual(h.members.map((m) => m.email), ['john@x.com', 'john@x.com'], 'the email goes on the people');
  assert.equal(h.emails, undefined);
  // What the importer builds is accepted by the API's validation.
  assert.equal(parseHousehold(h).labelName, 'John & Mary Smith');
});

test('export imports back the same', () => {
  const original = [{
    labelName: 'The Smith Family', formalName: 'Mr. and Mrs. John Smith', greeting: 'John and Mary',
    address: { line1: '123 Maple St', city: 'Troy', state: 'MI', zip: '48083' },
    emails: ['smiths@x.com'], members: [{ firstName: 'John', lastName: 'Smith', email: 'john@x.com' }, { firstName: 'Mary Ann', lastName: 'Smith' }],
    groups: ['Family'], notes: 'Says "hi", always',
  }];
  const rows = parseCsv(householdsToCsv(original));
  const { households } = buildHouseholds(rows.slice(1), guessMapping(rows[0]));
  const h = parseHousehold(households[0]);
  assert.equal(h.labelName, 'The Smith Family');
  assert.equal(h.formalName, 'Mr. and Mrs. John Smith');
  assert.equal(h.greeting, 'John and Mary');
  assert.deepEqual(h.address, original[0].address);
  // Each person keeps their own email; the old household email comes back on the people too.
  assert.deepEqual(h.members.map((m) => [m.firstName, m.lastName, m.email]), [['John', 'Smith', 'john@x.com'], ['Mary Ann', 'Smith', 'smiths@x.com']]);
  assert.deepEqual(h.emails, []);
  assert.deepEqual(h.groups, ['Family']);
  assert.equal(h.notes, 'Says "hi", always');
});

test('two first names in one field become two people', async () => {
  const { splitFirstNames, splitMembers } = await import('../../frontend/csv-core.js');
  assert.deepEqual(splitFirstNames('Peter and Paula'), ['Peter', 'Paula']);
  assert.deepEqual(splitFirstNames('Peter & Paula'), ['Peter', 'Paula']);
  assert.deepEqual(splitFirstNames('Peter AND Paula'), ['Peter', 'Paula']);
  assert.deepEqual(splitFirstNames('Tom, Ann and Joe'), ['Tom', 'Ann', 'Joe']);
  assert.deepEqual(splitFirstNames('Tom, Ann, & Joe'), ['Tom', 'Ann', 'Joe']);
  assert.deepEqual(splitFirstNames('Mary Ann and Bob'), ['Mary Ann', 'Bob']);
  for (const one of ['Peter', 'Mary Ann', 'Andy', 'Alexandra', 'Sandra', '', 'Peter and', ' and Paula']) {
    assert.equal(splitFirstNames(one), null, one);
  }
  assert.deepEqual(splitMembers([{ id: 'a1', firstName: 'Peter and Paula', lastName: 'Bartlett', email: 'p@x.com' }]),
    [{ id: 'a1', firstName: 'Peter', lastName: 'Bartlett', email: 'p@x.com' }, { firstName: 'Paula', lastName: 'Bartlett' }]);

  // The importer does it too.
  const rows = parseCsv('Title,First Names,Last Name,Address,City,State,Zip\nTodd and Kim Abbott,Todd and Kim,Abbott,12 Elm St,Troy,MI,48083\n');
  const { households } = buildHouseholds(rows.slice(1), guessMapping(rows[0]));
  assert.deepEqual(households[0].members.map((m) => [m.firstName, m.lastName]), [['Todd', 'Abbott'], ['Kim', 'Abbott']]);
  assert.equal(parseHousehold(households[0]).members.length, 2);
});

test('formal name defaults to "Mr. and Mrs. <Last>" when the greeting has two first names', async () => {
  const { defaultFormalName, householdLastName } = await import('../../frontend/csv-core.js');
  assert.equal(defaultFormalName('Peter and Paula', 'Bartlett'), 'Mr. and Mrs. Bartlett');
  assert.equal(defaultFormalName('Peter & Paula', 'Bartlett'), 'Mr. and Mrs. Bartlett');
  assert.equal(defaultFormalName('Peter', 'Bartlett'), '');
  assert.equal(defaultFormalName('Tom, Ann and Joe', 'Smith'), '');
  assert.equal(defaultFormalName('Peter and Paula', ''), '');
  assert.equal(householdLastName({ labelName: 'The Joneses' }), 'Jones');
  assert.equal(householdLastName({ labelName: 'The Smith Family' }), 'Smith');
  assert.equal(householdLastName({ labelName: 'X', members: [{ firstName: 'A' }, { lastName: 'Lee' }] }), 'Lee');

  const rows = parseCsv('Title,First Names,Last Name,Formal\nTodd and Kim Abbott,Todd and Kim,Abbott,\nRose Smith,Rose,Smith,\nAl and Jo Wu,Al and Jo,Wu,Dr. and Mr. Wu\n');
  const map = guessMapping(rows[0]);
  map[0] = 'labelName';
  const { households } = buildHouseholds(rows.slice(1), map);
  assert.deepEqual(households.map((h) => h.formalName), ['Mr. and Mrs. Abbott', undefined, 'Dr. and Mr. Wu']);
});

test('a household imported before the formal-name default still prints "Mr. and Mrs. <Last>"', async () => {
  const { effectiveFormalName } = await import('../../frontend/csv-core.js');
  const { envelopeName } = await import('../../frontend/print-core.js');
  const abbotts = { labelName: 'Todd and Kim Abbott', greeting: 'Todd and Kim', members: [{ firstName: 'Todd and Kim', lastName: 'Abbott' }] };
  assert.equal(effectiveFormalName(abbotts), 'Mr. and Mrs. Abbott');
  assert.equal(envelopeName({ ...abbotts, formalName: effectiveFormalName(abbotts) }, 'formal'), 'Mr. and Mrs. Abbott');
  assert.equal(envelopeName({ ...abbotts, formalName: effectiveFormalName(abbotts) }, 'label'), 'Todd and Kim Abbott');
  // A saved formal name always wins; a single person has none and keeps the envelope name.
  assert.equal(effectiveFormalName({ ...abbotts, formalName: 'Dr. and Mrs. Todd Abbott' }), 'Dr. and Mrs. Todd Abbott');
  const rose = { labelName: 'Grandma Rose', greeting: 'Rose', members: [{ firstName: 'Rose', lastName: 'Smith' }] };
  assert.equal(envelopeName({ ...rose, formalName: effectiveFormalName(rose) }, 'formal'), 'Grandma Rose');
});

test('the old household email and home phone move onto the people', async () => {
  const { peopleWithHouseholdContact } = await import('../../frontend/csv-core.js');
  // One shared email: everyone without an email gets it; the phone goes to the first person without one.
  let people = peopleWithHouseholdContact({ emails: ['smiths@x.com'], phone: '248-555-0100',
    members: [{ firstName: 'John', lastName: 'Smith' }, { firstName: 'Mary', lastName: 'Smith', email: 'mary@x.com' }] });
  assert.deepEqual(people.map((m) => [m.firstName, m.email, m.phone]), [['John', 'smiths@x.com', '248-555-0100'], ['Mary', 'mary@x.com', undefined]]);
  // Two names in one box split first, then both get the shared email.
  people = peopleWithHouseholdContact({ emails: ['pp@x.com'], members: [{ firstName: 'Peter and Paula', lastName: 'Bartlett' }] });
  assert.deepEqual(people.map((m) => [m.firstName, m.email]), [['Peter', 'pp@x.com'], ['Paula', 'pp@x.com']]);
  // No people yet: one row holds the email, waiting for a name.
  assert.deepEqual(peopleWithHouseholdContact({ emails: ['lee@x.com'] }), [{ email: 'lee@x.com' }]);
  // Several emails: handed out in order, none dropped.
  people = peopleWithHouseholdContact({ emails: ['a@x.com', 'b@x.com', 'c@x.com'], members: [{ firstName: 'A' }, { firstName: 'B' }] });
  assert.deepEqual(people.map((m) => m.email), ['a@x.com', 'b@x.com', 'c@x.com']);
  // Nothing to move: unchanged.
  assert.deepEqual(peopleWithHouseholdContact({ members: [{ firstName: 'Rose' }] }), [{ firstName: 'Rose' }]);
  assert.deepEqual(peopleWithHouseholdContact({}), []);

  // CSV import puts email and phone on the people.
  const rows = parseCsv('First Names,Last Name,Email,Phone\nTodd and Kim,Abbott,abbotts@x.com,555-0100\n');
  const { households } = buildHouseholds(rows.slice(1), guessMapping(rows[0]));
  const h = parseHousehold(households[0]);
  assert.deepEqual(h.members.map((m) => [m.firstName, m.email, m.phone]), [['Todd', 'abbotts@x.com', '555-0100'], ['Kim', 'abbotts@x.com', undefined]]);
  assert.deepEqual([h.emails, h.phone], [[], undefined]);
});
