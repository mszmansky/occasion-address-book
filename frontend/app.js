import { createAuth } from './auth.js';
import {
  addressLines, addressProblem, buildEnvelopes, buildLabels, envelopeName, isMailable, sortKey, LABEL_SHEETS, ENVELOPES, INVITE_MEDIA, invitePages, inviteLayout,
} from './print-core.js';
import { activeCount, emptyFilter, filterChips, filterOptions, matchesFilter } from './filter-core.js';
import {
  parseCsv, FIELDS, guessMapping, looksLikeHeader, buildHouseholds, householdsToCsv, splitFirstNames, splitMembers,
  defaultFormalName, householdLastName, effectiveFormalName, peopleWithHouseholdContact, formatPhone, findExistingHousehold, mergeHousehold,
} from './csv-core.js';
import { householdToVcard, fileBaseName, parseVcards, contactsToHouseholds } from './vcard-core.js';
import { FLOURISHES, drawFlourish, flourishByLabel } from './ornaments.js';
import {
  BORDERS, FONTS, FIELDS as DESIGN_FIELDS, DESIGN_DEFAULTS, borderByKey, fieldValues, fontByKey, fontLink, renderDesign, starterHtml,
} from './design-core.js';

const cfg = window.APP_CONFIG ?? {};
const root = document.getElementById('root');
const modal = document.getElementById('modal');
const toastEl = document.getElementById('toast');
const confirmEl = document.getElementById('confirm-modal'); // the app's own confirmation dialog (opens on top of other dialogs)
const APP_NAME = 'Occasions Address Book';

if (!cfg.apiUrl || !cfg.region || !cfg.userPoolId || !cfg.userPoolClientId) {
  root.innerHTML = '<p class="boot">Missing config.js. Run scripts/deploy.sh, or copy config.example.js to config.js for local testing.</p>';
  throw new Error('APP_CONFIG missing');
}

// Amazon Cognito, called straight from the browser (auth.js); accounts are by invitation.
const auth = createAuth(cfg);

const REMEMBER_KEY = 'oab.email';
const rememberedEmail = () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } };
function rememberEmail(email) {
  try { if (email) localStorage.setItem(REMEMBER_KEY, email); else localStorage.removeItem(REMEMBER_KEY); } catch { /* storage blocked */ }
}

// Cards or Labels: print and track who was mailed. Invitations: the same, plus a designed invitation
// to print. Emails: a designed email sent to chosen people. ("other" from earlier versions = cards.)
const KIND_LABEL = { card: 'Cards or Labels', invite: 'Invitations', email: 'Emails' };
const KIND_PILL = { card: 'due-soon', invite: 'ok', email: 'info' };
const kindOf = (o) => (KIND_LABEL[o?.kind] ? o.kind : 'card');
const isEmailKind = (o) => kindOf(o) === 'email';
const INVITE_BATCH = 25;

const state = {
  session: null, pendingEmail: null, books: [], bookId: '', authMode: 'signin', showLanding: true, authMsg: '', authErr: '', authEmail: rememberedEmail(),
  me: null, households: [], occasions: [], loading: true,
  view: 'people',                 // 'people' | 'occasions'
  occasionId: null, occ: null,    // open occasion: { occasion, tags }
  search: '',
  filters: { people: emptyFilter(), occ: emptyFilter() }, // the Filter panel, per screen
  occFilter: 'all', occSearch: '',
};

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (v) => (v === undefined || v === null ? '' : esc(v));
const fmtDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => (iso
  ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { ...opts, ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) }) : '');
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const hhById = () => new Map(state.households.map((h) => [h.id, h]));
const allEmails = (h) => [...new Set([...(h.emails ?? []), ...(h.members ?? []).map((m) => m.email)].filter(Boolean))];
const allGroups = () => [...new Set(state.households.flatMap((h) => h.groups ?? []))].sort((a, b) => a.localeCompare(b));
const peopleNames = (h) => (h.members ?? []).map((m) => [m.firstName, m.lastName].filter(Boolean).join(' ')).join(', ');
const PENCIL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.6 2.6a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L6 12.8l-3.3.8.8-3.3 7.1-7.7zM9.5 3.8l2.7 2.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const MAIL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m2.5 4.5 5.5 4 5.5-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const TRASH = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 4h11M6.5 4V2.75c0-.4.3-.75.75-.75h1.5c.4 0 .75.35.75.75V4M4 4l.6 9.1c.05.5.45.9 1 .9h4.8c.55 0 .95-.4 1-.9L12 4M6.75 6.75v4.5M9.25 6.75v4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BOOK_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 2.75A1.75 1.75 0 0 1 4.75 1h7.5c.41 0 .75.34.75.75v10.5a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 0 0 1.5H13M3 2.75v10.5A1.75 1.75 0 0 0 4.75 15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 4.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const REQUIRED = '<span class="req" aria-hidden="true" title="Required">*</span>';
// The standard share icon: a box with an arrow coming up out of it.
const SHARE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.75v8.5M5.25 4.5 8 1.75l2.75 2.75M5.5 6.5H4.25c-.7 0-1.25.55-1.25 1.25v5.5c0 .7.55 1.25 1.25 1.25h7.5c.7 0 1.25-.55 1.25-1.25v-5.5c0-.7-.55-1.25-1.25-1.25H10.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BRUSH = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13.6 2.4a1.4 1.4 0 0 0-2 0L6.8 7.2l2 2 4.8-4.8a1.4 1.4 0 0 0 0-2zM6 8.4c-1.4 0-2.4 1-2.4 2.4 0 .9-.5 1.6-1.6 2 .7.6 1.6.8 2.4.8 2 0 3.2-1.3 3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const CHEVRON = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOGO = '<img class="logo" src="icon-192.png" width="64" height="64" alt="">';

// Access to the address book in use: your own, or one shared with you (edit or view only).
const canEdit = () => state.me?.book?.canEdit !== false;
const isOwner = () => !state.me?.book || state.me.book.role === 'owner';
const ROLE_LABEL = { edit: 'Can edit', view: 'View only' };

// ----- address books: your own, plus any shared with you; the open one is remembered on this device -----
const BOOK_KEY = 'oab.book';
const storedBook = () => { try { return localStorage.getItem(BOOK_KEY) || ''; } catch { return ''; } };
function storeBook(id) { try { if (id) localStorage.setItem(BOOK_KEY, id); else localStorage.removeItem(BOOK_KEY); } catch { /* storage blocked */ } }
const ownBookId = () => state.session?.user?.sub ?? '';
const bookLabel = (b) => (b.own ? 'My address book' : `${b.ownerName || b.ownerEmail}'s`);
const currentBook = () => state.books.find((b) => b.id === (state.bookId || ownBookId())) ?? state.books[0];
state.bookId = storedBook();

function bookSwitcher() {
  if (state.books.length < 2) return '';
  const cur = currentBook();
  return `<div class="book-menu">
    <button type="button" class="book-chip" data-action="toggle-book-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="book-menu-list" title="Switch address book">
      ${BOOK_ICON}<span class="book-name">${esc(bookLabel(cur))}</span>${cur.own ? '' : `<span class="pill ${cur.role === 'edit' ? 'ok' : 'unknown'}">${ROLE_LABEL[cur.role]}</span>`}${CHEVRON}
    </button>
    <div class="menu" id="book-menu-list" role="menu" hidden>
      <div class="menu-label">Address books</div>
      ${state.books.map((b) => `<button type="button" role="menuitemradio" aria-checked="${b.id === cur.id}" data-action="switch-book" data-id="${b.own ? '' : esc(b.id)}">
        <span class="check-mark">${b.id === cur.id ? '✓' : ''}</span>
        <span class="book-item"><span>${esc(bookLabel(b))}</span><span class="small muted">${b.own ? 'Only you, plus anyone you share it with' : `${ROLE_LABEL[b.role]} · shared by ${esc(b.ownerEmail)}`}</span></span>
      </button>`).join('')}
    </div>
  </div>`;
}

