// CSV import/export for households. Pure functions (unit tested in Node).

/**
 * Splits a first-name field that holds more than one person: "Peter and Paula", "Peter & Paula",
 * "Tom, Ann and Joe". Returns the names, or null when it's one person (including "Mary Ann").
 * Each part must look like a first name (at most three words), so odd text is left alone.
 */
export function splitFirstNames(value) {
  const parts = String(value ?? '').split(/\s*(?:,\s*(?:and\s+|&\s*)?|\s+and\s+|\s*&\s*|\s*\+\s*)/i).map((x) => x.trim());
  if (parts.length < 2 || parts.length > 10) return null;
  if (parts.some((x) => !x || x.split(/\s+/).length > 3)) return null;
  return parts;
}

/**
 * One person per first name: { firstName: "Peter and Paula", lastName: "Bartlett", email } becomes
 * Peter Bartlett (keeping the email, phone and birthday) and Paula Bartlett. Others pass through.
 */
export function splitMembers(members = []) {
  return members.flatMap((m) => {
    const names = splitFirstNames(m.firstName);
    if (!names) return [m];
    return names.map((firstName, i) => (i === 0 ? { ...m, firstName } : { firstName, lastName: m.lastName }));
  });
}

/** The household's last name: the first person's, else from the envelope name ("The Bartletts", "The Smith Family"). */
export function householdLastName(h) {
  const fromPeople = (h.members ?? []).find((m) => m.lastName?.trim())?.lastName.trim();
  if (fromPeople) return fromPeople;
  const label = String(h.labelName ?? '').trim();
  const plural = /^the\s+/i.test(label) && !/\s(family|household)$/i.test(label); // "The Bartletts" names the family in the plural
  const last = label.replace(/^the\s+/i, '').replace(/\s+(family|household)$/i, '').split(/\s+/).at(-1) ?? '';
  if (!plural) return last;
  if (/(s|x|z|ch|sh)es$/i.test(last)) return last.slice(0, -2); // Joneses, Foxes
  return last.replace(/s$/i, '');
}

/**
 * Suggested formal name: "Mr. and Mrs. Bartlett" when the greeting is exactly two first names
 * ("Peter and Paula"); otherwise '' (no suggestion).
 */
export function defaultFormalName(greeting, lastName) {
  const names = splitFirstNames(greeting);
  return names?.length === 2 && lastName ? `Mr. and Mrs. ${lastName}` : '';
}

/**
 * The formal name to use for a household: the one saved, else the "Mr. and Mrs. <Last>" suggestion
 * (the same one the edit screen shows), else ''.
 */
export function effectiveFormalName(h) {
  if (h.formalName?.trim()) return h.formalName.trim();
  return defaultFormalName(h.greeting, householdLastName({ ...h, members: splitMembers(h.members ?? []) }));
}

/**
 * People for the edit screen, with the household's old shared email and home phone moved onto them
 * (those fields are gone): the email goes to every person without one, the phone to the first person
 * without one. A household with an email but no people gets one person row holding the email.
 */
export function peopleWithHouseholdContact(h) {
  const people = splitMembers(h.members ?? []).map((m) => ({ ...m }));
  const shared = [...new Set((h.emails ?? []).map((e) => String(e).trim()).filter(Boolean))];
  if (!people.length && (shared.length || h.phone)) people.push({});
  // One shared email: give it to everyone missing one. Several: hand them out in order, the rest to the last person.
  if (shared.length === 1) for (const m of people) m.email ||= shared[0];
  else {
    for (const e of shared.filter((x) => !people.some((m) => m.email === x))) {
      const m = people.find((x) => !x.email);
      if (m) m.email = e; else people.push({ email: e }); // never drop an address: it gets its own row to name
    }
  }
  if (h.phone) { const m = people.find((x) => !x.phone); if (m) m.phone = h.phone; }
  return people;
}

/** RFC 4180-ish CSV parser: quoted fields, doubled quotes, CRLF/LF, a leading BOM. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// What each import column can become, with header words that suggest it.
export const FIELDS = [
  { key: 'labelName', label: 'Household Greeting', hints: [/^((household|label|envelope|addressee|mailing)\s*name|name on envelope|household greeting)$/, /^name$/, /^(household|family|addressee|label)$/] },
  { key: 'formalName', label: 'Formal Greeting', hints: [/\bformal\b/] },
  { key: 'greeting', label: 'Informal Greeting', hints: [/greeting|salutation|dear/] },
  { key: 'firstName', label: 'First name', hints: [/^first/, /given/] },
  { key: 'lastName', label: 'Last name', hints: [/^last/, /surname|family name/] },
  { key: 'spouse', label: 'Spouse / partner first name', hints: [/spouse|partner|wife|husband/] },
  { key: 'line1', label: 'Street address', hints: [/^(street|address|addr)(\s*(1|line\s*1))?$/, /street/, /^address/] },
  { key: 'line2', label: 'Address line 2', hints: [/(address|addr|street)\s*(2|line\s*2)/, /apt|suite|unit/] },
  { key: 'city', label: 'City', hints: [/city|town/] },
  { key: 'state', label: 'State', hints: [/^(state|province|region|st)$/, /state/] },
  { key: 'zip', label: 'ZIP / postal code', hints: [/zip|postal|post code|postcode/] },
  { key: 'country', label: 'Country', hints: [/country/] },
  { key: 'email', label: 'Email', hints: [/e-?mail/] },
  { key: 'phone', label: 'Phone', hints: [/phone|mobile|cell|tel/] },
  { key: 'people', label: 'People (John Smith; Mary Smith)', hints: [/^(people|members|names)$/] },
  { key: 'groups', label: 'Groups', hints: [/group|tag|list|category/] },
  { key: 'notes', label: 'Notes', hints: [/note|comment/] },
];

/** Guesses a field for each column from its header; each field is used at most once. */
export function guessMapping(header) {
  const used = new Set();
  const norm = header.map((h) => String(h ?? '').trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' '));
  const map = norm.map(() => '');
  // Earlier hints are stronger, so try every column against hint 0 first, then hint 1, ...
  for (let pass = 0; pass < 3; pass++) {
    norm.forEach((h, i) => {
      if (map[i] || !h) return;
      const f = FIELDS.find((fl) => !used.has(fl.key) && fl.hints[pass]?.test(h));
      if (f) { map[i] = f.key; used.add(f.key); }
    });
  }
  return map;
}

