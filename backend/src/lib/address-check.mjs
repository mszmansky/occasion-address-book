// Address checks through the Google Address Validation API: corrects the street, city, state and
// ZIP (adding ZIP+4, from the Post Office's own data) and says whether mail is delivered there.
//
// Google bills each check (ValidateAddress = the "Address Validation Pro" SKU, 5,000 free a month).
// To stay well inside the free amount, checks are counted per month in the table, shared by everyone
// using this app, and refused once the month reaches the limit. Google's billing month runs on
// Pacific time, so the month here does too.

import { HttpError } from './auth.mjs';

export const MONTHLY_LIMIT = 1000; // Google's free amount is 5,000 a month; this keeps far below it
const QUOTA_PK = 'ADDRCHECK#QUOTA';
const API = 'https://addressvalidation.googleapis.com/v1:validateAddress';

// ---------- formatting ----------
const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const UPPER_WORDS = new Set(['PO', 'RR', 'HC', 'PSC', 'APO', 'FPO', 'DPO']);

/** Post Office data is in capitals ("123 N MAIN ST APT 4"); envelopes look friendlier as "123 N Main St Apt 4". */
export function friendlyCase(s) {
  return String(s ?? '').split(/(\s+)/).map((w) => {
    const up = w.toUpperCase();
    if (!/[A-Z]/i.test(w) || DIRECTIONALS.has(up) || UPPER_WORDS.has(up)) return up;
    if (/^\d+(ST|ND|RD|TH)$/.test(up)) return up.toLowerCase();           // 1st, 22nd
    if (/\d/.test(w)) return up;                                          // 12B, N123
    return up.split('-').map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join('-');
  }).join('');
}