function setBookMenu(open) {
  const btn = document.querySelector('.book-chip');
  const menu = document.getElementById('book-menu-list');
  if (!btn || !menu) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

async function switchBook(id) {
  setBookMenu(false);
  if ((id || '') === (state.bookId || '')) return;
  state.bookId = id || '';
  storeBook(state.bookId);
  Object.assign(state, { occasionId: null, occ: null, households: [], occasions: [], search: '', filters: { people: emptyFilter(), occ: emptyFilter() } });
  closeFilterPanel();
  await loadAll();
  window.scrollTo(0, 0);
}

/**
 * Asks before doing something, in the app's own style. Resolves true for the confirm button, false
 * for Cancel, Escape or a click outside.
 *   askConfirm({ title, text, ok: 'Move to Trash', danger: true })
 */
function askConfirm({ title, text = '', ok = 'OK', cancel = 'Cancel', danger = false, strict = false }) {
  return new Promise((resolve) => {
    confirmEl.innerHTML = `<form method="dialog" class="confirm-box">
      <h2 id="confirm-title">${esc(title)}</h2>
      ${text ? `<p id="confirm-text">${esc(text)}</p>` : ''}
      <div class="confirm-buttons">
        <button type="submit" value="no" class="btn">${esc(cancel)}</button>
        <button type="submit" value="yes" class="btn ${danger ? 'danger-solid' : 'primary'}" data-confirm-ok>${esc(ok)}</button>
      </div>
    </form>`;
    const done = (yes) => { confirmEl.onclose = null; if (confirmEl.open) confirmEl.close(); resolve(yes); };
    confirmEl.onclose = () => done(confirmEl.returnValue === 'yes');
    confirmEl.onclick = (e) => { if (e.target === confirmEl && !strict) done(false); }; // the backdrop
    confirmEl.oncancel = (e) => { if (strict) e.preventDefault(); }; // strict: only the buttons answer
    confirmEl.returnValue = '';
    confirmEl.showModal();
    confirmEl.querySelector('[data-confirm-ok]').focus();
  });
}

function toast(msg, isErr = false) {
  toastEl.textContent = msg;
  toastEl.className = `show${isErr ? ' err' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.className = ''; }, isErr ? 7000 : 3000);
}

async function api(path, { method = 'GET', body } = {}) {
  const session = await auth.getSession();
  if (!session) throw new Error('Please sign in again');
  const token = session.idToken; // the API checks Cognito ID tokens (they carry the email)
  let res;
  try {
    res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(state.bookId && state.bookId !== session.user?.sub ? { 'x-book': state.bookId } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The browser's own wording ("Load failed", "Failed to fetch") means no answer came back at all.
    throw new Error(navigator.onLine === false ? "You're offline. Check your connection and try again." : "Couldn't reach the server. Try again in a moment.");
  }
  const json = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (res.status === 401) {
    await auth.signOut();
    throw new Error(json?.error ?? 'Please sign in again');
  }
  if (res.status === 403 && json?.code === 'book_gone') {
    // That book was unshared (or never was): back to your own.
    state.bookId = ''; storeBook('');
    setTimeout(() => { toast(json.error, true); loadAll(); }, 0);
  }
  if (!res.ok) throw Object.assign(new Error(json?.error ?? `Request failed (${res.status})`), { status: res.status, data: json });
  return json;
}

// Disables a button while its work runs; aria-busy gives it the "working" cursor until it's done.
async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { modalError(e.message) || toast(e.message, true); return undefined; } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

// ---------- auth ----------
const AUTH_TITLES = {
  signin: ['Sign in', 'Keep addresses up to date and print labels and envelopes for every occasion.'],
  mfa: ['Two-step verification', 'Enter the 6-digit code from your authenticator app.'],
  newpassword: ['Choose your password', 'Welcome! Choose the password you\'ll use from now on (at least 8 characters).'],
  reset: ['Reset password', 'We\'ll email you a code to set a new password.'],
  resetcode: ['Enter your code', 'Check your email for a 6-digit code, then choose a new password.'],
};

// ---------- landing page (signed out) ----------
// What visitors see before signing in: what the app does, and the way in. Accounts are by
// invitation, so the only action is Sign in.
function renderLanding() {
  root.innerHTML = `
  <div class="landing">
    <header class="ld-top">
      <div class="brand">${LOGO}<span>${APP_NAME}</span></div>
      <nav class="ld-nav"><a class="ld-link" href="help.html">Help</a><button class="btn" data-action="show-signin">Sign in</button></nav>
    </header>

    <section class="ld-hero">
      <div class="ld-hero-text">
        <h1>Every card and invitation, addressed and on its way.</h1>
        <p class="ld-lede">Keep the addresses of everyone you send to in one place, choose who gets what for each occasion, then print labels and envelopes or email a designed invitation.</p>
        <div class="ld-cta"><button class="btn primary lg" data-action="show-signin">Sign in</button>
          <span class="ld-note">Accounts are by invitation. Your invitation email has a temporary password.</span></div>
      </div>
      <div class="ld-envelope" aria-hidden="true">
        <div class="env">
          <div class="env-return">The Bennett Family<br>14 Cherry Lane<br>Evergreen Falls, MI 49001</div>
          <div class="env-stamp"><span>★</span></div>
          <svg class="env-postmark" viewBox="0 0 160 70"><circle cx="35" cy="35" r="27" fill="none" stroke="currentColor" stroke-width="2"/><text x="35" y="27" text-anchor="middle" font-size="6.4" fill="currentColor" font-family="IBM Plex Sans, sans-serif" font-weight="600">EVERGREEN</text><text x="35" y="36" text-anchor="middle" font-size="6.4" fill="currentColor" font-family="IBM Plex Sans, sans-serif" font-weight="600">FALLS MI</text><text x="35" y="47" text-anchor="middle" font-size="7" fill="currentColor" font-family="IBM Plex Sans, sans-serif">DEC 12</text><path d="M70 22c10-6 20 6 30 0s20 6 30 0 20 6 28 0M70 35c10-6 20 6 30 0s20 6 30 0 20 6 28 0M70 48c10-6 20 6 30 0s20 6 30 0 20 6 28 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <div class="env-to">Mr. and Mrs. John Smith<br>123 Maple Street<br>Willow Bend, MI 49002-1234</div>
        </div>
      </div>
    </section>

    <section class="ld-features" aria-label="What it does">
      <article class="ld-feature">
        <div class="ld-text"><h2>One address book for the whole family</h2>
          <p>Each household is one envelope: its greetings, mailing address, the people in it with their email and phone, groups like Family or Neighbors, and notes. Bring in your old list from a spreadsheet, and search or filter it by group, city, state or ZIP.</p></div>
        <div class="ld-visual ld-hh">
          <div class="mini-card"><span class="mini-verified" title="Address verified"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.2 10.3l2.5 2.5 5.1-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><b>The Smith Family</b><span>Mr. and Mrs. John Smith</span><span>123 Maple Street<br>Willow Bend, MI 49002</span><span class="mini-chips"><i>Family</i><i>Christmas</i></span></div>
          <div class="mini-card"><b>The Jones Family</b><span>Bob and Carol</span><span>9 Elm Court<br>Cedar Hollow, MI 49003</span><span class="mini-chips"><i>Neighbors</i></span></div>
        </div>
      </article>
      <article class="ld-feature">
        <div class="ld-text"><h2>Pick who each occasion is for</h2>
          <p>Create an occasion, like Christmas cards 2026 or a graduation party, and tick the households it's for: one at a time, or everyone in a group or a town at once. Start next year's list from this year's, and see at a glance who has been mailed or emailed.</p></div>
        <div class="ld-visual"><div class="mini-occ">
          <div class="mo-head"><b>Christmas cards 2026</b><span>3 on the list · 1 mailed</span></div>
          ${[['The Smith Family', true, 'Mailed'], ['The Jones Family', true, ''], ['Grandma Rose', true, ''], ['The Lee Family', false, '']].map(([n, on, st]) => `<div class="mo-row${on ? ' on' : ''}"><span class="mo-box">${on ? '✓' : ''}</span><span>${n}</span>${st ? `<span class="mo-pill">${st}</span>` : ''}</div>`).join('')}
        </div></div>
      </article>
      <article class="ld-feature">
        <div class="ld-text"><h2>Labels and envelopes, ready to print</h2>
          <p>Tick who an occasion is for and print Avery 5160 / 8160 address labels, or A2 and A7 envelopes with your return address, with the greeting you choose on the first line. Start partway through a used label sheet, then mark everyone as mailed.</p></div>
        <div class="ld-visual"><div class="label-sheet">${Array.from({ length: 15 }, (_, i) => `<span class="lbl${i < 5 ? ' used' : ''}">${i < 5 ? '' : ['The Smith Family<br>123 Maple Street<br>Willow Bend, MI 49002', 'The Jones Family<br>9 Elm Court<br>Cedar Hollow, MI 49003', 'Grandma Rose<br>40 Lake Drive<br>Juniper Ridge, MI 49004'][i % 3]}</span>`).join('')}</div></div>
      </article>
      <article class="ld-feature">
        <div class="ld-text"><h2>Invitations and emails you design yourself</h2>
          <p>Choose fonts and colors, add your own pictures, borders and flourishes, and drop in each guest's greeting and the date, time and place. Print them on cards or on Avery 8387 postcards with each address on the back, or email them to just the people you pick.</p></div>
        <div class="ld-visual"><div class="mini-invite"><span class="mi-script">You're invited</span><span class="mi-flourish"></span><span>Dear John and Mary,</span><span>Holiday open house<br>Saturday, December 19 at 7:00 PM</span></div></div>
      </article>
      <article class="ld-feature">
        <div class="ld-text"><h2>Every address checked with the Post Office</h2>
          <p><b>Check address</b> looks an address up in the Post Office's own address data. It tidies the spelling, adds the ZIP+4, and catches a missing apartment number. Once an address is verified, its household gets a green check, and a filter shows you the ones still to check.</p></div>
        <div class="ld-visual"><div class="mini-verify">
          <div class="mv-head">${CHECK_ICON} <b>Confirmed: mail is delivered here.</b></div>
          <div class="mv-compare"><div><span>You entered</span>123 maple st<br>willow bend mi</div><div><span>Suggested</span>123 Maple St<br>Willow Bend, MI <span class="nw">49002-1234</span></div></div>
          <span class="mini-btns"><i class="yes">Use suggested address</i><i>Keep mine</i></span>
        </div></div>
      </article>
      <article class="ld-feature">
        <div class="ld-text"><h2>Addresses that stay up to date</h2>
          <p>Send a household a private link to confirm or correct their address. What they send back waits for you to accept, so nothing changes without you seeing it first.</p></div>
        <div class="ld-visual"><div class="mini-check"><b>Is this the right address for the Smith Family?</b><span>123 Maple Street<br>Willow Bend, MI 49002</span><span class="mini-btns"><i class="yes">Yes, that's right</i><i>No, update it</i></span></div></div>
      </article>
    </section>

    <section class="ld-more" aria-label="Also">
      <div><h3>Share with your family</h3><p>Let your spouse edit the same address book, or someone else just look. Everyone keeps their own book too.</p></div>
      <div><h3>The right person, the right greeting</h3><p>Email Mary alone with an invitation that still reads "Dear John and Mary".</p></div>
      <div><h3>Nothing lost by accident</h3><p>Deleted households and occasions wait in the Trash for 30 days.</p></div>
      <div><h3>Private by default</h3><p>Sign-in with an optional authenticator code, and automatic sign-out after 30 minutes away.</p></div>
    </section>

    <footer class="ld-foot"><span>${APP_NAME}</span><a class="ld-link" href="help.html">Help</a><button class="link" data-action="show-signin">Sign in</button></footer>
  </div>`;
}

function renderAuth() {
  // Visitors who aren't signing in yet see the landing page first.
  if (state.showLanding && state.authMode === 'signin') return renderLanding();
  const m = AUTH_TITLES[state.authMode] ? state.authMode : 'signin';
  const field = {
    email: `<label>Email<input type="email" name="email" autocomplete="username" value="${val(state.authEmail)}" required></label>`,
    password: '<label>Password<input type="password" name="password" autocomplete="current-password" required></label>',
    newPassword: '<label>New password<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>'
      + '<label>Confirm new password<input type="password" name="confirmPassword" minlength="8" autocomplete="new-password" required></label>',
    code: '<label>Code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="mono code-input"></label>',
  };
  const fields = {
    signin: field.email + field.password
      + `<label class="check"><input type="checkbox" name="remember" ${rememberedEmail() ? 'checked' : ''}> Remember my email on this device</label>`,
    mfa: field.code,
    newpassword: field.newPassword,
    reset: field.email,
    resetcode: field.code + field.newPassword,
  }[m];
  const button = { signin: 'Sign in', mfa: 'Verify', newpassword: 'Save password', reset: 'Email me a code', resetcode: 'Save new password' }[m];
  const links = m === 'signin'
    ? '<button class="link" data-action="auth-mode" data-mode="reset">Forgot password?</button><a class="link" href="help.html">Help</a>'
    : '<button class="link" data-action="auth-mode" data-mode="signin">Back to sign in</button>';
  root.innerHTML = `
  <main class="auth"><div class="auth-card">
    <div class="brand">${LOGO}<span>${APP_NAME}</span></div>
    <h1>${AUTH_TITLES[m][0]}</h1>
    <p class="muted small" style="margin:0">${AUTH_TITLES[m][1]}</p>
    <form data-form="auth" data-mode="${m}" class="stack">
      ${fields}
      ${state.authErr ? `<p class="error">${esc(state.authErr)}</p>` : ''}
      ${state.authMsg ? `<p class="small" style="color:var(--ok)">${esc(state.authMsg)}</p>` : ''}
      <button class="btn primary" type="submit">${button}</button>
    </form>
    <div class="auth-links">${links}</div>
    ${m === 'signin' ? '<p class="small muted" style="margin:14px 0 0">Accounts are by invitation. Got an invitation email? Sign in with your email and the temporary password in it.</p>' : ''}
  </div></main>`;
  const first = root.querySelector('form input');
  (m === 'signin' && first?.value ? root.querySelector('[name=password]') : first)?.focus();
}

async function submitAuth(form) {
  const d = Object.fromEntries([...form.elements].filter((el) => el.name && el.type !== 'checkbox').map((el) => [el.name, el.value.trim()]));
  const mode = form.dataset.mode;
  state.authErr = ''; state.authMsg = '';
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  const go = (res) => {
    if (res?.step === 'mfa') state.authMode = 'mfa';
    if (res?.step === 'new_password') state.authMode = 'newpassword';
    return res?.done; // signed in: auth.onChange takes over
  };
  try {
    if ((mode === 'newpassword' || mode === 'resetcode') && d.password !== d.confirmPassword) {
      throw new Error("The passwords don't match. Type them again.");
    }
    if (mode === 'signin') {
      state.authEmail = d.email;
      rememberEmail(form.elements.remember?.checked ? d.email : '');
      if (go(await auth.signIn(d.email, form.elements.password.value))) return;
    } else if (mode === 'mfa') {
      if (go(await auth.answerMfa(d.code.replace(/\s/g, '')))) return;
    } else if (mode === 'newpassword') {
      if (go(await auth.setNewPassword(form.elements.password.value))) return;
    } else if (mode === 'reset') {
      state.authEmail = d.email;
      await auth.forgotPassword(d.email);
      state.authMode = 'resetcode';
      state.authMsg = `If ${d.email} has an account, a code is on its way.`;
    } else if (mode === 'resetcode') {
      await auth.confirmForgotPassword(state.authEmail, d.code.replace(/\s/g, ''), form.elements.password.value);
      state.authMode = 'signin';
      state.authMsg = 'Password changed. Sign in with your new password.';
    }
  } catch (e) {
    state.authErr = e.message;
    if (/sign in again/i.test(e.message)) state.authMode = 'signin';
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  if (!state.session) renderAuth();
}

// ---------- data ----------
async function loadAll() {
  state.loading = true;
  render();
  try {
    state.books = (await api('/books')).books;
    if (state.bookId && !state.books.some((b) => b.id === state.bookId)) { state.bookId = ''; storeBook(''); }
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
    const [me, hh, occ] = await Promise.all([api(`/me${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`), api('/households'), api('/occasions')]);
    state.me = me;
    state.households = hh.households;
    state.occasions = occ.occasions;
    if (state.occasionId) await openOccasion(state.occasionId, { quiet: true });
  } catch (e) {
    toast(e.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshHouseholds() { state.households = (await api('/households')).households; }
async function refreshOccasions() { state.occasions = (await api('/occasions')).occasions; }

// ---------- keeping up with the other person ----------
// With a shared book, the other person's changes show up without reloading: the lists are fetched
// again when this window comes back into view and once a minute while it's open. The screen is
// redrawn only if something changed, and never while you're typing in a box or using a menu or the
// Filter panel (the change then shows on the next check). Open edit windows aren't touched; saving
// one that someone else changed meanwhile asks which version to keep.
let refreshing = false;
let lastRefresh = 0;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function safeToRedraw() {
  const a = document.activeElement;
  const typing = a && a !== document.body && root.contains(a) && a.matches('input, textarea, select');
  const menuOpen = document.querySelector('.menu:not([hidden])');
  return !typing && !menuOpen && !filterPanelScope;
}
async function refreshQuietly({ force = false } = {}) {
  if (refreshing || !state.session || !state.me || document.hidden) return;
  if (!force && Date.now() - lastRefresh < 15_000) return;
  refreshing = true;
  lastRefresh = Date.now();
  try {
    const openId = state.view === 'occasions' ? state.occasionId : null;
    const [hh, occs, occ] = await Promise.all([
      api('/households'), api('/occasions'), openId ? api(`/occasions/${openId}`).catch(() => null) : null,
    ]);
    if (!state.session || state.occasionId !== openId && openId) return; // moved on meanwhile
    const changed = !sameJson(hh.households, state.households) || !sameJson(occs.occasions, state.occasions)
      || (openId && occ && !sameJson(occ, state.occ));
    if (!changed) return;
    if (!safeToRedraw()) { lastRefresh = 0; return; } // try again on the next check
    state.households = hh.households;
    state.occasions = occs.occasions;
    if (openId && occ) state.occ = occ;
    render();
  } catch { /* offline for a moment: the next check tries again */ } finally {
    refreshing = false;
  }
}
setInterval(() => refreshQuietly({ force: true }), 60_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshQuietly(); });
window.addEventListener('focus', () => refreshQuietly());

function upsertHousehold(h) {
  const i = state.households.findIndex((x) => x.id === h.id);
  if (i >= 0) state.households[i] = h; else state.households.push(h);
}

// ---------- layout ----------
function render() {
  if (!state.session) return renderAuth();
  const email = state.session.user?.email ?? '';
  const pending = state.households.filter((h) => h.pendingUpdate).length;
  filterPanelScope = null; // a full redraw removes an open Filter panel
  root.innerHTML = `
  <header class="topbar">
    <div class="brand">${LOGO}<span>${APP_NAME}</span></div>
    ${bookSwitcher()}
    <nav class="nav" aria-label="Sections">
      <button class="nav-tab" data-action="view" data-view="people" aria-current="${state.view === 'people'}">Address book${pending ? ` <span class="dot" title="${plural(pending, 'address update')} to review">${pending}</span>` : ''}</button>
      <button class="nav-tab" data-action="view" data-view="occasions" aria-current="${state.view === 'occasions'}">Occasions</button>
    </nav>
    <div class="actions">${userChip(email)}</div>
  </header>
  <main class="page">${state.loading && !state.me ? '<p class="boot">Loading your address book…</p>'
    : state.view === 'people' ? renderPeople() : state.occasionId && state.occ ? renderOccasion() : renderOccasions()}</main>`;
  document.title = currentBook() && !currentBook().own ? `${bookLabel(currentBook())} · ${APP_NAME}` : APP_NAME;
  if (state.view === 'people') renderHouseholdList();
  if (state.view === 'occasions' && state.occasionId && state.occ) renderRecipientRows();
}

function initials(p, email) {
  const fromName = [p?.firstName, p?.lastName].filter(Boolean).map((x) => x[0]).join('');
  return (fromName || (email || '?')[0]).toUpperCase();
}

// The profile photo in a circle, or initials when there's no photo (same as Vehicle Maintenance).
function avatarHtml(p, email, size) {
  return p?.avatarUrl
    ? `<img class="avatar" src="${esc(p.avatarUrl)}" alt="" width="${size}" height="${size}">`
    : `<span class="avatar avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${esc(initials(p, email))}</span>`;
}

function userChip(email) {
  const p = state.me?.profile;
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ');
  return `<div class="user-menu">
    <button type="button" class="user-chip" data-action="toggle-user-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu-list">
      ${avatarHtml(p, email, 32)}
      <span class="user-text">${name ? `<span class="user-name">${esc(name)}</span>` : ''}<span class="user-email">${esc(email)}</span></span>
      ${CHEVRON}
    </button>
    <div class="menu" id="user-menu-list" role="menu" hidden>
      <button type="button" role="menuitem" data-action="settings">Settings</button>
      <button type="button" role="menuitem" data-action="trash">Trash</button>
      <hr>
      ${canEdit() ? '<button type="button" role="menuitem" data-action="import">Import…</button>' : ''}
      <button type="button" role="menuitem" data-action="export">Export…</button>
      <a role="menuitem" href="help.html" target="_blank" rel="noopener">Help</a>
      <hr>
      <button type="button" role="menuitem" data-action="signout">Sign out</button>
    </div>
  </div>`;
}

function setUserMenu(open) {
  const btn = document.querySelector('.user-chip');
  const menu = document.getElementById('user-menu-list');
  if (!btn || !menu) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

// ---------- address book ----------
function renderPeople() {
  const pending = state.households.filter((h) => h.pendingUpdate).length;
  if (!state.households.length && !isOwner()) {
    const b = state.me.book;
    return `<div class="panel empty"><h2>No households yet</h2>
      <p>${esc(b.ownerName || b.ownerEmail)}'s address book is empty so far.${canEdit() ? ' You can add the first household.' : ''}</p>
      ${canEdit() ? '<button class="btn primary" data-action="add-household">+ Household</button>' : ''}</div>`;
  }
  if (!state.households.length) {
    return `<div class="panel empty">
      <h2>Start your address book</h2>
      <p>Add a household for each envelope you send: a family at one address, a couple, or one person. Then tag them for occasions like Christmas cards or a party, and print labels or envelopes.</p>
      ${canEdit() ? '<div class="row-gap"><button class="btn primary" data-action="add-household" title="New household (N)" aria-keyshortcuts="n">+ Household <kbd>N</kbd></button><button class="btn" data-action="import">Import…</button></div>' : ''}
    </div>`;
  }
  return `
  <div class="page-head">
    <h1>Address book <span class="muted count">${plural(state.households.length, 'household')}</span></h1>
    <div class="actions">
      ${canEdit() ? '<button class="btn primary" data-action="add-household" title="New household (N)" aria-keyshortcuts="n">+ Household <kbd>N</kbd></button>' : ''}
    </div>
  </div>
  ${pending ? `<div class="notice"><span><b>${plural(pending, 'household')}</b> sent back ${pending === 1 ? 'an address' : 'addresses'} to review.</span>
    <button class="btn sm" data-action="pending-only">${state.filters.people.review ? 'Show everyone' : (pending === 1 ? 'Show it' : 'Show them')}</button></div>` : ''}
  <div class="filters">
    <input type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-input="search" placeholder="Search names, streets, cities, emails…" value="${val(state.search)}" aria-label="Search">
    ${filterButton('people')}
  </div>
  <div class="filter-chips" id="fchips-people">${filterChipsHtml('people')}</div>
  <div id="hh-list" class="hh-grid"></div>`;
}

function matchesSearch(h, q) {
  if (!q) return true;
  const a = h.address ?? {};
  const hay = [h.labelName, h.formalName, h.greeting, a.line1, a.line2, a.city, a.state, a.zip, h.phone, h.notes,
    ...(h.groups ?? []), ...allEmails(h), peopleNames(h)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

const byName = (a, b) => sortKey(a).localeCompare(sortKey(b)) || a.labelName.localeCompare(b.labelName);

// ---------- Filter (funnel button, panel, and chips for what's on) ----------
const FUNNEL = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 3h12l-4.6 5.4v4.1L6.6 14V8.4L2 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
let filterPanelScope = null; // 'people' (Address book) or 'occ' (an occasion's list) while the panel is open

function filterButton(scope) {
  const n = activeCount(state.filters[scope]);
  return `<div class="filter-wrap" data-filter-wrap="${scope}">
    <button type="button" class="btn filter-btn${n ? ' on' : ''}" data-action="filter-toggle" data-scope="${scope}" aria-haspopup="dialog" aria-expanded="${filterPanelScope === scope}" title="Filter">
      ${FUNNEL}<span>Filter</span>${n ? `<span class="filter-count">${n}</span>` : ''}
    </button>
  </div>`;
}

function filterChipsHtml(scope) {
  const chips = filterChips(state.filters[scope]);
  if (!chips.length) return '';
  return chips.map((c, i) => (c.remove
    ? `<span class="chip-tag"><span>${esc(c.label)}</span><button type="button" class="chip-x" data-action="filter-chip-remove" data-scope="${scope}" data-i="${i}" aria-label="Remove ${esc(c.label)}" title="Remove">×</button></span>`
    : `<span class="chip-tag plain"><span>${esc(c.label)}</span></span>`)).join('')
    + `<button type="button" class="link small" data-action="filter-clear" data-scope="${scope}">Clear all</button>`;
}

function setFilter(scope, patch) {
  state.filters[scope] = { ...state.filters[scope], ...patch };
  refreshFilterUI(scope);
}

// Re-draws the button badge, the chips and the list, without touching the search box or the open panel.
function refreshFilterUI(scope) {
  const wrap = document.querySelector(`[data-filter-wrap="${scope}"]`);
  if (wrap) {
    const n = activeCount(state.filters[scope]);
    const btn = wrap.querySelector('.filter-btn');
    btn.classList.toggle('on', Boolean(n));
    btn.querySelector('.filter-count')?.remove();
    if (n) btn.insertAdjacentHTML('beforeend', `<span class="filter-count">${n}</span>`);
  }
  const chips = document.getElementById(`fchips-${scope}`);
  if (chips) chips.innerHTML = filterChipsHtml(scope);
  if (scope === 'people') renderHouseholdList(); else renderRecipientRows();
  const panel = document.querySelector('.filter-panel');
  if (panel && filterPanelScope === scope) {
    panel.querySelector('[data-match-count]').textContent = matchSummary(scope);
    syncFilterPanel(panel, scope);
  }
}

function matchSummary(scope) {
  const n = state.households.filter((h) => matchesFilter(h, state.filters[scope])).length;
  return n === 1 ? '1 household matches' : `${plural(n, 'household')} match`;
}

function checklist(name, options, chosen, { search = false } = {}) {
  if (!options.length) return '<p class="muted small" style="margin:0">None yet</p>';
  const picked = new Set(chosen.map((v) => v.toLowerCase()));
  return `${search && options.length > 8 ? `<input type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" class="fp-search" data-fp-search="${name}" placeholder="Find…" aria-label="Find">` : ''}
    <div class="fp-list" data-fp-list="${name}">${options.map((o) => `<label class="check fp-opt" data-label="${esc(o.value.toLowerCase())}">
      <input type="checkbox" data-f="${name}" value="${esc(o.value)}" ${picked.has(o.value.toLowerCase()) ? 'checked' : ''}>
      <span>${esc(o.value)}</span><span class="fp-n">${o.count}</span></label>`).join('')}</div>`;
}

const radios = (name, value, choices) => `<div class="seg fp-seg" role="radiogroup">${choices.map(([v, l]) => `<label><input type="radio" name="fp-${name}" data-f="${name}" value="${v}" ${(value ?? '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

function toggleFilterPanel(scope) {
  if (filterPanelScope === scope) { closeFilterPanel(); return; }
  closeFilterPanel();
  const wrap = document.querySelector(`[data-filter-wrap="${scope}"]`);
  if (!wrap) return;
  filterPanelScope = scope;
  const f = state.filters[scope];
  const o = filterOptions(state.households);
  wrap.insertAdjacentHTML('beforeend', `<div class="filter-panel" role="dialog" aria-label="Filter households">
    <div class="fp-body">
      <section><div class="fp-head"><h3>Groups</h3>${o.groups.length > 1 ? radios('groupMode', f.groupMode, [['any', 'Any'], ['all', 'All']]) : ''}</div>${checklist('groups', o.groups, f.groups)}</section>
      <section><h3>City</h3>${checklist('cities', o.cities, f.cities, { search: true })}</section>
      <section><h3>State</h3>${checklist('states', o.states, f.states, { search: true })}</section>
      <section><h3>ZIP starts with</h3><input type="text" class="fp-zip" data-f="zip" value="${val(f.zip)}" inputmode="numeric" maxlength="10" placeholder="e.g. 480"></section>
      <section><h3>Email</h3>${radios('email', f.email, [['', 'Any'], ['yes', 'Has email'], ['no', 'No email']])}</section>
      <section><h3>Mailing address</h3>${radios('address', f.address, [['', 'Any'], ['complete', 'Has one'], ['missing', 'Missing']])}
        <label class="check fp-under"><input type="checkbox" data-f="verified" ${f.verified ? 'checked' : ''}> Verified</label></section>
      <section><label class="check"><input type="checkbox" data-f="review" ${f.review ? 'checked' : ''}> Sent back an address to review</label></section>
    </div>
    <div class="fp-foot"><span class="small muted" data-match-count>${matchSummary(scope)}</span>
      <span class="fp-buttons"><button type="button" class="btn sm ghost" data-action="filter-clear" data-scope="${scope}">Clear all</button>
      <button type="button" class="btn sm primary" data-action="filter-done">Done</button></span></div>
  </div>`);
  wrap.querySelector('.filter-btn').setAttribute('aria-expanded', 'true');
}

// Ticks the boxes to match the filter (e.g. after a chip is removed while the panel is open).
function syncFilterPanel(panel, scope) {
  const f = state.filters[scope];
  for (const name of ['groups', 'cities', 'states']) {
    const on = new Set(f[name].map((v) => v.toLowerCase()));
    panel.querySelectorAll(`[data-f="${name}"]`).forEach((cb) => { cb.checked = on.has(cb.value.toLowerCase()); });
  }
  for (const name of ['groupMode', 'email', 'address']) panel.querySelectorAll(`[data-f="${name}"]`).forEach((r) => { r.checked = r.value === (f[name] ?? ''); });
  const rv = panel.querySelector('[data-f=review]'); if (rv) rv.checked = Boolean(f.review);
  const vf = panel.querySelector('[data-f=verified]'); if (vf) vf.checked = Boolean(f.verified);
  const zip = panel.querySelector('[data-f=zip]'); if (zip && document.activeElement !== zip) zip.value = f.zip ?? '';
}

function readFilterPanel(panel) {
  const vals = (name) => [...panel.querySelectorAll(`[data-f="${name}"]:checked`)].map((cb) => cb.value);
  const radio = (name) => panel.querySelector(`[data-f="${name}"]:checked`)?.value ?? '';
  return {
    groups: vals('groups'), groupMode: radio('groupMode') || 'any', cities: vals('cities'), states: vals('states'),
    zip: panel.querySelector('[data-f=zip]').value.trim(), email: radio('email'), address: radio('address'),
    verified: panel.querySelector('[data-f=verified]').checked,
    review: panel.querySelector('[data-f=review]').checked,
  };
}

function closeFilterPanel() {
  document.querySelector('.filter-panel')?.remove();
  document.querySelectorAll('.filter-btn[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  filterPanelScope = null;
}

document.addEventListener('change', (e) => {
  const panel = e.target.closest?.('.filter-panel');
  if (panel && e.target.dataset.f && filterPanelScope) setFilter(filterPanelScope, readFilterPanel(panel));
});
document.addEventListener('input', (e) => {
  const panel = e.target.closest?.('.filter-panel');
  if (!panel) return;
  if (e.target.dataset.f === 'zip' && filterPanelScope) setFilter(filterPanelScope, readFilterPanel(panel));
  const list = e.target.dataset.fpSearch;
  if (list) {
    const q = e.target.value.trim().toLowerCase();
    panel.querySelectorAll(`[data-fp-list="${list}"] .fp-opt`).forEach((row) => { row.hidden = Boolean(q) && !row.dataset.label.includes(q); });
  }
});
document.addEventListener('mousedown', (e) => {
  if (filterPanelScope && !e.target.closest('.filter-panel, .filter-btn, .filter-chips')) closeFilterPanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filterPanelScope && !modal.open && !confirmEl.open) { closeFilterPanel(); document.querySelector('.filter-btn')?.focus(); }
});

function renderHouseholdList() {
  const el = document.getElementById('hh-list');
  if (!el) return;
  const list = state.households
    .filter((h) => matchesSearch(h, state.search) && matchesFilter(h, state.filters.people))
    .sort(byName);
  el.innerHTML = list.map(householdCard).join('') || '<p class="muted">No households match.</p>';
}

// Where an emailed address check stands: sent and waiting, no reply before the link expired, or
// confirmed in reply. Nothing once a newer edit or review has taken over.
function requestBadge(h) {
  const r = h.addressRequest;
  if (!r?.sentAt) return '';
  const day = (iso) => fmtDate(iso, { month: 'short', day: 'numeric' });
  const title = r.sentTo?.length ? ` title="Sent to ${esc(r.sentTo.join(', '))}"` : '';
  const confirmed = h.addressConfirmedAt && h.addressConfirmedAt >= r.sentAt;
  if (confirmed) return `<span class="pill ok"${title}>Address confirmed ${day(h.addressConfirmedAt)}</span>`;
  if (r.repliedAt) return '';
  if (Date.parse(r.expiresAt) < Date.now()) return `<span class="pill unknown"${title}>No reply to address check sent ${day(r.sentAt)}</span>`;
  return `<span class="pill info"${title}>Address check sent ${day(r.sentAt)}</span>`;
}

function householdCard(h) {
  const lines = addressLines('', h.address);
  const badges = [
    h.pendingUpdate ? '<span class="pill due-soon">New address to review</span>' : requestBadge(h),
    !isMailable(h.address) && `<span class="pill unknown">${esc(addressProblem(h.address))}</span>`,
  ].filter(Boolean).join('');
  const note = h.notes?.trim();
  const verified = h.addressVerifiedAt && isMailable(h.address);
  // Top-right corner, stacked: the note (click to read it), then the green check for a verified address.
  const corner = [
    note && `<span class="hh-note" data-action="show-note" data-note="${esc(note)}" title="Show note"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="6.3" r="1.1" fill="currentColor"/><path d="M10 9v5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="sr">Note: ${esc(note)}</span></span>`,
    verified && `<span class="hh-verified" title="Address verified ${esc(fmtDate(h.addressVerifiedAt))}"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.2 10.3l2.5 2.5 5.1-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr">Address verified</span></span>`,
  ].filter(Boolean).join('');
  return `<button class="hh-card${note ? ' has-note' : ''}${corner ? ' has-corner' : ''}" data-action="edit-household" data-id="${esc(h.id)}">
    ${corner ? `<span class="hh-corner">${corner}</span>` : ''}
    <span class="hh-name">${esc(h.labelName)}</span>
    ${effectiveFormalName(h) ? `<span class="small muted">${esc(effectiveFormalName(h))}</span>` : ''}
    <span class="hh-addr">${lines.map(esc).join('<br>') || '<span class="muted">—</span>'}</span>
    ${peopleNames(h) ? `<span class="small">${esc(peopleNames(h))}</span>` : ''}
    ${allEmails(h).length ? `<span class="small muted hh-email">${MAIL} ${esc(allEmails(h).join(', '))}</span>` : ''}
    ${(h.groups ?? []).length || badges ? `<span class="chips">${badges}${(h.groups ?? []).map((g) => `<span class="chip">${esc(g)}</span>`).join('')}</span>` : ''}
  </button>`;
}

// ---------- Trash: deleted households and occasions, kept 30 days ----------
const TRASH_DAYS = 30;
const daysLeft = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

async function trashModal() {
  let res;
  try { res = await api('/trash'); } catch (e) { toast(e.message, true); return; }
  const items = res.items;
  const row = (t) => {
    const left = daysLeft(t.expiresAt);
    return `<div class="trash-row">
      <span class="pill ${t.type === 'household' ? 'unknown' : 'due-soon'}">${t.type === 'household' ? 'Household' : 'Occasion'}</span>
      <div class="trash-what"><div class="trash-name">${esc(t.name)}</div>
        <div class="small muted">${[t.detail, `Deleted ${fmtDate(t.deletedAt)}${t.deletedBy && t.deletedBy !== state.session?.user?.email ? ` by ${esc(t.deletedBy)}` : ''}`].filter(Boolean).map(esc).join(' · ')}</div></div>
      <span class="small ${left <= 3 ? 'trash-soon' : 'muted'}">${left === 0 ? 'Deleted today' : `${plural(left, 'day')} left`}</span>
      ${canEdit() ? `<span class="trash-actions"><button type="button" class="btn sm" data-action="trash-restore" data-type="${t.type}" data-id="${esc(t.id)}" data-name="${esc(t.name)}">Restore</button>
        <button type="button" class="btn sm ghost danger" data-action="trash-forever" data-type="${t.type}" data-id="${esc(t.id)}" data-name="${esc(t.name)}" title="Delete forever" aria-label="Delete ${esc(t.name)} forever">${TRASH}</button></span>` : ''}
    </div>`;
  };
  openModal('Trash', items.length
    ? `<div class="trash-list">${items.map(row).join('')}</div>`
    : '<p class="muted" style="margin:0">The Trash is empty.</p>', {
    form: 'trash',
    wide: true,
    foot: `<div>${items.length && canEdit() ? '<button type="button" class="btn danger" data-action="trash-empty">Empty trash</button>' : ''}</div>
      <div class="right"><button type="button" class="btn" data-action="close">Close</button></div>`,
  });
}

async function restoreFromTrash(btn) {
  const { type, id, name } = btn.dataset;
  await withBusy(btn, async () => {
    const res = await api(`/trash/${type}/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if (type === 'household') upsertHousehold(res.household); else await refreshOccasions();
    if (state.occasionId) await openOccasion(state.occasionId, { quiet: true });
    toast(type === 'household'
      ? `${name} restored${res.relinked ? `, back on ${plural(res.relinked, 'occasion list')}` : ''}`
      : `"${name}" restored${res.relinked ? ` with ${plural(res.relinked, 'household')} on its list` : ''}`);
    render();
    await trashModal();
  });
}

// ---------- note bubble (the "i" on a card) ----------
let noteTip = null;
function hideNoteTip() {
  noteTip?.remove();
  noteTip = null;
}
function showNoteTip(icon) {
  const again = noteTip?.dataset.for === icon.closest('[data-id]')?.dataset.id;
  hideNoteTip();
  if (again) return; // a second click on the same "i" closes it
  noteTip = document.createElement('div');
  noteTip.className = 'note-tip';
  noteTip.setAttribute('role', 'tooltip');
  noteTip.dataset.for = icon.closest('[data-id]')?.dataset.id ?? '';
  noteTip.textContent = icon.dataset.note;
  document.body.appendChild(noteTip);
  // Below the icon, right edges aligned, kept inside the window.
  const r = icon.getBoundingClientRect();
  const w = noteTip.offsetWidth;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + noteTip.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - noteTip.offsetHeight - 6);
  noteTip.style.left = `${left}px`;
  noteTip.style.top = `${top}px`;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideNoteTip(); setBookMenu(false); }
  // N on the Address book screen: new household. Not while typing, with a dialog open, or with Cmd/Ctrl/Alt.
  if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
    && state.session && state.view === 'people' && !modal.open && canEdit()
    && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    hideNoteTip();
    setUserMenu(false);
    householdModal();
  }
});
window.addEventListener('scroll', hideNoteTip, true);
window.addEventListener('resize', hideNoteTip);

// ---------- modal ----------
function openModal(title, body, { form, foot = '', wide = false, head = '', base = '' } = {}) {
  modal.style.width = wide === 'xl' ? 'min(980px, calc(100vw - 32px))' : wide ? 'min(760px, calc(100vw - 32px))' : '';
  modal.innerHTML = `<form data-form="${form}" data-base="${esc(base)}" novalidate>
    <div class="modal-head"><h2>${title}</h2><div class="head-actions">${head}<button type="button" class="btn ghost sm" data-action="close" aria-label="Close">✕</button></div></div>
    <div class="modal-body stack">${body}<p class="error" data-error hidden></p></div>
    <div class="modal-foot">${foot}</div>
  </form>`;
  if (!modal.open) modal.showModal();
  modal.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')?.focus();
}
const closeModal = () => modal.close();
function modalError(msg) {
  const el = modal.open ? modal.querySelector('[data-error]') : null;
  if (!el) return false;
  el.textContent = msg; el.hidden = !msg;
  if (msg) el.scrollIntoView({ block: 'nearest' });
  return true;
}

const addressFields = (a = {}, prefix = '') => `
  <label>Street address<input name="${prefix}line1" value="${val(a.line1)}" autocomplete="off" maxlength="120"></label>
  <label>Apt, suite, unit<input name="${prefix}line2" value="${val(a.line2)}" autocomplete="off" maxlength="120"></label>
  <div class="grid-3">
    <label>City<input name="${prefix}city" value="${val(a.city)}" autocomplete="off" maxlength="80"></label>
    <label>State<input name="${prefix}state" value="${val(a.state)}" autocomplete="off" maxlength="40"></label>
    <label>ZIP<input name="${prefix}zip" value="${val(a.zip)}" autocomplete="off" maxlength="20" inputmode="numeric"></label>
  </div>
  <label>Country <span class="muted">(leave blank for the US)</span><input name="${prefix}country" value="${val(a.country)}" autocomplete="off" maxlength="60"></label>`;

const readAddress = (form, prefix = '') => Object.fromEntries(['line1', 'line2', 'city', 'state', 'zip', 'country']
  .map((k) => [k, form.elements[`${prefix}${k}`]?.value.trim() ?? '']));

// The default contact: the person ticked, else the first person with an email (ticked on screen too).
function defaultPerson(members = []) {
  const withEmail = members.filter((m) => m.email);
  return withEmail.find((m) => m.primary) ?? withEmail[0] ?? null;
}
function withDefaultShown(members) {
  const d = defaultPerson(members);
  return members.map((m) => ({ ...m, primary: m === d }));
}

function memberRow(m = {}) {
  return `<div class="member-row" data-member data-id="${val(m.id)}">
    <input data-m="firstName" placeholder="First name" value="${val(m.firstName)}" aria-label="First name" maxlength="60">
    <input data-m="lastName" placeholder="Last name" value="${val(m.lastName)}" aria-label="Last name" maxlength="60">
    <input data-m="email" type="email" placeholder="Email" value="${val(m.email)}" aria-label="Email" maxlength="254">
    <input data-m="phone" type="tel" placeholder="Phone" value="${val(m.phone)}" aria-label="Phone" maxlength="30">
    <label class="default-cell" title="Default contact"><input type="checkbox" data-m="primary" ${m.primary ? 'checked' : ''} aria-label="Default contact"></label>
    <button type="button" class="btn ghost sm" data-action="remove-member" aria-label="Remove person">✕</button>
  </div>`;
}

// ----- Groups: one rounded chip per group with an ×, a box to add more, and suggestions from the groups in use -----
const groupChip = (g) => `<span class="chip-tag" data-chip="${esc(g)}"><span>${esc(g)}</span><button type="button" class="chip-x" data-action="chip-remove" aria-label="Remove ${esc(g)}" title="Remove">×</button></span>`;

function groupChipsField(groups) {
  return `<div class="chip-input" data-chips>
    ${groups.map(groupChip).join('')}
    <input type="text" class="chip-text" data-chip-text maxlength="40" autocomplete="off" placeholder="${groups.length ? 'Add group' : 'Family, Neighbors, Work…'}"
      role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="group-suggest" aria-labelledby="groups-label">
    <div class="chip-suggest" id="group-suggest" role="listbox" hidden></div>
  </div>`;
}

const groupValues = (root) => {
  const box = root.querySelector('[data-chips]');
  if (!box) return [];
  addTypedGroup(box); // a group typed but not yet entered still counts when saving
  return [...box.querySelectorAll('[data-chip]')].map((c) => c.dataset.chip);
};

function addGroupChip(box, raw) {
  const name = String(raw ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return;
  const have = [...box.querySelectorAll('[data-chip]')].map((c) => c.dataset.chip.toLowerCase());
  if (have.includes(name.toLowerCase())) return;
  if (have.length >= 20) { toast('At most 20 groups per household', true); return; }
  // Reuse the spelling of an existing group ("family" becomes "Family").
  const known = allGroups().find((g) => g.toLowerCase() === name.toLowerCase()) ?? name;
  box.querySelector('[data-chip-text]').insertAdjacentHTML('beforebegin', groupChip(known));
  box.querySelector('[data-chip-text]').placeholder = 'Add group';
}

function addTypedGroup(box) {
  const input = box.querySelector('[data-chip-text]');
  if (input?.value.trim()) { addGroupChip(box, input.value); input.value = ''; }
  hideGroupSuggest(box);
}

function showGroupSuggest(box) {
  const input = box.querySelector('[data-chip-text]');
  const list = box.querySelector('.chip-suggest');
  const q = input.value.trim().toLowerCase();
  const have = new Set([...box.querySelectorAll('[data-chip]')].map((c) => c.dataset.chip.toLowerCase()));
  const matches = allGroups().filter((g) => !have.has(g.toLowerCase()))
    .filter((g) => !q || g.toLowerCase().includes(q))
    .sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)) || a.localeCompare(b))
    .slice(0, 8);
  const exact = matches.some((g) => g.toLowerCase() === q) || have.has(q); // already a chip: nothing to add
  const items = [...matches.map((g) => ({ value: g, label: esc(g) })), ...(q && !exact ? [{ value: input.value.trim(), label: `Add "<b>${esc(input.value.trim())}</b>"`, isNew: true }] : [])];
  if (!items.length) return hideGroupSuggest(box);
  list.innerHTML = items.map((it, i) => `<div class="chip-option${it.isNew ? ' new' : ''}" role="option" id="group-opt-${i}" data-value="${esc(it.value)}" aria-selected="${i === 0 && q ? 'true' : 'false'}">${it.label}</div>`).join('');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  return undefined;
}

function hideGroupSuggest(box) {
  const list = box?.querySelector('.chip-suggest');
  if (!list) return;
  list.hidden = true;
  list.innerHTML = '';
  box.querySelector('[data-chip-text]')?.setAttribute('aria-expanded', 'false');
}

function moveGroupHighlight(box, step) {
  const opts = [...box.querySelectorAll('.chip-option')];
  if (!opts.length) return;
  const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  const next = cur < 0 ? (step > 0 ? 0 : opts.length - 1) : (cur + step + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
  opts[next].scrollIntoView({ block: 'nearest' });
}

function onGroupKey(e) {
  const input = e.target;
  const box = input.closest('[data-chips]');
  const list = box.querySelector('.chip-suggest');
  const open = !list.hidden;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open) showGroupSuggest(box);
    moveGroupHighlight(box, e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && input.value.trim())) {
    // Enter / comma / Tab add a chip (Enter never submits the form from here).
    const picked = open && box.querySelector('.chip-option[aria-selected=true]');
    if (!picked && !input.value.trim()) { if (e.key !== 'Tab') e.preventDefault(); return; }
    e.preventDefault();
    addGroupChip(box, picked ? picked.dataset.value : input.value);
    input.value = '';
    hideGroupSuggest(box);
  } else if (e.key === 'Backspace' && !input.value) {
    // Backspace in the empty box removes the last chip.
    const chips = box.querySelectorAll('[data-chip]');
    chips[chips.length - 1]?.remove();
    showGroupSuggest(box);
  } else if (e.key === 'Escape' && open) {
    e.preventDefault(); // close the suggestions, not the dialog
    e.stopPropagation();
    hideGroupSuggest(box);
  }
}

// The household editor's sections. All of them belong to one form, so Save keeps every tab's changes.
const HOUSEHOLD_TABS = [['greetings', 'Greetings'], ['address', 'Address'], ['people', 'People'], ['more', 'Groups & Notes']];

function householdTabs(active, { people = 0, pending = false } = {}) {
  return `<div class="tabs settings-tabs hh-tabs" role="tablist">${HOUSEHOLD_TABS.map(([id, label]) => `
    <button type="button" role="tab" class="tab" data-action="hh-tab" data-tab="${id}" aria-selected="${id === active}">${label}${
      id === 'people' && people ? `<span class="count">${people}</span>` : ''}${id === 'address' && pending ? '<span class="tab-dot" title="Address update to review"></span>' : ''}</button>`).join('')}</div>`;
}

const NEXT_BTN = '<button type="button" class="btn" data-action="hh-next">Next ›</button>';

function showHouseholdTab(id, { focus = true } = {}) {
  if (id === 'address') loadAddressChecks();
  const next = modal.querySelector('[data-action=hh-next]');
  if (next) next.hidden = id === HOUSEHOLD_TABS.at(-1)[0];
  modalError(''); // an old message would point at the wrong tab
  modal.querySelectorAll('[data-action=hh-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
  modal.querySelectorAll('[data-hh-panel]').forEach((p) => { p.inert = p.dataset.hhPanel !== id; });
  if (focus) modal.querySelector(`[data-hh-panel="${id}"]`)?.querySelector('input:not([type=checkbox]):not([disabled]), textarea:not([disabled])')?.focus();
}

// ---------- address checks (Google Address Validation) ----------
// The app allows a number of checks a month for everyone; the API counts them and says how many are left.
// The button is hidden until address checks are set up, and disabled (no message) while the month's checks
// are used up; it turns itself back on when they're available again.
let addressChecks = null; // { enabled, remaining, availableAt, at }
let addressChecksTimer = null;

async function loadAddressChecks() {
  const box = modal.querySelector('[data-addr-check]');
  if (!box || !canEdit()) return;
  if (!addressChecks || Date.now() - addressChecks.at > 60_000) {
    try { addressChecks = { ...(await api('/address-check')).checks, at: Date.now() }; } catch { return; }
  }
  showAddressChecks();
}

function showAddressChecks() {
  const box = modal.querySelector('[data-addr-check]');
  if (!box) return;
  const c = addressChecks ?? {};
  box.hidden = !c.enabled;
  if (!c.enabled) return;
  const out = c.remaining <= 0;
  box.querySelector('[data-action=check-address]').disabled = out;
  // Turn the button back on when the month turns (timers can't wait longer than about 24 days).
  clearTimeout(addressChecksTimer);
  if (out && c.availableAt) {
    addressChecksTimer = setTimeout(() => { addressChecks = null; if (modal.open) loadAddressChecks(); }, Math.min(2 ** 31 - 1, Math.max(5_000, Date.parse(c.availableAt) - Date.now() + 2_000)));
  }
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'zip'];
const sameAddress = (a, b) => ADDRESS_KEYS.every((k) => String(a[k] ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b[k] ?? '').trim().replace(/\s+/g, ' ').toLowerCase());
const CHECK_VERDICTS = {
  confirmed: ['ok', 'Confirmed: mail is delivered here.'],
  'needs-unit': ['warn', 'This address needs an apartment or unit number.'],
  'unit-unconfirmed': ['ok', "Confirmed: mail is delivered to this building. The Post Office doesn't list its apartments."],
  'not-found': ['bad', "This address couldn't be confirmed."],
};

async function checkAddress(btn) {
  const form = modal.querySelector('form');
  const out = modal.querySelector('[data-addr-result]');
  const typed = readAddress(form);
  modalError('');
  out.innerHTML = '';
  await withBusy(btn, async () => {
    let res;
    try {
      res = await api('/address-check', { method: 'POST', body: { address: typed } });
    } catch (e) {
      if (e.data?.checks) { addressChecks = { ...e.data.checks, at: Date.now() }; showAddressChecks(); }
      throw e;
    }
    addressChecks = { ...res.checks, at: Date.now() };
    const { status, suggested, vacant } = res.result;
    const [tone, text] = CHECK_VERDICTS[status] ?? CHECK_VERDICTS['not-found'];
    const differs = suggested && !sameAddress(typed, suggested);
    out.innerHTML = `<div class="check-result ${tone}">
      <div>${tone === 'ok' ? CHECK_ICON : ''} <b>${esc(text)}</b>${vacant ? ' <span class="muted">It\'s listed as vacant.</span>' : ''}</div>
      ${differs ? `<div class="compare">
          <div><span class="small muted">You entered</span><div>${addressLines('', typed).map(esc).join('<br>') || '—'}</div></div>
          <div><span class="small muted">Suggested</span><div>${addressLines('', suggested).map(esc).join('<br>')}</div></div>
        </div>
        <div class="row-gap"><button type="button" class="btn sm primary" data-action="use-suggested-address">Use suggested address</button>
          <button type="button" class="btn sm" data-action="keep-typed-address">Keep mine</button></div>` : ''}
    </div>`;
    out.querySelector('[data-action=use-suggested-address]')?.addEventListener('click', () => {
      for (const k of ADDRESS_KEYS) form.elements[k].value = suggested[k] ?? '';
      out.innerHTML = `<div class="check-result ok"><div>${CHECK_ICON} <b>Updated to the suggested address.</b> <span class="muted">Save to keep it.</span></div></div>`;
    }, { once: true });
    out.querySelector('[data-action=keep-typed-address]')?.addEventListener('click', () => { out.innerHTML = ''; }, { once: true });
  });
  showAddressChecks();
}

// Share one household as a vCard or a CSV: the system share sheet (AirDrop, Mail, Messages…) where the
// browser has one, plus plain downloads. What's on screen is shared, including edits not yet saved.
function shareMenu() {
  const canShareSheet = typeof navigator.share === 'function';
  const items = (verb) => `<button type="button" role="menuitem" data-action="hh-share" data-how="${verb}" data-kind="vcf">vCard (.vcf)</button>
      <button type="button" role="menuitem" data-action="hh-share" data-how="${verb}" data-kind="csv">CSV (.csv)</button>`;
  return `<div class="share-menu">
    <button type="button" class="btn ghost sm icon-only" data-action="toggle-share-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="share-menu-list" title="Share" aria-label="Share">${SHARE_ICON}</button>
    <div class="menu" id="share-menu-list" role="menu" hidden>
      ${canShareSheet ? `<div class="menu-label">Share</div>${items('share')}<hr><div class="menu-label">Download</div>` : '<div class="menu-label">Download</div>'}
      ${items('download')}
    </div>
  </div>`;
}

// Escape closes an open share menu before it closes the dialog.
modal.addEventListener('cancel', (e) => {
  const menu = modal.querySelector('#share-menu-list');
  if (menu && !menu.hidden) { e.preventDefault(); setShareMenu(false); modal.querySelector('[data-action=toggle-share-menu]')?.focus(); }
});

function setShareMenu(open) {
  const btn = modal.querySelector('[data-action=toggle-share-menu]');
  const menu = modal.querySelector('#share-menu-list');
  if (!btn || !menu) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

async function shareHousehold(how, kind) {
  setShareMenu(false);
  const form = modal.querySelector('form');
  const saved = hhById().get(form.dataset.form.replace(/^household-/, '')) ?? {};
  const h = { ...saved, ...readHousehold(form) };
  if (!h.labelName) { showHouseholdTab('greetings'); return modalError('Enter the Household Greeting.'); }
  const name = `${fileBaseName(h)}.${kind}`;
  const text = kind === 'vcf' ? householdToVcard(h) : householdsToCsv([h]);
  const type = kind === 'vcf' ? 'text/vcard' : 'text/csv';
  if (how === 'share') {
    const file = new File([text], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: h.labelName }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  download(name, text, type);
}

function householdModal(h) {
  const isNew = !h;
  h ??= { members: [{}], address: {}, groups: state.filters.people.groups.length === 1 ? [...state.filters.people.groups] : [] };
  const p = h.pendingUpdate;
  const req = h.addressRequest;
  const suggestedFormal = defaultFormalName(h.greeting, householdLastName({ ...h, members: splitMembers(h.members ?? []) }));
  const pendingBox = p ? `<div class="pending-box">
      <div><b>They sent ${p.unchanged ? 'a confirmation' : 'a new address'}</b> <span class="muted small">${fmtDate(p.receivedAt)}</span></div>
      <div class="compare">
        <div><span class="small muted">On file</span><div>${addressLines('', h.address).map(esc).join('<br>') || '—'}</div></div>
        <div><span class="small muted">They sent</span><div>${addressLines('', p.address).map(esc).join('<br>')}</div></div>
      </div>
      ${p.note ? `<p class="small" style="margin:0">Note: ${esc(p.note)}</p>` : ''}
      <div class="row-gap"><button type="button" class="btn sm primary" data-action="pending" data-do="accept" data-id="${esc(h.id)}">Use new address</button>
      <button type="button" class="btn sm" data-action="pending" data-do="discard" data-id="${esc(h.id)}">Keep the one on file</button></div>
    </div>` : '';
  const people = withDefaultShown(peopleWithHouseholdContact(h).length ? peopleWithHouseholdContact(h) : [{}]);
  const start = p ? 'address' : 'greetings';
  const panel = (id, html) => `<div class="hh-panel stack" role="tabpanel" data-hh-panel="${id}" ${id === start ? '' : 'inert'}>${html}</div>`;
  openModal(isNew ? 'New household' : esc(h.labelName), `
    ${householdTabs(start, { people: people.filter((m) => m.firstName || m.lastName || m.email).length, pending: !!p })}
    <div class="hh-panels">
    ${panel('greetings', `
      <label>Household Greeting${REQUIRED}<input name="labelName" required aria-required="true" maxlength="120" value="${val(h.labelName)}" placeholder="The Smith Family"></label>
      <div class="grid-2">
        <label>Formal Greeting<input name="formalName" maxlength="160" value="${val(h.formalName || suggestedFormal)}" ${!h.formalName && suggestedFormal ? 'data-auto="1"' : ''} placeholder="Mr. and Mrs. John Smith"></label>
        <label>Informal Greeting<input name="greeting" maxlength="120" value="${val(h.greeting)}" placeholder="John and Mary"></label>
      </div>`)}
    ${panel('address', `
      ${pendingBox}
      ${addressFields(h.address)}
      <div class="addr-check" data-addr-check hidden>
        <div class="addr-check-row"><button type="button" class="btn sm" data-action="check-address">${CHECK_ICON} Check address</button></div>
        <div data-addr-result></div>
      </div>
      ${h.addressConfirmedAt ? `<p class="hint">Confirmed by them ${fmtDate(h.addressConfirmedAt)}.</p>` : ''}
      ${req && !p ? `<p class="hint">Address check sent ${fmtDate(req.sentAt)} to ${esc(req.sentTo.join(', '))}; the link works until ${fmtDate(req.expiresAt)}.</p>` : ''}`)}
    ${panel('people', `
      <div class="member-head small muted"><span>First</span><span>Last</span><span>Email</span><span>Phone</span><span class="default-head">Default</span><span></span></div>
      <div data-members>${people.map(memberRow).join('')}</div>
      <button type="button" class="btn sm" data-action="add-member">+ Person</button>`)}
    ${panel('more', `
      <div>
        <div class="label-like" id="groups-label">Groups</div>
        ${groupChipsField(h.groups ?? [])}
      </div>
      <label>Notes<textarea name="notes" rows="4" maxlength="2000">${esc(h.notes ?? '')}</textarea></label>`)}
    </div>`, {
    form: isNew ? 'household-new' : `household-${h.id}`,
    base: isNew ? '' : h.updatedAt ?? '',
    wide: true,
    head: isNew ? '' : shareMenu(),
    foot: `<div class="left-actions">${isNew ? '' : `<button type="button" class="btn danger" data-action="delete-household" data-id="${esc(h.id)}">Delete</button>
      <button type="button" class="btn" data-action="request-address" data-id="${esc(h.id)}" ${allEmails(h).length ? '' : 'disabled title="Add an email address first"'}>${MAIL} Confirm address</button>`}</div>
      <div class="right"><button type="button" class="btn" data-action="close">Cancel</button>${NEXT_BTN}<button class="btn primary">Save</button></div>`,
  });
  if (!canEdit()) {
    // View only: everything shown, nothing changeable.
    modal.querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select, .modal-body button:not(.tab)').forEach((el) => { el.disabled = true; });
    modal.querySelectorAll('[data-action=add-member], [data-action=remove-member], .pending-box .row-gap').forEach((el) => el.remove());
    modal.querySelector('.modal-foot').innerHTML = `<div class="small muted">View only</div><div class="right"><button type="button" class="btn" data-action="close">Close</button>${NEXT_BTN}</div>`;
  }
  showHouseholdTab(start);
}

function refreshFormalName(form) {
  const field = form?.elements.formalName;
  if (!field || (field.value.trim() && !field.dataset.auto)) return;
  const lastName = householdLastName({
    labelName: form.elements.labelName.value,
    members: [...form.querySelectorAll('[data-m=lastName]')].map((i) => ({ lastName: i.value })),
  });
  const suggestion = defaultFormalName(form.elements.greeting.value, lastName);
  field.value = suggestion;
  if (suggestion) field.dataset.auto = '1'; else delete field.dataset.auto;
}

function readHousehold(form) {
  const members = [...form.querySelectorAll('[data-member]')].map((row) => ({
    id: row.dataset.id || undefined,
    ...Object.fromEntries([...row.querySelectorAll('[data-m]')].map((i) => [i.dataset.m, i.type === 'checkbox' ? i.checked : i.value.trim()])),
  }));
  return {
    labelName: form.labelName.value.trim(),
    formalName: form.formalName.value.trim(),
    greeting: form.greeting.value.trim(),
    address: readAddress(form),
    members,
    emails: [], // the shared email and home phone now live on the people
    phone: '',
    groups: groupValues(form),
    notes: form.notes.value.trim(),
  };
}

// Someone else (or this person in another window) saved the same thing first. The API refuses the
// save and sends their version; this asks which to keep. Only the two buttons answer, so a stray
// click can't throw away either version.
async function resolveConflict(err, what, { loadTheirs, saveMine }) {
  if (err.status !== 409 || err.data?.code !== 'conflict' || !err.data.current) throw err;
  const who = err.data.changedBy === 'you' ? 'You' : err.data.changedBy;
  const mine = await askConfirm({
    title: err.data.changedBy === 'you' ? `You changed this ${what} in another window while editing it here` : `${who} changed this ${what} while you were editing it`,
    text: 'Load their version to see the latest (what you typed here is dropped), or save yours over it.',
    ok: 'Save mine anyway', cancel: 'Load their version', strict: true,
  });
  return mine ? saveMine(err.data.current) : loadTheirs(err.data.current);
}

async function saveHousehold(form) {
  const id = form.dataset.form.replace(/^household-/, '');
  const body = readHousehold(form);
  if (!body.labelName) { showHouseholdTab('greetings'); return modalError('Enter the Household Greeting.'); }
  const done = (household, msg) => { upsertHousehold(household); closeModal(); toast(msg); render(); };
  await withBusy(form.querySelector('.btn.primary'), async () => {
    if (id === 'new') return done((await api('/households', { method: 'POST', body })).household, 'Household added');
    const put = (base) => api(`/households/${id}`, { method: 'PUT', body: { ...body, baseUpdatedAt: base } });
    try {
      return done((await put(form.dataset.base || null)).household, 'Saved');
    } catch (err) {
      return resolveConflict(err, 'household', {
        saveMine: async (theirs) => done((await put(theirs.updatedAt ?? null)).household, 'Saved'),
        loadTheirs: (theirs) => { upsertHousehold(theirs); render(); householdModal(theirs); toast('Showing their version'); },
      });
    }
  });
}

function requestAddressModal(h) {
  const days = state.me?.linkDays ?? 30;
  openModal('Ask them to confirm their address', `
    <p style="margin:0">We'll email <b>${esc(allEmails(h).join(', '))}</b> a private link to confirm or correct the address for <b>${esc(h.labelName)}</b>. What they send comes back here for you to review; nothing changes until you accept it. The link works for ${days} days.</p>
    <label>Personal note <span class="muted">(optional)</span><textarea name="message" rows="3" maxlength="2000" placeholder="Getting ready for Christmas cards — is this still the right address?"></textarea></label>
    <p class="hint">Emails come from ${esc(fromName())} and replies go to ${esc(state.session.user.email)}.</p>`, {
    form: `addrreq-${h.id}`,
    foot: `<div></div><div class="right"><button type="button" class="btn" data-action="edit-household" data-id="${esc(h.id)}">Back</button><button class="btn primary">Send</button></div>`,
  });
}

function fromName() {
  const p = state.me?.profile ?? {};
  return p.emailFromName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'your name (set it in Settings)';
}

// ---------- CSV ----------
let importRows = null;

function importModal() {
  importRows = null;
  vcardImport = null;
  setUserMenu(false);
  openModal('Import', `
    <label class="drop-zone" data-drop tabindex="0" role="button" aria-label="Choose a spreadsheet (.csv) or contacts (.vcf) file">
      <input type="file" accept=".csv,text/csv,.vcf,text/vcard,text/x-vcard" data-input="csv-file" hidden>
      ${UPLOAD_ICON}
      <span class="dz-main" data-drop-label>Drop a spreadsheet (.csv) or contacts (.vcf) here</span>
      <span class="dz-sub">or <span class="link">choose a file</span></span>
    </label>
    <div data-import-step></div>`, { form: 'import', wide: true, foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" disabled data-import-go>Import</button></div>' });
}

// A file chosen in Import: contacts (.vcf, e.g. exported from Contacts on a Mac or iPhone) or a CSV.
async function readImportFile(file) {
  modalError('');
  const zone = modal.querySelector('[data-drop]');
  if (zone) { zone.classList.add('has-file'); zone.querySelector('[data-drop-label]').textContent = file.name; zone.querySelector('.dz-sub').innerHTML = 'Drop another file, or <span class="link">choose a different one</span>'; }
  const text = await file.text();
  if (/\.vcf$/i.test(file.name) || /^\uFEFF?\s*BEGIN:VCARD/i.test(text)) return readVcardFile(text);
  vcardImport = null;
  return readCsvFile(file, text);
}

// ---- contacts (vCard) import ----
// Contacts become households (people at the same address together), listed with a checkbox each so
// only the ones wanted come in. Households already in the address book start unticked.
let vcardImport = null; // { households, picked: Set }
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function readVcardFile(text) {
  importRows = null;
  const households = contactsToHouseholds(parseVcards(text), { phoneFormat: formatPhone }).map((h) => ({
    ...h, members: h.members.map((m) => ({ ...m, email: m.email && EMAIL_OK.test(m.email) ? m.email : undefined })),
  }));
  if (!households.length) return modalError('No contacts found in that file.');
  households.forEach((h, i) => {
    h.idx = i;
    h.existingId = findExistingHousehold(state.households, h)?.id;
  });
  // Ticked: a contact already here is merged into it, adding only what's missing.
  vcardImport = { households, picked: new Set(households.map((h) => h.idx)) };
  modal.querySelector('[data-import-step]').innerHTML = `
    <div class="vc-tools">
      <input type="search" data-vc-search placeholder="Find…" aria-label="Find" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button type="button" class="link" data-vc-all="1">Select all</button><button type="button" class="link" data-vc-all="">Select none</button>
    </div>
    <div class="imp-scroll tall"><div class="vc-list">${households.map((h) => `
      <label class="vc-row" data-vc-row="${h.idx}" data-text="${esc([h.labelName, ...h.members.map((m) => `${m.firstName} ${m.lastName} ${m.email ?? ''}`), h.address?.city].join(' ').toLowerCase())}">
        <input type="checkbox" data-vc="${h.idx}" ${vcardImport.picked.has(h.idx) ? 'checked' : ''}>
        <span class="vc-main"><span class="vc-name"><b>${esc(h.labelName)}</b>${h.existingId ? '<span class="pill info">Merges with existing</span>' : ''}</span>
          <span class="small muted">${esc([h.members.map((m) => m.firstName || m.email).filter(Boolean).join(', '), addressLines('', h.address).join(', '), addressProblem(h.address)].filter(Boolean).join(' · '))}</span></span>
      </label>`).join('')}</div></div>`;
  updateVcardSummary();
  return undefined;
}
function updateVcardSummary() {
  const n = vcardImport.picked.size;
  const go = modal.querySelector('[data-import-go]');
  go.disabled = !n;
  go.textContent = n ? `Import ${plural(n, 'contact')}` : 'Import';
}
// The Import drop zone: drag a file onto it (or click to choose one).
modal.addEventListener('dragover', (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  zone.classList.add('over');
});
modal.addEventListener('keydown', (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (zone && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); zone.querySelector('input[type=file]').click(); }
});
modal.addEventListener('dragleave', (e) => { const zone = e.target.closest?.('[data-drop]'); if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
modal.addEventListener('drop', (e) => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file) readImportFile(file).catch((err) => modalError(err.message));
});

modal.addEventListener('change', (e) => {
  if (!vcardImport || !e.target.matches('[data-vc]')) return;
  const i = Number(e.target.dataset.vc);
  if (e.target.checked) vcardImport.picked.add(i); else vcardImport.picked.delete(i);
  updateVcardSummary();
});
modal.addEventListener('input', (e) => {
  if (!vcardImport || !e.target.matches('[data-vc-search]')) return;
  const q = e.target.value.trim().toLowerCase();
  modal.querySelectorAll('[data-vc-row]').forEach((row) => { row.hidden = Boolean(q) && !row.dataset.text.includes(q); });
});
modal.addEventListener('click', (e) => {
  const all = e.target.closest('[data-vc-all]');
  if (!vcardImport || !all) return;
  // Select all / none apply to the households shown by Find.
  modal.querySelectorAll('[data-vc-row]:not([hidden]) [data-vc]').forEach((cb) => {
    cb.checked = Boolean(all.dataset.vcAll);
    const i = Number(cb.dataset.vc);
    if (cb.checked) vcardImport.picked.add(i); else vcardImport.picked.delete(i);
  });
  updateVcardSummary();
});

async function readCsvFile(file, text) {
  const rows = parseCsv(text ?? await file.text());
  if (!rows.length) return modalError('That file is empty.');
  const header = looksLikeHeader(rows[0]);
  const cols = Math.max(...rows.map((r) => r.length));
  importRows = { header: header ? rows[0] : null, data: header ? rows.slice(1) : rows, cols, at: 0 };
  const mapping = header ? guessMapping(rows[0]) : Array(cols).fill('');
  const sample = importRows.data[0] ?? [];
  const many = importRows.data.length > 1;
  modal.querySelector('[data-import-step]').innerHTML = `
    <p class="small muted" style="margin:0">${plural(importRows.data.length, 'row')} found. Check what each column holds:</p>
    <div class="imp-scroll short"><table class="imp-map"><thead><tr><th>Column</th><th class="imp-ex-head">${many ? `<span class="imp-nav">
      <button type="button" class="btn ghost sm" data-action="imp-row" data-step="-1" aria-label="Previous row" disabled>‹</button>
      <span data-imp-pos>Row 1 of ${importRows.data.length.toLocaleString('en-US')}</span>
      <button type="button" class="btn ghost sm" data-action="imp-row" data-step="1" aria-label="Next row">›</button></span>` : 'Example'}</th><th>Holds</th></tr></thead><tbody>
    ${Array.from({ length: cols }, (_, i) => `<tr>
      <td class="imp-col">${esc(importRows.header?.[i] || `Column ${i + 1}`)}</td>
      <td><div class="imp-sample" data-sample="${i}" title="${esc(sample[i] ?? '')}">${esc(sample[i] ?? '')}</div></td>
      <td><select data-map="${i}"><option value="">Don't import</option>${FIELDS.map((f) => `<option value="${f.key}" ${mapping[i] === f.key ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></td>
    </tr>`).join('')}
    </tbody></table></div>
    <p class="small" data-import-summary></p>`;
  updateImportSummary();
}

// Steps the Example column through the file's rows.
function showImportRow(at) {
  const total = importRows.data.length;
  importRows.at = Math.min(Math.max(0, at), total - 1);
  const row = importRows.data[importRows.at] ?? [];
  modal.querySelectorAll('[data-sample]').forEach((el) => {
    const v = row[Number(el.dataset.sample)] ?? '';
    el.textContent = v;
    el.title = v;
  });
  modal.querySelector('[data-imp-pos]').textContent = `Row ${(importRows.at + 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
  modal.querySelector('[data-step="-1"]').disabled = importRows.at === 0;
  modal.querySelector('[data-step="1"]').disabled = importRows.at === total - 1;
}

function currentMapping() {
  return [...modal.querySelectorAll('[data-map]')].map((s) => s.value);
}

function updateImportSummary() {
  if (!importRows) return;
  const { households, skipped } = buildHouseholds(importRows.data, currentMapping());
  const merging = households.filter((h) => findExistingHousehold(state.households, h)).length;
  const fresh = households.length - merging;
  const noAddr = households.filter((h) => !isMailable(h.address)).length;
  const mergeText = merging ? `merge <b>${merging}</b> into ${merging === 1 ? 'a household' : 'households'} already here` : '';
  modal.querySelector('[data-import-summary]').innerHTML = `Ready to ${[fresh && `import <b>${plural(fresh, 'new household')}</b>`, mergeText].filter(Boolean).join(' and ') || 'import nothing'}${
    skipped.length ? `; ${plural(skipped.length, 'row')} without a name will be skipped` : ''}${
    noAddr ? `; ${noAddr} ${noAddr === 1 ? 'has' : 'have'} no complete mailing address yet` : ''}.`;
  const go = modal.querySelector('[data-import-go]');
  go.disabled = !households.length;
  go.textContent = households.length ? `Import ${plural(households.length, 'household')}` : 'Import';
}

function exportModal() {
  openModal('Export', `<div class="export-choices">
      <button type="button" class="btn" data-action="export-as" data-kind="csv"><b>Spreadsheet (.csv)</b><span class="small muted">Excel, Numbers, Google Sheets; imports back here</span></button>
      <button type="button" class="btn" data-action="export-as" data-kind="vcf"><b>Contacts (.vcf)</b><span class="small muted">Contacts on a Mac or iPhone, Google Contacts, Outlook</span></button>
    </div>`, { form: 'export', foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button></div>' });
}

// New households are added; ones already in the address book get only what they're missing
// (mergeHousehold: what's here always wins).
async function runImport(btn) {
  const incoming = vcardImport
    ? vcardImport.households.filter((h) => vcardImport.picked.has(h.idx)).map(({ idx, existingId, ...h }) => h)
    : buildHouseholds(importRows.data, currentMapping()).households;
  await withBusy(btn, async () => {
    await refreshHouseholds(); // merge into the latest version
    const fresh = [];
    const merged = new Map(); // household id -> merged household
    let updated = 0;
    for (const h of incoming) {
      const found = findExistingHousehold(state.households, h);
      if (!found) { fresh.push(h); continue; }
      const { household, added } = mergeHousehold(merged.get(found.id) ?? found, h);
      if (added.length) merged.set(found.id, household);
      else if (!merged.has(found.id)) merged.set(found.id, null); // already had everything
    }
    for (let i = 0; i < fresh.length; i += 500) {
      await api('/households/import', { method: 'POST', body: { households: fresh.slice(i, i + 500) } });
    }
    for (const [id, h] of merged) {
      if (!h) continue;
      const { id: _id, PK, SK, createdAt, updatedAt, updatedBy, updatedByName, pendingUpdate, addressRequest, addressConfirmedAt, addressVerifiedAt, ...body } = h;
      await api(`/households/${id}`, { method: 'PUT', body: { ...body, baseUpdatedAt: updatedAt ?? null } });
      updated++;
    }
    await refreshHouseholds();
    closeModal();
    const same = [...merged.values()].filter((x) => !x).length;
    toast([
      fresh.length && `Imported ${plural(fresh.length, 'new household')}`,
      updated && `added missing details to ${plural(updated, 'household')}`,
      same && `${plural(same, 'household')} already had everything`,
    ].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) || 'Nothing to import');
    render();
  });
}

function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- occasions ----------
function renderOccasions() {
  return `
  <div class="page-head">
    <h1>Occasions</h1>
    <div class="actions">${canEdit() ? '<button class="btn primary" data-action="add-occasion">+ Occasion</button>' : ''}</div>
  </div>
  ${state.occasions.length ? `<div class="occ-grid">${state.occasions.map((o) => `
    <button class="occ-card" data-action="open-occasion" data-id="${esc(o.id)}">
      <span class="occ-kind pill ${KIND_PILL[kindOf(o)]}">${KIND_LABEL[kindOf(o)]}</span>
      <span class="hh-name">${esc(o.name)}</span>
      ${kindOf(o) === 'card' ? '' : `<span class="small muted">${o.date ? fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}</span>`}
      <span class="small">${plural(o.counts.tagged, 'household')} on the list${isEmailKind(o) ? ` · ${o.counts.invited} emailed` : ` · ${o.counts.mailed} mailed`}</span>
    </button>`).join('')}</div>` : `<div class="panel empty">
      <h2>Plan an occasion</h2>
      <p>Create an occasion like <b>Christmas cards 2026</b> or <b>Graduation party</b>, tick who it's for, then print labels or envelopes and email invitations.</p>
      ${canEdit() ? '<button class="btn primary" data-action="add-occasion">+ Occasion</button>' : ''}</div>`}`;
}

async function openOccasion(id, { quiet = false } = {}) {
  state.occasionId = id;
  try {
    state.occ = await api(`/occasions/${id}`);
  } catch (e) {
    state.occasionId = null; state.occ = null;
    if (!quiet) toast(e.message, true);
  }
}

const tagMap = () => new Map((state.occ?.tags ?? []).map((t) => [t.householdId, t]));

function renderOccasion() {
  const o = state.occ.occasion;
  const tags = tagMap();
  const byId = hhById();
  const onList = [...tags.keys()].map((id) => byId.get(id)).filter(Boolean);
  const mailed = [...tags.values()].filter((t) => t.mailedAt).length;
  const invited = [...tags.values()].filter((t) => t.invitedAt).length;
  const noAddr = onList.filter((h) => !isMailable(h.address)).length;
  const withEmail = onList.filter((h) => allEmails(h).length).length;
  const kind = kindOf(o);
  const when = kind === 'card' ? '' : [o.date && fmtDate(o.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), o.time].filter(Boolean).join(' at ');
  return `
  <button class="link back" data-action="view" data-view="occasions">← Occasions</button>
  <div class="page-head">
    <div><h1>${esc(o.name)}</h1>
      <p class="muted" style="margin:2px 0 0">${[KIND_LABEL[kind], when, kind === 'card' ? '' : o.location].filter(Boolean).map(esc).join(' · ')}</p></div>
    <div class="actions">
      ${canEdit() ? `<button class="btn" data-action="edit-occasion">${PENCIL} Edit</button>
      ${kind === 'email' ? `<button class="btn primary" data-action="invites" ${withEmail ? '' : 'disabled'}>${MAIL} Send emails…</button>` : ''}` : ''}
      ${kind !== 'email' ? `<button class="btn primary" data-action="print" ${onList.length ? '' : 'disabled'}>Print…</button>` : ''}
    </div>
  </div>
  <div class="stats">
    <div><b>${onList.length}</b><span>on the list</span></div>
    ${kind === 'email' ? `<div><b>${invited}</b><span>emailed</span></div>
    ${onList.length - withEmail ? `<div class="warn"><b>${onList.length - withEmail}</b><span>no email</span></div>` : ''}`
    : `<div><b>${mailed}</b><span>mailed</span></div>
    ${noAddr ? `<div class="warn"><b>${noAddr}</b><span>missing an address</span></div>` : ''}`}
  </div>
  <div class="filters">
    <div class="seg" role="group" aria-label="Show">
      ${[['all', 'Everyone'], ['on', 'On the list'], ['off', 'Not on the list'], ['unmailed', kind === 'email' ? 'Not emailed yet' : 'Not mailed yet']].map(([k, l]) => `<button type="button" data-action="occ-filter" data-filter="${k}" aria-pressed="${state.occFilter === k}">${l}</button>`).join('')}
    </div>
    <input type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-input="occ-search" placeholder="Search…" value="${val(state.occSearch)}" aria-label="Search">
    ${filterButton('occ')}
  </div>
  <div class="filter-chips" id="fchips-occ">${filterChipsHtml('occ')}</div>
  <div class="bulk small"><span data-shown></span>
    ${canEdit() ? `<button class="link" data-action="bulk-tag" data-add="1">Add all shown to the list</button>
    <button class="link" data-action="bulk-tag" data-add="">Remove all shown</button>` : ''}
  </div>
  <div class="panel tight"><table class="items rcpt kind-${kind}">
    <thead><tr><th style="width:44px"><span class="sr">On the list</span></th><th>Household</th><th>Greeting</th><th>${kind === 'email' ? 'People' : 'Address'}</th><th class="col-mailed">Mailed</th><th class="col-email">Email</th></tr></thead>
    <tbody id="rcpt-rows"></tbody></table></div>`;
}

function shownRecipients() {
  const tags = tagMap();
  return state.households.filter((h) => {
    const t = tags.get(h.id);
    if (state.occFilter === 'on' && !t) return false;
    if (state.occFilter === 'off' && t) return false;
    if (state.occFilter === 'unmailed' && (!t || (isEmailKind(state.occ?.occasion) ? t.invitedAt : t.mailedAt))) return false;
    return matchesFilter(h, state.filters.occ) && matchesSearch(h, state.occSearch);
  }).sort(byName);
}

// Who's in a household, for the occasion list: the greeting, else the people's first names.
function whoText(h) {
  if (h.greeting?.trim()) return h.greeting.trim();
  const names = splitMembers(h.members ?? []).map((m) => m.firstName).filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

// Emails: who in a household it goes to. The people ticked on the list, else the default contact.
function tagPeople(h, t) {
  if (!t) return [];
  const withEmail = (h.members ?? []).filter((m) => m.email);
  const ids = Array.isArray(t.to) ? t.to : [defaultPerson(h.members)?.id];
  return withEmail.filter((m) => ids.includes(m.id));
}
// The greeting the occasion's Greeting setting gives a household on the list. "The person's first
// name" uses the people it goes to; the others name the household however many people get it
// (send to Kim alone, greet "Kim and Jim").
function listGreeting(h, t) {
  const style = state.occ?.occasion?.greetStyle ?? 'informal';
  if (style !== 'person') return greetingFor(h, style);
  return joinNames(tagPeople(h, t).map((m) => m.firstName || personName(m))) || greetingFor(h, 'informal');
}
// One checkbox per person with an email address.
function peopleCell(h, t) {
  const people = (h.members ?? []).filter((m) => m.email);
  if (!people.length) return '<span class="muted">No email</span>';
  const on = new Set(tagPeople(h, t).map((m) => m.id));
  return `<div class="people-checks">${people.map((m) => `<label class="check" title="${esc(m.email)}"><input type="checkbox" data-action="tag-person" data-id="${esc(h.id)}" data-person="${esc(m.id)}" ${on.has(m.id) ? 'checked' : ''} ${canEdit() ? '' : 'disabled'}> ${esc(personName(m))}</label>`).join('')}</div>`;
}

function renderRecipientRows() {
  const el = document.getElementById('rcpt-rows');
  if (!el) return;
  const tags = tagMap();
  const list = shownRecipients();
  document.querySelector('[data-shown]').textContent = `${plural(list.length, 'household')} shown ·`;
  el.innerHTML = list.map((h) => {
    const t = tags.get(h.id);
    const email = allEmails(h).length;
    const emailKind = isEmailKind(state.occ?.occasion);
    const emailCell = !t ? '' : t.invitedAt ? `<span class="pill ok" title="${esc((t.invitedTo ?? []).join(', '))}">Sent ${fmtDate(t.invitedAt, { month: 'short', day: 'numeric' })}</span>`
      : t.inviteError ? `<span class="pill overdue" title="${esc(t.inviteError)}">Failed</span>`
        : email ? '<span class="muted small">Not sent</span>' : '<span class="muted small">No email</span>';
    return `<tr class="${t ? 'on' : ''}">
      <td><input type="checkbox" data-action="tag" data-id="${esc(h.id)}" ${t ? 'checked' : ''} ${canEdit() && (!emailKind || email) ? '' : 'disabled'} aria-label="${esc(h.labelName)} on the list"></td>
      <td><button class="link-btn" data-action="edit-household" data-id="${esc(h.id)}">${esc(h.labelName)}</button>${h.pendingUpdate ? ' <span class="pill due-soon">New address</span>' : ''}</td>
      <td class="col-greeting small">${esc(emailKind && t ? listGreeting(h, t) : whoText(h))}</td>
      <td class="small">${emailKind ? peopleCell(h, t)
    : [esc(addressLines('', h.address).join(', ')), addressProblem(h.address) && `<span class="pill unknown">${esc(addressProblem(h.address))}</span>`].filter(Boolean).join(' ')}</td>
      <td class="col-mailed">${t ? `<input type="checkbox" data-action="mailed" data-id="${esc(h.id)}" ${t.mailedAt ? 'checked' : ''} ${canEdit() ? '' : 'disabled'} aria-label="Mailed">` : ''}</td>
      <td class="col-email">${emailCell}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No households match.</td></tr>';
}

async function setTags(add, remove) {
  const res = await api(`/occasions/${state.occasionId}/tags`, { method: 'PUT', body: { add, remove } });
  state.occ.tags = res.tags;
}

async function setMailed(ids, mailed) {
  for (let i = 0; i < ids.length; i += 1000) {
    const res = await api(`/occasions/${state.occasionId}/mailed`, { method: 'POST', body: { householdIds: ids.slice(i, i + 1000), mailed } });
    state.occ.tags = res.tags;
  }
}

// Which greeting goes on the first line of labels and envelopes.
function nameStyleOptions(current) {
  const style = ['formal', 'informal'].includes(current) ? current : 'label';
  return [['label', 'Household Greeting'], ['formal', 'Formal Greeting'], ['informal', 'Informal Greeting']]
    .map(([v, l]) => `<option value="${v}" ${style === v ? 'selected' : ''}>${l}</option>`).join('');
}

function occasionModal(o) {
  const isNew = !o;
  o ??= { kind: 'card', nameStyle: 'label', invite: {} };
  const kind = kindOf(o);
  const copyable = state.occasions.filter((x) => x.counts.tagged);
  openModal(isNew ? 'New occasion' : 'Edit occasion', `
    <label>Name<input name="name" required maxlength="120" value="${val(o.name)}" placeholder="Christmas cards ${new Date().getFullYear()}"></label>
    <div class="grid-3">
      <label>Type<select name="kind" data-occ-kind>${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label data-kinds="invite email" ${kind === 'card' ? 'hidden' : ''}>Date <span class="muted">(optional)</span><input type="date" name="date" value="${val(o.date)}"></label>
      <label data-kinds="invite email" ${kind === 'card' ? 'hidden' : ''}>Time <span class="muted">(optional)</span><input name="time" maxlength="40" value="${val(o.time)}" placeholder="7:00 PM"></label>
    </div>
    <label data-kinds="invite email" ${kind === 'card' ? 'hidden' : ''}>Location <span class="muted">(optional)</span><input name="location" maxlength="300" value="${val(o.location)}"></label>
    <label data-kinds="card invite" ${kind === 'email' ? 'hidden' : ''}>Greeting Style<select name="nameStyle">
      ${nameStyleOptions(o.nameStyle)}</select></label>
    <div data-kinds="invite" ${kind === 'invite' ? '' : 'hidden'}><button type="button" class="btn" data-action="design-from-edit">${BRUSH} Design invitation…</button></div>
    <div data-kinds="email" ${kind === 'email' ? '' : 'hidden'}><button type="button" class="btn" data-action="design-from-edit">${BRUSH} Design email…</button></div>
    <label data-kinds="invite email" ${kind === 'card' ? 'hidden' : ''}><span data-kinds="invite" ${kind === 'invite' ? '' : 'hidden'}>Invitation Greeting</span><span data-kinds="email" ${kind === 'email' ? '' : 'hidden'}>Email Greeting</span><select name="greetStyle">
      ${[['informal', 'Informal Greeting'], ['formal', 'Formal Greeting'], ['household', 'Household Greeting'], ['person', "The person's first name"]]
    .map(([k, l]) => `<option value="${k}" ${k === 'person' ? `data-kinds="email" ${kind === 'email' ? '' : 'hidden disabled'}` : ''} ${(o.greetStyle ?? 'informal') === k && !(k === 'person' && kind !== 'email') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label data-kinds="email" ${kind === 'email' ? '' : 'hidden'}>Email subject<input name="subject" maxlength="200" value="${val(o.invite?.subject)}" placeholder="You're invited: ${val(o.name) || 'our holiday open house'}"></label>
    ${isNew && copyable.length ? `<label>Start with the list from <span class="muted">(optional)</span><select name="copyFrom"><option value="">Nobody yet</option>
      ${copyable.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${x.counts.tagged})</option>`).join('')}</select></label>` : ''}
    <label>Notes<textarea name="notes" rows="2" maxlength="2000">${esc(o.notes ?? '')}</textarea></label>`, {
    form: isNew ? 'occasion-new' : 'occasion-edit',
    base: isNew ? '' : o.updatedAt ?? '',
    wide: true,
    foot: `<div class="left-actions">${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-occasion">Delete</button>'}</div>
      <div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">${isNew ? 'Create' : 'Save'}</button></div>`,
  });
}

// thenDesign: the Design button on this screen saves the occasion first, then opens the design window.
async function saveOccasion(form, { thenDesign = false } = {}) {
  const f = form.elements;
  const dated = f.kind.value !== 'card'; // cards and labels have no date, time or place
  const body = {
    name: f.namedItem('name').value.trim(), kind: f.kind.value,
    date: dated ? f.date.value : '', time: dated ? f.time.value.trim() : '', location: dated ? f.location.value.trim() : '',
    nameStyle: f.nameStyle.value, greetStyle: f.greetStyle.value, notes: f.notes.value.trim(),
    // The plain message from earlier versions is kept; designs are saved from the design window.
    invite: { subject: f.subject.value.trim(), message: (form.dataset.form === 'occasion-new' ? '' : state.occ?.occasion?.invite?.message) || undefined },
    copyFrom: f.copyFrom?.value || undefined,
  };
  if (!body.name) return modalError('Give the occasion a name.');
  const isNew = form.dataset.form === 'occasion-new';
  await withBusy(form.querySelector('.btn.primary'), async () => {
    let res;
    try {
      res = isNew ? await api('/occasions', { method: 'POST', body }) : await api(`/occasions/${state.occasionId}`, { method: 'PUT', body: { ...body, baseUpdatedAt: form.dataset.base || null } });
    } catch (err) {
      return resolveConflict(err, 'occasion', {
        saveMine: async (theirs) => { form.dataset.base = theirs.updatedAt ?? ''; return saveOccasion(form, { thenDesign }); },
        loadTheirs: async (theirs) => { await openOccasion(state.occasionId); await refreshOccasions(); render(); occasionModal(theirs); toast('Showing their version'); },
      });
    }
    await refreshOccasions();
    closeModal();
    state.view = 'occasions';
    if (isNew) { state.occFilter = res.copied ? 'on' : 'all'; state.occSearch = ''; }
    await openOccasion(res.occasion.id);
    render();
    if (thenDesign) { designModal(); return; }
    toast(isNew ? (res.copied ? `Created with ${plural(res.copied, 'household')} from the earlier list` : 'Created. Tick who it\'s for.') : 'Saved');
  });
}

// ---------- printing ----------
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
let jspdfLoad = null;
async function getJsPDF() {
  jspdfLoad ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = JSPDF_URL;
    el.onload = resolve;
    el.onerror = () => { jspdfLoad = null; reject(new Error('Could not load the PDF tools. Check your connection and try again.')); };
    document.head.appendChild(el);
  });
  await jspdfLoad;
  return window.jspdf.jsPDF;
}

function returnLines() {
  const p = state.me?.profile ?? {};
  const name = p.returnName || [p.firstName, p.lastName].filter(Boolean).join(' ');
  return isMailable(p.returnAddress) ? addressLines(name, p.returnAddress) : [];
}

let lastPrinted = [];

// ---------- printing ----------
// First what to print (invitations, addresses or return addresses), then what to print it on; only
// the stock that suits that choice is offered. Invitations print in a new tab through the browser's
// print dialog; addresses and return addresses are made as a PDF. Tips live on the help page.
const PRINT_MEDIA = {
  invitations: Object.entries(INVITE_MEDIA).map(([k, m]) => [k, m.name]),
  addresses: [['avery5160', LABEL_SHEETS.avery5160.name], ['a2', ENVELOPES.a2.name], ['a7', ENVELOPES.a7.name]],
  return: [['avery5160', LABEL_SHEETS.avery5160.name]],
};
// Printing follows the occasion: its Greeting Style for the first line of addresses, and its
// Invitation Greeting for the greeting inside each invitation.
const inviteGreetStyle = (o) => (['formal', 'household'].includes(o?.greetStyle) ? o.greetStyle : 'informal');
const isEnvelope = (media) => Boolean(ENVELOPES[media]);

// The last stock chosen for each kind of printing (this browser only).
function printPrefs() { try { return JSON.parse(localStorage.getItem('oab.print') || '{}'); } catch { return {}; } }
function savePrintPref(prefs) { try { localStorage.setItem('oab.print', JSON.stringify({ ...printPrefs(), ...prefs })); } catch { /* not saved */ } }

function printModal() {
  const o = state.occ.occasion;
  const tags = tagMap();
  const unmailed = [...tags.values()].filter((t) => !t.mailedAt).length;
  const hasReturn = returnLines().length > 0;
  const invite = kindOf(o) === 'invite';
  const designed = Boolean(o.design?.html);
  const whatChoice = (value, label, { checked = false, disabled = false } = {}) => `<label><input type="radio" name="what" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${label}</span></label>`;
  openModal('Print', `
    <div class="print-what"><span class="field-label">Print</span><div class="seg fp-seg" role="radiogroup" aria-label="Print">
      ${invite ? whatChoice('invitations', 'Invitations', { checked: designed, disabled: !designed }) : ''}
      ${whatChoice('addresses', 'Addresses', { checked: !(invite && designed) })}
      ${whatChoice('return', 'Return addresses', { disabled: !hasReturn })}
    </div></div>
    ${invite && !designed ? '<p class="small muted" style="margin:0">Design the invitation (Edit › Design invitation…) to print it.</p>' : ''}
    ${!hasReturn ? '<p class="small muted" style="margin:0">Return addresses: set yours in Settings first.</p>' : ''}
    <label>Print on<select name="media"></select></label>
    <div class="grid-2" data-for="who">
      <label>Who<select name="who">
        <option value="unmailed">Not mailed yet (${unmailed})</option>
        <option value="all">Everyone on the list (${tags.size})</option>
        <option value="shown">On the list and shown below (${shownRecipients().filter((h) => tags.has(h.id)).length})</option></select></label>
      <label>Order<select name="order"><option value="name">By last name</option><option value="zip">By ZIP code</option></select></label>
    </div>
    <div class="print-what" data-for="orient"><span class="field-label">Orientation</span><div class="seg fp-seg" role="radiogroup" aria-label="Orientation">
      <label><input type="radio" name="orient" value="portrait" ${printPrefs().orient === 'landscape' ? '' : 'checked'}><span>Portrait</span></label>
      <label><input type="radio" name="orient" value="landscape" ${printPrefs().orient === 'landscape' ? 'checked' : ''}><span>Landscape</span></label>
    </div></div>
    <label data-for="start">Start on label number<input name="start" type="number" min="1" max="30" value="1" style="max-width:110px"></label>
    <label class="check" data-for="back"><input type="checkbox" name="withBack" checked> Print the address on the back</label>
    <label class="check" data-for="ret"><input type="checkbox" name="withReturn" ${hasReturn ? 'checked' : 'disabled'}> Return address in the corner</label>
    <label class="check" data-for="outline"><input type="checkbox" name="outline"> Draw outlines (test print on plain paper)</label>
    <div data-after hidden class="notice"></div>`, {
    form: 'print',
    foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button><button class="btn primary">Make PDF</button></div>',
  });
  syncPrintForm({ whatChanged: true });
}

// Shows what applies to the current choices. whatChanged: refill "Print on" and the greeting default.
function syncPrintForm({ whatChanged = false } = {}) {
  const form = modal.querySelector('form');
  const f = form.elements;
  const what = f.what.value || 'addresses';
  if (whatChanged) {
    const options = PRINT_MEDIA[what];
    const keep = options.some(([k]) => k === f.media.value) ? f.media.value : printPrefs()[what];
    f.media.innerHTML = options.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    f.media.value = options.some(([k]) => k === keep) ? keep : options[0][0];
  }
  const media = f.media.value;
  const postcard = what === 'invitations' && INVITE_MEDIA[media]?.postcard;
  const show = (k, on) => { form.querySelector(`[data-for=${k}]`).hidden = !on; };
  show('who', what !== 'return');
  show('orient', what === 'invitations');
  show('start', media === 'avery5160');
  show('back', Boolean(postcard));
  show('ret', (what === 'addresses' && isEnvelope(media)) || Boolean(postcard && f.withBack.checked));
  show('outline', media === 'avery5160' || isEnvelope(media) || media === 'avery8387');
  form.querySelector('.modal-foot .btn.primary').textContent = what === 'invitations' ? 'Print invitations' : 'Make PDF';
}

function chosenHouseholds(f, { needAddress }) {
  const tags = tagMap();
  const byId = hhById();
  const shownIds = new Set(shownRecipients().map((h) => h.id));
  let households = [...tags.values()]
    .filter((t) => f.who.value === 'all' || (f.who.value === 'unmailed' ? !t.mailedAt : shownIds.has(t.householdId)))
    .map((t) => byId.get(t.householdId)).filter(Boolean);
  const skipped = needAddress ? households.filter((h) => !isMailable(h.address)) : [];
  if (needAddress) households = households.filter((h) => isMailable(h.address));
  households.sort(f.order.value === 'zip'
    ? (a, b) => String(a.address?.zip ?? '').localeCompare(String(b.address?.zip ?? '')) || byName(a, b)
    : byName);
  return { households, skipped };
}

// The first line of an address: the occasion's Greeting Style, falling back to the Household Greeting.
const addressName = (h, o) => envelopeName({ ...h, formalName: effectiveFormalName(h) }, o.nameStyle);

function skippedToast(skipped) {
  if (skipped.length) toast(`Skipped ${plural(skipped.length, 'household')} with no complete address: ${skipped.slice(0, 3).map((h) => h.labelName).join(', ')}${skipped.length > 3 ? '…' : ''}`, true);
}

function showAfterPrint(message) {
  const after = modal.querySelector('[data-after]');
  after.hidden = false;
  after.innerHTML = `<span>${message}${lastPrinted.length && canEdit() ? ` Once they're in the mail, mark ${plural(lastPrinted.length, 'household')} as mailed.` : ''}</span>
    ${lastPrinted.length && canEdit() ? '<button type="button" class="btn sm primary" data-action="mark-printed">Mark mailed</button>' : ''}`;
}

// Printed invitations: the design filled in for each household, one card per cell of the chosen
// stock. On postcards the back can carry the address, each sheet's back following its front and
// laid out so every address lands behind its own invitation (two-sided, flip on long edge).
async function printInvitations(form) {
  const f = form.elements;
  const o = state.occ.occasion;
  const media = INVITE_MEDIA[f.media.value] ?? INVITE_MEDIA.avery8387;
  const backs = Boolean(media.postcard && f.withBack.checked);
  const { households, skipped } = chosenHouseholds(f, { needAddress: backs });
  if (!households.length) return modalError(skipped.length ? 'Nobody chosen has a complete mailing address for the back.' : 'Nobody to print for.');
  if (!o.design?.html) return modalError('Design the invitation first.');
  const win = window.open('', '_blank'); // opened right away so the browser doesn't block it
  if (!win) return modalError('Your browser blocked the new tab. Allow pop-ups for this site and try again.');
  skippedToast(skipped);
  const layout = inviteLayout(media, f.orient.value);
  const [cw, ch] = layout.card;
  const ret = backs && f.withReturn.checked ? returnLines() : [];
  // Content drawn the other way round from its place is turned a quarter to fit it.
  const place = (html, turn, cls = '') => (turn
    ? `<div class="turned ${cls}" style="width:${ch}in;height:${cw}in;transform:translate(${cw}in,0) rotate(90deg)">${html}</div>`
    : `<div class="upright ${cls}">${html}</div>`);
  const front = (h) => place(renderDesign(o.design, fieldValues({ occasion: o, greeting: greetingFor(h, inviteGreetStyle(o)), fromName: fromName() }), { padding: `${media.pad}in` }), layout.rotateFront);
  // The address side always runs along the card's long side.
  const back = (h) => place(`${ret.length ? `<div class="ret">${ret.map(esc).join('<br>')}</div>` : ''}
      <div class="to">${addressLines(addressName(h, o), h.address).map(esc).join('<br>')}</div>`, cw < ch, 'back');
  const pages = invitePages(households.length, media, { backs }).map((pg) => `<section class="sheet">${pg.cells.map((i, c) => {
    const x = (c % media.cols) * cw;
    const y = Math.floor(c / media.cols) * ch;
    const body = i === null ? '' : pg.side === 'front' ? front(households[i]) : back(households[i]);
    return `<div class="cell${f.outline.checked ? ' outlined' : ''}" style="left:${x}in;top:${y}in">${body}</div>`;
  }).join('')}</section>`).join('');
  const link = fontLink(o.design);
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.name)} - invitations</title>
    ${link ? `<link rel="stylesheet" href="${esc(link)}">` : ''}
    <style>
      @page { size: ${layout.sheet[0]}in ${layout.sheet[1]}in; margin: 0; }
      html, body { margin: 0; }
      .sheet { position: relative; width: ${layout.sheet[0]}in; height: ${layout.sheet[1]}in; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
      .sheet:last-child { break-after: auto; page-break-after: auto; }
      .cell { position: absolute; width: ${cw}in; height: ${ch}in; overflow: hidden; box-sizing: border-box; }
      .cell.outlined { outline: 1px dashed #9a9a9a; outline-offset: -1px; }
      .turned { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
      .upright { position: absolute; inset: 0; }
      .turned > .design, .upright > .design { height: 100%; box-sizing: border-box; }
      .design p { margin: 0 0 12px; }
      .design img { max-width: 100%; height: auto; }
      .back { font-family: Helvetica, Arial, sans-serif; color: #000; }
      .back .ret { position: absolute; left: 0.3in; top: 0.3in; max-width: 45%; font-size: 8pt; line-height: 1.25; }
      .back .to { position: absolute; left: 46%; top: 47%; transform: translateY(-50%); max-width: 50%; font-size: 12pt; line-height: 1.3; overflow-wrap: anywhere; }
      @media screen { body { background: #8a8a8a; padding: 16px 0; } .sheet { margin: 0 auto 16px; box-shadow: 0 2px 10px rgba(0,0,0,.35); } }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style></head><body>${pages}</body></html>`);
  win.document.close();
  lastPrinted = households.map((h) => h.id);
  showAfterPrint(`${plural(households.length, 'invitation')} opened in a new tab.`);
  // Print once the fonts and pictures have loaded.
  await win.document.fonts?.ready.catch(() => {});
  await Promise.all([...win.document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  win.focus();
  win.print();
  return undefined;
}

async function makePdf(form) {
  const f = form.elements;
  const what = f.what.value;
  const media = f.media.value;
  savePrintPref({ [what]: media, ...(what === 'invitations' ? { orient: f.orient.value } : {}) });
  if (what === 'invitations') return printInvitations(form);
  const print = state.me?.profile?.print ?? {};
  const outline = f.outline.checked;
  await withBusy(form.querySelector('.modal-foot .btn.primary'), async () => {
    const JsPDF = await getJsPDF();
    let doc;
    let households = [];
    if (what === 'return') {
      const lines = returnLines();
      if (!lines.length) throw new Error('Set your return address in Settings first.');
      doc = buildLabels(JsPDF, Array(31 - Number(f.start.value || 1)).fill(lines), {
        start: Number(f.start.value) || 1, offsetX: print.labelOffsetX, offsetY: print.labelOffsetY, outline,
      });
    } else {
      const chosen = chosenHouseholds(f, { needAddress: true });
      households = chosen.households;
      if (!households.length) throw new Error(chosen.skipped.length ? 'Nobody chosen has a complete mailing address.' : 'Nobody to print for.');
      const items = households.map((h) => addressLines(addressName(h, state.occ.occasion), h.address));
      doc = isEnvelope(media)
        ? buildEnvelopes(JsPDF, items, {
          envelope: media, returnLines: f.withReturn.checked ? returnLines() : [], offsetX: print.envelopeOffsetX, offsetY: print.envelopeOffsetY, outline,
        })
        : buildLabels(JsPDF, items, { start: Number(f.start.value) || 1, offsetX: print.labelOffsetX, offsetY: print.labelOffsetY, outline });
      skippedToast(chosen.skipped);
    }
    const url = doc.output('bloburl');
    const win = window.open(url, '_blank');
    lastPrinted = households.map((h) => h.id);
    showAfterPrint(win ? 'The PDF opened in a new tab.' : `<a href="${url}" target="_blank" rel="noopener">Open the PDF</a> (your browser blocked the new tab).`);
  });
  return undefined;
}

// ---------- design window (Invitations and Emails) ----------
// A small word processor: fonts, sizes, colors, alignment, lists, pictures and fill-in fields
// ({{greeting}} and friends, as plain text so they take the formatting around them), or HTML pasted
// in. The API cleans it on save.
const FONT_SIZES = [['2', 'Small'], ['3', 'Normal'], ['4', 'Large'], ['5', 'Larger'], ['6', 'Huge']];
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
let designRange = null; // the editor selection, kept while the toolbar has focus

function designHtml(editor) {
  const copy = editor.cloneNode(true);
  copy.querySelectorAll('.selected, .line-selected').forEach((el) => el.classList.remove('selected', 'line-selected'));
  return copy.innerHTML.replace(/ class=""/g, '');
}

function loadFont(design) {
  const href = fontLink(design);
  if (!href || document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}
// All web fonts, so the font list shows each one in its own face.
function loadAllFonts() {
  loadFont({ html: FONTS.filter((f) => f.web).map((f) => f.stack).join(' '), font: '' });
}

function designModal() {
  const o = state.occ.occasion;
  const d = { ...DESIGN_DEFAULTS, ...(o.design ?? {}) };
  const html = o.design?.html ?? starterHtml(o.invite?.message);
  loadAllFonts();
  // One font picker and one text color: with words selected they change those words; with nothing
  // selected they change the whole design's font or text color.
  const colorInput = (name, value, label, title, extra = '') => `<span class="tb-swatch" ${extra}><span class="tb-label">${label}</span><button type="button" class="tb-color" data-color-for="${name}" title="${title}" aria-label="${title}" aria-haspopup="dialog" style="background:${esc(value)}"></button><input type="color" name="${name}" value="${esc(value)}" data-design="${name}" class="native-color" tabindex="-1" aria-hidden="true"></span>`;
  openModal(kindOf(o) === 'email' ? 'Email Designer' : 'Invitation Designer', `
    <div class="design-toolbar" role="toolbar" aria-label="Formatting">
      <span class="tb-group">
        <button type="button" class="tb" data-history="undo" title="Undo (⌘Z)" aria-label="Undo" disabled>${UNDO_ICON}</button>
        <button type="button" class="tb" data-history="redo" title="Redo (⇧⌘Z)" aria-label="Redo" disabled>${REDO_ICON}</button>
      </span>
      <select data-design="font" aria-label="Font" title="Font">${FONTS.map((f) => `<option value="${f.key}" ${f.key === d.font ? 'selected' : ''} style="font-family:${esc(f.stack)}">${esc(f.label)}</option>`).join('')}</select>
      <select data-design="fontSize" aria-label="Size" title="Size"><option value="">Size</option>${FONT_SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <span class="tb-group">
        <button type="button" class="tb" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button>
        <button type="button" class="tb" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button>
        <button type="button" class="tb" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>
      </span>
      ${colorInput('color', d.color, 'Text', 'Text color')}
      <span class="tb-group">
        <button type="button" class="tb" data-cmd="justifyLeft" title="Align left" aria-label="Align left">${ALIGN('l')}</button>
        <button type="button" class="tb" data-cmd="justifyCenter" title="Center" aria-label="Center">${ALIGN('c')}</button>
        <button type="button" class="tb" data-cmd="justifyRight" title="Align right" aria-label="Align right">${ALIGN('r')}</button>
      </span>
      <button type="button" class="tb" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">•≡</button>
      <span class="tb-break"></span>
      <select data-design="field" aria-label="Insert a fill-in field" title="Insert a fill-in field"><option value="">Insert field</option>${DESIGN_FIELDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <button type="button" class="tb" data-insert-line title="Insert a line">${LINE_ICON} <span>Line</span></button>
      <label class="tb tb-pic" title="Insert a picture">${PICTURE} <span>Picture</span><input type="file" accept="${PICTURE_TYPES.join(',')}" data-design-picture hidden></label>
      <span class="tb-spacer"></span>
      ${colorInput('background', d.background, 'Background', 'Background color')}
      <label class="tb-swatch"><span class="tb-label">Border</span><select data-design="border" aria-label="Border">${BORDERS.map((x) => `<option value="${x.key}" ${x.key === d.border ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      ${colorInput('borderColor', d.borderColor, 'Border color', 'Border color', `data-border-color ${d.border === 'none' ? 'hidden' : ''}`)}
      <button type="button" class="tb" data-design-html aria-pressed="false" title="Edit or paste HTML">&lt;/&gt;</button>
    </div>
    <div class="color-pop" data-color-pop hidden role="dialog" aria-label="Choose a color"></div>
    <div class="design-imgbar" data-design-linebar hidden>
      <span class="small muted">Line</span>
      <select data-line-type aria-label="Line style">${LINE_STYLES.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
        <optgroup label="Calligraphy">${FLOURISHES.map((f) => `<option value="${f.key}">${esc(f.label.replace(' flourish', ''))}</option>`).join('')}</optgroup></select>
      ${colorInput('lineColor', d.borderColor, 'Color', 'Line color')}
      <span class="imgbar-sep"></span>
      <span class="small muted">Length</span>
      ${[['25%', 'Short'], ['50%', 'Medium'], ['75%', 'Long'], ['100%', 'Full width']].map(([w, l]) => `<button type="button" class="btn sm" data-line-width="${w}" aria-pressed="false">${l}</button>`).join('')}
      <button type="button" class="btn sm danger" data-line-remove>Remove</button>
    </div>
    <div class="design-imgbar" data-design-imgbar hidden>
      <span class="small muted">Place</span>
      ${[['left', 'Left, text beside'], ['center', 'Centered'], ['right', 'Right, text beside'], ['inline', 'In the line']].map(([k, l]) => `<button type="button" class="btn sm" data-img-place="${k}" aria-pressed="false">${l}</button>`).join('')}
      <span class="imgbar-sep"></span>
      <span class="small muted">Size</span>
      ${[['25%', 'Small'], ['50%', 'Medium'], ['75%', 'Large'], ['100%', 'Full width']].map(([w, l]) => `<button type="button" class="btn sm" data-img-width="${w}">${l}</button>`).join('')}
      <span class="imgbar-sep"></span>
      <span class="imgbar-group"><span class="small muted">Border</span>
      <select data-img-border aria-label="Picture border"><option value="none">None</option>${LINE_STYLES.map(([k, l]) => `<option value="${k}">${esc(k === 'rounded' ? 'Rounded corners' : l)}</option>`).join('')}</select>
      ${colorInput('imgBorderColor', d.borderColor, 'Color', 'Picture border color', 'data-img-border-color hidden')}</span>
      <button type="button" class="btn sm danger" data-img-remove>Remove</button>
    </div>
    <div class="design-stage">
      <div class="design-canvas" data-design-canvas data-font="${esc(d.font)}" data-color="${esc(d.color)}" style="background:${esc(d.background)};color:${esc(d.color)};font-family:${esc(fontByKey(d.font).stack)}">
        <div class="design-edit" contenteditable="true" spellcheck="true" data-design-edit aria-label="Design">${(html)}</div>
      </div>
      <textarea class="design-src" data-design-src hidden spellcheck="false" aria-label="HTML"></textarea>
      <div class="design-preview" data-design-preview-pane hidden>
        <div class="preview-nav">
          <button type="button" class="btn ghost sm" data-preview-step="-1" aria-label="Previous household">‹</button>
          <span data-preview-pos></span>
          <button type="button" class="btn ghost sm" data-preview-step="1" aria-label="Next household">›</button>
        </div>
        <div data-preview-body></div>
      </div>
    </div>`, {
    form: 'design', wide: 'xl', base: o.design?.updatedAt ?? '',
    foot: `<div class="left-actions"><button type="button" class="btn btn-preview" data-design-preview aria-pressed="false" title="See it filled in for each household">${EYE_ICON} Preview</button></div><div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">Save design</button></div>`,
  });
  try { document.execCommand('styleWithCSS', false, true); } catch { /* older browsers */ }
  const editor = modal.querySelector('[data-design-edit]');
  editor.focus();
  wireDesign(editor);
}

// Colors offered in the color window: classic invitation colors.
const PALETTE = ['#000000', '#1d2125', '#4b5563', '#9ca3af', '#ffffff', '#fdf6e3', '#f5e6c8', '#c9a227', '#b8860b', '#7f1d1d',
  '#9f1239', '#dc2626', '#f472b6', '#ea580c', '#facc15', '#14532d', '#16a34a', '#0f766e', '#1e3a8a', '#2563eb', '#7c3aed', '#78350f'];
const EYE_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const LINE_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 4.5h4M2 11.5h7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".45"/></svg>';
// Divider lines: the same styles as the page border (drawn by mail apps), plus calligraphy flourishes
// (drawn here and saved as pictures).
const LINE_STYLES = [['thin', 'Thin line'], ['thick', 'Thick line'], ['double', 'Double line'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['rounded', 'Rounded'], ['groove', 'Engraved']];
const LINE_CSS = { thin: '1px solid', thick: '4px solid', double: '5px double', dashed: '2px dashed', dotted: '3px dotted', groove: '6px groove' };
const UPLOAD_ICON = '<svg class="dz-icon" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const UNDO_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3M2.75 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const REDO_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="m10.5 3.5 3 3-3 3M13.25 6.5h-6.5a4 4 0 0 0 0 8H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ALIGN = (w) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${{ l: 'M2 3h12M2 6.5h8M2 10h12M2 13.5h8', c: 'M2 3h12M4 6.5h8M2 10h12M4 13.5h8', r: 'M2 3h12M6 6.5h8M2 10h12M6 13.5h8' }[w]}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const PICTURE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="6.25" r="1.25" fill="currentColor"/><path d="m2.5 12 3.8-3.8 2.4 2.4 1.8-1.8L13.5 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

function wireDesign(editor) {
  const canvas = modal.querySelector('[data-design-canvas]');
  const src = modal.querySelector('[data-design-src]');
  const imgbar = modal.querySelector('[data-design-imgbar]');
  let picked = null; // the picture being resized

  const keepRange = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) designRange = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    editor.focus();
    if (!designRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(designRange);
  };
  const exec = (cmd, value = null) => { restore(); document.execCommand(cmd, false, value); keepRange(); };
  const hasSelection = () => Boolean(designRange && !designRange.collapsed && editor.contains(designRange.commonAncestorContainer));

  // Undo / redo: the app keeps its own history of the whole design (text, pictures, font, colors), so
  // every change can be undone, not just typing. Typing is grouped into one step per pause.
  const bgInput = modal.querySelector('[name=background]');
  const colorIn = modal.querySelector('[data-design=color]');
  const fontSel = modal.querySelector('[data-design=font]');
  const undoBtn = modal.querySelector('[data-history=undo]');
  const redoBtn = modal.querySelector('[data-history=redo]');
  const borderSel = modal.querySelector('[data-design=border]');
  const borderColor = modal.querySelector('[name=borderColor]');
  // The page border, drawn like the finished design: a frame a little inside the edge.
  const applyBorder = () => {
    const b = borderByKey(borderSel.value);
    modal.querySelector('[data-border-color]').hidden = !b.css;
    canvas.style.padding = b.css ? '16px' : '';
    editor.style.border = b.css ? `${b.css} ${borderColor.value}` : '';
    editor.style.borderRadius = b.radius ?? '';
    editor.style.padding = b.css ? '16px' : '';
  };
  applyBorder();
  const snap = () => ({ html: editor.innerHTML.replace(/ class="(line-)?selected"/g, ''), font: canvas.dataset.font, color: canvas.dataset.color, background: bgInput.value, border: borderSel.value, borderColor: borderColor.value });
  const same = (a, b) => ['html', 'font', 'color', 'background', 'border', 'borderColor'].every((k) => a[k] === b[k]);
  const history = [snap()];
  let at = 0;
  let pending = null;
  const syncHistory = () => { undoBtn.disabled = at === 0; redoBtn.disabled = at === history.length - 1; };
  const record = () => {
    clearTimeout(pending); pending = null;
    const now = snap();
    if (same(now, history[at])) return;
    history.splice(at + 1, Infinity, now);
    if (history.length > 200) history.shift();
    at = history.length - 1;
    syncHistory();
  };
  const recordSoon = () => { clearTimeout(pending); pending = setTimeout(record, 500); };
  const apply = (s) => {
    editor.innerHTML = s.html;
    canvas.dataset.font = s.font; canvas.style.fontFamily = fontByKey(s.font).stack; fontSel.value = s.font;
    canvas.dataset.color = s.color; canvas.style.color = s.color; colorIn.value = s.color;
    bgInput.value = s.background; canvas.style.background = s.background;
    borderSel.value = s.border; borderColor.value = s.borderColor; applyBorder();
    for (const [n, v] of [['color', s.color], ['background', s.background], ['borderColor', s.borderColor]]) {
      const sw = modal.querySelector(`[data-color-for="${n}"]`); if (sw) sw.style.background = v;
    }
    pick(null); pickLine(null);
    designRange = null;
    syncHistory();
  };
  const step = (dir) => {
    if (pending) record(); // finish the step being typed
    const to = at + dir;
    if (to < 0 || to >= history.length) return;
    at = to;
    apply(history[at]);
    editor.focus();
  };
  modal.querySelector('.design-toolbar').addEventListener('click', (e) => {
    const h = e.target.closest('[data-history]');
    if (h) step(h.dataset.history === 'undo' ? -1 : 1);
  });
  editor.addEventListener('input', recordSoon);
  editor.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
    else if (k === 'y') { e.preventDefault(); step(1); }
  });
  // Fields and pictures go in at the caret as real nodes (insertHTML splits paragraphs around chips).
  const insertNode = (html) => {
    restore();
    const sel = window.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const frag = range.createContextualFragment(html);
    const last = frag.lastChild;
    range.insertNode(frag);
    range.setStartAfter(last); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    keepRange();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  editor.addEventListener('keyup', keepRange);
  editor.addEventListener('mouseup', keepRange);
  editor.addEventListener('input', keepRange);

  // Where a picture sits. Floats (with the align attribute for Outlook) are what mail apps understand;
  // free positioning anywhere on the page doesn't survive email, so pictures are dragged within the text.
  const PLACES = {
    left: { float: 'left', display: '', margin: '0 16px 12px 0', align: 'left' },
    right: { float: 'right', display: '', margin: '0 0 12px 16px', align: 'right' },
    center: { float: '', display: 'block', margin: '12px auto', align: '' },
    inline: { float: '', display: '', margin: '', align: '' },
  };
  const placeOf = (img) => (img.style.float === 'left' ? 'left' : img.style.float === 'right' ? 'right' : img.style.display === 'block' ? 'center' : 'inline');
  const place = (img, where) => {
    const p = PLACES[where];
    img.style.float = p.float; img.style.display = p.display; img.style.margin = p.margin;
    if (p.align) img.setAttribute('align', p.align); else img.removeAttribute('align');
  };
  const showPlace = (img) => imgbar.querySelectorAll('[data-img-place]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.imgPlace === placeOf(img))));

  // A picture's border: the same styles as lines, in any color (through the color window).
  const imgBorderSel = imgbar.querySelector('[data-img-border]');
  const imgBorderColor = modal.querySelector('[name=imgBorderColor]');
  const imgBorderOf = (img) => {
    if (!img.style.borderStyle || img.style.borderStyle === 'none') return 'none';
    if (img.style.borderRadius) return 'rounded';
    const st = img.style.borderStyle; const w = parseFloat(img.style.borderWidth) || 1;
    return st === 'double' ? 'double' : st === 'dashed' ? 'dashed' : st === 'dotted' ? 'dotted' : st === 'groove' ? 'groove' : w >= 3 ? 'thick' : 'thin';
  };
  function showImgBorder(img) {
    const style = imgBorderOf(img);
    imgBorderSel.value = style;
    if (style !== 'none') imgBorderColor.value = toHexColor(img.style.borderColor) || imgBorderColor.value;
    modal.querySelector('[data-img-border-color]').hidden = style === 'none';
    modal.querySelector('[data-color-for=imgBorderColor]').style.background = imgBorderColor.value;
  }
  function setImgBorder(img, style, color) {
    img.style.border = ''; img.style.borderRadius = '';
    if (style === 'rounded') { img.style.border = `3px solid ${color}`; img.style.borderRadius = '14px'; }
    else if (LINE_CSS[style]) img.style.border = `${LINE_CSS[style]} ${color}`;
    showImgBorder(img);
    record();
  }
  imgBorderSel.addEventListener('change', () => { if (picked) setImgBorder(picked, imgBorderSel.value, imgBorderColor.value); });

  const pick = (img) => {
    editor.querySelectorAll('img.selected').forEach((i) => i.classList.remove('selected'));
    picked = img;
    img?.classList.add('selected');
    imgbar.hidden = !img;
    if (img) { showImgBorder(img); showPlace(img); }
  };
  editor.addEventListener('click', (e) => {
    const line = e.target.closest('hr, img');
    if (line && lineTypeOf(line)) { pick(null); pickLine(line); return; }
    pickLine(null);
    pick(e.target.closest('img'));
  });

  // ---- divider lines ----
  const linebar = modal.querySelector('[data-design-linebar]');
  const lineColorIn = modal.querySelector('[name=lineColor]');
  let line = null; // the line being edited
  const toHexColor = (c) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c ?? '');
    return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : null);
  };
  function lineTypeOf(el) {
    if (!el) return null;
    if (el.dataset.line) return el.dataset.line;
    if (el.tagName === 'IMG') return flourishByLabel(el.getAttribute('alt'))?.key ?? null;
    if (el.tagName !== 'HR') return null;
    if (el.style.backgroundColor && !el.style.borderTopStyle) return 'rounded';
    const w = parseFloat(el.style.borderTopWidth) || 1;
    const st = el.style.borderTopStyle;
    return st === 'double' ? 'double' : st === 'dashed' ? 'dashed' : st === 'dotted' ? 'dotted' : st === 'groove' ? 'groove' : w >= 3 ? 'thick' : 'thin';
  }
  const lineColorOf = (el) => el.dataset.lineColor || toHexColor(el.style.borderTopColor) || toHexColor(el.style.backgroundColor) || lineColorIn.value;
  const lineWidthOf = (el) => el.style.width || '50%';
  // Builds the line as HTML: a styled <hr> for the plain styles, a flourish picture for the others.
  async function lineHtml(type, color, width) {
    const meta = `data-line="${type}" data-line-color="${color}"`;
    if (LINE_CSS[type]) return `<hr ${meta} style="border:0;border-top:${LINE_CSS[type]} ${color};height:0;width:${width};margin:16px auto">`;
    if (type === 'rounded') return `<hr ${meta} style="border:0;height:4px;border-radius:2px;background-color:${color};width:${width};margin:16px auto">`;
    const f = FLOURISHES.find((x) => x.key === type) ?? FLOURISHES[0];
    const url = await uploadPicture(await drawFlourish(f.key, color), 'image/png');
    return `<img ${meta} src="${esc(url)}" alt="${esc(f.label)}" style="display:block;width:${width};max-width:100%;height:auto;margin:12px auto">`;
  }
  function pickLine(el) {
    editor.querySelectorAll('.line-selected').forEach((x) => x.classList.remove('line-selected'));
    line = el;
    linebar.hidden = !el;
    if (!el) return;
    el.classList.add('line-selected');
    imgbar.hidden = true;
    linebar.querySelector('[data-line-type]').value = lineTypeOf(el);
    lineColorIn.value = lineColorOf(el);
    linebar.querySelector('[data-color-for=lineColor]').style.background = lineColorIn.value;
    linebar.querySelectorAll('[data-line-width]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lineWidth === lineWidthOf(el))));
  }
  // Redraws the selected line with a new style, color or length (flourishes are redrawn and re-saved).
  async function changeLine({ type = lineTypeOf(line), color = lineColorOf(line), width = lineWidthOf(line) } = {}) {
    if (!line) return;
    const old = line;
    linebar.classList.add('busy');
    try {
      const html = await lineHtml(type, color, width);
      const fresh = document.createRange().createContextualFragment(html).firstChild;
      old.replaceWith(fresh);
      pickLine(fresh);
      record();
    } catch (e) { modalError(e.message); } finally { linebar.classList.remove('busy'); }
  }
  modal.querySelector('[data-insert-line]').addEventListener('click', async () => {
    const color = borderByKey(borderSel.value).css ? borderColor.value : canvas.dataset.color;
    insertNode((await lineHtml('thin', color, '50%')).replace('<hr ', '<hr data-new '));
    const inserted = editor.querySelector('[data-new]');
    inserted?.removeAttribute('data-new');
    pickLine(inserted);
    record();
  });
  linebar.addEventListener('change', (e) => { if (e.target.matches('[data-line-type]')) changeLine({ type: e.target.value }); });
  linebar.addEventListener('click', (e) => {
    const w = e.target.closest('[data-line-width]')?.dataset.lineWidth;
    if (w) changeLine({ width: w });
    if (e.target.closest('[data-line-remove]')) { line.remove(); pickLine(null); record(); }
  });

  // Drag a picture to move it to another spot in the text; drop a picture file from the Mac to add it.
  let dragged = null;
  const caretAt = (x, y) => {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const pos = document.caretPositionFromPoint?.(x, y);
    if (!pos) return null;
    const r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true);
    return r;
  };
  editor.addEventListener('dragstart', (e) => {
    dragged = e.target.closest?.('img') ?? null;
    if (!dragged) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });
  editor.addEventListener('dragend', () => { dragged = null; });
  editor.addEventListener('dragover', (e) => {
    if (dragged || [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = dragged ? 'move' : 'copy'; }
  });
  editor.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => PICTURE_TYPES.includes(f.type));
    if (!dragged && !file) return;
    e.preventDefault();
    const r = caretAt(e.clientX, e.clientY);
    if (!r || !editor.contains(r.startContainer)) { dragged = null; return; }
    if (file) {
      designRange = r; // the picture goes where it was dropped
      insertPicture(file, insertNode);
      return;
    }
    if (dragged.contains(r.startContainer)) { dragged = null; return; }
    r.insertNode(dragged);
    pick(dragged);
    dragged = null;
    record();
  });

  const bar = modal.querySelector('.design-toolbar');
  // Buttons act without stealing the selection.
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button.tb')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) exec(b.dataset.cmd);
  });
  bar.addEventListener('change', (e) => {
    const t = e.target;
    const what = t.dataset.design;
    if (what === 'font') {
      if (hasSelection()) { exec('fontName', fontByKey(t.value).stack); t.value = canvas.dataset.font; } // just these words
      else { canvas.dataset.font = t.value; canvas.style.fontFamily = fontByKey(t.value).stack; }      // the whole design
      record();
    }
    if (what === 'border') { applyBorder(); record(); }
    if (what === 'fontSize' && t.value) { exec('fontSize', t.value); t.value = ''; }
    if (what === 'field' && t.value) { exec('insertText', `{{${t.value}}}`); t.value = ''; }
    if (t.matches('[data-design-picture]') && t.files[0]) { const f = t.files[0]; t.value = ''; insertPicture(f, insertNode); }
  });
  // Colors: Safari's color panel may report a pick only as "change" (other browsers send "input" while
  // dragging), so both are handled; applying the same color twice is harmless.
  const onColor = (e) => {
    const t = e.target;
    if (t.type !== 'color') return;
    const sw = modal.querySelector(`[data-color-for="${t.name}"]`);
    if (sw) sw.style.background = t.value;
    if (t.name === 'lineColor') { if (e.type === 'change') changeLine({ color: t.value }); return; }
    if (t.name === 'imgBorderColor') { if (picked && imgBorderSel.value !== 'none') setImgBorder(picked, imgBorderSel.value, t.value); return; }
    if (t.dataset.design === 'color') {
      if (hasSelection()) exec('foreColor', t.value);
      else { canvas.dataset.color = t.value; canvas.style.color = t.value; }
      recordSoon(); // dragging through colors is one step
    }
    if (t.dataset.design === 'background') { canvas.style.background = t.value; recordSoon(); }
    if (t.dataset.design === 'borderColor') { applyBorder(); recordSoon(); }
  };
  for (const el of [bar, linebar, imgbar]) { el.addEventListener('input', onColor); el.addEventListener('change', onColor); }

  // The color window: the color now on the swatch with its code, the colors already used in this
  // design (so text can match the background or border exactly), a palette, a code box, and the
  // Mac's own color picker under "More colors…".
  const pop = modal.querySelector('[data-color-pop]');
  let popFor = null;
  const toHex = (c) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
  };
  const usedColors = () => {
    const found = [canvas.dataset.color, bgInput.value, borderColor.value];
    editor.querySelectorAll('[style]').forEach((el) => { found.push(toHex(el.style.color), toHex(el.style.backgroundColor)); });
    editor.querySelectorAll('font[color]').forEach((el) => found.push(toHex(el.getAttribute('color'))));
    return [...new Set(found.filter(Boolean).map((c) => c.toLowerCase()))].slice(0, 14);
  };
  const chip = (c) => `<button type="button" class="pop-chip" data-pick="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="${c.toUpperCase()}"></button>`;
  const closePop = () => { pop.hidden = true; popFor = null; };
  const pickColor = (hex) => {
    const input = modal.querySelector(`input[name="${popFor}"]`);
    input.value = hex;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closePop();
  };
  const openPop = (btn) => {
    const input = modal.querySelector(`input[name="${btn.dataset.colorFor}"]`);
    popFor = input.name;
    const now = input.value.toLowerCase();
    pop.innerHTML = `
      <div class="pop-now"><span class="pop-big" style="background:${now}"></span>
        <div><div class="small muted">${esc(btn.title)}</div><b class="mono">${now.toUpperCase()}</b></div></div>
      <div class="small muted">In this design</div>
      <div class="pop-row">${usedColors().map(chip).join('')}</div>
      <div class="small muted">Colors</div>
      <div class="pop-row">${PALETTE.map(chip).join('')}</div>
      <div class="pop-code"><label class="small muted" for="pop-hex">Color code</label>
        <input id="pop-hex" data-pop-hex value="${now.toUpperCase()}" maxlength="7" spellcheck="false" autocomplete="off">
        <button type="button" class="btn sm" data-pop-apply>Use</button></div>
      <button type="button" class="link" data-pop-more>More colors…</button>`;
    pop.querySelectorAll(`[data-pick="${now}"]`).forEach((c) => c.classList.add('on'));
    const r = btn.getBoundingClientRect();
    const host = modal.querySelector('.modal-body').getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.max(8, Math.min(r.left - host.left, host.width - pop.offsetWidth - 8))}px`;
    pop.style.top = `${r.bottom - host.top + 6 + modal.querySelector('.modal-body').scrollTop}px`;
  };
  modal.querySelector('form').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color-for]');
    if (!sw) return;
    keepRange();
    if (popFor === sw.dataset.colorFor) closePop(); else openPop(sw);
  });
  pop.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); }); // keep the text selection
  pop.addEventListener('click', (e) => {
    const c = e.target.closest('[data-pick]')?.dataset.pick;
    if (c) return pickColor(c);
    if (e.target.closest('[data-pop-apply]')) {
      const v = pop.querySelector('[data-pop-hex]').value.trim();
      const hex = /^#?[0-9a-f]{6}$/i.test(v) ? `#${v.replace('#', '').toLowerCase()}` : null;
      if (hex) pickColor(hex); else pop.querySelector('[data-pop-hex]').focus();
      return undefined;
    }
    if (e.target.closest('[data-pop-more]')) {
      const input = modal.querySelector(`input[name="${popFor}"]`);
      closePop();
      input.click();
    }
    return undefined;
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-pop-hex]')) { e.preventDefault(); pop.querySelector('[data-pop-apply]').click(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); }
  });
  modal.addEventListener('pointerdown', (e) => { if (!pop.hidden && !e.target.closest('[data-color-pop], [data-color-for]')) closePop(); });
  // A color picker takes focus: remember the selection before it opens.
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('input[type=color], select')) keepRange(); });

  imgbar.addEventListener('click', (e) => {
    if (!picked) return;
    const w = e.target.closest('[data-img-width]')?.dataset.imgWidth;
    if (w) { picked.style.width = w; picked.style.maxWidth = '100%'; picked.style.height = 'auto'; }
    const where = e.target.closest('[data-img-place]')?.dataset.imgPlace;
    if (where) { place(picked, where); showPlace(picked); }
    if (e.target.closest('[data-img-remove]')) { picked.remove(); pick(null); }
    record();
  });

  // HTML view: edit or paste HTML; switching back shows it (cleaned) in the editor.
  const htmlBtn = modal.querySelector('[data-design-html]');
  htmlBtn.addEventListener('click', async () => {
    const toSource = src.hidden;
    if (toSource) {
      src.value = designHtml(editor);
      canvas.hidden = true; src.hidden = false; src.focus();
    } else {
      editor.innerHTML = (await cleanForEditor(src.value));
      src.hidden = true; canvas.hidden = false; editor.focus();
      record();
    }
    htmlBtn.setAttribute('aria-pressed', String(toSource));
    lockToolbar(toSource, htmlBtn);
  });

  // Formatting tools are off while the HTML or the preview is showing (page colors and border stay
  // usable in the HTML view).
  function lockToolbar(on, except) {
    bar.querySelectorAll('select, button.tb, input, .tb-pic, .tb-color').forEach((el) => {
      if (el === except) return;
      if (except === htmlBtn && el.matches('input[type=color], [data-color-for=background], [data-color-for=borderColor], [data-design=border]')) return;
      if (el.matches('[data-history]')) { el.disabled = on || (el.dataset.history === 'undo' ? at === 0 : at === history.length - 1); return; }
      el.classList.toggle('off', on);
      if ('disabled' in el) el.disabled = on;
    });
  }

  // Preview: the design filled in for each household on the list (‹ ›), with its real greeting
  // and the occasion's date, time and location, exactly as it will print or arrive.
  const previewBtn = modal.querySelector('[data-design-preview]');
  const pane = modal.querySelector('[data-design-preview-pane]');
  let previewAt = 0;
  const previewPeople = () => {
    const tags = tagMap();
    const byId = hhById();
    const onList = [...tags.keys()].map((id) => byId.get(id)).filter(Boolean).sort(byName);
    return onList.length ? onList : [...state.households].sort(byName);
  };
  const currentDesign = () => ({
    html: designHtml(editor), background: bgInput.value, color: canvas.dataset.color, font: canvas.dataset.font,
    border: borderSel.value, borderColor: borderColor.value,
  });
  const showPreview = () => {
    const list = previewPeople();
    const o = state.occ.occasion;
    previewAt = Math.min(Math.max(0, previewAt), Math.max(0, list.length - 1));
    const h = list[previewAt];
    const greeting = !h ? 'Friend' : kindOf(o) === 'email' ? listGreeting(h, tagMap().get(h.id) ?? {}) : greetingFor(h, inviteGreetStyle(o));
    const design = currentDesign();
    loadFont(design);
    pane.querySelector('[data-preview-pos]').innerHTML = h
      ? `<b>${esc(h.labelName)}</b> <span class="muted">· ${previewAt + 1} of ${list.length}${tagMap().size ? '' : ' in the address book'}</span>`
      : '<span class="muted">No households yet</span>';
    pane.querySelector('[data-preview-step="-1"]').disabled = previewAt <= 0;
    pane.querySelector('[data-preview-step="1"]').disabled = previewAt >= list.length - 1;
    pane.querySelector('[data-preview-body]').innerHTML = `<div class="preview-page">${renderDesign(design, fieldValues({ occasion: o, greeting, fromName: fromName() }))}</div>`;
  };
  previewBtn.addEventListener('click', () => {
    const on = pane.hidden;
    if (on && !src.hidden) htmlBtn.click(); // leave the HTML view first
    pane.hidden = !on;
    canvas.hidden = on;
    imgbar.hidden = true; pick(null); pickLine(null); closePop();
    previewBtn.setAttribute('aria-pressed', String(on));
    lockToolbar(on, previewBtn);
    if (on) showPreview(); else editor.focus();
  });
  pane.addEventListener('click', (e) => {
    const step = Number(e.target.closest('[data-preview-step]')?.dataset.previewStep);
    if (step) { previewAt += step; showPreview(); }
  });
}

