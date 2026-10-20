// CSV import/export for households. Pure functions (unit tested in Node).

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
  { key: 'labelName', label: 'Name on envelope', hints: [/^((household|label|envelope|addressee|mailing)\s*name|name on envelope)$/, /^name$/, /^(household|family|addressee|label)$/] },
  { key: 'formalName', label: 'Formal name', hints: [/formal/] },
  { key: 'greeting', label: 'Greeting name', hints: [/greeting|salutation|dear/] },
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
 * Name on envelope, when not mapped: "First & Spouse Last" or "First Last".
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
      for (const full of v.people.split(/[;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20)) {
        const parts = full.split(/\s+/);
        members.push(parts.length > 1 ? { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) } : { firstName: full });
      }
    }
    households.push({
      labelName,
      formalName: v.formalName || undefined,
      greeting: v.greeting || (coupleFirst && coupleFirst !== labelName ? coupleFirst.replace(' & ', ' and ') : undefined),
      address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, zip: v.zip, country: v.country },
      emails: (v.email ?? '').split(/[;,\s]+/).filter(Boolean).slice(0, 10),
      phone: v.phone || undefined,
      members,
      groups: v.groups ? v.groups.split(/[;,|]/).map((g) => g.trim()).filter(Boolean) : [],
      notes: v.notes || undefined,
    });
  });
  return { households, skipped };
}

/** The address book as CSV rows (one per household), readable by this importer and by spreadsheets. */
export function householdsToCsv(list) {
  const header = ['Name on envelope', 'Formal name', 'Greeting', 'Street address', 'Address line 2', 'City', 'State', 'ZIP', 'Country',
    'Email', 'Phone', 'People', 'Groups', 'Notes'];
  const rows = list.map((h) => {
    const a = h.address ?? {};
    const people = (h.members ?? []).map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join('; ');
    const allEmails = [...new Set([...(h.emails ?? []), ...(h.members ?? []).map((m) => m.email)].filter(Boolean))].join('; ');
    return [h.labelName, h.formalName, h.greeting, a.line1, a.line2, a.city, a.state, a.zip, a.country,
      allEmails, h.phone, people, (h.groups ?? []).join('; '), h.notes];
  });
  return toCsv([header, ...rows]);
}
