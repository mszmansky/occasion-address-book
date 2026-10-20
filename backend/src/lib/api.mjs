// HTTP API (API Gateway HTTP API, payload v2).
// Every route needs a Cognito ID token except /public/*, which serves the address-update
// page a household opens from its emailed link (the link's token is the credential there).

import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './auth.mjs';
import { userPk } from './repo.mjs';
import { buildAddressReceived, buildAddressRequest, buildInvite } from './email.mjs';

export const LINK_DAYS = 30;          // address-update links expire after this many days
export const INVITE_BATCH = 25;       // invitations sent per request (the page sends larger lists in batches)
export const IMPORT_MAX = 500;        // households per import request
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const newId = () => randomBytes(8).toString('hex');
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');
const tokenPk = (t) => `TOKEN#${tokenHash(t)}`;

// ---------- validation helpers ----------
function str(v, field, { max = 200, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text`);
  const t = String(v).trim();
  if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  if (required && !t) throw new HttpError(400, `${field} is required`);
  return t || undefined;
}

function num(v, field, { min = 0, max = 1000, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} must be a number between ${min} and ${max}`);
  return n;
}

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function date(v, field) {
  if (v === undefined || v === null || v === '') return undefined;
  if (!isIsoDate(v)) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return v;
}

function email(v, field) {
  const e = str(v, field, { max: 254 });
  if (e && !EMAIL.test(e)) throw new HttpError(400, `${field}: "${e}" is not a valid email`);
  return e?.toLowerCase();
}

function emails(v, field, { max = 10 } = {}) {
  if (v === undefined || v === null || v === '') return [];
  const list = (Array.isArray(v) ? v : String(v).split(/[,;\s]+/)).map((e) => String(e).trim()).filter(Boolean);
  if (list.length > max) throw new HttpError(400, `${field}: at most ${max} addresses`);
  return [...new Set(list.map((e) => email(e, field)))];
}

function ids(v, field, { max = 1000 } = {}) {
  if (!Array.isArray(v)) throw new HttpError(400, `${field} must be a list`);
  if (v.length > max) throw new HttpError(400, `${field}: at most ${max} at a time`);
  for (const id of v) if (typeof id !== 'string' || !/^[a-z0-9]{1,40}$/.test(id)) throw new HttpError(400, `${field} has an invalid id`);
  return [...new Set(v)];
}

function parseAddress(a, label = 'Address') {
  if (a === undefined || a === null) return {};
  if (typeof a !== 'object' || Array.isArray(a)) throw new HttpError(400, `${label} is invalid`);
  const out = {
    line1: str(a.line1, `${label} line 1`, { max: 120 }),
    line2: str(a.line2, `${label} line 2`, { max: 120 }),
    city: str(a.city, 'City', { max: 80 }),
    state: str(a.state, 'State', { max: 40 }),
    zip: str(a.zip, 'ZIP / postal code', { max: 20 }),
    country: str(a.country, 'Country', { max: 60 }),
  };
  if (out.state && /^[a-z]{2}$/i.test(out.state)) out.state = out.state.toUpperCase();
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function parseMembers(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'People must be a list');
  if (list.length > 20) throw new HttpError(400, 'At most 20 people per household');
  const out = [];
  for (const [i, m] of list.entries()) {
    if (!m || typeof m !== 'object') throw new HttpError(400, `Person ${i + 1} is invalid`);
    const firstName = str(m.firstName, `Person ${i + 1} first name`, { max: 60 });
    const lastName = str(m.lastName, `Person ${i + 1} last name`, { max: 60 });
    const em = email(m.email, `${firstName ?? `Person ${i + 1}`}'s email`);
    const phone = str(m.phone, `${firstName ?? `Person ${i + 1}`}'s phone`, { max: 30 });
    const birthday = date(m.birthday, `${firstName ?? `Person ${i + 1}`}'s birthday`);
    const relationship = str(m.relationship, `${firstName ?? `Person ${i + 1}`}'s relationship`, { max: 40 });
    if (!firstName && !lastName && !em && !phone) continue; // blank row
    if (!firstName && !lastName) throw new HttpError(400, `Give person ${i + 1} a name`);
    out.push({
      id: typeof m.id === 'string' && /^[a-z0-9]{1,40}$/.test(m.id) ? m.id : newId(),
      firstName, lastName, email: em, phone, birthday, relationship,
    });
  }
  return out;
}