// HTML typed or pasted in is cleaned before it's shown in the app (the API cleans it again, more
// strictly, on save). Parsed in an inert document, so nothing in it runs or loads while cleaning.
const UNSAFE_TAGS = 'script, style, link, meta, base, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, svg, math, template, noscript';
async function cleanForEditor(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll(UNSAFE_TAGS).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      const v = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (name.startsWith('on') || name === 'class' || name === 'id' || name === 'srcdoc' || name === 'formaction'
        || (['href', 'src', 'xlink:href', 'action', 'background'].includes(name) && !/^(https?:|mailto:|tel:|#)/.test(v))) el.removeAttribute(name);
      if (name === 'style' && /url\(|expression\(/i.test(value)) el.removeAttribute(name);
    }
  });
  return doc.body.innerHTML;
}

async function uploadPicture(blob, type) {
  const { uploadUrl, url } = await api(`/occasions/${state.occasionId}/images`, { method: 'POST', body: { type, size: blob.size } });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': type }, body: blob });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return url;
}

async function insertPicture(file, insertNode) {
  if (!PICTURE_TYPES.includes(file.type)) return modalError('Pictures must be PNG, JPEG, GIF or WebP.');
  modalError('');
  const label = modal.querySelector('.tb-pic');
  label.classList.add('busy');
  try {
    let blob = file;
    // Big photos are scaled down to 1600px wide (animated GIFs are left alone).
    if (file.type !== 'image/gif') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
      if (bitmap && bitmap.width > 1600) {
        const scale = 1600 / bitmap.width;
        const canvas = Object.assign(document.createElement('canvas'), { width: 1600, height: Math.round(bitmap.height * scale) });
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        blob = await new Promise((r) => canvas.toBlob(r, type, 0.88));
      }
      bitmap?.close?.();
    }
    if (blob.size > 5 * 1024 * 1024) throw new Error('That picture is too large (over 5 MB).');
    const url = await uploadPicture(blob, blob.type || file.type);
    insertNode(`<img src="${esc(url)}" alt="" style="width:50%;max-width:100%;height:auto">`);
  } catch (e) {
    modalError(e.message);
  } finally {
    label.classList.remove('busy');
  }
  return undefined;
}

async function saveDesign(form) {
  const editor = form.querySelector('[data-design-edit]');
  const src = form.querySelector('[data-design-src]');
  if (!src.hidden) editor.innerHTML = (await cleanForEditor(src.value));
  const body = {
    html: designHtml(editor),
    background: form.querySelector('[name=background]').value,
    color: form.querySelector('[data-design-canvas]').dataset.color,
    font: form.querySelector('[data-design-canvas]').dataset.font,
    border: form.querySelector('[data-design=border]').value,
    borderColor: form.querySelector('[name=borderColor]').value,
  };
  const done = (occasion) => { state.occ.occasion = occasion; closeModal(); toast('Design saved'); render(); };
  const put = (base) => api(`/occasions/${state.occasionId}/design`, { method: 'PUT', body: { ...body, baseUpdatedAt: base } });
  await withBusy(form.querySelector('.btn.primary'), async () => {
    try {
      return done((await put(form.dataset.base || null)).occasion);
    } catch (err) {
      return resolveConflict(err, 'design', {
        saveMine: async (theirs) => done((await put(theirs.design?.updatedAt ?? null)).occasion),
        loadTheirs: (theirs) => { state.occ.occasion = theirs; render(); designModal(); toast('Showing their version'); },
      });
    }
  });
}

// ---------- invitations ----------
function invitesModal() {
  const o = state.occ.occasion;
  const tags = tagMap();
  const byId = hhById();
  const on = [...tags.values()].map((t) => ({ t, h: byId.get(t.householdId) })).filter((x) => x.h);
  const withEmail = on.filter((x) => allEmails(x.h).length).sort((a, b) => byName(a.h, b.h));
  const notSent = withEmail.filter((x) => !x.t.invitedAt);
  if (!o.design?.html && !o.invite?.message) {
    openModal('Send emails', '<p style="margin:0">Design the email first.</p>', {
      form: 'noop', foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button><button type="button" class="btn primary" data-action="design">Design email</button></div>',
    });
    return;
  }
  const sample = withEmail[0]?.h;
  const design = o.design?.html ? o.design : { html: starterHtml(o.invite?.message) };
  loadFont(design);
  openModal('Send emails', `
    <div class="invite-preview"><div class="small muted">Subject</div><div><b>${esc(o.invite?.subject || `You're invited: ${o.name}`)}</b></div></div>
    <div class="email-preview">${renderDesign(design, fieldValues({ occasion: o, greeting: sample ? listGreeting(sample, tags.get(sample.id)) : 'Friend', fromName: fromName() }), { padding: '20px' })}</div>
    <div class="row-gap">
      <label class="check"><input type="radio" name="who" value="new" checked data-who> Not sent yet (${notSent.length})</label>
      <label class="check"><input type="radio" name="who" value="all" data-who> Everyone with email (${withEmail.length})</label>
    </div>
    ${withEmail.length ? `<div class="send-table-wrap"><table class="items send-table"><thead><tr><th>Household</th><th>To</th><th>Greeting</th></tr></thead><tbody>
      ${withEmail.map(({ h, t }) => sendRow(h, t)).join('')}</tbody></table></div>` : ''}
    <div data-progress hidden class="notice"></div>`, {
    form: 'invites', wide: true,
    foot: `<div class="left-actions"><button type="button" class="btn" data-action="test-invite">Send a test to me</button></div>
      <div class="right"><button type="button" class="btn" data-action="close">Close</button><button class="btn primary">Send</button></div>`,
  });
  syncSendRows();
}

const personName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;

const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');
/**
 * The greeting text for a style: 'informal' (default), 'formal', 'household', or 'p:<person id>' for one
 * person's first name (e.g. just the dad, or an adult child).
 */
function greetingFor(h, style) {
  if (style === 'formal') return effectiveFormalName(h) || h.labelName;
  if (style === 'household') return h.labelName;
  if (String(style).startsWith('p:')) {
    const m = (h.members ?? []).find((x) => x.id === style.slice(2));
    if (m) return m.firstName || personName(m);
  }
  return h.greeting || h.labelName;
}

// The people it goes to are the ones ticked on the occasion's list; the greeting can still be changed here.
function sendRow(h, t) {
  const id = esc(h.id);
  return `<tr data-send-row="${id}" data-sent="${t.invitedAt ? '1' : ''}">
    <td>${esc(h.labelName)}${t.invitedAt ? ` <span class="pill ok">Sent ${fmtDate(t.invitedAt, { month: 'short', day: 'numeric' })}</span>` : ''}</td>
    <td class="small">${esc(tagPeople(h, t).map(personName).join(', '))}</td>
    <td><select data-greeting="${id}" aria-label="Greeting for ${esc(h.labelName)}"></select></td>
  </tr>`;
}

// Fills each row's Greeting choices with the actual words: Informal, Formal, Household, or any one
// person in the household by first name. It starts on the occasion's Greeting setting and follows
// Send to when a person's name is chosen (send to Mary, greet Mary).
function syncSendRows() {
  const byId = hhById();
  const tags = tagMap();
  const showAll = modal.querySelector('[data-who][value=all]')?.checked;
  modal.querySelectorAll('[data-send-row]').forEach((row) => {
    row.hidden = !showAll && row.dataset.sent === '1';
    if (row.dataset.filled) return;
    row.dataset.filled = '1';
    const h = byId.get(row.dataset.sendRow);
    const to = tagPeople(h, tags.get(h.id));
    const sel = row.querySelector('[data-greeting]');
    const people = (h.members ?? []).filter((m) => m.firstName || m.lastName);
    const opts = [['informal', 'Informal'], ['formal', 'Formal'], ['household', 'Household']]
      .map(([k, l]) => [k, `${greetingFor(h, k)} (${l})`])
      .concat(to.length > 1 ? [['to', joinNames(to.map((m) => m.firstName || personName(m)))]] : [])
      .concat(people.map((m) => [`p:${m.id}`, greetingFor(h, `p:${m.id}`)]));
    const style = state.occ?.occasion?.greetStyle ?? 'informal';
    const chosen = style !== 'person' ? style : to.length === 1 ? `p:${to[0].id}` : to.length > 1 ? 'to' : 'informal';
    sel.innerHTML = opts.map(([k, text]) => `<option value="${esc(k)}" data-text="${esc(k === 'to' ? text : '')}" ${k === chosen ? 'selected' : ''}>${esc(text)}</option>`).join('');
  });
}

async function sendInvites(form) {
  const byId = hhById();
  const rows = [...modal.querySelectorAll('[data-send-row]')].filter((r) => !r.hidden);
  if (!rows.length) return modalError('Nobody to send to.');
  if (!await askConfirm({ title: 'Send emails?', text: `Email ${plural(rows.length, 'household')} now.`, ok: 'Send' })) return undefined;
  const pick = (row) => {
    const h = byId.get(row.dataset.sendRow);
    const sel = row.querySelector('[data-greeting]');
    return [h.id, sel.value === 'to' ? sel.selectedOptions[0].dataset.text : greetingFor(h, sel.value)];
  };
  const chosen = rows.map(pick);
  const prog = modal.querySelector('[data-progress]');
  prog.hidden = false;
  const results = [];
  await withBusy(form.querySelector('.btn.primary'), async () => {
    for (let i = 0; i < chosen.length; i += INVITE_BATCH) {
      prog.textContent = `Sending… ${Math.min(i, chosen.length)} of ${chosen.length}`;
      const batch = chosen.slice(i, i + INVITE_BATCH);
      const res = await api(`/occasions/${state.occasionId}/invites`, {
        method: 'POST',
        body: {
          householdIds: batch.map(([id]) => id),
          greetings: Object.fromEntries(batch.map(([id, g]) => [id, g])),
        },
      });
      results.push(...res.results);
    }
  });
  await openOccasion(state.occasionId);
  await refreshOccasions();
  const sent = results.filter((r) => r.status === 'sent').length;
  const problems = results.filter((r) => r.status !== 'sent');
  prog.innerHTML = `<div><b>${plural(sent, 'email')} sent.</b>${problems.length ? `<ul class="small">${problems.map((r) => `<li>${esc(byId.get(r.householdId)?.labelName ?? '?')}: ${esc(r.reason)}</li>`).join('')}</ul>` : ''}</div>`;
  render();
  return undefined;
}

// ---------- settings ----------
// Tabs across the top, like Vehicle Maintenance. Each tab saves only its own fields.
const SETTINGS_TABS = [['profile', 'Profile'], ['return', 'Return address'], ['security', 'Security'], ['printer', 'Printer'], ['sharing', 'Sharing']];
let settingsTab = 'profile';
let mfaEnrollment = null; // { qr, secret } while setting up an authenticator app

function settingsTabs(active) {
  return `<div class="tabs settings-tabs" role="tablist">${SETTINGS_TABS.map(([id, label]) => `
    <button type="button" role="tab" class="tab" data-action="settings-tab" data-tab="${id}" aria-selected="${id === active}">${label}</button>`).join('')}</div>`;
}

const saveFoot = (label) => `<div></div><div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">${label}</button></div>`;

function settingsModal(tab = settingsTab) {
  settingsTab = SETTINGS_TABS.some(([id]) => id === tab) ? tab : 'profile';
  if (settingsTab === 'return') return returnAddressTab();
  if (settingsTab === 'security') return securityTab();
  if (settingsTab === 'printer') return printerTab();
  if (settingsTab === 'sharing') return sharingTab();
  return profileTab();
}

function profileTab() {
  const p = state.me?.profile ?? {};
  const email = state.session?.user?.email ?? p.email;
  openModal('Settings', `
    ${settingsTabs('profile')}
    <div class="avatar-row">
      <div class="avatar-edit">
        <div data-avatar-preview>${avatarHtml(p, email, 72)}</div>
        ${p.avatarUrl ? `<button type="button" class="avatar-remove" data-action="remove-avatar" title="Remove photo" aria-label="Remove photo">${TRASH}</button>` : ''}
      </div>
      <div class="avatar-actions">
        <label class="btn sm">
          <input type="file" data-avatar-input accept="image/jpeg,image/png,image/webp,image/heic,.heic" hidden>
          ${p.avatarUrl ? 'Change photo' : 'Upload photo'}
        </label>
      </div>
    </div>
    <div class="grid-2">
      <label>First name<input name="firstName" maxlength="60" value="${val(p.firstName)}" autocomplete="given-name"></label>
      <label>Last name<input name="lastName" maxlength="60" value="${val(p.lastName)}" autocomplete="family-name"></label>
    </div>
    <label>Emails come from <span class="muted">(optional; default is your name)</span><input name="emailFromName" maxlength="80" value="${val(p.emailFromName)}" placeholder="The Szmansky Family"></label>
    <div>
      <div class="label-like">Sign-in email</div>
      <div class="email-row"><span>${esc(email)}</span><button type="button" class="icon-btn" data-action="show-email-change" aria-expanded="${state.pendingEmail ? 'true' : 'false'}" title="Change email" aria-label="Change email">${PENCIL}</button></div>
      <div class="email-change" data-email-change ${state.pendingEmail ? '' : 'hidden'}>${emailChangeBody(state.pendingEmail)}</div>
      <p class="hint">Replies to your invitations and address checks come here.</p>
    </div>`, { form: 'settings-profile', foot: saveFoot('Save profile') });
  modal.querySelector('[data-avatar-input]').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) uploadAvatar(file);
  });
}

