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
export function addressBookReport(households, { title = 'Address book', filters = [], printed = new Date(), logo = '', site = '' } = {}) {
  const rows = households.map((h, i) => {
    const a = h.address ?? {};
    const addr = addressLines('', a).map(esc);
    const status = [
      h.addressVerifiedAt ? `<span class="tag ok">✓ Verified ${esc(day(h.addressVerifiedAt))}</span>` : '',
      h.pendingUpdate ? '<span class="tag warn">New address to review</span>' : '',
    ].filter(Boolean).join(' ');
    const members = (h.members ?? []).map(person).join('');
    const contact = lines([h.phone ? esc(h.phone) : '', ...(h.emails ?? []).map(mail)]);
    return `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="n">${i + 1}</td>
      <td><div class="name">${esc(h.labelName)}</div>${label('Formal:', h.formalName)}${label('Informal:', h.greeting)}</td>
      <td>${lines(addr) || '<span class="muted">No address</span>'}${status ? `<div class="status">${status}</div>` : ''}</td>
      <td>${members || '<span class="muted">—</span>'}</td>
      <td>${contact || '<span class="muted">—</span>'}</td>
      <td>${h.groups?.length ? `<div class="groups">${h.groups.map((g) => `<span class="tag">${esc(g)}</span>`).join(' ')}</div>` : ''}${h.notes ? `<div class="notes">${esc(h.notes)}</div>` : ''}</td>
    </tr>`;
  }).join('');
  const sub = [`${households.length} ${households.length === 1 ? 'household' : 'households'}`, ...filters.map(esc), `Printed ${esc(day(printed.toISOString()))}`].join(' · ');
  const body = `<div id="report-src" data-title="${esc(title)}" data-year="${printed.getFullYear()}" data-site="${esc(site)}"><header>${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ''}<div><div class="app">Occasions Address Book</div><h1>${esc(title)}</h1><p>${sub}</p></div></header>
    <table>
      <colgroup><col class="c-n"><col class="c-h"><col class="c-a"><col class="c-p"><col class="c-c"><col class="c-g"></colgroup>
      <thead><tr><th>#</th><th>Household</th><th>Address</th><th>People</th><th>Phone &amp; email</th><th>Groups &amp; notes</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No households match.</td></tr>'}</tbody>
    </table></div>`;
  const css = `
@page { size: 11in 8.5in; margin: 0; }
html, body { margin: 0; }
body { font: 9pt/1.35 Helvetica, Arial, sans-serif; color: #1f2328; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
#report-src, .sheet { width: 11in; padding: 0.45in 0.4in 0; }
.sheet { position: relative; height: 8.5in; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.sheet > footer > span { flex: 1; } .sheet > footer .site { text-align: center; } .sheet > footer .pg { text-align: right; }
.sheet > footer { position: absolute; left: 0.4in; right: 0.4in; bottom: 0.3in; display: flex; justify-content: space-between; border-top: 1px solid #d0d7de; padding-top: 4pt; font-size: 7.5pt; color: #57606a; }
@media screen { body { background: #8a8a8a; padding: 16px 0; } .sheet, #report-src { margin: 0 auto 16px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35); } }
header { display: flex; align-items: center; gap: 10pt; margin-bottom: 10pt; border-bottom: 2px solid #9f1239; padding-bottom: 6pt; }
header .logo { width: 0.6in; height: 0.6in; border-radius: 0.12in; flex: none; }
header .app { font-size: 8pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #57606a; }
h1 { font-size: 16pt; margin: 0 0 2pt; color: #9f1239; }
header p { margin: 0; color: #57606a; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.c-n { width: 0.35in; } .c-h { width: 1.85in; } .c-a { width: 1.85in; } .c-p { width: 2.55in; } .c-c { width: 1.65in; } .c-g { width: auto; }
thead { display: table-header-group; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #57606a; border-bottom: 1px solid #8c959f; padding: 3pt 5pt; }
td { vertical-align: top; padding: 5pt; border-bottom: 1px solid #d0d7de; overflow-wrap: anywhere; word-break: normal; }
tr { break-inside: avoid; page-break-inside: avoid; }
tr.alt td { background: #f6f8fa; }
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
  return { css, body };
}

/**
 * Runs in the report's own page (passed to it as text, so it uses nothing from outside): lays the
 * rows onto Letter-landscape pages, repeating the column headings, and puts "© 2026 Occasions
 * Address Book", the site's address and "Page 1 of 3" at the foot of each. Doing the pages here, rather than leaving it to the browser, gives every browser the
 * same page numbers.
 */
export function paginateReport(doc) {
  const src = doc.getElementById('report-src');
  if (!src) return;
  const IN = 96;
  const room = (8.5 - 0.45 - 0.75) * IN; // the page, less the top margin and the footer
  const table = src.querySelector('table');
  const header = src.querySelector('header');
  const rows = [...table.tBodies[0].rows];
  const pages = [];
  const newPage = () => {
    const sheet = doc.createElement('section');
    sheet.className = 'sheet';
    const body = doc.createElement('div');
    if (!pages.length) body.append(header);
    const t = doc.createElement('table');
    t.className = table.className;
    t.innerHTML = `${table.querySelector('colgroup').outerHTML}${table.tHead.outerHTML}<tbody></tbody>`;
    body.append(t);
    sheet.append(body);
    doc.body.insertBefore(sheet, src);
    pages.push(sheet);
    return { body, tbody: t.tBodies[0] };
  };
  let page = newPage();
  for (const row of rows) {
    page.tbody.append(row);
    if (page.body.offsetHeight > room && page.tbody.rows.length > 1) {
      row.remove();
      page = newPage();
      page.tbody.append(row);
    }
  }
  const year = src.dataset.year || String(new Date().getFullYear());
  const site = src.dataset.site || '';
  src.remove();
  pages.forEach((sheet, i) => {
    const foot = doc.createElement('footer');
    foot.innerHTML = '<span></span><span class="site"></span><span class="pg"></span>';
    foot.children[0].textContent = `© ${year} Occasions Address Book`;
    foot.children[1].textContent = site;
    foot.children[2].textContent = `Page ${i + 1} of ${pages.length}`;
    sheet.append(foot);
  });
}

/**
 * A checklist for addressing envelopes by hand: one numbered row per household with a box to tick,
 * the name and address as they go on the envelope, and the people in the household. items: in order,
 * { name, address, members, mailedAt }. Same pages, header and footer as the Address book report.
 */
export function addressChecklist(items, { title = 'Addresses', subtitle = [], printed = new Date(), logo = '', site = '' } = {}) {
  const rows = items.map((it, i) => {
    const addr = addressLines('', it.address ?? {}).map(esc);
    const people = (it.members ?? []).map((m) => esc([m.firstName, m.lastName].filter(Boolean).join(' '))).filter(Boolean);
    return `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="x"><span class="box"></span></td>
      <td class="n">${i + 1}</td>
      <td class="env"><div class="name">${esc(it.name)}</div>${lines(addr) || '<span class="muted">No address</span>'}</td>
      <td>${people.length ? people.join('<br>') : '<span class="muted">—</span>'}</td>
      <td class="m">${it.mailedAt ? `Mailed ${esc(day(it.mailedAt))}` : ''}</td>
    </tr>`;
  }).join('');
  const sub = [`${items.length} ${items.length === 1 ? 'household' : 'households'}`, ...subtitle.map(esc), `Printed ${esc(day(printed.toISOString()))}`].join(' · ');
  const body = `<div id="report-src" data-title="${esc(title)}" data-year="${printed.getFullYear()}" data-site="${esc(site)}"><header>${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ''}<div><div class="app">Occasions Address Book</div><h1>${esc(title)}</h1><p>${sub}</p></div></header>
    <table class="checklist">
      <colgroup><col class="c-x"><col class="c-n"><col class="c-e"><col class="c-pp"><col class="c-m"></colgroup>
      <thead><tr><th>Done</th><th>#</th><th>Name and address (as on the envelope)</th><th>People</th><th>Mailed</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Nobody to list.</td></tr>'}</tbody>
    </table></div>`;
  const css = `${addressBookReport([]).css}
.c-x { width: 0.5in; } .c-n { width: 0.35in; } .c-e { width: 4.4in; } .c-pp { width: auto; } .c-m { width: 1.2in; }
.checklist td { padding-top: 7pt; padding-bottom: 7pt; }
.checklist .env { font-size: 10.5pt; line-height: 1.4; }
.checklist .env .name { font-size: 10.5pt; }
.checklist .x { text-align: center; }
.checklist .box { display: inline-block; width: 13pt; height: 13pt; border: 1.3pt solid #57606a; border-radius: 2pt; background: #fff; }
.checklist .m { color: #57606a; }`;
  return { css, body };
}