/** True when the first row looks like column titles rather than data. */
export function looksLikeHeader(row) {
  return guessMapping(row).filter(Boolean).length >= 2;
}

/**
 * Turns CSV rows into households for the API. Rows without a usable name are reported, not imported.
 * Household Greeting, when not mapped: "First & Spouse Last" or "First Last".
 */
export function buildHouseholds(rows, mapping) {
  const households = [];
  const skipped = [];
  rows.forEach((r, i) => {
    const v = {};
    mapping.forEach((key, col) => { if (key) v[key] = String(r[col] ?? '').trim(); });
    const coupleFirst = [v.firstName, v.spouse].filter(Boolean).join(' & ');
    const labelName = v.labelName || [coupleFirst, v.lastName].filter(Boolean).join(' ');
    if (!labelName) { skipped.push({ row: i + 1, reason: 'No name' }); return; }
    const members = [];
    if (v.firstName || v.lastName) members.push({ firstName: v.firstName, lastName: v.lastName });
    if (v.spouse) members.push({ firstName: v.spouse, lastName: v.lastName });
    if (!members.length && v.people) {
      // "John Smith; Mary Smith": last word is the last name.
      // "John Smith <john@x.com> (248-555-0101); Mary Smith": last word is the last name; an email in <>
      // and a phone in () are that person's.
      for (const entry of v.people.split(/[;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20)) {
        const email = /<([^<>\s]+@[^<>\s]+)>/.exec(entry)?.[1];
        const rest = entry.replace(/<[^>]*>/g, ' ');
        // The phone is the bracketed part at the end; it may hold its own brackets: "((248) 555-0101)".
        const phoneMatch = /\((.*\d.*)\)\s*$/.exec(rest);
        const phone = phoneMatch?.[1].trim();
        const full = (phoneMatch ? rest.slice(0, phoneMatch.index) : rest).replace(/\s+/g, ' ').trim();
        const parts = full.split(' ');
        const person = parts.length > 1 ? { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) } : { firstName: full };
        members.push({ ...person, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
      }
    }
    const greeting = v.greeting || (coupleFirst && coupleFirst !== labelName ? coupleFirst.replace(' & ', ' and ') : undefined);
    households.push({
      labelName,
      formalName: v.formalName || defaultFormalName(greeting, householdLastName({ labelName, members })) || undefined,
      greeting,
      address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, zip: v.zip, country: v.country },
      // Email and phone go on the people (a shared email on each of them).
      ...(() => {
        const contact = { emails: (v.email ?? '').split(/[;,\s]+/).filter(Boolean).slice(0, 10), phone: v.phone || undefined };
        const people = splitMembers(members).slice(0, 20);
        return people.length ? { members: peopleWithHouseholdContact({ members: people, ...contact }) } : { members: [], ...contact };
      })(),
      groups: v.groups ? v.groups.split(/[;,|]/).map((g) => g.trim()).filter(Boolean) : [],
      notes: v.notes || undefined,
    });
  });
  return { households, skipped };
}

/** The address book as CSV rows (one per household), readable by this importer and by spreadsheets. */
export function householdsToCsv(list) {
  // People carry their own email and phone: "John Smith <john@x.com> (248-555-0101); Mary Smith". Email and Phone hold only
  // what's still saved on the household itself (from before those moved onto the people).
  const header = ['Household Greeting', 'Formal Greeting', 'Informal Greeting', 'Street address', 'Address line 2', 'City', 'State', 'ZIP', 'Country',
    'People', 'Email', 'Phone', 'Groups', 'Notes'];
  const rows = list.map((h) => {
    const a = h.address ?? {};
    const people = (h.members ?? []).map((m) => [[m.firstName, m.lastName].filter(Boolean).join(' '), m.email && `<${m.email}>`, m.phone && `(${m.phone})`]
      .filter(Boolean).join(' ')).join('; ');
    return [h.labelName, h.formalName, h.greeting, a.line1, a.line2, a.city, a.state, a.zip, a.country,
      people, (h.emails ?? []).join('; '), h.phone, (h.groups ?? []).join('; '), h.notes];
  });
  return toCsv([header, ...rows]);
}