function parseGroups(v) {
  if (v === undefined || v === null || v === '') return [];
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((g) => String(g).trim()).filter(Boolean);
  if (list.length > 20) throw new HttpError(400, 'At most 20 groups per household');
  for (const g of list) if (g.length > 40) throw new HttpError(400, `Group "${g.slice(0, 20)}…" is too long (max 40 characters)`);
  const seen = new Set();
  return list.filter((g) => !seen.has(g.toLowerCase()) && seen.add(g.toLowerCase()));
}

export function parseHousehold(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Household is invalid');
  return {
    labelName: str(b.labelName, 'Name on envelope', { max: 120, required: true }),
    formalName: str(b.formalName, 'Formal name', { max: 160 }),
    greeting: str(b.greeting, 'Greeting name', { max: 120 }),
    address: parseAddress(b.address),
    emails: emails(b.emails, 'Household email'),
    phone: str(b.phone, 'Phone', { max: 30 }),
    members: parseMembers(b.members),
    groups: parseGroups(b.groups),
    notes: str(b.notes, 'Notes', { max: 2000 }),
  };
}

const KINDS = ['card', 'invite', 'other'];
const NAME_STYLES = ['label', 'formal'];

function parseOccasion(b) {
  const kind = b.kind ?? 'card';
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Type must be card, invite or other');
  const nameStyle = b.nameStyle ?? 'label';
  if (!NAME_STYLES.includes(nameStyle)) throw new HttpError(400, 'Name style must be label or formal');
  const inv = b.invite ?? {};
  if (typeof inv !== 'object') throw new HttpError(400, 'Invitation is invalid');
  return {
    name: str(b.name, 'Occasion name', { max: 120, required: true }),
    kind,
    date: date(b.date, 'Date'),
    time: str(b.time, 'Time', { max: 40 }),
    location: str(b.location, 'Location', { max: 300 }),
    nameStyle,
    notes: str(b.notes, 'Notes', { max: 2000 }),
    invite: {
      subject: str(inv.subject, 'Email subject', { max: 200 }),
      message: str(inv.message, 'Email message', { max: 5000 }),
    },
  };
}

export const PROFILE_DEFAULTS = {
  firstName: '', lastName: '', emailFromName: '',
  returnAddress: {},
  print: { labelOffsetX: 0, labelOffsetY: 0, envelopeOffsetX: 0, envelopeOffsetY: 0 },
};

function parseProfile(b, current) {
  const p = b.print ?? {};
  const off = (v, field, cur) => (v === undefined ? cur : num(v, field, { min: -1, max: 1 }) ?? 0);
  const cp = current.print ?? PROFILE_DEFAULTS.print;
  return {
    firstName: b.firstName === undefined ? current.firstName : str(b.firstName, 'First name', { max: 60 }) ?? '',
    lastName: b.lastName === undefined ? current.lastName : str(b.lastName, 'Last name', { max: 60 }) ?? '',
    emailFromName: b.emailFromName === undefined ? current.emailFromName : str(b.emailFromName, 'Emails come from', { max: 80 }) ?? '',
    returnName: b.returnName === undefined ? current.returnName : str(b.returnName, 'Return address name', { max: 120 }),
    returnAddress: b.returnAddress === undefined ? current.returnAddress : parseAddress(b.returnAddress, 'Return address'),
    print: {
      labelOffsetX: off(p.labelOffsetX, 'Label offset (across)', cp.labelOffsetX),
      labelOffsetY: off(p.labelOffsetY, 'Label offset (down)', cp.labelOffsetY),
      envelopeOffsetX: off(p.envelopeOffsetX, 'Envelope offset (across)', cp.envelopeOffsetX),
      envelopeOffsetY: off(p.envelopeOffsetY, 'Envelope offset (down)', cp.envelopeOffsetY),
    },
  };
}