// Profile photos are cropped to a centered square and saved as a 400px JPEG before upload.
async function squareJpeg(file, size = 400) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.88));
}

async function uploadAvatar(file) {
  const preview = modal.querySelector('[data-avatar-preview]');
  preview?.classList.add('busy');
  try {
    let blob;
    try { blob = await squareJpeg(file); } catch { throw new Error("That image couldn't be read. Try a JPEG or PNG."); }
    const { id, uploadUrl } = await api('/me/avatar', { method: 'POST', body: { type: 'image/jpeg', size: blob.size } });
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    state.me.profile = (await api(`/me/avatar/${id}/complete`, { method: 'POST', body: { type: 'image/jpeg' } })).profile;
    toast('Photo updated');
    profileTabKeepingInput();
    render();
  } catch (e) {
    toast(e.message, true);
  } finally {
    preview?.classList.remove('busy');
  }
}

async function removeAvatar(btn) {
  await withBusy(btn, async () => {
    state.me.profile = (await api('/me/avatar', { method: 'DELETE' })).profile;
    toast('Photo removed');
    profileTabKeepingInput();
    render();
  });
}

// Re-draws the Profile tab (new photo, new email) without losing names typed but not yet saved.
function profileTabKeepingInput() {
  const names = ['firstName', 'lastName', 'emailFromName'];
  const typed = modal.open ? Object.fromEntries(names.map((n) => [n, modal.querySelector(`[name=${n}]`)?.value])) : null;
  profileTab();
  if (typed) for (const n of names) if (typed[n] !== undefined) modal.querySelector(`[name=${n}]`).value = typed[n];
}

