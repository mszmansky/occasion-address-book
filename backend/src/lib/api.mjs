// HTTP API (API Gateway HTTP API, payload v2).
// Every route needs a Cognito ID token except /public/*, which serves the address-update
// page a household opens from its emailed link (the link's token is the credential there).

import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './auth.mjs';
import { userPk } from './repo.mjs';
import { buildAddressReceived, buildAddressRequest, buildInvite, buildShareNotice } from './email.mjs';
import { cleanDesignHtml } from './sanitize.mjs';
import { BORDERS, FONTS } from './design-core.mjs';

export const LINK_DAYS = 30;          // address-update links expire after this many days
export const TRASH_DAYS = 30;         // deleted households and occasions stay in the Trash this long
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
    const relationship = str(m.relationship, `${firstName ?? `Person ${i + 1}`}'s relationship`, { max: 40 });
    if (!firstName && !lastName && !em && !phone) continue; // blank row
    if (!firstName && !lastName) throw new HttpError(400, `Give person ${i + 1} a name`);
    out.push({
      id: typeof m.id === 'string' && /^[a-z0-9]{1,40}$/.test(m.id) ? m.id : newId(),
      firstName, lastName, email: em, phone, relationship,
      primary: m.primary === true || m.primary === 'true' || undefined,
    });
  }
  // One default contact at most: the first one ticked.
  let seen = false;
  for (const m of out) { if (m.primary && seen) delete m.primary; else if (m.primary) seen = true; }
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
    labelName: str(b.labelName, 'Household Greeting', { max: 120, required: true }),
    formalName: str(b.formalName, 'Formal Greeting', { max: 160 }),
    greeting: str(b.greeting, 'Informal Greeting', { max: 120 }),
    address: parseAddress(b.address),
    emails: emails(b.emails, 'Household email'),
    phone: str(b.phone, 'Phone', { max: 30 }),
    members: parseMembers(b.members),
    groups: parseGroups(b.groups),
    notes: str(b.notes, 'Notes', { max: 2000 }),
  };
}

// Cards or Labels (print), Invitations (designed, printed), Emails (designed, emailed).
// "other" from earlier versions is treated as cards.
const KINDS = ['card', 'invite', 'email'];
export const kindOf = (o) => (KINDS.includes(o?.kind) ? o.kind : 'card');
const NAME_STYLES = ['label', 'formal'];
const GREET_STYLES = ['informal', 'formal', 'household', 'person'];

function parseOccasion(b) {
  const kind = b.kind === undefined || b.kind === 'other' ? 'card' : b.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Type must be card, invite or email');
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
    greetStyle: GREET_STYLES.includes(b.greetStyle) ? b.greetStyle : 'informal',
    notes: str(b.notes, 'Notes', { max: 2000 }),
    invite: {
      subject: str(inv.subject, 'Email subject', { max: 200 }),
      message: str(inv.message, 'Email message', { max: 5000 }),
    },
  };
}

