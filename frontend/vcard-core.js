// vCard (.vcf) for one household. Pure functions (unit tested in Node).
//
// One card per person, each with the household's mailing address, so Contacts on a Mac or iPhone,
// Google Contacts and Outlook import every person. A household with no named people becomes one
// card named after its Household Greeting.

import { peopleWithHouseholdContact } from './csv-core.js';

// vCard 3.0 text escaping: backslash, comma, semicolon and line breaks.
const escText = (v) => String(v ?? '').trim().replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes are folded: CRLF plus one space, never splitting a character.
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function card({ first = '', last = '', fullName, email, phone, address }) {
  const a = address ?? {};
  const lines = ['BEGIN:VCARD', 'VERSION:3.0',
    `N:${escText(last)};${escText(first)};;;`,
    `FN:${escText(fullName)}`];
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escText(email)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escText(phone)}`);
  if (['line1', 'line2', 'city', 'state', 'zip', 'country'].some((k) => String(a[k] ?? '').trim())) {
    const street = [a.line1, a.line2].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n');
    lines.push(`ADR;TYPE=HOME:;;${[street, a.city, a.state, a.zip, a.country].map(escText).join(';')}`);
  }
  lines.push('END:VCARD');
  return lines.map(foldLine).join('\r\n');
}

export function householdToVcard(h) {
  const people = peopleWithHouseholdContact(h).filter((m) => m.firstName || m.lastName || m.email || m.phone);
  const named = people.filter((m) => m.firstName || m.lastName);
  const cards = named.length
    ? people.map((m) => {
      const full = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || h.labelName;
      return card({ first: m.firstName, last: m.lastName, fullName: full, email: m.email, phone: m.phone, address: h.address });
    })
    : [card({ last: h.labelName, fullName: h.labelName, email: people[0]?.email, phone: people[0]?.phone, address: h.address })];
  return `${cards.join('\r\n')}\r\n`;
}

/** A safe file name from the Household Greeting: "The Smith Family.vcf". */
export function fileBaseName(h) {
  return String(h.labelName ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Household';
}