function returnAddressTab() {
  const p = state.me?.profile ?? {};
  openModal('Settings', `
    ${settingsTabs('return')}
    <p style="margin:0">Printed in the corner of envelopes, and on return-address labels.${isOwner() ? '' : ' It belongs to the shared address book, so everyone using it prints the same one.'}</p>
    <label>Name<input name="returnName" maxlength="120" value="${val(p.returnName)}" placeholder="${val([p.firstName, p.lastName].filter(Boolean).join(' ') || 'The Szmansky Family')}"></label>
    ${addressFields(p.returnAddress, 'r_')}`, { form: 'settings-return', foot: canEdit() ? saveFoot('Save return address') : '<div class="small muted">View only</div><div class="right"><button type="button" class="btn" data-action="close">Close</button></div>' });
  if (!canEdit()) modal.querySelectorAll('.modal-body input').forEach((el) => { el.disabled = true; });
}

// ----- sharing: the owner shares the address book and occasions, each person "Can edit" or "View only" -----
let shares = [];
const roleSelect = (name, role, extra = '') => `<select ${name} ${extra}>
  <option value="edit" ${role === 'edit' ? 'selected' : ''}>Can edit</option>
  <option value="view" ${role === 'view' ? 'selected' : ''}>View only</option></select>`;

async function sharingTab() {
  const withMe = state.books.filter((b) => !b.own);
  openModal('Settings', `
    ${settingsTabs('sharing')}
    <p style="margin:0">Share <b>your</b> address book and its occasions. The people you share with keep their own address book too, and switch between them at the top of the screen. Changes in a shared book show up for everyone using it.</p>
    <div data-share-list class="share-list"><p class="muted small" style="margin:0">Loading…</p></div>
    <fieldset class="stack"><legend>Share with someone</legend>
      <div class="share-add">
        <label>Email<input type="email" name="shareEmail" autocomplete="off" placeholder="partner@example.com"></label>
        <label>Access${roleSelect('name="shareRole"', 'edit')}</label>
      </div>
      <p class="hint">If they don't have an account yet, they'll get an invitation email with a temporary password. The share stays with their account, so it keeps working if they change their email.</p>
    </fieldset>
    ${withMe.length ? `<fieldset class="stack"><legend>Shared with you</legend>
      <div class="share-list">${withMe.map((b) => `<div class="share-row two">
        <div><div>${esc(bookLabel(b))} address book</div><div class="small muted">${esc(b.ownerEmail)}${b.sharedAt ? ` · since ${fmtDate(b.sharedAt)}` : ''}</div></div>
        <span class="pill ${b.role === 'edit' ? 'ok' : 'unknown'}">${ROLE_LABEL[b.role]}</span>
      </div>`).join('')}</div>
      <p class="hint">Only the owner can change your access to their book.</p>
    </fieldset>` : ''}`, {
    form: 'share',
    foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button><button class="btn primary">Share</button></div>',
  });
  try { shares = (await api('/shares')).shares; } catch (e) { shares = []; modalError(e.message); }
  renderShareList();
}