export const DESIGN_MAX = 100_000; // characters of HTML
const HEX = /^#[0-9a-f]{6}$/i;
export function parseDesign(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Design is invalid');
  if (typeof (b.html ?? '') !== 'string') throw new HttpError(400, 'Design must be HTML text');
  if (String(b.html ?? '').length > DESIGN_MAX) throw new HttpError(400, 'The design is too large. Use fewer or smaller pictures pasted as links.');
  const html = cleanDesignHtml(b.html);
  for (const [k, label] of [['background', 'Background color'], ['color', 'Text color']]) {
    if (b[k] !== undefined && b[k] !== '' && !HEX.test(b[k])) throw new HttpError(400, `${label} must look like #ffffff`);
  }
  if (b.font !== undefined && !FONTS.some((f) => f.key === b.font)) throw new HttpError(400, 'Unknown font');
  if (b.border !== undefined && !BORDERS.some((x) => x.key === b.border)) throw new HttpError(400, 'Unknown border');
  if (b.borderColor !== undefined && b.borderColor !== '' && !HEX.test(b.borderColor)) throw new HttpError(400, 'Border color must look like #ffffff');
  return {
    html, background: b.background || undefined, color: b.color || undefined, font: b.font || undefined,
    border: b.border && b.border !== 'none' ? b.border : undefined, borderColor: b.border && b.border !== 'none' ? b.borderColor || undefined : undefined,
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

// The household's default contact: the person ticked as default, else the first person with an email.
export function defaultContact(h) {
  const withEmail = (h.members ?? []).filter((m) => m.email);
  return withEmail.find((m) => m.primary) ?? withEmail[0] ?? null;
}

/**
 * Who an invitation goes to. choice: 'default' (or nothing), 'all', or a person's id.
 * Without people who have an email, it falls back to the household's own addresses.
 */
export function inviteRecipients(h, choice) {
  const all = householdEmails(h);
  if (choice === 'all') return all;
  const people = (h.members ?? []).filter((m) => m.email);
  const chosen = (choice && people.find((m) => m.id === choice)) ?? defaultContact(h);
  return chosen ? [chosen.email.toLowerCase()] : all;
}

// Every address a household can be emailed at: its own plus each person's, without repeats.
export function householdEmails(h) {
  return [...new Set([...(h.emails ?? []), ...(h.members ?? []).map((m) => m.email)].filter(Boolean).map((e) => e.toLowerCase()))];
}

const strip = ({ PK, SK, GSI1PK, GSI1SK, ...rest }) => rest;
const occOut = (o) => ({ ...strip(o), kind: kindOf(o) });
const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ');

export function createApi({ repo, verify, mailer, appUrl, files, media, directory, addressChecker, now = () => new Date(), log = console, pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const routes = [];
  // open: no sign-in (the address-check page). write: changes the book or sends email, so
  // View-only people can't.
  const route = (method, pattern, fn, { open = false, write = false, owner = false } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, fn, open, write, owner });
  };
  const nowIso = () => now().toISOString();
  const pk = (user) => userPk(user.sub);   // the person: profile, photo, printer settings
  const bk = (user) => user.book.pk;        // the address book they work in: their own, or one shared with them

  // ---------- address books & sharing ----------
  // Everyone has their own private book (their USER# partition). An owner can share it; the people
  // they share with keep their own book too, and pick which book to work in (the x-book header).
  // Shares are tied to each person's permanent account id (Cognito "sub"), never to an email, so
  // either side can change their sign-in email without re-sharing.
  //   USER#<owner> / SHARE#<member sub>          who the owner shares with, and how (edit or view)
  //   MEMBER#<member sub> / BOOK#<owner sub>     the same share, from the member's side
  // Emails stored on these are only for display; they're refreshed when the member signs in.
  const memberPk = (sub) => `MEMBER#${sub}`;
  const legacyPk = (email) => `SHARED#${email}`; // first version: shares keyed by email

  // Moves shares saved by earlier versions (keyed by email, or one shared book per person) to
  // MEMBER#<sub> / BOOK#<owner>.
  async function migrateShares(user) {
    const moves = [];
    const byEmail = await repo.get(legacyPk(user.email), 'BOOK');
    if (byEmail) moves.push({ old: byEmail, key: { PK: legacyPk(user.email), SK: 'BOOK' }, ownerRowSk: `SHARE#${user.email}` });
    const single = await repo.get(memberPk(user.sub), 'BOOK');
    if (single) moves.push({ old: single, key: { PK: memberPk(user.sub), SK: 'BOOK' }, ownerRowSk: `SHARE#${user.sub}` });
    for (const { old, key, ownerRowSk } of moves) {
      if (old.ownerSub === user.sub) { await repo.del(key.PK, key.SK); continue; }
      const ownerPk = userPk(old.ownerSub);
      const oldRow = await repo.get(ownerPk, ownerRowSk);
      await repo.batchPut([
        { PK: memberPk(user.sub), SK: `BOOK#${old.ownerSub}`, memberSub: user.sub, email: user.email, role: old.role, ownerSub: old.ownerSub, sharedAt: old.sharedAt },
        { PK: ownerPk, SK: `SHARE#${user.sub}`, memberSub: user.sub, email: user.email, role: old.role, sharedAt: old.sharedAt, invited: oldRow?.invited },
      ]);
      await repo.batchDel([key, ...(oldRow && ownerRowSk !== `SHARE#${user.sub}` ? [{ PK: ownerPk, SK: ownerRowSk }] : [])]);
    }
  }

  // The books shared with this person, with each owner's current name and email.
  async function sharedBooks(user) {
    await migrateShares(user);
    const rows = await repo.query(memberPk(user.sub), 'BOOK#');
    const out = [];
    for (const m of rows) {
      if (m.email !== user.email) { // keep the email the owner sees current
        const row = await repo.get(userPk(m.ownerSub), `SHARE#${user.sub}`);
        await repo.batchPut([{ ...m, email: user.email }, ...(row ? [{ ...row, email: user.email }] : [])]);
      }
      const owner = (await repo.get(userPk(m.ownerSub), 'PROFILE')) ?? {};
      out.push({ id: m.ownerSub, role: m.role, ownerName: fullName(owner), ownerEmail: owner.email ?? '', sharedAt: m.sharedAt });
    }
    return out.sort((x, y) => (x.ownerName || x.ownerEmail).localeCompare(y.ownerName || y.ownerEmail));
  }

  // Which book this request works in: x-book names a shared book's owner; otherwise your own.
  async function resolveBook(user, requested) {
    const own = { id: user.sub, pk: userPk(user.sub), ownerSub: user.sub, role: 'owner' };
    if (!requested || requested === user.sub) return own;
    if (!/^[\w-]{1,64}$/.test(requested)) throw new HttpError(400, 'Invalid address book');
    let m = await repo.get(memberPk(user.sub), `BOOK#${requested}`);
    if (!m) { await migrateShares(user); m = await repo.get(memberPk(user.sub), `BOOK#${requested}`); }
    if (!m) throw new HttpError(403, 'That address book is no longer shared with you', 'book_gone');
    const owner = (await repo.get(userPk(m.ownerSub), 'PROFILE')) ?? {};
    return { id: m.ownerSub, pk: userPk(m.ownerSub), ownerSub: m.ownerSub, role: m.role, ownerName: fullName(owner), ownerEmail: owner.email ?? '' };
  }
  const canEdit = (user) => user.book.role === 'owner' || user.book.role === 'edit';

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
    const item = await repo.get(bk(user), sk);
    if (!item) throw new HttpError(404, `${what} not found`);
    return item;
  }

  const publicHousehold = (h) => strip(h);

  // ---------- two people editing at once ----------
  // Each household, occasion and design carries updatedAt. The app sends the one it started from
  // (baseUpdatedAt); if someone else saved in the meantime, the save is refused with 409 and their
  // version, so the app can offer "Load their version" or "Save mine anyway" (which resends with
  // their updatedAt). Saves without baseUpdatedAt (older app versions) still go through.
  const stampOf = async (user) => ({ updatedBy: user.sub, updatedByName: fullName(await getProfile(user)) || user.email });
  async function saveChecked(user, current, item, base, out) {
    const who = await stampOf(user);
    const next = { ...item, ...who };
    if (base === undefined) { await repo.put(next); return next; }
    try {
      if (base !== (current.updatedAt ?? null)) throw Object.assign(new Error('changed'), { name: 'ConditionalCheckFailedException' });
      await repo.putIfUnchanged(next, current.updatedAt);
      return next;
    } catch (e) {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
      const latest = await repo.get(current.PK, current.SK);
      const mine = latest?.updatedBy === user.sub;
      const err = new HttpError(409, `${mine ? 'You' : latest?.updatedByName || 'Someone'} changed this while you were editing it`, 'conflict');
      err.extra = { current: latest ? out(latest) : null, changedBy: mine ? 'you' : latest?.updatedByName || 'Someone' };
      throw err;
    }
  }
  const baseOf = (body) => (body.baseUpdatedAt === undefined ? undefined : typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null);

  // ---------- profile ----------
  // The profile as the app sees it: the stored photo becomes a link that works for an hour.
  async function publicProfile(p) {
    const { avatar, ...rest } = strip(p);
    return { ...rest, avatarUrl: avatar && files ? await files.signDownload(avatar.key, { name: 'avatar', type: avatar.type }) : undefined };
  }

  // The book's owner profile holds the return address (it belongs to the shared book).
  async function bookProfile(user) {
    return user.book.role === 'owner' ? getProfile(user) : (await repo.get(user.book.pk, 'PROFILE')) ?? {};
  }

  async function meResponse(user, own) {
    const book = user.book.role === 'owner' ? own : await bookProfile(user);
    return {
      profile: { ...(await publicProfile(own)), returnName: book.returnName, returnAddress: book.returnAddress ?? {} },
      book: user.book.role === 'owner'
        ? { id: user.book.id, role: 'owner', canEdit: true }
        : { id: user.book.id, role: user.book.role, canEdit: canEdit(user), ownerName: user.book.ownerName, ownerEmail: user.book.ownerEmail },
      linkDays: LINK_DAYS,
    };
  }

  route('GET', '/me', async ({ user }) => meResponse(user, await getProfile(user)));

  // Your own book first, then the ones shared with you.
  route('GET', '/books', async ({ user }) => ({
    books: [{ id: user.sub, role: 'owner', own: true }, ...(await sharedBooks(user))],
  }));

  // Name, photo and printer settings are the person's own; the return address is the book's.
  route('PUT', '/me', async ({ user, body }) => {
    const { returnName, returnAddress, ...personal } = body;
    const current = await getProfile(user);
    const updated = { ...current, ...parseProfile(personal, current), returnName: current.returnName, returnAddress: current.returnAddress, updatedAt: nowIso() };
    if (returnName !== undefined || returnAddress !== undefined) {
      if (!canEdit(user)) throw new HttpError(403, 'You have view-only access to this address book', 'view_only');
      const book = user.book.role === 'owner' ? updated : { PK: user.book.pk, SK: 'PROFILE', ...(await bookProfile(user)) };
      const parsed = parseProfile({ returnName, returnAddress }, book);
      Object.assign(book, { returnName: parsed.returnName, returnAddress: parsed.returnAddress });
      if (book !== updated) await repo.put({ ...book, updatedAt: nowIso() });
    }
    await repo.put(updated);
    return meResponse(user, updated);
  });

  // ---------- sharing (owner only) ----------
  const shareView = (sh) => ({ id: sh.memberSub ?? sh.email, email: sh.email, role: sh.role, sharedAt: sh.sharedAt, invited: sh.invited || undefined });
  const listShares = async (user) => (await repo.query(pk(user), 'SHARE#')).map(shareView).sort((x, y) => x.email.localeCompare(y.email));
  const parseRole = (r) => {
    if (!['edit', 'view'].includes(r)) throw new HttpError(400, 'Choose "Can edit" or "View only"');
    return r;
  };
  // The owner's row and the member's row for one share (rows from the first, email-keyed version included).
  async function shareRows(user, id) {
    const row = await repo.get(pk(user), `SHARE#${id}`);
    if (!row) throw new HttpError(404, 'Not shared with that person');
    // The member's side, wherever this version or an earlier one put it.
    const candidates = row.memberSub
      ? [{ PK: memberPk(row.memberSub), SK: `BOOK#${user.sub}` }, { PK: memberPk(row.memberSub), SK: 'BOOK' }]
      : [{ PK: legacyPk(row.email), SK: 'BOOK' }];
    for (const mKey of candidates) {
      const m = await repo.get(mKey.PK, mKey.SK);
      if (m?.ownerSub === user.sub) return { row, m, mKey };
    }
    return { row, m: null, mKey: null };
  }

  route('GET', '/shares', async ({ user }) => {
    await getProfile(user); // keeps the owner's email current for the people they share with
    return { shares: await listShares(user) };
  });

  route('POST', '/shares', async ({ user, body }) => {
    if (!directory) throw new HttpError(503, 'Sharing is not set up');
    const email = (str(body.email, 'Email', { max: 254, required: true }) ?? '').toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(400, `"${email}" is not a valid email`);
    if (email === user.email) throw new HttpError(400, "That's your own email");
    const role = parseRole(body.role);
    if ((await repo.query(pk(user), 'SHARE#')).length >= 20) throw new HttpError(400, 'You can share with at most 20 people');

    // Find their account (or create one and email them an invitation): the share follows that account.
    const { sub, invited } = await directory.invite(email);
    if (!sub) throw new HttpError(502, 'Could not find or create an account for that email. Please try again.');
    if (sub === user.sub) throw new HttpError(400, "That's your own account");
    const existing = await repo.get(memberPk(sub), `BOOK#${user.sub}`);

    const ownerName = fullName(await getProfile(user)) || '';
    const sharedAt = existing?.sharedAt ?? nowIso();
    await repo.batchPut([
      { PK: pk(user), SK: `SHARE#${sub}`, memberSub: sub, email, role, sharedAt, invited: invited || undefined },
      { PK: memberPk(sub), SK: `BOOK#${user.sub}`, memberSub: sub, email, role, ownerSub: user.sub, sharedAt },
    ]);
    if (!existing) {
      try {
        await mailer.send({ to: email, ...buildShareNotice({ ownerName, ownerEmail: user.email, role, invited, appUrl }), fromName: ownerName, replyTo: user.email });
      } catch (e) {
        log.error(e); // the share works either way; they'll see the book when they sign in
      }
    }
    return { share: shareView({ memberSub: sub, email, role, sharedAt, invited }), shares: await listShares(user) };
  });

  route('PUT', '/shares/:id', async ({ user, params, body }) => {
    const role = parseRole(body.role);
    const { row, m } = await shareRows(user, params.id);
    await repo.batchPut([{ ...row, role }, ...(m ? [{ ...m, role }] : [])]);
    return { shares: await listShares(user) };
  });

  route('DELETE', '/shares/:id', async ({ user, params }) => {
    const { row, m, mKey } = await shareRows(user, params.id);
    await repo.batchDel([{ PK: row.PK, SK: row.SK }, ...(m ? [mKey] : [])]);
    return { shares: await listShares(user) };
  });

  // ---------- profile photo (same as Vehicle Maintenance) ----------
  // The browser crops the photo to a square JPEG, asks for an upload link, PUTs the file straight
  // to the private bucket, then calls complete so the API can check it arrived and is small enough.
  const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const AVATAR_MAX = 5 * 1024 * 1024;
  const avatarKey = (sub, id, type) => `avatars/${sub}/${id}.${AVATAR_TYPES[type]}`;
  const needFiles = () => { if (!files) throw new HttpError(503, 'Photo storage is not set up'); };

  route('POST', '/me/avatar', async ({ user, body }) => {
    needFiles();
    const type = String(body.type ?? '');
    if (!AVATAR_TYPES[type]) throw new HttpError(400, 'Use a JPEG, PNG or WebP image');
    const size = num(body.size, 'File size', { min: 1, max: Number.MAX_SAFE_INTEGER, required: true });
    if (size > AVATAR_MAX) throw new HttpError(400, 'Profile photos can be up to 5 MB');
    const id = newId();
    return { id, uploadUrl: await files.signUpload(avatarKey(user.sub, id, type), { type, size }) };
  });

  route('POST', '/me/avatar/:aid/complete', async ({ user, params, body }) => {
    needFiles();
    if (!/^[a-f0-9]{16}$/.test(params.aid)) throw new HttpError(400, 'Invalid upload');
    const type = String(body.type ?? '');
    if (!AVATAR_TYPES[type]) throw new HttpError(400, 'Use a JPEG, PNG or WebP image');
    const key = avatarKey(user.sub, params.aid, type);
    const size = await files.size(key);
    if (size === null) throw new HttpError(409, 'The upload did not finish. Please try again.');
    if (size > AVATAR_MAX) { await files.remove([key]); throw new HttpError(400, 'Profile photos can be up to 5 MB'); }
    const profile = await getProfile(user);
    const old = profile.avatar?.key;
    const updated = { ...profile, avatar: { key, type, updatedAt: nowIso() } };
    await repo.put(updated);
    if (old && old !== key) await files.remove([old]);
    return { profile: (await meResponse(user, updated)).profile };
  });

  route('DELETE', '/me/avatar', async ({ user }) => {
    const profile = await getProfile(user);
    if (profile.avatar && files) await files.remove([profile.avatar.key]);
    const { avatar, ...rest } = profile;
    await repo.put(rest);
    return { profile: (await meResponse(user, rest)).profile };
  });

  // ---------- households ----------
  route('GET', '/households', async ({ user }) => ({
    households: (await repo.query(bk(user), 'HH#')).map(publicHousehold),
  }));

  route('POST', '/households', async ({ user, body }) => {
    const id = newId();
    const item = { PK: bk(user), SK: `HH#${id}`, id, ...parseHousehold(body), createdAt: nowIso(), updatedAt: nowIso() };
    await repo.put(item);
    return { household: publicHousehold(item) };
  }, { write: true });

  route('POST', '/households/import', async ({ user, body }) => {
    const list = body.households;
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Nothing to import');
    if (list.length > IMPORT_MAX) throw new HttpError(400, `Import at most ${IMPORT_MAX} households at a time`);
    const items = list.map((row, i) => {
      try {
        const id = newId();
        return { PK: bk(user), SK: `HH#${id}`, id, ...parseHousehold(row), createdAt: nowIso(), updatedAt: nowIso() };
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(400, `Row ${i + 1}: ${e.message}`);
        throw e;
      }
    });
    await repo.batchPut(items);
    return { imported: items.length };
  }, { write: true });

  route('PUT', '/households/:id', async ({ user, params, body }) => {
    const current = await mustGet(user, `HH#${params.id}`, 'Household');
    const item = { ...current, ...parseHousehold(body), updatedAt: nowIso() };
    return { household: publicHousehold(await saveChecked(user, current, item, baseOf(body), publicHousehold)) };
  }, { write: true });

  // Deleting moves the household to the Trash, with its places on occasion lists so a restore puts them back.
  route('DELETE', '/households/:id', async ({ user, params }) => {
    const h = await mustGet(user, `HH#${params.id}`, 'Household');
    const tags = (await repo.query(bk(user), 'TAG#')).filter((t) => t.householdId === params.id);
    await toTrash(user, 'household', h, tags);
    return { deleted: true, trashed: true };
  }, { write: true });

  // A reply from the household's address-update link: take it, or throw it away.
  route('POST', '/households/:id/pending/:action', async ({ user, params }) => {
    if (!['accept', 'discard'].includes(params.action)) throw new HttpError(404, 'Not found');
    const h = await mustGet(user, `HH#${params.id}`, 'Household');
    if (!h.pendingUpdate) throw new HttpError(409, 'There is no address waiting to be reviewed');
    const { pendingUpdate, ...rest } = h;
    // Accepting changes the address, so it counts as an edit; discarding leaves the household as it was.
    const item = params.action === 'accept'
      ? { ...rest, address: pendingUpdate.address, addressConfirmedAt: pendingUpdate.receivedAt, updatedAt: nowIso(), ...await stampOf(user) }
      : rest;
    await repo.put(item);
    return { household: publicHousehold(item) };
  }, { write: true });

  // ---------- address checks (USPS) ----------
  // How many checks are left this hour (USPS allows 60 an hour for the whole app). enabled: false
  // until USPS credentials are set up.
  route('GET', '/address-check', async () => ({ checks: addressChecker ? await addressChecker.status() : { enabled: false } }));

  // Checks the address as typed (it doesn't have to be saved yet); nothing changes until it's saved.
  route('POST', '/address-check', async ({ body }) => {
    if (!addressChecker) throw new HttpError(503, "Address checking isn't set up yet");
    const a = body.address ?? {};
    const address = {
      line1: str(a.line1, 'Street address', { max: 120 }), line2: str(a.line2, 'Apt, suite, unit', { max: 120 }),
      city: str(a.city, 'City', { max: 80 }), state: str(a.state, 'State', { max: 40 }), zip: str(a.zip, 'ZIP', { max: 20 }),
      country: str(a.country, 'Country', { max: 60 }),
    };
    if (address.country && !/^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(address.country)) {
      throw new HttpError(400, 'USPS can only check US addresses');
    }
    if (!address.line1 || !address.state || !(address.city || address.zip)) {
      throw new HttpError(400, 'Enter the street, state, and the city or ZIP first');
    }
    return addressChecker.check(address);
  }, { write: true });

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
      PK: tokenPk(token), SK: 'TOKEN', sub: user.book.ownerSub, householdId: h.id, ownerEmail: user.email, fromName,
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
    const item = { ...h, addressRequest: { sentAt: nowIso(), sentTo: to, expiresAt: expires.toISOString() } };
    await repo.put(item);
    return { household: publicHousehold(item), sentTo: to };
  }, { write: true });

  // ---------- occasions ----------
  route('GET', '/occasions', async ({ user }) => {
    const [occasions, tags] = await Promise.all([repo.query(bk(user), 'OCC#'), repo.query(bk(user), 'TAG#')]);
    const counts = {};
    for (const t of tags) {
      const c = (counts[t.occasionId] ??= { tagged: 0, mailed: 0, invited: 0 });
      c.tagged++;
      if (t.mailedAt) c.mailed++;
      if (t.invitedAt) c.invited++;
    }
    return {
      occasions: occasions.map((o) => ({ ...occOut(o), counts: counts[o.id] ?? { tagged: 0, mailed: 0, invited: 0 } }))
        .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt)),
    };
  });

  route('POST', '/occasions', async ({ user, body }) => {
    const id = newId();
    const item = { PK: bk(user), SK: `OCC#${id}`, id, ...parseOccasion(body), createdAt: nowIso(), updatedAt: nowIso() };
    let tags = [];
    if (body.copyFrom) {
      // Start from last year's list: same households (those still in the address book), fresh mailed/invited state.
      const [from] = ids([body.copyFrom], 'Copy from');
      await mustGet(user, `OCC#${from}`, 'Occasion to copy from');
      const [old, households] = await Promise.all([repo.query(bk(user), `TAG#${from}#`), repo.query(bk(user), 'HH#')]);
      const alive = new Set(households.map((h) => h.id));
      tags = old.filter((t) => alive.has(t.householdId)).map((t) => tagItem(user, id, t.householdId));
    }
    await repo.put(item);
    if (tags.length) await repo.batchPut(tags);
    return { occasion: occOut(item), copied: tags.length };
  }, { write: true });

  route('GET', '/occasions/:id', async ({ user, params }) => {
    const o = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const tags = await repo.query(bk(user), `TAG#${params.id}#`);
    return { occasion: occOut(o), tags: tags.map(strip) };
  });

  route('PUT', '/occasions/:id', async ({ user, params, body }) => {
    const current = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const item = { ...current, ...parseOccasion(body), updatedAt: nowIso() };
    return { occasion: occOut(await saveChecked(user, current, item, baseOf(body), occOut)) };
  }, { write: true });

  // Deleting moves the occasion, with its list (and who was mailed / invited), to the Trash.
  route('DELETE', '/occasions/:id', async ({ user, params }) => {
    const o = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const tags = await repo.query(bk(user), `TAG#${params.id}#`);
    await toTrash(user, 'occasion', o, tags);
    return { deleted: true, trashed: true };
  }, { write: true });

  // ---------- Trash ----------
  //   <book> / TRASH#household#<id>   or   TRASH#occasion#<id>
  // holds the deleted item and the occasion-list rows that went with it. The "ttl" attribute makes
  // DynamoDB remove it after TRASH_DAYS; since that can lag a day or two, expired items are also
  // hidden and purged here.
  const TYPES = { household: 'HH', occasion: 'OCC' };
  const trashSk = (type, id) => `TRASH#${type}#${id}`;
  const expired = (t) => Date.parse(t.expiresAt) <= now().getTime();

  async function toTrash(user, type, item, tags) {
    const deletedAt = nowIso();
    const expires = new Date(now().getTime() + TRASH_DAYS * 86_400_000);
    await repo.put({
      PK: bk(user), SK: trashSk(type, item.id), type, id: item.id, item: strip(item), tags: tags.map(strip),
      deletedAt, deletedBy: user.email, expiresAt: expires.toISOString(), ttl: Math.floor(expires.getTime() / 1000),
    });
    await repo.batchDel([{ PK: bk(user), SK: item.SK }, ...tags]);
  }

  async function trashList(user) {
    const rows = await repo.query(bk(user), 'TRASH#');
    const gone = rows.filter(expired);
    if (gone.length) await repo.batchDel(gone);
    return rows.filter((t) => !expired(t));
  }

  const trashView = (t) => ({
    type: t.type, id: t.id, deletedAt: t.deletedAt, deletedBy: t.deletedBy, expiresAt: t.expiresAt,
    name: t.type === 'household' ? t.item.labelName : t.item.name,
    detail: t.type === 'household'
      ? [t.item.address?.city, t.item.address?.state].filter(Boolean).join(', ')
      : `${t.tags.length} ${t.tags.length === 1 ? 'household' : 'households'} on the list`,
  });

  async function mustGetTrash(user, params) {
    if (!TYPES[params.type]) throw new HttpError(404, 'Not found');
    const t = await repo.get(bk(user), trashSk(params.type, params.id));
    if (!t || expired(t)) throw new HttpError(404, 'That item is no longer in the Trash');
    return t;
  }

  route('GET', '/trash', async ({ user }) => ({
    items: (await trashList(user)).map(trashView).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.name.localeCompare(b.name)),
    days: TRASH_DAYS,
  }));

  // Restore: the item comes back with the occasion-list rows whose other half still exists.
  route('POST', '/trash/:type/:id/restore', async ({ user, params }) => {
    const t = await mustGetTrash(user, params);
    const sk = `${TYPES[t.type]}#${t.id}`;
    if (await repo.get(bk(user), sk)) throw new HttpError(409, 'It has already been restored');
    const live = t.type === 'household'
      ? new Set((await repo.query(bk(user), 'OCC#')).map((o) => o.id))
      : new Set((await repo.query(bk(user), 'HH#')).map((h) => h.id));
    const otherId = (g) => (t.type === 'household' ? g.occasionId : g.householdId);
    const tags = t.tags.filter((g) => live.has(otherId(g)))
      .map((g) => ({ PK: bk(user), SK: `TAG#${g.occasionId}#${g.householdId}`, ...g }));
    // A link to something that's also in the bin goes with that item, so restoring it later relinks them.
    const otherType = t.type === 'household' ? 'occasion' : 'household';
    const handOff = [];
    for (const g of t.tags.filter((x) => !live.has(otherId(x)))) {
      const other = handOff.find((o) => o.id === otherId(g)) ?? await repo.get(bk(user), trashSk(otherType, otherId(g)));
      if (!other || expired(other)) continue;
      if (!other.tags.some((x) => x.occasionId === g.occasionId && x.householdId === g.householdId)) other.tags.push(g);
      if (!handOff.includes(other)) handOff.push(other);
    }
    const item = { PK: bk(user), SK: sk, ...t.item, updatedAt: nowIso() };
    await repo.batchPut([item, ...tags, ...handOff]);
    await repo.del(bk(user), trashSk(t.type, t.id));
    return { restored: trashView(t), [t.type]: strip(item), relinked: tags.length };
  }, { write: true });

  route('DELETE', '/trash/:type/:id', async ({ user, params }) => {
    const t = await mustGetTrash(user, params);
    await repo.del(bk(user), trashSk(t.type, t.id));
    return { deleted: true };
  }, { write: true });

  route('DELETE', '/trash', async ({ user }) => {
    const rows = await repo.query(bk(user), 'TRASH#');
    if (rows.length) await repo.batchDel(rows);
    return { emptied: rows.length };
  }, { write: true });

  const tagItem = (user, oid, hid) => ({
    PK: bk(user), SK: `TAG#${oid}#${hid}`, occasionId: oid, householdId: hid, addedAt: nowIso(),
  });

  // Tag (add) or untag (remove) households for an occasion.
  route('PUT', '/occasions/:id/tags', async ({ user, params, body }) => {
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const add = ids(body.add ?? [], 'add');
    const remove = ids(body.remove ?? [], 'remove');
    const existing = await repo.query(bk(user), `TAG#${params.id}#`);
    const have = new Set(existing.map((t) => t.householdId));
    if (add.length) {
      const known = new Set((await repo.query(bk(user), 'HH#')).map((h) => h.id));
      const missing = add.filter((h) => !known.has(h));
      if (missing.length) throw new HttpError(404, 'Household not found');
      await repo.batchPut(add.filter((h) => !have.has(h)).map((h) => tagItem(user, params.id, h)));
    }
    const del = remove.filter((h) => have.has(h)).map((h) => ({ PK: bk(user), SK: `TAG#${params.id}#${h}` }));
    if (del.length) await repo.batchDel(del);
    // Emails: who in each household it goes to, e.g. { <household id>: [<person id>, …] }. Choosing
    // nobody takes the household off the list.
    if (body.people && typeof body.people === 'object') {
      const entries = Object.entries(body.people).slice(0, 1000);
      const now = await repo.query(bk(user), `TAG#${params.id}#`);
      const tags = new Map(now.map((t) => [t.householdId, t]));
      const puts = [];
      const dels = [];
      for (const [hid, list] of entries) {
        const [checked] = ids([hid], 'Household');
        const h = await repo.get(bk(user), `HH#${checked}`);
        if (!h) throw new HttpError(404, 'Household not found');
        const people = Array.isArray(list) ? [...new Set(list.map(String))].slice(0, 20) : [];
        const withEmail = new Set((h.members ?? []).filter((m) => m.email).map((m) => m.id));
        if (people.some((pid) => !withEmail.has(pid))) throw new HttpError(400, 'That person has no email address in this household');
        if (!people.length) { if (tags.has(checked)) dels.push({ PK: bk(user), SK: `TAG#${params.id}#${checked}` }); continue; }
        puts.push({ ...(tags.get(checked) ?? tagItem(user, params.id, checked)), to: people });
      }
      if (puts.length) await repo.batchPut(puts);
      if (dels.length) await repo.batchDel(dels);
    }
    return { tags: (await repo.query(bk(user), `TAG#${params.id}#`)).map(strip) };
  }, { write: true });

  // Mark households as mailed (or not) — e.g. after printing their labels.
  route('POST', '/occasions/:id/mailed', async ({ user, params, body }) => {
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const hids = new Set(ids(body.householdIds, 'householdIds'));
    if (typeof body.mailed !== 'boolean') throw new HttpError(400, 'mailed must be true or false');
    const tags = (await repo.query(bk(user), `TAG#${params.id}#`)).filter((t) => hids.has(t.householdId));
    const updated = tags.map(({ mailedAt, ...t }) => (body.mailed ? { ...t, mailedAt: mailedAt ?? nowIso() } : t));
    if (updated.length) await repo.batchPut(updated);
    return { tags: (await repo.query(bk(user), `TAG#${params.id}#`)).map(strip) };
  }, { write: true });

  // Emails the invitation to tagged households. Each household gets one email addressed to all of
  // its people. With test: true, one sample goes to the signed-in user only.
  // The designed invitation or email (Invitations and Emails). Cleaned of anything but formatting.
  route('PUT', '/occasions/:id/design', async ({ user, params, body }) => {
    const current = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    // The design has its own stamp, so editing the occasion's details doesn't clash with its design.
    const design = { ...parseDesign(body), updatedAt: nowIso() };
    const base = baseOf(body);
    if (base !== undefined && base !== (current.design?.updatedAt ?? null)) {
      const mine = current.design?.updatedBy === user.sub;
      const err = new HttpError(409, `${mine ? 'You' : current.design?.updatedByName || 'Someone'} changed this design while you were editing it`, 'conflict');
      err.extra = { current: occOut(current), changedBy: mine ? 'you' : current.design?.updatedByName || 'Someone' };
      throw err;
    }
    Object.assign(design, await stampOf(user));
    const item = { ...current, design }; // the occasion's own stamp is for its details
    await repo.put(item);
    return { occasion: occOut(item) };
  }, { write: true });

  // Pictures for designs. They're public (guests' mail apps load them), under unguessable names.
  const MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  route('POST', '/occasions/:id/images', async ({ user, params, body }) => {
    if (!media) throw new HttpError(503, 'Picture uploads are not set up');
    await mustGet(user, `OCC#${params.id}`, 'Occasion');
    const ext = MEDIA_TYPES[body.type];
    if (!ext) throw new HttpError(400, 'Pictures must be PNG, JPEG, GIF or WebP');
    const size = num(body.size, 'Size', { min: 1, max: 5 * 1024 * 1024, required: true });
    const key = `media/${randomBytes(16).toString('hex')}.${ext}`;
    return { uploadUrl: await media.signUpload(key, { type: body.type, size }), url: `${String(appUrl).replace(/\/$/, '')}/${key}` };
  }, { write: true });

  route('POST', '/occasions/:id/invites', async ({ user, params, body }) => {
    const o = await mustGet(user, `OCC#${params.id}`, 'Occasion');
    if (!o.design?.html && !o.invite?.message) throw new HttpError(400, 'Design the email first');
    const profile = await getProfile(user);
    const fromName = senderName(profile);

    if (body.test) {
      const sample = (await repo.query(bk(user), `TAG#${params.id}#`))[0];
      const h = sample ? await repo.get(bk(user), `HH#${sample.householdId}`) : null;
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
    // Per household: 'default' (the default contact), 'all', or a person's id. Missing = default.
    const choices = body.recipients && typeof body.recipients === 'object' ? body.recipients : {};
    // Per household: the greeting text chosen in the send window (Informal, Formal, a first name…).
    const greetings = body.greetings && typeof body.greetings === 'object' ? body.greetings : {};
    const results = [];
    for (const [i, hid] of hids.entries()) {
      const tag = await repo.get(bk(user), `TAG#${params.id}#${hid}`);
      const h = await repo.get(bk(user), `HH#${hid}`);
      if (!tag || !h) { results.push({ householdId: hid, status: 'skipped', reason: 'Not on this occasion\'s list' }); continue; }
      // Who it goes to: chosen in the send window, else the people ticked on the occasion's list,
      // else the default contact.
      const choice = typeof choices[hid] === 'string' ? choices[hid].slice(0, 40) : 'default';
      const ticked = !choices[hid] && Array.isArray(tag.to)
        ? (h.members ?? []).filter((m) => m.email && tag.to.includes(m.id)).map((m) => m.email.toLowerCase())
        : [];
      const to = ticked.length ? [...new Set(ticked)] : inviteRecipients(h, choice);
      if (!to.length) { results.push({ householdId: hid, status: 'skipped', reason: 'No email address' }); continue; }
      try {
        if (i) await pause(120); // stay under SES's per-second send rate
        const greeting = typeof greetings[hid] === 'string' && greetings[hid].trim() ? greetings[hid].trim().slice(0, 160) : undefined;
        await mailer.send({ to, ...buildInvite({ occasion: o, household: h, fromName, greeting }), fromName, replyTo: user.email });
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
  }, { write: true });

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
      ? { ...rest, addressConfirmedAt: update.receivedAt }
      : { ...rest, pendingUpdate: update }; // not an edit: what they sent waits for review
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
      if (user) {
        user.book = await resolveBook(user, event.headers?.['x-book'] ?? event.headers?.['X-Book']);
        if (match.write && !canEdit(user)) throw new HttpError(403, 'You have view-only access to this address book', 'view_only');
      }
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
      if (err instanceof HttpError) return respond(err.status, { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra ?? {}) });
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