// Every address a household can be emailed at: its own plus each person's, without repeats.
export function householdEmails(h) {
  return [...new Set([...(h.emails ?? []), ...(h.members ?? []).map((m) => m.email)].filter(Boolean).map((e) => e.toLowerCase()))];
}

const strip = ({ PK, SK, GSI1PK, GSI1SK, ...rest }) => rest;
const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ');

export function createApi({ repo, verify, mailer, appUrl, now = () => new Date(), log = console, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const routes = [];
  const route = (method, pattern, fn, { open = false } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, fn, open });
  };
  const nowIso = () => now().toISOString();
  const pk = (user) => userPk(user.sub);

  async function getProfile(user) {
    const existing = await repo.get(pk(user), 'PROFILE');
    if (existing) {
      if (existing.email !== user.email) { existing.email = user.email; await repo.put(existing); }
      return existing;
    }
    const p = { PK: pk(user), SK: 'PROFILE', email: user.email, ...structuredClone(PROFILE_DEFAULTS), createdAt: nowIso() };
    await repo.put(p);
    return p;
  }
  const senderName = (p) => p.emailFromName || fullName(p) || '';

  async function mustGet(user, sk, what) {
    const item = await repo.get(pk(user), sk);
    if (!item) throw new HttpError(404, `${what} not found`);
    return item;
  }

  const publicHousehold = (h) => strip(h);

  // ---------- profile ----------
  route('GET', '/me', async ({ user }) => ({ profile: strip(await getProfile(user)), linkDays: LINK_DAYS }));

  route('PUT', '/me', async ({ user, body }) => {
    const current = await getProfile(user);
    const updated = { ...current, ...parseProfile(body, current), updatedAt: nowIso() };
    await repo.put(updated);
    return { profile: strip(updated) };
  });

  // ---------- households ----------
  route('GET', '/households', async ({ user }) => ({
    households: (await repo.query(pk(user), 'HH#')).map(publicHousehold),
  }));

  route('POST', '/households', async ({ user, body }) => {
    const id = newId();
    const item = { PK: pk(user), SK: `HH#${id}`, id, ...parseHousehold(body), createdAt: nowIso(), updatedAt: nowIso() };
    await repo.put(item);
    return { household: publicHousehold(item) };
  });

  route('POST', '/households/import', async ({ user, body }) => {
    const list = body.households;
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Nothing to import');
    if (list.length > IMPORT_MAX) throw new HttpError(400, `Import at most ${IMPORT_MAX} households at a time`);
    const items = list.map((row, i) => {
      try {
        const id = newId();
        return { PK: pk(user), SK: `HH#${id}`, id, ...parseHousehold(row), createdAt: nowIso(), updatedAt: nowIso() };
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(400, `Row ${i + 1}: ${e.message}`);
        throw e;
      }
    });
    await repo.batchPut(items);
    return { imported: items.length };
  });

  route('PUT', '/households/:id', async ({ user, params, body }) => {
    const current = await mustGet(user, `HH#${params.id}`, 'Household');
    const item = { ...current, ...parseHousehold(body), updatedAt: nowIso() };
    await repo.put(item);
    return { household: publicHousehold(item) };
  });

  route('DELETE', '/households/:id', async ({ user, params }) => {
    await mustGet(user, `HH#${params.id}`, 'Household');
    const tags = (await repo.query(pk(user), 'TAG#')).filter((t) => t.householdId === params.id);
    await repo.batchDel([{ PK: pk(user), SK: `HH#${params.id}` }, ...tags]);
    return { deleted: true };
  });

  // A reply from the household's address-update link: take it, or throw it away.
  route('POST', '/households/:id/pending/:action', async ({ user, params }) => {
    if (!['accept', 'discard'].includes(params.action)) throw new HttpError(404, 'Not found');
    const h = await mustGet(user, `HH#${params.id}`, 'Household');
    if (!h.pendingUpdate) throw new HttpError(409, 'There is no address waiting to be reviewed');
    const { pendingUpdate, ...rest } = h;
    const item = params.action === 'accept'
      ? { ...rest, address: pendingUpdate.address, addressConfirmedAt: pendingUpdate.receivedAt, updatedAt: nowIso() }
      : { ...rest, updatedAt: nowIso() };
    await repo.put(item);
    return { household: publicHousehold(item) };
  });

  // Emails the household a private link to confirm or correct their mailing address.
  route('POST', '/households/:id/address-request', async ({ user, params, body }) => {
    const h = await mustGet(user, `HH#${params.id}`, 'Household');
    const to = householdEmails(h);
    if (!to.length) throw new HttpError(400, `Add an email address for ${h.labelName} first`);
    const profile = await getProfile(user);
    const fromName = senderName(profile);
    const message = str(body.message, 'Message', { max: 2000 });

    const token = randomBytes(24).toString('base64url');
    const expires = new Date(now().getTime() + LINK_DAYS * 86_400_000);
    await repo.put({
      PK: tokenPk(token), SK: 'TOKEN', sub: user.sub, householdId: h.id, ownerEmail: user.email, fromName,
      createdAt: nowIso(), expiresAt: expires.toISOString(), ttl: Math.floor(expires.getTime() / 1000),
    });
    const url = `${appUrl}/update.html#t=${token}`;
    const msg = buildAddressRequest({ household: h, fromName, url, message, expiresDays: LINK_DAYS });
    try {
      await mailer.send({ to, ...msg, fromName, replyTo: user.email });
    } catch (e) {
      log.error(e);
      await repo.del(tokenPk(token), 'TOKEN');
      throw new HttpError(502, sesHint(e, 'The email could not be sent.'));
    }
    const item = { ...h, addressRequest: { sentAt: nowIso(), sentTo: to, expiresAt: expires.toISOString() }, updatedAt: nowIso() };
    await repo.put(item);
    return { household: publicHousehold(item), sentTo: to };
  });

  // ---------- occasions ----------
  route('GET', '/occasions', async ({ user }) => {
    const [occasions, tags] = await Promise.all([repo.query(pk(user), 'OCC#'), repo.query(pk(user), 'TAG#')]);
    const counts = {};
    for (const t of tags) {
      const c = (counts[t.occasionId] ??= { tagged: 0, mailed: 0, invited: 0 });
      c.tagged++;
      if (t.mailedAt) c.mailed++;
      if (t.invitedAt) c.invited++;
    }
    return {
      occasions: occasions.map((o) => ({ ...strip(o), counts: counts[o.id] ?? { tagged: 0, mailed: 0, invited: 0 } }))
        .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt)),
    };
  });

  route('POST', '/occasions', async ({ user, body }) => {
    const id = newId();
    const item = { PK: pk(user), SK: `OCC#${id}`, id, ...parseOccasion(body), createdAt: nowIso(), updatedAt: nowIso() };
    let tags = [];
    if (body.copyFrom) {
      // Start from last year's list: same households (those still in the address book), fresh mailed/invited state.
      const [from] = ids([body.copyFrom], 'Copy from');
      await mustGet(user, `OCC#${from}`, 'Occasion to copy from');
      const [old, households] = await Promise.all([repo.query(pk(user), `TAG#${from}#`), repo.query(pk(user), 'HH#')]);
      const alive = new Set(households.map((h) => h.id));
      tags = old.filter((t) => alive.has(t.householdId)).map((t) => tagItem(user, id, t.householdId));
    }
    await repo.put(item);
    if (tags.length) await repo.batchPut(tags);
    return { occasion: strip(item), copied: tags.length };
  });

  route('GET', '/occasions/:id', async ({ user, params }) => {
    const o = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const tags = await repo.query(pk(user), `TAG#${params.id}#`);
    return { occasion: strip(o), tags: tags.map(strip) };
  });

  route('PUT', '/occasions/:id', async ({ user, params, body }) => {
    const current = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const item = { ...current, ...parseOccasion(body), updatedAt: nowIso() };
    await repo.put(item);
    return { occasion: strip(item) };
  });

  route('DELETE', '/occasions/:id', async ({ user, params }) => {
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const tags = await repo.query(pk(user), `TAG#${params.id}#`);
    await repo.batchDel([{ PK: pk(user), SK: `OCC#${params.id}` }, ...tags]);
    return { deleted: true };
  });

  const tagItem = (user, oid, hid) => ({
    PK: pk(user), SK: `TAG#${oid}#${hid}`, occasionId: oid, householdId: hid, addedAt: nowIso(),
  });

  // Tag (add) or untag (remove) households for an occasion.
  route('PUT', '/occasions/:id/tags', async ({ user, params, body }) => {
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const add = ids(body.add ?? [], 'add');
    const remove = ids(body.remove ?? [], 'remove');
    const existing = await repo.query(pk(user), `TAG#${params.id}#`);
    const have = new Set(existing.map((t) => t.householdId));
    if (add.length) {
      const known = new Set((await repo.query(pk(user), 'HH#')).map((h) => h.id));
      const missing = add.filter((h) => !known.has(h));
      if (missing.length) throw new HttpError(404, 'Household not found');
      await repo.batchPut(add.filter((h) => !have.has(h)).map((h) => tagItem(user, params.id, h)));
    }
    const del = remove.filter((h) => have.has(h)).map((h) => ({ PK: pk(user), SK: `TAG#${params.id}#${h}` }));
    if (del.length) await repo.batchDel(del);
    return { tags: (await repo.query(pk(user), `TAG#${params.id}#`)).map(strip) };
  });

  // Mark households as mailed (or not) — e.g. after printing their labels.
  route('POST', '/occasions/:id/mailed', async ({ user, params, body }) => {
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const hids = new Set(ids(body.householdIds, 'householdIds'));
    if (typeof body.mailed !== 'boolean') throw new HttpError(400, 'mailed must be true or false');
    const tags = (await repo.query(pk(user), `TAG#${params.id}#`)).filter((t) => hids.has(t.householdId));
    const updated = tags.map(({ mailedAt, ...t }) => (body.mailed ? { ...t, mailedAt: mailedAt ?? nowIso() } : t));
    if (updated.length) await repo.batchPut(updated);
    return { tags: (await repo.query(pk(user), `TAG#${params.id}#`)).map(strip) };
  });

  // Emails the invitation to tagged households. Each household gets one email addressed to all of
  // its people. With test: true, one sample goes to the signed-in user only.
  route('POST', '/occasions/:id/invites', async ({ user, params, body }) => {
    const o = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    if (!o.invite?.message) throw new HttpError(400, 'Write the invitation message first (Edit occasion)');
    const profile = await getProfile(user);
    const fromName = senderName(profile);

    if (body.test) {
      const sample = (await repo.query(pk(user), `TAG#${params.id}#`))[0];
      const h = sample ? await repo.get(pk(user), `HH#${sample.householdId}`) : null;
      const msg = buildInvite({ occasion: o, household: h ?? { labelName: fullName(profile) || 'Friend' }, fromName, test: true });
      try {
        await mailer.send({ to: user.email, ...msg, fromName, replyTo: user.email });
      } catch (e) {
        log.error(e);
        throw new HttpError(502, sesHint(e, 'The test email could not be sent.'));
      }
      return { sentTo: user.email };
    }

    const hids = ids(body.householdIds, 'householdIds', { max: INVITE_BATCH });
    const results = [];
    for (const [i, hid] of hids.entries()) {
      const tag = await repo.get(pk(user), `TAG#${params.id}#${hid}`);
      const h = await repo.get(pk(user), `HH#${hid}`);
      if (!tag || !h) { results.push({ householdId: hid, status: 'skipped', reason: 'Not on this occasion\'s list' }); continue; }
      const to = householdEmails(h);
      if (!to.length) { results.push({ householdId: hid, status: 'skipped', reason: 'No email address' }); continue; }
      try {
        if (i) await pause(120); // stay under SES's per-second send rate
        await mailer.send({ to, ...buildInvite({ occasion: o, household: h, fromName }), fromName, replyTo: user.email });
        const { inviteError, ...t } = tag;
        await repo.put({ ...t, invitedAt: nowIso(), invitedTo: to });
        results.push({ householdId: hid, status: 'sent', to });
      } catch (e) {
        log.error(e);
        const reason = sesHint(e, 'Sending failed');
        await repo.put({ ...tag, inviteError: reason });
        results.push({ householdId: hid, status: 'failed', reason });
      }
    }
    return { results };
  });

  // ---------- public: address-update link ----------
  async function linkContext(token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'This link isn\'t valid.');
    const t = await repo.get(tokenPk(token), 'TOKEN');
    if (!t || Date.parse(t.expiresAt) < now().getTime()) throw new HttpError(404, 'This link has expired. Ask the sender for a new one.');
    const h = await repo.get(userPk(t.sub), `HH#${t.householdId}`);
    if (!h) throw new HttpError(404, 'This link is no longer in use.');
    return { t, h };
  }

  route('GET', '/public/address/:token', async ({ params }) => {
    const { t, h } = await linkContext(params.token);
    return {
      labelName: h.labelName,
      fromName: t.fromName || '',
      address: h.pendingUpdate?.address ?? h.address ?? {},
      submittedAt: t.submittedAt,
      expiresAt: t.expiresAt,
    };
  }, { open: true });

  route('POST', '/public/address/:token', async ({ params, body }) => {
    const { t, h } = await linkContext(params.token);
    const unchanged = body.unchanged === true;
    const address = unchanged ? (h.address ?? {}) : parseAddress(body.address);
    if (!unchanged && (!address.line1 || !address.city)) throw new HttpError(400, 'Enter at least the street address and city');
    const update = { address, unchanged, note: str(body.note, 'Note', { max: 500 }), receivedAt: nowIso() };

    const { pendingUpdate, ...rest } = h;
    const item = unchanged
      ? { ...rest, addressConfirmedAt: update.receivedAt, updatedAt: nowIso() }
      : { ...rest, pendingUpdate: update, updatedAt: nowIso() };
    await repo.put(item);
    await repo.put({ ...t, submittedAt: update.receivedAt });
    try {
      await mailer.send({ to: t.ownerEmail, ...buildAddressReceived({ household: h, update, appUrl }) });
    } catch (e) {
      log.error(e); // the reply is saved either way; the owner sees it in the app
    }
    return { saved: true };
  }, { open: true });

  // ---------- dispatch ----------
  return async function handler(event) {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    const path = (event.rawPath ?? event.path ?? '/').replace(/\/+$/, '') || '/';
    try {
      if (method === 'OPTIONS') return respond(204, null);
      const match = routes.find((r) => r.method === method && r.re.test(path));
      if (!match) {
        if (routes.some((r) => r.re.test(path))) throw new HttpError(405, 'Method not allowed');
        throw new HttpError(404, 'Not found');
      }
      const user = match.open ? null : await verify(event.headers?.authorization ?? event.headers?.Authorization);
      const values = match.re.exec(path).slice(1).map(decodeURIComponent);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, values[i]]));
      let body = {};
      if (event.body) {
        try {
          body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
        } catch {
          throw new HttpError(400, 'Request body must be JSON');
        }
        if (!body || typeof body !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
      }
      return respond(200, await match.fn({ user, params, body, query: event.queryStringParameters ?? {} }));
    } catch (err) {
      if (err instanceof HttpError) return respond(err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
      log.error(err);
      return respond(500, { error: 'Something went wrong. Please try again.' });
    }
  };
}

// SES's sandbox only delivers to verified addresses; say so instead of a bare failure.
function sesHint(e, fallback) {
  const m = String(e?.message ?? '');
  if (/not verified|MessageRejected/i.test(m) || e?.name === 'MessageRejected') {
    return `${fallback} Amazon SES rejected it (${m.slice(0, 160)}). While SES is in the sandbox, every recipient must be a verified address.`;
  }
  return fallback;
}

function respond(statusCode, data) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: data === null ? '' : JSON.stringify(data),
  };
}