// The Post Office puts the apartment on the street line ("1 RIVERFRONT CTR W APT 804"); the app keeps
// it on its own line.
const UNIT = /\s+((?:APT|APARTMENT|STE|SUITE|UNIT|BLDG|FL|FLOOR|RM|ROOM|LOT|SPC|TRLR|DEPT|PH|OFC|BSMT|FRNT|REAR|LOWR|UPPR|#)\b\.?\s*.*|#\s*\S+.*)$/i;
export function splitUnit(line) {
  const s = String(line ?? '').trim();
  if (/^(PO BOX|P\.?O\.? BOX)\b/i.test(s)) return { line1: s, line2: '' };
  const m = s.match(UNIT);
  return m && m.index > 0 ? { line1: s.slice(0, m.index).trim(), line2: m[1].trim() } : { line1: s, line2: '' };
}

// ---------- the Google API ----------
// getApiKey: async () => the API key, or null when checks aren't set up.
export function createGoogleClient({ getApiKey, fetchFn = fetch, timeoutMs = 10_000 }) {
  return {
    async enabled() { return !!(await getApiKey()); },

    /** address: { line1, line2, city, state, zip }. Returns Google's `result`. */
    async lookup(address) {
      const key = await getApiKey();
      if (!key) throw new HttpError(503, "Address checking isn't set up yet");
      const body = {
        address: {
          regionCode: 'US',
          addressLines: [address.line1, address.line2].filter(Boolean),
          ...(address.city ? { locality: address.city } : {}),
          ...(address.state ? { administrativeArea: address.state } : {}),
          ...(address.zip ? { postalCode: address.zip } : {}),
        },
        enableUspsCass: true, // Post Office standardizing for US addresses; same price
      };
      let res;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs); // well inside the API Gateway's 30 seconds
      try {
        res = await fetchFn(`${API}?key=${encodeURIComponent(key)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
        });
      } catch {
        if (ctl.signal.aborted) throw new HttpError(504, "Google didn't answer in time. Try the check again.");
        throw new HttpError(502, "Couldn't reach Google for the address check. Try again in a minute.");
      } finally {
        clearTimeout(timer);
      }
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) throw new HttpError(429, 'Google says too many address checks right now. Try again later.');
      if (res.status === 400) throw new HttpError(400, "Google couldn't read that address");
      if (res.status === 401 || res.status === 403) {
        console.error('Address check refused', res.status, json?.error?.message);
        throw new HttpError(502, 'Google turned down the address check. Check the API key and that the Address Validation API is turned on.');
      }
      if (!res.ok) throw new HttpError(502, `The address check failed (${res.status}). Try again in a minute.`);
      return json.result ?? null;
    },
  };
}

/** Turns Google's result into what the app shows: a verdict and the corrected address. */
export function interpret(result) {
  if (!result) return { status: 'not-found' };
  const usps = result.uspsData ?? {};
  const std = usps.standardizedAddress;
  const verdict = result.verdict ?? {};
  const missing = result.address?.missingComponentTypes ?? [];

  let status;
  const dpv = usps.dpvConfirmation;
  if (dpv) status = dpv === 'Y' ? 'confirmed' : dpv === 'D' ? 'needs-unit' : dpv === 'S' ? 'unit-unconfirmed' : 'not-found';
  else if (missing.includes('subpremise') || verdict.possibleNextAction === 'CONFIRM_ADD_SUBPREMISES') status = 'needs-unit';
  else if (verdict.addressComplete && ['PREMISE', 'SUB_PREMISE'].includes(verdict.validationGranularity) && !verdict.hasUnconfirmedComponents) status = 'confirmed';
  else status = 'not-found';

  let suggested;
  if (std?.firstAddressLine) {
    const { line1, line2 } = splitUnit(std.firstAddressLine);
    suggested = {
      line1: friendlyCase(line1),
      line2: friendlyCase([line2, std.secondAddressLine].filter(Boolean).join(' ')),
      city: friendlyCase(std.city),
      state: String(std.state ?? '').toUpperCase(),
      zip: [std.zipCode, std.zipCodeExtension].filter(Boolean).join('-'),
    };
  } else if (result.address?.postalAddress?.addressLines?.length && status !== 'not-found') {
    const p = result.address.postalAddress;
    const { line1, line2 } = splitUnit(p.addressLines[0]);
    suggested = {
      line1, line2: [line2, ...p.addressLines.slice(1)].filter(Boolean).join(' '),
      city: p.locality ?? '', state: String(p.administrativeArea ?? '').toUpperCase(), zip: p.postalCode ?? '',
    };
  }
  return { status, ...(suggested ? { suggested } : {}), ...(usps.dpvVacant === 'Y' ? { vacant: true } : {}) };
}

// ---------- the monthly limit ----------
// Google's billing month starts at midnight Pacific time.
function pacificMonth(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month) };
}
/** When the next Pacific month starts (08:00 UTC on the 1st covers both standard and daylight time). */
function nextMonthStart(d) {
  const { y, m } = pacificMonth(d);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 8)).toISOString();
}

export function createAddressChecker({ client, repo, now = () => new Date(), limit = MONTHLY_LIMIT }) {
  const monthKey = (d) => { const { y, m } = pacificMonth(d); return `MONTH#${y}-${String(m).padStart(2, '0')}`; };

  async function status() {
    if (!(await client.enabled())) return { enabled: false };
    const t = now();
    const used = (await repo.get(QUOTA_PK, monthKey(t)))?.count ?? 0;
    const remaining = Math.max(0, limit - used);
    return { enabled: true, limit, used: Math.min(used, limit), remaining, availableAt: remaining ? null : nextMonthStart(t) };
  }

  const usedUp = async () => {
    const e = new HttpError(429, 'The address checks for this month are used up.');
    e.extra = { checks: await status() };
    return e;
  };

  return {
    status,
    async check(address) {
      if (!(await client.enabled())) throw new HttpError(503, "Address checking isn't set up yet");
      const t = now();
      const key = monthKey(t);
      const ttl = Math.floor(t.getTime() / 1000) + 70 * 86_400;
      // Count first, atomically, so two people checking at once can't both take the last one.
      const count = await repo.increment(QUOTA_PK, key, 'count', 1, { ttl });
      if (count > limit) {
        await repo.increment(QUOTA_PK, key, 'count', -1, { ttl });
        throw await usedUp();
      }
      try {
        return { result: interpret(await client.lookup(address)), checks: await status() };
      } catch (e) {
        if (e.status === 429) e.extra = { checks: await status() };
        throw e;
      }
    },
  };
}
