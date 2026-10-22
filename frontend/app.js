import { createAuth } from './auth.js';
import {
  addressLines, buildEnvelopes, buildLabels, envelopeName, isMailable, sortKey, LABEL_SHEETS, ENVELOPES,
} from './print-core.js';
import { activeCount, emptyFilter, filterChips, filterOptions, matchesFilter } from './filter-core.js';
import {
  parseCsv, FIELDS, guessMapping, looksLikeHeader, buildHouseholds, householdsToCsv, splitFirstNames, splitMembers,
  defaultFormalName, householdLastName, effectiveFormalName, peopleWithHouseholdContact,
} from './csv-core.js';
import { householdToVcard, fileBaseName } from './vcard-core.js';

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

const KIND_LABEL = { card: 'Cards', invite: 'Invitation', other: 'Other' };
const INVITE_BATCH = 25;

const state = {
  session: null, pendingEmail: null, books: [], bookId: '', authMode: 'signin', authMsg: '', authErr: '', authEmail: rememberedEmail(),
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
const CHEVRON = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOGO = '<img class="logo" src="icon-192.png" width="64" height="64" alt="">';

// Access to the address book in use: your own, or one shared with you (edit or view only).
const canEdit = () => state.me?.book?.canEdit !== false;
const isOwner = () => !state.me?.book || state.me.book.role === 'owner';
const ROLE_LABEL = { edit: 'Can edit', view: 'View only' };

function sharedNote() {
  const b = state.me?.book;
  if (!b || b.role === 'owner') return '';
  return `<div class="shared-note">You're in <b>${esc(b.ownerName || b.ownerEmail)}</b>'s shared address book · ${ROLE_LABEL[b.role]}.
    ${state.books.length > 1 ? '<button class="link" data-action="switch-book" data-id="">Go to my address book</button>' : ''}</div>`;
}

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
function askConfirm({ title, text = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
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
    confirmEl.onclick = (e) => { if (e.target === confirmEl) done(false); }; // the backdrop
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
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(state.bookId && state.bookId !== session.user?.sub ? { 'x-book': state.bookId } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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

function renderAuth() {
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
    ? '<button class="link" data-action="auth-mode" data-mode="reset">Forgot password?</button>'
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
    const [me, hh, occ] = await Promise.all([api('/me'), api('/households'), api('/occasions')]);
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
  <main class="page">${sharedNote()}${state.loading && !state.me ? '<p class="boot">Loading your address book…</p>'
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
      ${canEdit() ? '<div class="row-gap"><button class="btn primary" data-action="add-household" title="New household (N)" aria-keyshortcuts="n">+ Household <kbd>N</kbd></button><button class="btn" data-action="import">Import a spreadsheet (CSV)</button></div>' : ''}
    </div>`;
  }
  return `
  <div class="page-head">
    <h1>Address book <span class="muted count">${plural(state.households.length, 'household')}</span></h1>
    <div class="actions">
      ${canEdit() ? '<button class="btn" data-action="import">Import CSV</button>' : ''}
      <button class="btn" data-action="export">Export CSV</button>
      ${canEdit() ? '<button class="btn primary" data-action="add-household" title="New household (N)" aria-keyshortcuts="n">+ Household <kbd>N</kbd></button>' : ''}
    </div>
  </div>
  ${pending ? `<div class="notice"><span><b>${plural(pending, 'household')}</b> sent back ${pending === 1 ? 'an address' : 'addresses'} to review.</span>
    <button class="btn sm" data-action="pending-only">${state.filters.people.review ? 'Show everyone' : (pending === 1 ? 'Show it' : 'Show them')}</button></div>` : ''}
  <div class="filters">
    <input type="search" data-input="search" placeholder="Search names, streets, cities, emails…" value="${val(state.search)}" aria-label="Search">
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
  return `${search && options.length > 8 ? `<input type="search" class="fp-search" data-fp-search="${name}" placeholder="Find…" aria-label="Find">` : ''}
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
      <section><h3>Mailing address</h3>${radios('address', f.address, [['', 'Any'], ['complete', 'Has one'], ['missing', 'Missing']])}</section>
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
  const zip = panel.querySelector('[data-f=zip]'); if (zip && document.activeElement !== zip) zip.value = f.zip ?? '';
}

function readFilterPanel(panel) {
  const vals = (name) => [...panel.querySelectorAll(`[data-f="${name}"]:checked`)].map((cb) => cb.value);
  const radio = (name) => panel.querySelector(`[data-f="${name}"]:checked`)?.value ?? '';
  return {
    groups: vals('groups'), groupMode: radio('groupMode') || 'any', cities: vals('cities'), states: vals('states'),
    zip: panel.querySelector('[data-f=zip]').value.trim(), email: radio('email'), address: radio('address'),
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

function householdCard(h) {
  const lines = addressLines('', h.address);
  const badges = [
    h.pendingUpdate && '<span class="pill due-soon">New address to review</span>',
    !isMailable(h.address) && '<span class="pill unknown">No mailing address</span>',
  ].filter(Boolean).join('');
  const note = h.notes?.trim();
  return `<button class="hh-card${note ? ' has-note' : ''}" data-action="edit-household" data-id="${esc(h.id)}">
    ${note ? `<span class="hh-note" data-action="show-note" data-note="${esc(note)}" title="Show note"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="6.3" r="1.1" fill="currentColor"/><path d="M10 9v5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="sr">Note: ${esc(note)}</span></span>` : ''}
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
function openModal(title, body, { form, foot = '', wide = false, head = '' } = {}) {
  modal.style.width = wide ? 'min(760px, calc(100vw - 32px))' : '';
  modal.innerHTML = `<form data-form="${form}" novalidate>
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

// ---------- address checks (USPS) ----------
// USPS allows 60 checks an hour for the whole app; the API counts them and says how many are left.
// The button is hidden until address checks are set up, and disabled (no message) while the hour's checks
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
  // Turn the button back on when the hour rolls over.
  clearTimeout(addressChecksTimer);
  if (out && c.availableAt) {
    addressChecksTimer = setTimeout(() => { addressChecks = null; if (modal.open) loadAddressChecks(); }, Math.max(5_000, Date.parse(c.availableAt) - Date.now() + 2_000));
  }
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'zip'];
const sameAddress = (a, b) => ADDRESS_KEYS.every((k) => String(a[k] ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b[k] ?? '').trim().replace(/\s+/g, ' ').toLowerCase());
const CHECK_VERDICTS = {
  confirmed: ['ok', 'USPS confirms this address.'],
  'needs-unit': ['warn', 'USPS says this address needs an apartment or unit number.'],
  'unit-unconfirmed': ['warn', "USPS found the building but not that apartment or unit."],
  'not-found': ['bad', "USPS couldn't find this address."],
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
      <div>${tone === 'ok' ? CHECK_ICON : ''} <b>${esc(text)}</b>${vacant ? ' <span class="muted">USPS lists it as vacant.</span>' : ''}</div>
      ${differs ? `<div class="compare">
          <div><span class="small muted">You entered</span><div>${addressLines('', typed).map(esc).join('<br>') || '—'}</div></div>
          <div><span class="small muted">USPS</span><div>${addressLines('', suggested).map(esc).join('<br>')}</div></div>
        </div>
        <div class="row-gap"><button type="button" class="btn sm primary" data-action="use-usps-address">Use USPS address</button>
          <button type="button" class="btn sm" data-action="keep-typed-address">Keep mine</button></div>` : ''}
    </div>`;
    out.querySelector('[data-action=use-usps-address]')?.addEventListener('click', () => {
      for (const k of ADDRESS_KEYS) form.elements[k].value = suggested[k] ?? '';
      out.innerHTML = `<div class="check-result ok"><div>${CHECK_ICON} <b>Updated to the USPS address.</b> <span class="muted">Save to keep it.</span></div></div>`;
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

async function saveHousehold(form) {
  const id = form.dataset.form.replace(/^household-/, '');
  const body = readHousehold(form);
  if (!body.labelName) { showHouseholdTab('greetings'); return modalError('Enter the Household Greeting.'); }
  await withBusy(form.querySelector('.btn.primary'), async () => {
    const res = id === 'new' ? await api('/households', { method: 'POST', body }) : await api(`/households/${id}`, { method: 'PUT', body });
    upsertHousehold(res.household);
    closeModal();
    toast(id === 'new' ? 'Household added' : 'Saved');
    render();
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
  openModal('Import a spreadsheet', `
    <p style="margin:0">Save your list from Excel, Numbers or Google Sheets as <b>CSV</b>, with one row per household (or one row per person if each person has their own address).</p>
    <input type="file" accept=".csv,text/csv" data-input="csv-file" class="imp-file">
    <div data-import-step></div>`, { form: 'import', wide: true, foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" disabled data-import-go>Import</button></div>' });
}

async function readCsvFile(file) {
  const rows = parseCsv(await file.text());
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
  const noAddr = households.filter((h) => !isMailable(h.address)).length;
  modal.querySelector('[data-import-summary]').innerHTML = `Ready to import <b>${plural(households.length, 'household')}</b>${
    skipped.length ? `; ${plural(skipped.length, 'row')} without a name will be skipped` : ''}${
    noAddr ? `; ${noAddr} ${noAddr === 1 ? 'has' : 'have'} no complete mailing address yet` : ''}.`;
  const go = modal.querySelector('[data-import-go]');
  go.disabled = !households.length;
  go.textContent = households.length ? `Import ${plural(households.length, 'household')}` : 'Import';
}

async function runImport(btn) {
  const { households } = buildHouseholds(importRows.data, currentMapping());
  await withBusy(btn, async () => {
    for (let i = 0; i < households.length; i += 500) {
      await api('/households/import', { method: 'POST', body: { households: households.slice(i, i + 500) } });
    }
    await refreshHouseholds();
    closeModal();
    toast(`Imported ${plural(households.length, 'household')}`);
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
      <span class="occ-kind pill ${o.kind === 'invite' ? 'ok' : o.kind === 'card' ? 'due-soon' : 'unknown'}">${KIND_LABEL[o.kind]}</span>
      <span class="hh-name">${esc(o.name)}</span>
      <span class="small muted">${o.date ? fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}</span>
      <span class="small">${plural(o.counts.tagged, 'household')} on the list${o.kind !== 'invite' ? ` · ${o.counts.mailed} mailed` : ` · ${o.counts.invited} emailed`}</span>
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
  const when = [o.date && fmtDate(o.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), o.time].filter(Boolean).join(' at ');
  return `
  <button class="link back" data-action="view" data-view="occasions">← Occasions</button>
  <div class="page-head">
    <div><h1>${esc(o.name)}</h1>
      <p class="muted" style="margin:2px 0 0">${[KIND_LABEL[o.kind], when, o.location].filter(Boolean).map(esc).join(' · ')}</p></div>
    <div class="actions">
      ${canEdit() ? `<button class="btn" data-action="edit-occasion">${PENCIL} Edit</button>
      <button class="btn" data-action="invites" ${withEmail ? '' : 'disabled title="Nobody on the list has an email address"'}>${MAIL} Email invitations…</button>` : ''}
      <button class="btn primary" data-action="print" ${onList.length ? '' : 'disabled title="Tick households for this occasion first"'}>Print labels / envelopes…</button>
    </div>
  </div>
  <div class="stats">
    <div><b>${onList.length}</b><span>on the list</span></div>
    <div><b>${mailed}</b><span>mailed</span></div>
    <div><b>${invited}</b><span>emailed</span></div>
    ${noAddr ? `<div class="warn"><b>${noAddr}</b><span>missing an address</span></div>` : ''}
  </div>
  <div class="filters">
    <div class="seg" role="group" aria-label="Show">
      ${[['all', 'Everyone'], ['on', 'On the list'], ['off', 'Not on the list'], ['unmailed', 'Not mailed yet']].map(([k, l]) => `<button type="button" data-action="occ-filter" data-filter="${k}" aria-pressed="${state.occFilter === k}">${l}</button>`).join('')}
    </div>
    <input type="search" data-input="occ-search" placeholder="Search…" value="${val(state.occSearch)}" aria-label="Search">
    ${filterButton('occ')}
  </div>
  <div class="filter-chips" id="fchips-occ">${filterChipsHtml('occ')}</div>
  <div class="bulk small"><span data-shown></span>
    ${canEdit() ? `<button class="link" data-action="bulk-tag" data-add="1">Add all shown to the list</button>
    <button class="link" data-action="bulk-tag" data-add="">Remove all shown</button>` : ''}
  </div>
  <div class="panel tight"><table class="items rcpt">
    <thead><tr><th style="width:44px"><span class="sr">On the list</span></th><th>Household</th><th>Greeting</th><th>Address</th><th class="col-mailed">Mailed</th><th class="col-email">Email</th></tr></thead>
    <tbody id="rcpt-rows"></tbody></table></div>`;
}

function shownRecipients() {
  const tags = tagMap();
  return state.households.filter((h) => {
    const t = tags.get(h.id);
    if (state.occFilter === 'on' && !t) return false;
    if (state.occFilter === 'off' && t) return false;
    if (state.occFilter === 'unmailed' && (!t || t.mailedAt)) return false;
    return matchesFilter(h, state.filters.occ) && matchesSearch(h, state.occSearch);
  }).sort(byName);
}

// Who's in a household, for the occasion list: the greeting, else the people's first names.
function whoText(h) {
  if (h.greeting?.trim()) return h.greeting.trim();
  const names = splitMembers(h.members ?? []).map((m) => m.firstName).filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
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
    const emailCell = !t ? '' : t.invitedAt ? `<span class="pill ok" title="${esc((t.invitedTo ?? []).join(', '))}">Sent ${fmtDate(t.invitedAt, { month: 'short', day: 'numeric' })}</span>`
      : t.inviteError ? `<span class="pill overdue" title="${esc(t.inviteError)}">Failed</span>`
        : email ? '<span class="muted small">Not sent</span>' : '<span class="muted small">No email</span>';
    return `<tr class="${t ? 'on' : ''}">
      <td><input type="checkbox" data-action="tag" data-id="${esc(h.id)}" ${t ? 'checked' : ''} ${canEdit() ? '' : 'disabled'} aria-label="${esc(h.labelName)} on the list"></td>
      <td><button class="link-btn" data-action="edit-household" data-id="${esc(h.id)}">${esc(h.labelName)}</button>${h.pendingUpdate ? ' <span class="pill due-soon">New address</span>' : ''}</td>
      <td class="col-greeting small">${esc(whoText(h))}</td>
      <td class="small">${isMailable(h.address) ? esc(addressLines('', h.address).join(', ')) : '<span class="pill unknown">No address</span>'}</td>
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

// The two name choices, with an example from the list (a household that has a formal name) when there is one.
function nameStyleOptions(current, householdIds = []) {
  const byId = hhById();
  const pool = [...householdIds.map((id) => byId.get(id)).filter(Boolean), ...state.households];
  const ex = pool.find((h) => effectiveFormalName(h) && effectiveFormalName(h) !== h.labelName);
  const [everyday, formal] = ex ? [ex.labelName, effectiveFormalName(ex)] : ['The Smith Family', 'Mr. and Mrs. John Smith'];
  return `<option value="label" ${current !== 'formal' ? 'selected' : ''}>Household Greeting, e.g. "${esc(everyday)}"</option>
      <option value="formal" ${current === 'formal' ? 'selected' : ''}>Formal Greeting, e.g. "${esc(formal)}"</option>`;
}

function occasionModal(o) {
  const isNew = !o;
  o ??= { kind: 'card', nameStyle: 'label', invite: {} };
  const copyable = state.occasions.filter((x) => x.counts.tagged);
  openModal(isNew ? 'New occasion' : 'Edit occasion', `
    <label>Name<input name="name" required maxlength="120" value="${val(o.name)}" placeholder="Christmas cards ${new Date().getFullYear()}"></label>
    <div class="grid-3">
      <label>Type<select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Date <span class="muted">(optional)</span><input type="date" name="date" value="${val(o.date)}"></label>
      <label>Time <span class="muted">(optional)</span><input name="time" maxlength="40" value="${val(o.time)}" placeholder="7:00 PM"></label>
    </div>
    <label>Location <span class="muted">(optional)</span><input name="location" maxlength="300" value="${val(o.location)}"></label>
    <label>Name printed on labels and envelopes<select name="nameStyle">
      ${nameStyleOptions(o.nameStyle, isNew ? [] : (state.occ?.tags ?? []).map((t) => t.householdId))}</select>
      <span class="hint">You can still switch it each time you print.</span></label>
    ${isNew && copyable.length ? `<label>Start with the list from <span class="muted">(optional)</span><select name="copyFrom"><option value="">Nobody yet</option>
      ${copyable.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${x.counts.tagged})</option>`).join('')}</select></label>` : ''}
    <fieldset><legend>Email invitation <span class="muted">(optional)</span></legend>
      <label>Subject<input name="subject" maxlength="200" value="${val(o.invite?.subject)}" placeholder="You're invited: ${val(o.name) || 'our holiday open house'}"></label>
      <label>Message<textarea name="message" rows="5" maxlength="5000" placeholder="Join us for…">${esc(o.invite?.message ?? '')}</textarea></label>
      <p class="hint">Each household gets one email to all of its addresses, starting "Dear …" with their greeting name, followed by your message and the date, time and location. Replies come to you.</p>
    </fieldset>
    <label>Notes<textarea name="notes" rows="2" maxlength="2000">${esc(o.notes ?? '')}</textarea></label>`, {
    form: isNew ? 'occasion-new' : 'occasion-edit',
    wide: true,
    foot: `<div class="left-actions">${isNew ? '' : '<button type="button" class="btn danger" data-action="delete-occasion">Delete</button>'}</div>
      <div class="right"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">${isNew ? 'Create' : 'Save'}</button></div>`,
  });
}

async function saveOccasion(form) {
  const f = form.elements;
  const body = {
    name: f.namedItem('name').value.trim(), kind: f.kind.value, date: f.date.value, time: f.time.value.trim(), location: f.location.value.trim(),
    nameStyle: f.nameStyle.value, notes: f.notes.value.trim(),
    invite: { subject: f.subject.value.trim(), message: f.message.value.trim() },
    copyFrom: f.copyFrom?.value || undefined,
  };
  if (!body.name) return modalError('Give the occasion a name.');
  const isNew = form.dataset.form === 'occasion-new';
  await withBusy(form.querySelector('.btn.primary'), async () => {
    const res = isNew ? await api('/occasions', { method: 'POST', body }) : await api(`/occasions/${state.occasionId}`, { method: 'PUT', body });
    await refreshOccasions();
    closeModal();
    state.view = 'occasions';
    if (isNew) { state.occFilter = res.copied ? 'on' : 'all'; state.occSearch = ''; }
    await openOccasion(res.occasion.id);
    render();
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

function printModal() {
  const o = state.occ.occasion;
  const tags = tagMap();
  const unmailed = [...tags.values()].filter((t) => !t.mailedAt).length;
  const hasReturn = returnLines().length > 0;
  openModal('Print labels or envelopes', `
    <fieldset><legend>What to print</legend>
      <label class="check"><input type="radio" name="what" value="labels" checked> ${esc(LABEL_SHEETS.avery5160.name)}</label>
      <label class="check"><input type="radio" name="what" value="envelopes"> ${esc(ENVELOPES.a7.name)}, printed directly</label>
      <label class="check"><input type="radio" name="what" value="return"> Return-address labels on Avery 5160 / 8160 ${hasReturn ? '' : '<span class="muted">(set your return address in Settings)</span>'}</label>
    </fieldset>
    <div class="grid-2" data-for="who">
      <label>Who<select name="who">
        <option value="unmailed">Not mailed yet (${unmailed})</option>
        <option value="all">Everyone on the list (${tags.size})</option>
        <option value="shown">On the list and shown below (${shownRecipients().filter((h) => tags.has(h.id)).length})</option></select></label>
      <label>Order<select name="order"><option value="name">By last name</option><option value="zip">By ZIP code</option></select></label>
    </div>
    <label data-for="name">Name printed on the first line<select name="nameStyle">
      ${nameStyleOptions(o.nameStyle, [...tags.keys()])}</select>
      <span class="hint">Households with no Formal Greeting use their Household Greeting either way.</span></label>
    <label data-for="start">Start on label number <span class="muted">(1–30, to use up a partly used sheet)</span><input name="start" type="number" min="1" max="30" value="1" style="max-width:110px"></label>
    <label class="check" data-for="ret"><input type="checkbox" name="withReturn" ${hasReturn ? 'checked' : 'disabled'}> Print my return address in the corner</label>
    <label class="check"><input type="checkbox" name="outline"> Draw outlines (for a test print on plain paper)</label>
    <p class="hint" data-hint></p>
    <div data-after hidden class="notice"></div>`, {
    form: 'print',
    foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button><button class="btn primary">Make PDF</button></div>',
  });
  syncPrintForm();
}

function syncPrintForm() {
  const f = modal.querySelector('form').elements;
  const what = f.what.value;
  const show = (k, on) => { modal.querySelector(`[data-for=${k}]`).hidden = !on; };
  show('who', what !== 'return');
  show('name', what !== 'return');
  show('start', what !== 'envelopes');
  show('ret', what === 'envelopes');
  modal.querySelector('[data-hint]').innerHTML = what === 'envelopes'
    ? 'In the print dialog choose the <b>A7 envelope</b> paper size (5.25 × 7.25 in), <b>Actual size / 100%</b> scale, and feed envelopes as your printer shows. Fine-tune the position in Settings if it lands off-center.'
    : what === 'return'
      ? 'Prints a full sheet of 30 return-address labels. Print at <b>Actual size / 100%</b> on Letter paper.'
      : 'Print at <b>Actual size / 100%</b> (not "Fit to page") on Letter paper. Try one sheet on plain paper with outlines first, holding it over a label sheet to check alignment.';
}

async function makePdf(form) {
  const f = form.elements;
  const what = f.what.value;
  const print = state.me?.profile?.print ?? {};
  const outline = f.outline.checked;
  await withBusy(form.querySelector('.btn.primary'), async () => {
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
      const tags = tagMap();
      const byId = hhById();
      const shownIds = new Set(shownRecipients().map((h) => h.id));
      households = [...tags.values()]
        .filter((t) => f.who.value === 'all' || (f.who.value === 'unmailed' ? !t.mailedAt : shownIds.has(t.householdId)))
        .map((t) => byId.get(t.householdId)).filter(Boolean);
      const skipped = households.filter((h) => !isMailable(h.address));
      households = households.filter((h) => isMailable(h.address));
      households.sort(f.order.value === 'zip'
        ? (a, b) => String(a.address.zip ?? '').localeCompare(String(b.address.zip ?? '')) || byName(a, b)
        : byName);
      if (!households.length) throw new Error(skipped.length ? 'Nobody chosen has a complete mailing address.' : 'Nobody to print for.');
      // Formal: the saved formal name, else the same "Mr. and Mrs. <Last>" suggestion the edit screen shows.
      const items = households.map((h) => addressLines(envelopeName({ ...h, formalName: effectiveFormalName(h) }, f.nameStyle.value), h.address));
      doc = what === 'labels'
        ? buildLabels(JsPDF, items, { start: Number(f.start.value) || 1, offsetX: print.labelOffsetX, offsetY: print.labelOffsetY, outline })
        : buildEnvelopes(JsPDF, items, {
          returnLines: f.withReturn.checked ? returnLines() : [], offsetX: print.envelopeOffsetX, offsetY: print.envelopeOffsetY, outline,
        });
      if (skipped.length) toast(`Skipped ${plural(skipped.length, 'household')} with no complete address: ${skipped.slice(0, 3).map((h) => h.labelName).join(', ')}${skipped.length > 3 ? '…' : ''}`, true);
    }
    const url = doc.output('bloburl');
    const win = window.open(url, '_blank');
    lastPrinted = households.map((h) => h.id);
    const after = modal.querySelector('[data-after]');
    after.hidden = false;
    after.innerHTML = `<span>${win ? 'The PDF opened in a new tab.' : `<a href="${url}" target="_blank" rel="noopener">Open the PDF</a> (your browser blocked the new tab).`}
      ${lastPrinted.length && canEdit() ? `Once they're in the mail, mark ${plural(lastPrinted.length, 'household')} as mailed.` : ''}</span>
      ${lastPrinted.length && canEdit() ? '<button type="button" class="btn sm primary" data-action="mark-printed">Mark mailed</button>' : ''}`;
  });
}

// ---------- invitations ----------
function invitesModal() {
  const o = state.occ.occasion;
  const tags = tagMap();
  const byId = hhById();
  const on = [...tags.values()].map((t) => ({ t, h: byId.get(t.householdId) })).filter((x) => x.h);
  const withEmail = on.filter((x) => allEmails(x.h).length);
  const notSent = withEmail.filter((x) => !x.t.invitedAt);
  if (!o.invite?.message) {
    openModal('Email invitations', `<p style="margin:0">Write the invitation first: open <b>Edit</b> and fill in the email message.</p>`, {
      form: 'noop', foot: '<div></div><div class="right"><button type="button" class="btn" data-action="close">Close</button><button type="button" class="btn primary" data-action="edit-occasion">Edit occasion</button></div>',
    });
    return;
  }
  const several = withEmail.filter((x) => (x.h.members ?? []).filter((m) => m.email).length > 1).sort((a, b) => byName(a.h, b.h));
  openModal('Email invitations', `
    <div class="invite-preview"><div class="small muted">Subject</div><div><b>${esc(o.invite.subject || `You're invited: ${o.name}`)}</b></div>
      <div class="small muted" style="margin-top:8px">Message</div><div class="pre">${esc(o.invite.message)}</div></div>
    <label class="check"><input type="radio" name="who" value="new" checked> Not sent yet (${notSent.length})</label>
    <label class="check"><input type="radio" name="who" value="all"> Everyone with email (${withEmail.length})</label>
    ${several.length ? `<fieldset><legend>Send to</legend><div class="sendto-list">${several.map(({ h }) => sendToRow(h)).join('')}</div></fieldset>` : ''}
    <div data-progress hidden class="notice"></div>`, {
    form: 'invites',
    foot: `<div class="left-actions"><button type="button" class="btn" data-action="test-invite">Send a test to me</button></div>
      <div class="right"><button type="button" class="btn" data-action="close">Close</button><button class="btn primary">Send</button></div>`,
  });
}

const personName = (m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;

function sendToRow(h) {
  const people = (h.members ?? []).filter((m) => m.email);
  const d = defaultPerson(h.members);
  return `<label class="sendto-row"><span>${esc(h.labelName)}</span><select data-sendto="${esc(h.id)}" aria-label="Send ${esc(h.labelName)}'s invitation to">
    ${people.map((m) => `<option value="${m === d ? 'default' : esc(m.id)}" ${m === d ? 'selected' : ''}>${esc(personName(m))}${m === d ? ' (default)' : ''}</option>`).join('')}
    <option value="all">${people.length === 2 ? 'Both' : 'Everyone'}</option></select></label>`;
}

async function sendInvites(form) {
  const tags = tagMap();
  const byId = hhById();
  const ids = [...tags.values()]
    .filter((t) => byId.get(t.householdId) && allEmails(byId.get(t.householdId)).length && (form.elements.who.value === 'all' || !t.invitedAt))
    .map((t) => t.householdId);
  if (!ids.length) return modalError('Nobody to send to.');
  if (!await askConfirm({ title: 'Send invitations?', text: `Email the invitation to ${plural(ids.length, 'household')} now.`, ok: 'Send' })) return undefined;
  const prog = modal.querySelector('[data-progress]');
  prog.hidden = false;
  const results = [];
  await withBusy(form.querySelector('.btn.primary'), async () => {
    for (let i = 0; i < ids.length; i += INVITE_BATCH) {
      prog.textContent = `Sending… ${Math.min(i, ids.length)} of ${ids.length}`;
      const batch = ids.slice(i, i + INVITE_BATCH);
      const recipients = Object.fromEntries(batch.map((id) => [id, form.querySelector(`[data-sendto="${CSS.escape(id)}"]`)?.value ?? 'default']));
      const res = await api(`/occasions/${state.occasionId}/invites`, { method: 'POST', body: { householdIds: batch, recipients } });
      results.push(...res.results);
    }
  });
  await openOccasion(state.occasionId);
  await refreshOccasions();
  const sent = results.filter((r) => r.status === 'sent').length;
  const problems = results.filter((r) => r.status !== 'sent');
  prog.innerHTML = `<div><b>${plural(sent, 'invitation')} sent.</b>${problems.length ? `<ul class="small">${problems.map((r) => `<li>${esc(byId.get(r.householdId)?.labelName ?? '?')}: ${esc(r.reason)}</li>`).join('')}</ul>` : ''}</div>`;
  render();
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
  const sample = ['The Sample Family', '1234 Example Street', 'Apt 5', 'Troy, MI  48083'];
  const ret = returnLines();
  const doc = what === 'labels'
    ? buildLabels(JsPDF, Array(30).fill(sample), { offsetX: s.print.labelOffsetX, offsetY: s.print.labelOffsetY, outline: true })
    : buildEnvelopes(JsPDF, [sample], {
      returnLines: ret.length ? ret : ['Your Name', '1 Return Street', 'Troy, MI  48083'],
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
    case 'export': download(`address-book-${new Date().toISOString().slice(0, 10)}.csv`, householdsToCsv([...state.households].sort(byName))); break;
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
      const ids = shownRecipients().map((h) => h.id).filter((x) => (add ? !tags.has(x) : tags.has(x)));
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
  }
});
document.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-chip-text]')) showGroupSuggest(e.target.closest('[data-chips]')); });
document.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-chip-text]')) hideGroupSuggest(e.target.closest('[data-chips]')); });

document.addEventListener('input', (e) => {
  // Changing the address makes an earlier USPS check out of date.
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
  if (k === 'csv-file' && t.files?.[0]) readCsvFile(t.files[0]).catch((err) => modalError(err.message));
  if (t.dataset?.map !== undefined) updateImportSummary();
  if (t.name === 'what' && t.form?.dataset.form === 'print') syncPrintForm();
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

modal.addEventListener('close', () => { modal.innerHTML = ''; });

auth.onChange((event, session) => {
  const wasSignedIn = Boolean(state.session);
  state.session = session;
  if (!session) {
    Object.assign(state, { me: null, books: [], households: [], occasions: [], occasionId: null, occ: null, view: 'people' });
    if (wasSignedIn) state.bookId = storedBook(); // a different person may sign in next; loadAll checks the book is theirs
    if (modal.open) modal.close();
    if (wasSignedIn || event !== 'INITIAL_SESSION') state.authMode = 'signin';
    return renderAuth();
  }
  if (!wasSignedIn) { state.authMode = 'signin'; state.authErr = ''; setTimeout(loadAll, 0); }
  return undefined;
});
