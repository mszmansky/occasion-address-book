// vCard (.vcf) for one household. Pure functions (unit tested in Node).
//
// One card per person, each with the household's mailing address, so Contacts on a Mac or iPhone,
// Google Contacts and Outlook import every person. A household with no named people becomes one
// card named after its Household Greeting. Everything else on the household card comes too: the
// greetings, the person's relationship, the household phone, groups (CATEGORIES) and notes, written
// out in each card's note for people to read, and as X-OAB- fields so this app reads it all back.

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

function card({ first = '', last = '', fullName, email, phone, homePhone, address, household = {}, relationship = '', primary = false }) {
  const a = address ?? {};
  const h = household;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0',
    `N:${escText(last)};${escText(first)};;;`,
    `FN:${escText(fullName)}`];
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escText(email)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escText(phone)}`);
  if (homePhone && homePhone !== phone) lines.push(`TEL;TYPE=HOME:${escText(homePhone)}`);
  const groups = (h.groups ?? []).filter(Boolean);
  if (groups.length) lines.push(`CATEGORIES:${groups.map(escText).join(',')}`);
  const note = [
    h.labelName && `Household: ${h.labelName}`,
    h.formalName && `Formal greeting: ${h.formalName}`,
    h.greeting && `Informal greeting: ${h.greeting}`,
    relationship && `Relationship: ${relationship}`,
    groups.length && `Groups: ${groups.join(', ')}`,
    h.notes && `Notes: ${h.notes}`,
  ].filter(Boolean).join('\n');
  if (note) lines.push(`NOTE:${escText(note)}`);
  // For this app to read back exactly (other apps keep or ignore these).
  if (h.labelName) lines.push(`X-OAB-HOUSEHOLD:${escText(h.labelName)}`);
  if (h.formalName) lines.push(`X-OAB-FORMAL:${escText(h.formalName)}`);
  if (h.greeting) lines.push(`X-OAB-INFORMAL:${escText(h.greeting)}`);
  if (relationship) lines.push(`X-OAB-RELATIONSHIP:${escText(relationship)}`);
  if (primary) lines.push('X-OAB-DEFAULT-CONTACT:1');
  if (h.notes) lines.push(`X-OAB-NOTES:${escText(h.notes)}`);
  if (['line1', 'line2', 'city', 'state', 'zip', 'country'].some((k) => String(a[k] ?? '').trim())) {
    const street = [a.line1, a.line2].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n');
    lines.push(`ADR;TYPE=HOME:;;${[street, a.city, a.state, a.zip, a.country].map(escText).join(';')}`);
  }
  lines.push('END:VCARD');
  return lines.map(foldLine).join('\r\n');
}

export function householdToVcard(h) {
  // The household phone goes on every card as its HOME number, not onto one person.
  const people = peopleWithHouseholdContact({ ...h, phone: undefined }).filter((m) => m.firstName || m.lastName || m.email || m.phone);
  const named = people.filter((m) => m.firstName || m.lastName);
  const cards = named.length
    ? people.map((m) => {
      const full = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || h.labelName;
      return card({ first: m.firstName, last: m.lastName, fullName: full, email: m.email, phone: m.phone, homePhone: h.phone, address: h.address, household: h, relationship: m.relationship, primary: m.primary });
    })
    : [card({ last: h.labelName, fullName: h.labelName, email: people[0]?.email, phone: people[0]?.phone, homePhone: h.phone, address: h.address, household: h })];
  return `${cards.join('\r\n')}\r\n`;
}

/** A safe file name from the Household Greeting: "The Smith Family.vcf". */
export function fileBaseName(h) {
  return String(h.labelName ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Household';
}

// ---------- reading vCards (import) ----------
// Reads .vcf files from Contacts on a Mac or iPhone, Google Contacts, Outlook and others: vCard 2.1,
// 3.0 and 4.0, folded lines, "item1." groups, quoted-printable text and escaped characters.

const decodeQP = (s, charset = 'utf-8') => {
  const bytes = [];
  const src = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-F]{2}$/i.test(src.slice(i + 1, i + 3))) { bytes.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(src.charCodeAt(i) & 0xff);
  }
  try { return new TextDecoder(charset).decode(new Uint8Array(bytes)); } catch { return new TextDecoder().decode(new Uint8Array(bytes)); }
};
const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1');
// Splits on unescaped semicolons (structured values like N and ADR).
const parts = (s) => {
  const out = [''];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { out[out.length - 1] += s[i] + s[i + 1]; i++; } else if (s[i] === ';') out.push(''); else out[out.length - 1] += s[i];
  }
  return out.map((x) => unescapeText(x).trim());
};

function readLine(line) {
  const colon = (() => { let q = false; for (let i = 0; i < line.length; i++) { if (line[i] === '"') q = !q; else if (line[i] === ':' && !q) return i; } return -1; })();
  if (colon < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const name = rawName.replace(/^[^.]+\./, '').toUpperCase(); // drop "item1." groups
  const params = {};
  const types = [];
  for (const p of rawParams) {
    const [k, v] = p.includes('=') ? p.split(/=(.*)/s) : ['TYPE', p];
    const key = k.toUpperCase();
    const val = (v ?? '').replace(/^"|"$/g, '');
    if (key === 'TYPE') types.push(...val.toLowerCase().split(','));
    else params[key] = val;
  }
  if ('PREF' in params) types.push('pref');
  let value = line.slice(colon + 1);
  if ((params.ENCODING ?? '').toUpperCase() === 'QUOTED-PRINTABLE') value = decodeQP(value, params.CHARSET || 'utf-8');
  return { name, types, value };
}

/** All the contacts in a .vcf file. */
export function parseVcards(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  // Unfold: a line starting with a space or tab continues the one before; quoted-printable soft breaks too.
  const lines = src.replace(/=\r?\n(?=[^\r\n])/g, '=\n').split(/\r?\n/).reduce((acc, l) => {
    if (/^[ \t]/.test(l) && acc.length) acc[acc.length - 1] += l.slice(1);
    else if (acc.length && /=$/.test(acc[acc.length - 1]) && /QUOTED-PRINTABLE/i.test(acc[acc.length - 1])) acc[acc.length - 1] += `\n${l}`;
    else acc.push(l);
    return acc;
  }, []);
  const contacts = [];
  let c = null;
  const best = (list) => (list.find((x) => x.types.includes('pref')) ?? list.find((x) => x.types.includes('home')) ?? list[0]);
  for (const line of lines) {
    const t = line.trim();
    if (/^BEGIN:VCARD$/i.test(t)) { c = { emails: [], tels: [], adrs: [], x: {} }; continue; }
    if (/^END:VCARD$/i.test(t)) {
      if (c) {
        const email = c.emails.length ? best(c.emails).value : '';
        // From this app, a HOME phone is the household's; the person's own is the other one.
        const own = c.x.HOUSEHOLD ? c.tels.filter((x) => !x.types.includes('home')) : c.tels;
        const tel = own.length ? (own.find((x) => x.types.includes('cell') || x.types.includes('mobile')) ?? best(own)).value : '';
        const adr = c.adrs.length ? best(c.adrs).parts : null;
        contacts.push({
          firstName: c.n?.[1] || '', lastName: c.n?.[0] || '', fullName: c.fn || '', org: c.org || '',
          email: email.trim().toLowerCase(), phone: tel.trim(),
          homePhone: (c.tels.find((x) => x.types.includes('home')) && c.tels.find((x) => x.types.includes('home')).value.trim() !== tel.trim()) ? c.tels.find((x) => x.types.includes('home')).value.trim() : '',
          note: c.note || '', categories: c.categories ?? [],
          household: c.x.HOUSEHOLD || '', formalName: c.x.FORMAL || '', greeting: c.x.INFORMAL || '', relationship: c.x.RELATIONSHIP || '',
          primary: c.x['DEFAULT-CONTACT'] === '1', notes: c.x.NOTES || '',
          address: adr ? (() => {
            const lines2 = [adr[1], adr[2]].filter(Boolean).join('\n').split(/\n/).map((x) => x.trim()).filter(Boolean);
            return { line1: lines2[0] || '', line2: lines2.slice(1).join(', '), city: adr[3] || '', state: adr[4] || '', zip: adr[5] || '', country: adr[6] || '' };
          })() : null,
        });
      }
      c = null;
      continue;
    }
    if (!c) continue;
    const r = readLine(t);
    if (!r) continue;
    if (r.name === 'N') c.n = parts(r.value);
    else if (r.name === 'FN') c.fn = unescapeText(r.value).trim();
    else if (r.name === 'ORG') c.org = parts(r.value)[0];
    else if (r.name === 'EMAIL' && r.value.trim()) c.emails.push({ types: r.types, value: unescapeText(r.value) });
    else if (r.name === 'TEL' && r.value.trim()) c.tels.push({ types: r.types, value: unescapeText(r.value).replace(/^tel:/i, '') });
    else if (r.name === 'ADR') c.adrs.push({ types: r.types, parts: parts(r.value) });
    else if (r.name === 'NOTE') c.note = unescapeText(r.value).trim();
    else if (r.name === 'CATEGORIES') c.categories = r.value.split(/(?<!\\),/).map((x) => unescapeText(x).trim()).filter(Boolean);
    else if (r.name.startsWith('X-OAB-')) c.x[r.name.slice(6)] = unescapeText(r.value).trim();
  }
  return contacts;
}

const US = /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i;
const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const joinFirst = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');

/**
 * Contacts → households: people at the same street address and ZIP become one household (the
 * Smiths both listed separately in Contacts become "The Smith Family"); everyone else is their own.
 * phoneFormat tidies phone numbers, e.g. formatPhone from csv-core.
 */
export function contactsToHouseholds(contacts, { phoneFormat = (p) => p } = {}) {
  const groups = new Map();
  const loose = [];
  for (const c of contacts) {
    const company = !c.firstName && !c.lastName && c.org && (!c.fullName || c.fullName === c.org); // a business card
    const first = company ? '' : c.firstName || (!c.lastName && c.fullName ? c.fullName.split(/\s+/).slice(0, -1).join(' ') : '');
    const last = company ? '' : c.lastName || (!c.firstName && c.fullName ? c.fullName.split(/\s+/).at(-1) : '');
    if (!first && !last && !c.org && !c.email) continue;
    const person = { firstName: first, lastName: last, email: c.email || undefined, phone: c.phone ? phoneFormat(c.phone) : undefined, relationship: c.relationship || undefined, primary: c.primary || undefined };
    const a = c.address;
    const addr = a ? { ...a, country: US.test(a.country) ? '' : a.country } : {};
    // Cards this app wrote say which household they belong to; others are grouped by address.
    const k = c.household ? `oab|${key(c.household)}|${a ? `${key(a.line1)}|${key(a.zip)}` : ''}`
      : a?.line1 && (a.zip || a.city) ? `${key(a.line1)}|${key(a.zip) || key(a.city)}` : null;
    const entry = { person, org: c.org, address: addr, c };
    if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(entry); } else loose.push([entry]);
  }
  return [...groups.values(), ...loose].map((entries) => {
    const people = entries.map((e) => e.person).filter((p) => p.firstName || p.lastName || p.email);
    const lasts = [...new Set(people.map((p) => p.lastName).filter(Boolean))];
    const firsts = people.map((p) => p.firstName).filter(Boolean);
    let labelName;
    if (!people.some((p) => p.firstName || p.lastName)) labelName = entries[0].org || people[0]?.email || 'Unnamed';
    else if (people.length > 1 && lasts.length === 1) labelName = `The ${lasts[0]} Family`;
    else if (people.length === 1) labelName = [people[0].firstName, people[0].lastName].filter(Boolean).join(' ');
    else labelName = people.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ')).join(' and ');
    const withAddress = entries.find((e) => e.address.line1) ?? entries[0];
    const from = entries.find((e) => e.c.household)?.c; // written by this app: its own details
    const groups = [...new Set(entries.flatMap((e) => e.c.categories ?? []))].slice(0, 20);
    // Notes: this app's own, else the contacts' notes.
    const notes = from ? from.notes : [...new Set(entries.map((e) => e.c.note).filter(Boolean))].join('\n\n');
    const homePhone = entries.map((e) => e.c.homePhone).find(Boolean);
    const anyPrimary = people.some((p) => p.primary);
    return {
      labelName: (from?.household || labelName).slice(0, 120),
      formalName: from?.formalName ? from.formalName.slice(0, 160) : undefined,
      greeting: (from?.greeting || joinFirst(firsts)).slice(0, 120) || undefined,
      address: withAddress.address,
      phone: homePhone ? phoneFormat(homePhone) : undefined,
      members: people.map((p, i) => ({ ...p, primary: anyPrimary ? Boolean(p.primary) : i === 0 && Boolean(p.email) })),
      groups,
      notes: notes ? notes.slice(0, 2000) : undefined,
    };
  });
}