function renderShareList() {
  const box = modal.querySelector('[data-share-list]');
  if (!box) return;
  box.innerHTML = shares.length ? shares.map((sh) => `
    <div class="share-row">
      <div><div>${esc(sh.email)}</div><div class="small muted">Shared ${fmtDate(sh.sharedAt)}${sh.invited ? ' · invited' : ''}</div></div>
      ${roleSelect(`data-share-role="${esc(sh.id)}" data-email="${esc(sh.email)}" aria-label="Access for ${esc(sh.email)}"`, sh.role)}
      <button type="button" class="btn sm danger" data-action="unshare" data-id="${esc(sh.id)}" data-email="${esc(sh.email)}">Stop sharing</button>
    </div>`).join('') : '<p class="muted small" style="margin:0">Not shared with anyone yet.</p>';
}

async function addShare(form) {
  const email = form.elements.shareEmail.value.trim();
  if (!email) return modalError('Enter their email address');
  return withBusy(form.querySelector('.btn.primary'), async () => {
    const res = await api('/shares', { method: 'POST', body: { email, role: form.elements.shareRole.value } });
    shares = res.shares;
    form.elements.shareEmail.value = '';
    renderShareList();
    toast(res.share.invited ? `Shared, and invited ${res.share.email} to create an account` : `Shared with ${res.share.email}`);
  });
}

