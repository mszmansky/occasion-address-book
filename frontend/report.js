// The printed Address book report: the households on screen (search and filters applied), numbered,
// with everything on each household card. A pure function (unit tested in Node); the app opens it in a
// new tab with the browser's print dialog, like everything else it prints.

import { addressLines } from './print-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
// Long emails break after the @ rather than mid-word.
const mail = (e) => esc(e).replace(/@/g, '@<wbr>');
const lines = (list) => list.filter(Boolean).map((l) => `<div>${l}</div>`).join('');
const label = (k, v) => (v ? `<div><span class="k">${k}</span> ${esc(v)}</div>` : '');

function person(m) {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ');
  return `<div class="person"><div><b>${esc(name)}</b>${m.relationship ? ` <span class="muted">· ${esc(m.relationship)}</span>` : ''}${m.primary ? ' <span class="tag">Default contact</span>' : ''}</div>`
    + `${m.email ? `<div>${mail(m.email)}</div>` : ''}${m.phone ? `<div>${esc(m.phone)}</div>` : ''}</div>`;
}

/**
 * households: in the order to print. title: e.g. "Address book" or "Kim's address book".
 * filters: what's applied, in words (search text and filter chips), shown under the title.
 */
export function addressBookReport(households, { title = 'Address book', filters = [], printed = new Date() } = {}) {
  const rows = households.map((h, i) => {
    const a = h.address ?? {};
    const addr = addressLines('', a).map(esc);
    const status = [
      h.addressVerifiedAt ? `<span class="tag ok">✓ Verified ${esc(day(h.addressVerifiedAt))}</span>` : '',
      h.pendingUpdate ? '<span class="tag warn">New address to review</span>' : '',
    ].filter(Boolean).join(' ');
    const members = (h.members ?? []).map(person).join('');
    const contact = lines([h.phone ? esc(h.phone) : '', ...(h.emails ?? []).map(mail)]);
    return `<tr>
      <td class="n">${i + 1}</td>
      <td><div class="name">${esc(h.labelName)}</div>${label('Formal:', h.formalName)}${label('Informal:', h.greeting)}</td>
      <td>${lines(addr) || '<span class="muted">No address</span>'}${status ? `<div class="status">${status}</div>` : ''}</td>
      <td>${members || '<span class="muted">—</span>'}</td>
      <td>${contact || '<span class="muted">—</span>'}</td>
      <td>${h.groups?.length ? `<div class="groups">${h.groups.map((g) => `<span class="tag">${esc(g)}</span>`).join(' ')}</div>` : ''}${h.notes ? `<div class="notes">${esc(h.notes)}</div>` : ''}</td>
    </tr>`;
  }).join('');
  const sub = [`${households.length} ${households.length === 1 ? 'household' : 'households'}`, ...filters.map(esc), `Printed ${esc(day(printed.toISOString()))}`].join(' · ');
  const body = `<header><h1>${esc(title)}</h1><p>${sub}</p></header>
    <table>
      <colgroup><col class="c-n"><col class="c-h"><col class="c-a"><col class="c-p"><col class="c-c"><col class="c-g"></colgroup>
      <thead><tr><th>#</th><th>Household</th><th>Address</th><th>People</th><th>Phone &amp; email</th><th>Groups &amp; notes</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No households match.</td></tr>'}</tbody>
    </table>`;
  const css = `
@page { size: 11in 8.5in; margin: 0.45in 0.4in; }
html, body { margin: 0; }
body { font: 9pt/1.35 Helvetica, Arial, sans-serif; color: #1f2328; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
@media screen { body { background: #8a8a8a; padding: 16px 0; } main { width: 11in; margin: 0 auto; background: #fff; padding: 0.45in 0.4in; box-shadow: 0 2px 10px rgba(0,0,0,.35); } }
header { margin-bottom: 10pt; border-bottom: 2px solid #9f1239; padding-bottom: 6pt; }
h1 { font-size: 16pt; margin: 0 0 2pt; color: #9f1239; }
header p { margin: 0; color: #57606a; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.c-n { width: 0.35in; } .c-h { width: 1.85in; } .c-a { width: 1.85in; } .c-p { width: 2.55in; } .c-c { width: 1.65in; } .c-g { width: auto; }
thead { display: table-header-group; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #57606a; border-bottom: 1px solid #8c959f; padding: 3pt 5pt; }
td { vertical-align: top; padding: 5pt; border-bottom: 1px solid #d0d7de; overflow-wrap: anywhere; word-break: normal; }
tr { break-inside: avoid; page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f6f8fa; }
td.n { color: #57606a; text-align: right; font-variant-numeric: tabular-nums; }
.name { font-weight: 700; font-size: 10pt; }
.k { color: #57606a; }
.person + .person { margin-top: 4pt; }
.muted { color: #8c959f; }
.status, .groups { margin-top: 3pt; }
.notes { margin-top: 3pt; white-space: pre-wrap; }
.tag { display: inline-block; border: 1px solid #d0d7de; border-radius: 3pt; padding: 0 3pt; font-size: 7.5pt; color: #424a53; background: #fff; }
.tag.ok { border-color: #8fd19e; color: #1a7f37; }
.tag.warn { border-color: #e3b341; color: #9a6700; }`;
  return { css, body: `<main>${body}</main>` };
}
