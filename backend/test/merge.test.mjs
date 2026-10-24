import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingHousehold, mergeHousehold } from '../../frontend/csv-core.js';

const fleck = {
  id: 'h1', labelName: 'Mary Fleck and Family', greeting: 'Mary', groups: ['Family'], notes: 'Send early',
  address: { line1: '1044 Ridgeview Circle', city: 'Lake Orion', state: 'MI', zip: '48360' },
  members: [{ id: 'm1', firstName: 'Mary', lastName: 'Fleck', primary: true }],
};

test('finds the household by greeting or by street and ZIP', () => {
  const list = [fleck, { id: 'h2', labelName: 'The Smiths', address: { line1: '12 Oak St', zip: '48083' } }];
  assert.equal(findExistingHousehold(list, { labelName: 'mary fleck and family' }).id, 'h1');
  assert.equal(findExistingHousehold(list, { labelName: 'John Smith', address: { line1: '12 OAK ST.', zip: '48083' } }).id, 'h2');
  assert.equal(findExistingHousehold(list, { labelName: 'John Smith', address: { line1: '12 Oak St', zip: '48084' } }), null);
  // Otherwise by a person in it: name, email or phone.
  assert.equal(findExistingHousehold(list, { labelName: 'Mary Fleck', address: { line1: '9 Elsewhere Rd' }, members: [{ firstName: 'Mary', lastName: 'Fleck' }] }).id, 'h1');
  const withContact = [...list, { id: 'h3', labelName: 'The Lees', emails: ['lees@example.com'], members: [{ firstName: 'Ann', lastName: 'Lee', phone: '(248) 555-0123' }] }];
  assert.equal(findExistingHousehold(withContact, { labelName: 'A. Lee', members: [{ firstName: 'A', email: 'LEES@example.com' }] }).id, 'h3');
  assert.equal(findExistingHousehold(withContact, { labelName: 'Annie', members: [{ firstName: 'Annie', phone: '+1 248-555-0123' }] }).id, 'h3');
  assert.equal(findExistingHousehold(withContact, { labelName: 'Mary', members: [{ firstName: 'Mary' }] }), null); // a first name alone isn't enough
});

test('adds a missing phone and email; what we have wins', () => {
  const { household, added } = mergeHousehold(fleck, {
    labelName: 'Mary Fleck', greeting: 'Mary F', groups: ['Work'], notes: 'other note',
    address: { line1: '9 Elsewhere Rd', city: 'Troy', state: 'MI', zip: '48083' },
    members: [{ firstName: 'Mary', lastName: 'Fleck', phone: '(248) 555-0101', email: 'mary@example.com' }],
  });
  assert.deepEqual(household.members, [{ id: 'm1', firstName: 'Mary', lastName: 'Fleck', primary: true, phone: '(248) 555-0101', email: 'mary@example.com' }]);
  assert.deepEqual(household.address, fleck.address);           // our address wins
  assert.equal(household.greeting, 'Mary');                     // ours wins
  assert.deepEqual(household.groups, ['Family']);
  assert.equal(household.notes, 'Send early');
  assert.equal(household.labelName, 'Mary Fleck and Family');
  assert.deepEqual(added, ['email for Mary Fleck', 'phone for Mary Fleck']);
});

test('an existing phone or email is kept; nothing new means nothing added', () => {
  const ours = { ...fleck, members: [{ firstName: 'Mary', lastName: 'Fleck', phone: '248-555-0000', email: 'old@example.com' }] };
  const { household, added } = mergeHousehold(ours, { labelName: 'x', members: [{ firstName: 'Mary', lastName: 'Fleck', phone: '248-555-9999', email: 'new@example.com' }] });
  assert.deepEqual([household.members[0].phone, household.members[0].email], ['248-555-0000', 'old@example.com']);
  assert.deepEqual(added, []);
});

test('matches people by email or phone, and adds people we do not have', () => {
  const ours = { labelName: 'The Smiths', members: [{ firstName: 'John', lastName: 'Smith', email: 'john@example.com' }, { firstName: 'Mary', lastName: 'Smith', phone: '+1 248 555 0101' }] };
  const { household, added } = mergeHousehold(ours, { labelName: 'x', members: [
    { firstName: 'Johnny', lastName: 'Smith', email: 'JOHN@example.com', phone: '2485550199' },
    { firstName: 'M', lastName: 'Smith', phone: '(248) 555-0101', email: 'mary@example.com' },
    { firstName: 'Tim', lastName: 'Smith', email: 'tim@example.com' },
  ] });
  assert.deepEqual(household.members.map((m) => [m.firstName, m.email, m.phone]), [
    ['John', 'john@example.com', '2485550199'], ['Mary', 'mary@example.com', '+1 248 555 0101'], ['Tim', 'tim@example.com', undefined],
  ]);
  assert.deepEqual(added, ['phone for Johnny Smith', 'email for M Smith', 'Tim Smith added']);
});

test('the address: empty takes theirs; the same street fills in the blanks; another street is left', () => {
  const vc = { labelName: 'x', address: { line1: '1 Riverfront Center W', line2: 'Apt 804', city: 'Flint', state: 'MI', zip: '48502' } };
  assert.deepEqual(mergeHousehold({ labelName: 'Megan', address: {} }, vc).household.address, vc.address);
  const partial = mergeHousehold({ labelName: 'Megan', address: { line1: '1 riverfront center w', city: 'Flint', state: 'MI' } }, vc);
  assert.deepEqual(partial.household.address, { line1: '1 riverfront center w', line2: 'Apt 804', city: 'Flint', state: 'MI', zip: '48502' });
  assert.deepEqual(partial.added, ['apartment, ZIP']);
  assert.deepEqual(mergeHousehold({ labelName: 'Megan', address: { line1: '5 Other St' } }, vc).household.address, { line1: '5 Other St' });
});

test('old shared email and phone move onto the people; blank greetings, groups and notes fill in', () => {
  const old = { labelName: 'The Lees', emails: ['lees@example.com'], phone: '248-555-0123', members: [{ firstName: 'Ann', lastName: 'Lee' }] };
  const { household, added } = mergeHousehold(old, { labelName: 'x', greeting: 'Ann', formalName: 'Ms. Ann Lee', groups: ['Friends'], notes: 'Met at work', members: [{ firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' }] });
  assert.deepEqual(household.members, [{ firstName: 'Ann', lastName: 'Lee', email: 'lees@example.com', phone: '248-555-0123' }]);
  assert.equal(household.emails, undefined); assert.equal(household.phone, undefined);
  assert.deepEqual([household.greeting, household.formalName, household.groups, household.notes], ['Ann', 'Ms. Ann Lee', ['Friends'], 'Met at work']);
  assert.deepEqual(added, ['informal greeting', 'formal greeting', 'groups', 'note']);
});