function printerTab() {
  const pr = state.me?.profile?.print ?? {};
  const off = (name, label, v) => `<label>${label}<input name="${name}" type="number" step="0.01" min="-1" max="1" value="${Number(v ?? 0)}"></label>`;
  openModal('Settings', `
    ${settingsTabs('printer')}
    <p style="margin:0">If printing lands off, move it in inches: positive moves right or down, negative left or up (0.06 is about 1/16 in).
      Print an alignment page on plain paper and hold it against a label sheet or envelope to check.</p>
    <fieldset><legend>Avery 5160 / 8160 labels</legend>
      <div class="grid-2">${off('labelOffsetX', 'Across', pr.labelOffsetX)}${off('labelOffsetY', 'Down', pr.labelOffsetY)}</div>
      <div><button type="button" class="btn sm" data-action="align-test" data-what="labels">Label alignment page</button></div>
    </fieldset>
    <fieldset><legend>A7 envelopes</legend>
      <div class="grid-2">${off('envelopeOffsetX', 'Across', pr.envelopeOffsetX)}${off('envelopeOffsetY', 'Down', pr.envelopeOffsetY)}</div>
      <div><button type="button" class="btn sm" data-action="align-test" data-what="envelopes">Envelope alignment page</button></div>
    </fieldset>
    <p class="hint">Always print at <b>Actual size / 100%</b>, not "Fit to page".</p>`, { form: 'settings-printer', foot: saveFoot('Save printer settings') });
}

async function securityTab() {
  openModal('Settings', `
    ${settingsTabs('security')}
    <fieldset class="stack">
      <legend>Change password</legend>
      <label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label>
      <div class="grid-2">
        <label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label>
        <label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label>
      </div>
      <div><button class="btn" type="submit">Update password</button></div>
    </fieldset>
    <fieldset class="stack">
      <legend>Two-step verification</legend>
      <div data-mfa class="stack"><p class="muted small" style="margin:0">Checking…</p></div>
    </fieldset>`, {
    form: 'settings-password',
    foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button></div>',
  });
  await renderMfaSection();
}

// What each tab sends; the API keeps everything it isn't sent.
function readSettings(form, tab) {
  const f = form.elements;
  if (tab === 'profile') return { firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim(), emailFromName: f.emailFromName.value.trim() };
  if (tab === 'return') return { returnName: f.returnName.value.trim(), returnAddress: readAddress(form, 'r_') };
  const n = (k) => Number(f[k].value || 0);
  return { print: { labelOffsetX: n('labelOffsetX'), labelOffsetY: n('labelOffsetY'), envelopeOffsetX: n('envelopeOffsetX'), envelopeOffsetY: n('envelopeOffsetY') } };
}

async function changePassword(form) {
  const f = form.elements;
  const [current, next, again] = [f.currentPassword.value, f.newPassword.value, f.confirmPassword.value];
  if (next !== again) throw new Error("The new passwords don't match");
  if (next.length < 8) throw new Error('Use at least 8 characters for the new password');
  if (next === current) throw new Error('Choose a password different from your current one');
  try {
    await auth.changePassword(current, next); // Cognito checks the current password
  } catch (e) {
    if (e.code === 'NotAuthorizedException') throw new Error('Your current password is incorrect');
    throw e;
  }
  closeModal();
  toast('Password updated');
  api('/me/password-changed', { method: 'POST' }).catch(() => {}); // the "your password was changed" email
}

// ----- sign-in email change: Cognito emails a code to the new address -----
function emailChangeBody(pending) {
  if (pending) {
    return `<p class="small" style="margin:0">We emailed a 6-digit code to <b>${esc(pending)}</b>. Enter it to make that your sign-in email.</p>
      <label>Code<input type="text" name="emailCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="mono code-input"></label>
      <div class="row-gap" style="justify-content:flex-start"><button type="button" class="btn sm primary" data-action="confirm-email-change">Confirm</button>
        <button type="button" class="btn sm" data-action="send-email-change" data-email="${esc(pending)}">Send a new code</button>
        <button type="button" class="btn sm ghost" data-action="cancel-email-change">Cancel</button></div>`;
  }
  return `<label>New email address<input type="email" name="newEmail" autocomplete="email" placeholder="you@example.com"></label>
    <div><button type="button" class="btn sm" data-action="send-email-change">Email me a code</button></div>
    <div class="hint">We'll email a 6-digit code to the new address. Your email changes once you enter it; until then, keep signing in with your current one.</div>`;
}

