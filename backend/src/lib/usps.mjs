// Address checks through the USPS Addresses API (v3): corrects the street, city, state and ZIP
// (adding ZIP+4) and says whether the Post Office delivers there.
//
// USPS allows 60 checks an hour per account, shared by everyone using this app, so checks are
// counted per minute in the table and refused once the last 60 minutes reach the limit.

import { HttpError } from './auth.mjs';

export const USPS_HOURLY_LIMIT = 55; // USPS allows 60; a little headroom for retries and clock drift
const QUOTA_PK = 'USPS#QUOTA';
const API = 'https://apis.usps.com';

// ---------- formatting ----------
const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const UPPER_WORDS = new Set(['PO', 'RR', 'HC', 'PSC', 'APO', 'FPO', 'DPO']);

/** USPS answers in capitals ("123 N MAIN ST APT 4"); envelopes look friendlier as "123 N Main St Apt 4". */
export function friendlyCase(s) {
  return String(s ?? '').split(/(\s+)/).map((w) => {
    const up = w.toUpperCase();
    if (!/[A-Z]/i.test(w) || DIRECTIONALS.has(up) || UPPER_WORDS.has(up)) return up;
    if (/^\d+(ST|ND|RD|TH)$/.test(up)) return up.toLowerCase();           // 1st, 22nd
    if (/\d/.test(w)) return up;                                          // 12B, N123
    return up.split('-').map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join('-');
  }).join('');
}

// ---------- the USPS API ----------
// getCredentials: async () => ({ clientId, clientSecret }) or null when checks aren't set up.
export function createUspsClient({ getCredentials, fetchFn = fetch, now = () => Date.now() }) {
  let token = null; // { value, expiresAt }

  async function accessToken() {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    const creds = await getCredentials();
    if (!creds) throw new HttpError(503, "Address checking isn't set up yet");
    const res = await fetchFn(`${API}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'client_credentials' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new HttpError(502, 'USPS turned down the sign-in for address checks. Check the USPS credentials.');
    token = { value: json.access_token, expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 };
    return token.value;
  }

  return {
    async enabled() { return !!(await getCredentials()); },

    /** address: { line1, line2, city, state, zip }. Returns the USPS reply, or null if USPS has no such address. */
    async lookup(address) {
      const q = new URLSearchParams({ streetAddress: address.line1, state: address.state });
      if (address.line2) q.set('secondaryAddress', address.line2);
      if (address.city) q.set('city', address.city);
      const [zip5, zip4] = String(address.zip ?? '').replace(/\s/g, '').split('-');
      if (/^\d{5}$/.test(zip5 ?? '')) q.set('ZIPCode', zip5);
      if (/^\d{4}$/.test(zip4 ?? '')) q.set('ZIPPlus4', zip4);
      let res;
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetchFn(`${API}/addresses/v3/address?${q}`, { headers: { authorization: `Bearer ${await accessToken()}`, accept: 'application/json' } });
        if (res.status !== 401) break;
        token = null; // expired early: sign in again once
      }
      if (res.status === 429) {
        const e = new HttpError(429, 'USPS says the hourly limit for address checks is used up. Try again later.');
        e.retryAfter = Number(res.headers?.get?.('retry-after')) || 3600;
        throw e;
      }
      if (res.status === 404) return null;
      const json = await res.json().catch(() => ({}));
      if (res.status === 400) {
        const msg = json?.error?.errors?.[0]?.detail || json?.error?.message || '';
        if (/not found|invalid|ambiguous|multiple/i.test(msg)) return null;
        throw new HttpError(400, msg ? `USPS: ${msg}` : 'USPS could not read that address');
      }
      if (!res.ok) throw new HttpError(502, `USPS address check failed (${res.status}). Try again in a minute.`);
      return json;
    },
  };
}

/** Turns a USPS reply into what the app shows: a verdict and the corrected address. */
export function interpret(reply) {
  if (!reply?.address) return { status: 'not-found' };
  const a = reply.address;
  const dpv = reply.additionalInfo?.DPVConfirmation;
  const status = dpv === 'Y' ? 'confirmed' : dpv === 'D' ? 'needs-unit' : dpv === 'S' ? 'unit-unconfirmed' : 'not-found';
  const suggested = {
    line1: friendlyCase(a.streetAddress),
    line2: friendlyCase(a.secondaryAddress),
    city: friendlyCase(a.city),
    state: String(a.state ?? '').toUpperCase(),
    zip: [a.ZIPCode, a.ZIPPlus4].filter(Boolean).join('-'),
  };
  return { status, suggested, ...(reply.additionalInfo?.vacant === 'Y' ? { vacant: true } : {}) };
}

// ---------- the hourly limit ----------
export function createAddressChecker({ usps, repo, now = () => new Date(), limit = USPS_HOURLY_LIMIT }) {
  const minuteKey = (d) => `MIN#${d.toISOString().slice(0, 16)}`;

  async function status() {
    if (!(await usps.enabled())) return { enabled: false };
    const t = now();
    const block = await repo.get(QUOTA_PK, 'BLOCK');
    const from = minuteKey(new Date(t.getTime() - 59 * 60_000));
    const rows = (await repo.query(QUOTA_PK, 'MIN#')).filter((r) => r.SK >= from && (r.count ?? 0) > 0);
    const used = rows.reduce((n, r) => n + r.count, 0);
    const blockedUntil = block?.until && block.until > t.toISOString() ? block.until : null;
    const remaining = blockedUntil ? 0 : Math.max(0, limit - used);
    let availableAt = null;
    if (blockedUntil) availableAt = blockedUntil;
    else if (!remaining) {
      // The minute when enough of the oldest checks fall out of the last hour to allow another one.
      let over = used - limit + 1;
      for (const r of rows) {
        over -= r.count;
        if (over <= 0) { availableAt = new Date(Date.parse(`${r.SK.slice(4)}:00Z`) + 60 * 60_000).toISOString(); break; }
      }
    }
    return { enabled: true, limit, used, remaining, availableAt };
  }

  return {
    status,
    async check(address) {
      const s = await status();
      if (!s.enabled) throw new HttpError(503, "Address checking isn't set up yet");
      if (s.remaining <= 0) {
        const e = new HttpError(429, 'The address checks for this hour are used up.');
        e.extra = { checks: s };
        throw e;
      }
      const t = now();
      await repo.increment(QUOTA_PK, minuteKey(t), 'count', 1, { ttl: Math.floor(t.getTime() / 1000) + 2 * 3600 });
      try {
        return { result: interpret(await usps.lookup(address)), checks: await status() };
      } catch (e) {
        if (e.status === 429) {
          const until = new Date(t.getTime() + (e.retryAfter ?? 3600) * 1000).toISOString();
          await repo.put({ PK: QUOTA_PK, SK: 'BLOCK', until, ttl: Math.floor(Date.parse(until) / 1000) + 3600 });
          e.extra = { checks: await status() };
        }
        throw e;
      }
    },
  };
}
