// Household filters for the Address book and occasion lists. Pure functions (unit tested in Node).
//
// A filter is:
//   { groups: [], groupMode: 'any' | 'all', cities: [], states: [], zip: '',
//     email: '' | 'yes' | 'no', address: '' | 'complete' | 'missing', review: false }
// Empty or missing parts don't filter. Within a part, choices are alternatives (Troy OR Rochester);
// across parts they all apply (in Michigan AND in the Family group).

import { isMailable } from './print-core.js';

export const emptyFilter = () => ({ groups: [], groupMode: 'any', cities: [], states: [], zip: '', email: '', address: '', review: false });

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const householdEmails = (h) => [...(h.emails ?? []), ...(h.members ?? []).map((m) => m.email)].filter(Boolean);

/** How many separate filters are on (for the badge on the Filter button). */
export function activeCount(f = {}) {
  return (f.groups?.length ? 1 : 0) + (f.cities?.length ? 1 : 0) + (f.states?.length ? 1 : 0) + (f.zip?.trim() ? 1 : 0)
    + (f.email ? 1 : 0) + (f.address ? 1 : 0) + (f.review ? 1 : 0);
}

export function matchesFilter(h, f = {}) {
  const a = h.address ?? {};
  if (f.groups?.length) {
    const mine = new Set((h.groups ?? []).map(norm));
    const wanted = f.groups.map(norm);
    if (f.groupMode === 'all' ? !wanted.every((g) => mine.has(g)) : !wanted.some((g) => mine.has(g))) return false;
  }
  if (f.cities?.length && !f.cities.map(norm).includes(norm(a.city))) return false;
  if (f.states?.length && !f.states.map(norm).includes(norm(a.state))) return false;
  if (f.zip?.trim() && !String(a.zip ?? '').replace(/\s/g, '').toLowerCase().startsWith(f.zip.replace(/\s/g, '').toLowerCase())) return false;
  if (f.email === 'yes' && !householdEmails(h).length) return false;
  if (f.email === 'no' && householdEmails(h).length) return false;
  if (f.address === 'complete' && !isMailable(a)) return false;
  if (f.address === 'missing' && isMailable(a)) return false;
  if (f.review && !h.pendingUpdate) return false;
  return true;
}

/**
 * The choices to offer, with how many households have each: groups, cities and states in use.
 * Spellings are merged ignoring case and extra spaces ("troy " and "Troy" are one city).
 */
export function filterOptions(households) {
  const tally = (pick) => {
    const m = new Map();
    for (const h of households) {
      for (const raw of [].concat(pick(h) ?? [])) {
        const label = String(raw ?? '').trim().replace(/\s+/g, ' ');
        if (!label) continue;
        const key = label.toLowerCase();
        const cur = m.get(key) ?? { value: label, count: 0 };
        cur.count++;
        m.set(key, cur);
      }
    }
    return [...m.values()].sort((x, y) => x.value.localeCompare(y.value));
  };
  return {
    groups: tally((h) => h.groups ?? []),
    cities: tally((h) => h.address?.city),
    states: tally((h) => (h.address?.state ? String(h.address.state).toUpperCase() : '')),
  };
}

/** One chip per active choice, each with how to remove just that choice. */
export function filterChips(f = {}) {
  const chips = [];
  for (const g of f.groups ?? []) chips.push({ label: `Group: ${g}`, remove: { groups: f.groups.filter((x) => x !== g) } });
  if ((f.groups?.length ?? 0) > 1) chips.push({ label: f.groupMode === 'all' ? 'In all of these groups' : 'In any of these groups', remove: null });
  for (const c of f.cities ?? []) chips.push({ label: `City: ${c}`, remove: { cities: f.cities.filter((x) => x !== c) } });
  for (const s of f.states ?? []) chips.push({ label: `State: ${s}`, remove: { states: f.states.filter((x) => x !== s) } });
  if (f.zip?.trim()) chips.push({ label: `ZIP starts with ${f.zip.trim()}`, remove: { zip: '' } });
  if (f.email) chips.push({ label: f.email === 'yes' ? 'Has email' : 'No email', remove: { email: '' } });
  if (f.address) chips.push({ label: f.address === 'complete' ? 'Has mailing address' : 'Missing mailing address', remove: { address: '' } });
  if (f.review) chips.push({ label: 'Address update to review', remove: { review: false } });
  return chips;
}