async function changeEmail(btn) {
  const email = (btn.dataset.email ?? modal.querySelector('[name=newEmail]')?.value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address', true);
  if (email === state.session?.user?.email?.toLowerCase()) return toast("That's already your email", true);
  return withBusy(btn, async () => {
    await auth.startEmailChange(email);
    state.pendingEmail = email;
    const box = modal.querySelector('[data-email-change]');
    box.innerHTML = emailChangeBody(email);
    box.querySelector('[name=emailCode]').focus();
  });
}

async function confirmEmailChange(btn) {
  const code = (modal.querySelector('[name=emailCode]')?.value ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return toast('Enter the 6-digit code from the email', true);
  return withBusy(btn, async () => {
    await auth.confirmEmailChange(code);
    state.pendingEmail = null;
    state.session = await auth.getSession();
    if (rememberedEmail()) rememberEmail(state.session?.user?.email);
    state.me = await api('/me'); // the profile follows the new sign-in email
    toast('Your sign-in email is changed');
    profileTabKeepingInput();
    render();
  });
}

// ----- two-step verification with an authenticator app -----
async function renderMfaSection() {
  const box = modal.querySelector('[data-mfa]');
  if (!box) return;
  if (mfaEnrollment) {
    box.innerHTML = `
      <ol class="mfa-steps">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and scan this code.
          <div class="mfa-qr"><img src="${esc(mfaEnrollment.qr)}" alt="QR code for your authenticator app" width="180" height="180"></div></li>
        <li>Can't scan it? Enter this key instead: <span class="mono mfa-secret">${esc(mfaEnrollment.secret)}</span></li>
        <li><label>Enter the 6-digit code it shows<input type="text" data-mfa-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="mono code-input" placeholder="123456"></label></li>
      </ol>
      <div class="mfa-buttons"><button type="button" class="btn" data-action="mfa-cancel">Cancel</button><button type="button" class="btn primary" data-action="mfa-verify">Verify and turn on</button></div>`;
    box.querySelector('[data-mfa-code]').focus();
    return;
  }
  let account;
  try { account = await auth.getAccount(); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  box.innerHTML = account.mfaEnabled
    ? `<div class="mfa-on"><span class="pill ok">On</span> Authenticator app</div>
      <p class="hint">You'll be asked for a code from the app each time you sign in.</p>
      <div><button type="button" class="btn danger" data-action="mfa-disable">Turn off</button></div>`
    : `<p style="margin:0">Add a second step when signing in: a 6-digit code from an authenticator app on your phone. Someone who learns your password still can't get in.</p>
      <div><button type="button" class="btn primary" data-action="mfa-start">Set up authenticator app</button></div>`;
}

// QR codes for the authenticator app are drawn in the browser (the secret never leaves it).
let qrLib = null;
async function qrDataUrl(text) {
  qrLib ??= (await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm')).default;
  return qrLib.toDataURL(text, { width: 360, margin: 1 });
}

async function startMfaEnroll(btn) {
  await withBusy(btn, async () => {
    const { secret, uri } = await auth.startMfaSetup(state.session?.user?.email ?? '');
    mfaEnrollment = { secret, qr: await qrDataUrl(uri) };
    await renderMfaSection();
  });
}

async function finishMfaEnroll(btn) {
  const code = modal.querySelector('[data-mfa-code]').value.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return toast('Enter the 6-digit code from your authenticator app', true);
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await auth.finishMfaSetup(code);
    mfaEnrollment = null;
    toast('Two-step verification is on');
    await renderMfaSection();
  } catch (e) {
    toast(e.code === 'CodeMismatchException' || e.code === 'EnableSoftwareTokenMFAException' ? "That code didn't work. Codes change every 30 seconds; try the current one." : e.message, true);
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  return undefined;
}

async function disableMfa(btn) {
  if (!await askConfirm({ title: 'Turn off two-step verification?', text: 'Signing in will only need your password.', ok: 'Turn off', danger: true })) return;
  await withBusy(btn, async () => {
    await auth.disableMfa();
    toast('Two-step verification is off');
    await renderMfaSection();
  });
}

// Alignment pages use the offsets typed on the Printer tab (saved or not) and the saved return address.
async function alignTest(what) {
  const s = readSettings(modal.querySelector('form'), 'printer');
  const JsPDF = await getJsPDF();
  const sample = ['The Sample Family', '1234 Example Street', 'Apt 5', 'Evergreen Falls, MI  49001'];
  const ret = returnLines();
  const doc = what === 'labels'
    ? buildLabels(JsPDF, Array(30).fill(sample), { offsetX: s.print.labelOffsetX, offsetY: s.print.labelOffsetY, outline: true })
    : buildEnvelopes(JsPDF, [sample], {
      returnLines: ret.length ? ret : ['Your Name', '1 Return Street', 'Evergreen Falls, MI  49001'],
      offsetX: s.print.envelopeOffsetX, offsetY: s.print.envelopeOffsetY, outline: true,
    });
  window.open(doc.output('bloburl'), '_blank');
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  if (!e.target.closest('.note-tip, .hh-note')) hideNoteTip();
  const el = e.target.closest('[data-action]');
  if (!e.target.closest('.user-menu')) setUserMenu(false);
  if (!e.target.closest('.book-menu')) setBookMenu(false);
  if (!e.target.closest('.share-menu')) setShareMenu(false);
  if (!el) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'show-signin': state.showLanding = false; renderAuth(); window.scrollTo(0, 0); break;
    case 'auth-mode': auth.cancelSignIn(); state.authMode = el.dataset.mode; state.authErr = ''; state.authMsg = ''; renderAuth(); break;
    case 'toggle-user-menu': setUserMenu(document.getElementById('user-menu-list').hidden); break;
    case 'toggle-book-menu': setBookMenu(document.getElementById('book-menu-list').hidden); break;
    case 'switch-book': await switchBook(el.dataset.id); break;
    case 'signout': await auth.signOut(); break;
    case 'close': closeModal(); break;
    case 'view':
      state.view = el.dataset.view;
      state.occasionId = null; state.occ = null;
      if (state.view === 'occasions') await refreshOccasions().catch((err) => toast(err.message, true));
      render();
      break;
    case 'settings': setUserMenu(false); mfaEnrollment = null; settingsModal('profile'); break;
    case 'align-test': await withBusy(el, () => alignTest(el.dataset.what)); break;
    case 'settings-tab': settingsModal(el.dataset.tab); break;
    case 'hh-tab': showHouseholdTab(el.dataset.tab); break;
    case 'check-address': await checkAddress(el); break;
    case 'toggle-share-menu': setShareMenu(modal.querySelector('#share-menu-list').hidden); break;
    case 'hh-share': await shareHousehold(el.dataset.how, el.dataset.kind); break;
    case 'hh-next': {
      const at = HOUSEHOLD_TABS.findIndex(([t]) => t === modal.querySelector('[data-action=hh-tab][aria-selected=true]')?.dataset.tab);
      showHouseholdTab(HOUSEHOLD_TABS[Math.min(at + 1, HOUSEHOLD_TABS.length - 1)][0]);
      break;
    }
    case 'remove-avatar': await removeAvatar(el); break;
    case 'unshare':
      if (!await askConfirm({ title: 'Stop sharing?', text: `${el.dataset.email} will no longer see your address book and occasions.`, ok: 'Stop sharing', danger: true })) break;
      await withBusy(el, async () => {
        shares = (await api(`/shares/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' })).shares;
        renderShareList();
        toast(`Stopped sharing with ${el.dataset.email}`);
      });
      break;
    case 'show-email-change': {
      const box = modal.querySelector('[data-email-change]');
      box.hidden = !box.hidden;
      el.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) box.querySelector('input')?.focus();
      break;
    }
    case 'send-email-change': await changeEmail(el); break;
    case 'confirm-email-change': await confirmEmailChange(el); break;
    case 'cancel-email-change':
      state.pendingEmail = null;
      modal.querySelector('[data-email-change]').innerHTML = emailChangeBody(null);
      break;
    case 'mfa-start': await startMfaEnroll(el); break;
    case 'mfa-verify': await finishMfaEnroll(el); break;
    case 'mfa-cancel': mfaEnrollment = null; await renderMfaSection(); break; // Cognito drops an unverified setup on its own
    case 'mfa-disable': await disableMfa(el); break;
    // address book
    case 'add-household': householdModal(); break;
    case 'edit-household': householdModal(hhById().get(id)); break;
    case 'add-member': {
      const box = modal.querySelector('[data-members]');
      if (box.children.length >= 20) return toast('At most 20 people per household', true);
      box.insertAdjacentHTML('beforeend', memberRow());
      box.lastElementChild.querySelector('input').focus();
      break;
    }
    case 'remove-member': el.closest('[data-member]').remove(); break;
    case 'chip-remove': {
      const box = el.closest('[data-chips]');
      el.closest('[data-chip]').remove();
      box.querySelector('[data-chip-text]').focus();
      break;
    }
    case 'delete-household': {
      const h = hhById().get(id);
      if (!await askConfirm({ title: `Move ${h.labelName} to the Trash?`, text: `You can restore them for ${TRASH_DAYS} days.`, ok: 'Move to Trash', danger: true })) return;
      await withBusy(el, async () => {
        await api(`/households/${id}`, { method: 'DELETE' });
        state.households = state.households.filter((x) => x.id !== id);
        if (state.occ) state.occ.tags = state.occ.tags.filter((t) => t.householdId !== id);
        closeModal(); toast(`${h.labelName} moved to the Trash`); render();
      });
      break;
    }
    case 'pending':
      await withBusy(el, async () => {
        const res = await api(`/households/${id}/pending/${el.dataset.do}`, { method: 'POST' });
        upsertHousehold(res.household);
        toast(el.dataset.do === 'accept' ? 'Address updated' : 'Kept the address on file');
        householdModal(res.household);
        render();
      });
      break;
    case 'request-address': requestAddressModal(hhById().get(id)); break;
    case 'pending-only': setFilter('people', { review: !state.filters.people.review }); render(); break;
    case 'filter-toggle': toggleFilterPanel(el.dataset.scope); break;
    case 'filter-done': closeFilterPanel(); break;
    case 'filter-clear': setFilter(el.dataset.scope, emptyFilter()); closeFilterPanel(); break;
    case 'filter-chip-remove': {
      const { scope } = el.dataset;
      const chip = filterChips(state.filters[scope])[Number(el.dataset.i)];
      if (chip?.remove) setFilter(scope, chip.remove);
      break;
    }
    case 'show-note': showNoteTip(el); break;
    case 'import': importModal(); break;
    case 'imp-row': showImportRow(importRows.at + Number(el.dataset.step)); break;
    case 'export': setUserMenu(false); exportModal(); break;
    case 'export-as': {
      const day = new Date().toISOString().slice(0, 10);
      const list = [...state.households].sort(byName);
      if (el.dataset.kind === 'vcf') download(`address-book-${day}.vcf`, list.map(householdToVcard).join(''), 'text/vcard');
      else download(`address-book-${day}.csv`, householdsToCsv(list));
      closeModal();
      break;
    }
    // occasions
    case 'add-occasion': occasionModal(); break;
    case 'open-occasion':
      state.occFilter = 'all'; state.occSearch = ''; state.filters.occ = emptyFilter(); closeFilterPanel();
      await openOccasion(id); render(); window.scrollTo(0, 0);
      break;
    case 'edit-occasion': occasionModal(state.occ.occasion); break;
    case 'trash': setUserMenu(false); await trashModal(); break;
    case 'trash-restore': await restoreFromTrash(el); break;
    case 'trash-forever': {
      if (!await askConfirm({ title: `Delete "${el.dataset.name}" forever?`, text: "This can't be undone.", ok: 'Delete forever', danger: true })) break;
      await withBusy(el, async () => {
        await api(`/trash/${el.dataset.type}/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
        toast(`"${el.dataset.name}" deleted forever`);
        await trashModal();
      });
      break;
    }
    case 'trash-empty':
      if (!await askConfirm({ title: 'Empty the Trash?', text: "Everything in it is deleted forever. This can't be undone.", ok: 'Empty trash', danger: true })) break;
      await withBusy(el, async () => {
        const res = await api('/trash', { method: 'DELETE' });
        toast(`Deleted ${plural(res.emptied, 'item')} forever`);
        await trashModal();
      });
      break;
    case 'delete-occasion':
      if (!await askConfirm({ title: `Move "${state.occ.occasion.name}" to the Trash?`, text: `You can restore it, with its list, for ${TRASH_DAYS} days.`, ok: 'Move to Trash', danger: true })) return;
      await withBusy(el, async () => {
        const name = state.occ.occasion.name;
        await api(`/occasions/${state.occasionId}`, { method: 'DELETE' });
        state.occasionId = null; state.occ = null;
        await refreshOccasions(); closeModal(); toast(`"${name}" moved to the Trash`); render();
      });
      break;
    case 'occ-filter': state.occFilter = el.dataset.filter; render(); break;
    case 'tag': {
      const on = el.checked;
      el.disabled = true;
      try { await setTags(on ? [id] : [], on ? [] : [id]); } catch (err) { el.checked = !on; toast(err.message, true); }
      el.disabled = false;
      render();
      break;
    }
    case 'tag-person': {
      const h = hhById().get(id);
      const t = tagMap().get(id);
      const now = new Set(tagPeople(h, t).map((m) => m.id));
      if (el.checked) now.add(el.dataset.person); else now.delete(el.dataset.person);
      el.disabled = true;
      try {
        const res = await api(`/occasions/${state.occasionId}/tags`, { method: 'PUT', body: { people: { [id]: [...now] } } });
        state.occ.tags = res.tags;
      } catch (err) { el.checked = !el.checked; toast(err.message, true); }
      render();
      break;
    }
    case 'mailed': {
      const on = el.checked;
      el.disabled = true;
      try { await setMailed([id], on); } catch (err) { el.checked = !on; toast(err.message, true); }
      el.disabled = false;
      render();
      break;
    }
    case 'bulk-tag': {
      const tags = tagMap();
      const add = Boolean(el.dataset.add);
      // Emails: only households someone can be emailed at.
      const shown = shownRecipients().filter((h) => !add || !isEmailKind(state.occ?.occasion) || allEmails(h).length);
      const ids = shown.map((h) => h.id).filter((x) => (add ? !tags.has(x) : tags.has(x)));
      if (!ids.length) return toast(add ? 'Everyone shown is already on the list' : 'Nobody shown is on the list');
      if (!add && !await askConfirm({ title: `Remove ${plural(ids.length, 'household')} from this occasion?`, text: 'They stay in your address book.', ok: 'Remove', danger: true })) return;
      await withBusy(el, async () => {
        for (let i = 0; i < ids.length; i += 1000) await setTags(add ? ids.slice(i, i + 1000) : [], add ? [] : ids.slice(i, i + 1000));
        render();
      });
      break;
    }
    case 'print': printModal(); break;
    case 'mark-printed':
      await withBusy(el, async () => {
        await setMailed(lastPrinted, true);
        el.closest('[data-after]').textContent = `Marked ${plural(lastPrinted.length, 'household')} as mailed.`;
        render();
      });
      break;
    case 'invites': invitesModal(); break;
    case 'design': designModal(); break;
    case 'design-from-edit': await saveOccasion(el.closest('form'), { thenDesign: true }); break;
    case 'test-invite':
      await withBusy(el, async () => {
        const res = await api(`/occasions/${state.occasionId}/invites`, { method: 'POST', body: { test: true } });
        toast(`Test sent to ${res.sentTo}`);
      });
      break;
    default:
  }
});

document.addEventListener('keydown', (e) => { if (e.target.matches?.('[data-chip-text]')) onGroupKey(e); }, true);
document.addEventListener('mousedown', (e) => {
  // Picking a suggestion: keep focus in the box.
  const opt = e.target.closest('.chip-option');
  if (opt) {
    e.preventDefault();
    const box = opt.closest('[data-chips]');
    addGroupChip(box, opt.dataset.value);
    box.querySelector('[data-chip-text]').value = '';
    hideGroupSuggest(box);
    showGroupSuggest(box);
  } else if (e.target.matches?.('[data-chips]')) {
    e.preventDefault();
    e.target.querySelector('[data-chip-text]').focus();
    showGroupSuggest(e.target);
  }
});
// The group suggestions open when you click into Groups or start typing (or press ↓), not just
// because the box got the focus, so they don't cover the tab when it opens.
document.addEventListener('click', (e) => { if (e.target.matches?.('[data-chip-text]')) showGroupSuggest(e.target.closest('[data-chips]')); });
document.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-chip-text]')) hideGroupSuggest(e.target.closest('[data-chips]')); });
// Phone numbers tidy themselves into (248) 555-0101 when you leave the box.
document.addEventListener('focusout', (e) => {
  if (!e.target.matches?.('[data-m=phone]')) return;
  const tidy = formatPhone(e.target.value);
  if (tidy !== e.target.value) e.target.value = tidy;
});

document.addEventListener('input', (e) => {
  // Changing the address makes an earlier check out of date.
  if (e.target.closest?.('[data-hh-panel=address]') && e.target.name && ['line1', 'line2', 'city', 'state', 'zip', 'country'].includes(e.target.name)) {
    const out = modal.querySelector('[data-addr-result]');
    if (out) out.innerHTML = '';
  }
  if (e.target.matches?.('[data-chip-text]')) {
    const box = e.target.closest('[data-chips]');
    if (e.target.value.includes(',')) { // pasted "Family, Work"
      const parts = e.target.value.split(',');
      e.target.value = parts.pop();
      parts.forEach((g) => addGroupChip(box, g));
    }
    showGroupSuggest(box);
  }
  if (e.target.name === 'formalName') delete e.target.dataset.auto; // typed by hand: never replace it
  const k = e.target.dataset?.input;
  if (k === 'search') { state.search = e.target.value; renderHouseholdList(); }
  if (k === 'occ-search') { state.occSearch = e.target.value; renderRecipientRows(); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches?.('[data-who]')) syncSendRows();
  if (t.matches?.('[data-occ-kind]')) {
    modal.querySelectorAll('[data-kinds]').forEach((el) => {
      el.hidden = !el.dataset.kinds.split(' ').includes(t.value);
      if (el.tagName === 'OPTION') { el.disabled = el.hidden; if (el.hidden && el.selected) el.parentElement.value = 'informal'; }
    });
  }
  if (t.dataset?.m === 'primary' && t.checked) {
    t.closest('[data-members]').querySelectorAll('[data-m=primary]').forEach((cb) => { if (cb !== t) cb.checked = false; });
  }
  // "Peter and Paula" typed into one First box becomes two people sharing the last name.
  if (t.dataset?.m === 'firstName') {
    const names = splitFirstNames(t.value);
    const row = t.closest('[data-member]');
    if (names && row) {
      const box = row.parentElement;
      const room = 20 - box.children.length;
      const last = row.querySelector('[data-m=lastName]').value.trim();
      t.value = names[0];
      row.insertAdjacentHTML('afterend', names.slice(1, 1 + room).map((firstName) => memberRow({ firstName, lastName: last })).join(''));
      toast(`Split into ${names.length} people`);
    }
  }
  // Formal name follows the greeting and last name until it's typed by hand.
  if (['greeting', 'labelName'].includes(t.name) || t.dataset?.m === 'lastName' || t.dataset?.m === 'firstName') refreshFormalName(t.form);
  const k = t.dataset?.input;
  if (t.dataset?.shareRole) {
    const { email } = t.dataset;
    t.disabled = true;
    api(`/shares/${encodeURIComponent(t.dataset.shareRole)}`, { method: 'PUT', body: { role: t.value } })
      .then((res) => { shares = res.shares; toast(`${email}: ${ROLE_LABEL[t.value]}`); })
      .catch((err) => { toast(err.message, true); renderShareList(); })
      .finally(() => { t.disabled = false; });
  }
  if (k === 'csv-file' && t.files?.[0]) readImportFile(t.files[0]).catch((err) => modalError(err.message));
  if (t.dataset?.map !== undefined) updateImportSummary();
  if (t.form?.dataset.form === 'print' && ['what', 'media', 'withBack'].includes(t.name)) syncPrintForm({ whatChanged: t.name === 'what' });
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  modalError('');
  if (kind === 'auth') return submitAuth(form);
  if (kind.startsWith('household-')) return saveHousehold(form);
  if (kind.startsWith('occasion-')) return saveOccasion(form);
  if (kind === 'print') return makePdf(form);
  if (kind === 'invites') return sendInvites(form);
  if (kind === 'design') return saveDesign(form);
  if (kind === 'import') return runImport(form.querySelector('[data-import-go]'));
  if (kind === 'share') return addShare(form);
  if (kind === 'settings-password') return withBusy(form.querySelector('button[type=submit]'), () => changePassword(form));
  if (['settings-profile', 'settings-return', 'settings-printer'].includes(kind)) {
    const tab = kind.slice('settings-'.length);
    return withBusy(form.querySelector('.btn.primary'), async () => {
      const res = await api('/me', { method: 'PUT', body: readSettings(form, tab) });
      state.me.profile = res.profile;
      state.me.book = res.book;
      closeModal();
      toast({ profile: 'Profile saved', return: 'Return address saved', printer: 'Printer settings saved' }[tab]);
      render();
    });
  }
  if (kind.startsWith('addrreq-')) {
    const id = kind.slice('addrreq-'.length);
    return withBusy(form.querySelector('.btn.primary'), async () => {
      const res = await api(`/households/${id}/address-request`, { method: 'POST', body: { message: form.message.value.trim() } });
      upsertHousehold(res.household);
      closeModal(); toast(`Sent to ${res.sentTo.join(', ')}`); render();
    });
  }
  return undefined;
});

// The close event arrives a moment later; if another window has opened in the meantime (Edit occasion →
// Design), keep it.
modal.addEventListener('close', () => { if (!modal.open) modal.innerHTML = ''; });

// ---------- inactivity sign-out ----------
// After 30 minutes with no mouse, keyboard, scroll or touch activity, the app signs out; a dialog
// warns 2 minutes before. The last activity time is shared through localStorage, so working in one
// tab keeps the others signed in, and a Mac that slept past the limit signs out when it wakes.
// The warning sits on top of any open dialog, so "Stay signed in" keeps unsaved edits.
const IDLE_LIMIT = 30 * 60_000;
const IDLE_WARNING = 2 * 60_000;
const ACTIVE_KEY = 'oab.lastActive';
const idleEl = Object.assign(document.createElement('dialog'), { className: 'confirm-modal idle-modal' });
idleEl.setAttribute('aria-labelledby', 'idle-title');
document.body.append(idleEl);
let lastActive = Date.now();
let idleTimer = null;

function readLastActive() {
  try { return Math.max(lastActive, Number(localStorage.getItem(ACTIVE_KEY)) || 0); } catch { return lastActive; }
}
function markActive(force = false) {
  const t = Date.now();
  if (!force && t - lastActive < 10_000) return; // write at most every 10 seconds
  lastActive = t;
  try { localStorage.setItem(ACTIVE_KEY, String(t)); } catch { /* private mode: this tab only */ }
}
const fmtLeft = (ms) => { const sec = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

function showIdleWarning(left) {
  if (!idleEl.open) {
    idleEl.innerHTML = `<form method="dialog" class="confirm-box">
      <h2 id="idle-title">Still there?</h2>
      <p>You'll be signed out in <b data-idle-left>${fmtLeft(left)}</b>.</p>
      <div class="confirm-buttons">
        <button type="submit" value="out" class="btn">Sign out</button>
        <button type="submit" value="stay" class="btn primary" data-idle-stay>Stay signed in</button>
      </div></form>`;
    idleEl.returnValue = '';
    idleEl.onclose = () => {
      if (idleEl.returnValue === 'out') auth.signOut();
      else markActive(true); // "Stay signed in", or Esc
    };
    idleEl.showModal();
    idleEl.querySelector('[data-idle-stay]').focus();
  } else {
    idleEl.querySelector('[data-idle-left]').textContent = fmtLeft(left);
  }
}

function checkIdle() {
  if (!state.session) { if (idleEl.open) { idleEl.onclose = null; idleEl.close(); } return; }
  const idle = Date.now() - readLastActive();
  if (idle >= IDLE_LIMIT) {
    if (idleEl.open) { idleEl.onclose = null; idleEl.close(); }
    auth.signOut();
  } else if (idle >= IDLE_LIMIT - IDLE_WARNING) {
    showIdleWarning(IDLE_LIMIT - idle);
  } else if (idleEl.open) {
    idleEl.onclose = null; idleEl.close(); // activity in another tab
  }
}

// Still signed in from a visit that ended more than 30 minutes ago?
function staleSession() {
  try {
    const stored = Number(localStorage.getItem(ACTIVE_KEY)) || 0;
    return Boolean(stored) && Date.now() - stored >= IDLE_LIMIT;
  } catch { return false; }
}

function startIdleWatch() {
  markActive(true);
  clearInterval(idleTimer);
  idleTimer = setInterval(checkIdle, 1000);
}
function stopIdleWatch() {
  clearInterval(idleTimer);
  idleTimer = null;
  if (idleEl.open) { idleEl.onclose = null; idleEl.close(); }
}

for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  document.addEventListener(ev, () => { if (state.session && !idleEl.open) markActive(); }, { passive: true, capture: true });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.session) checkIdle(); });


auth.onChange((event, session) => {
  const wasSignedIn = Boolean(state.session);
  state.session = session;
  if (!session) {
    stopIdleWatch();
    if (wasSignedIn) state.showLanding = true; // signing out goes back to the welcome page
    Object.assign(state, { me: null, books: [], households: [], occasions: [], occasionId: null, occ: null, view: 'people' });
    if (wasSignedIn && Date.now() - readLastActive() >= IDLE_LIMIT) { state.authErr = ''; state.authMsg = 'You were signed out after 30 minutes without activity.'; }
    if (wasSignedIn) state.bookId = storedBook(); // a different person may sign in next; loadAll checks the book is theirs
    if (modal.open) modal.close();
    if (wasSignedIn || event !== 'INITIAL_SESSION') state.authMode = 'signin';
    return renderAuth();
  }
  if (!wasSignedIn) {
    // Reopening the app after more than 30 minutes away: sign out instead of picking up where it left off.
    if (event === 'INITIAL_SESSION' && staleSession()) {
      state.session = null;
      state.authMsg = 'You were signed out after 30 minutes without activity.';
      auth.signOut();
      return renderAuth();
    }
    state.authMode = 'signin'; state.authErr = ''; state.authMsg = '';
    startIdleWatch();
    setTimeout(loadAll, 0);
  }
  return undefined;
});
