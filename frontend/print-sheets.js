// Label sheets and envelopes as printable HTML pages, for the browser's print window (the same way
// invitations print). Pure functions (unit tested in Node): each returns { pageSize, css, body };
// the app writes them into a new tab, fits the text (fitLabel), and opens the print dialog.
// Measurements come from print-core (LABEL_SHEETS, ENVELOPES), in inches.

import { ENVELOPES, LABEL_SHEETS } from './print-core.js';
import { LABEL_CSS } from './label-styles.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r = (n) => Number(n.toFixed(4));

const BASE_CSS = `
html, body { margin: 0; }
.page { position: relative; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }
.page:last-child { break-after: auto; page-break-after: auto; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media screen { body { background: #8a8a8a; padding: 16px 0; } .page { margin: 0 auto 16px; box-shadow: 0 2px 10px rgba(0,0,0,.35); } }
`;

/**
 * Labels on a sheet. items: the HTML of each label (a .rl design, see label-styles), filled in from
 * label number `start` and onto more sheets as needed.
 */
export function labelSheetsHtml(items, { sheet = 'avery5160', start = 1, offsetX = 0, offsetY = 0, outline = false } = {}) {
  const s = LABEL_SHEETS[sheet] ?? LABEL_SHEETS.avery5160;
  const per = s.cols * s.rows;
  const first = Math.min(Math.max(1, Math.floor(start) || 1), per) - 1;
  const pages = Math.max(1, Math.ceil((first + items.length) / per));
  let body = '';
  for (let p = 0; p < pages; p++) {
    let slots = '';
    for (let pos = 0; pos < per; pos++) {
      const i = p * per + pos - first;
      const item = i >= 0 && i < items.length ? items[i] : '';
      if (!item && !outline) continue;
      const x = s.left + (pos % s.cols) * s.pitchX + offsetX;
      const y = s.top + Math.floor(pos / s.cols) * s.pitchY + offsetY;
      slots += `<div class="slot${outline ? ' outlined' : ''}" style="left:${r(x)}in;top:${r(y)}in">${item}</div>`;
    }
    body += `<section class="page">${slots}</section>`;
  }
  const css = `${BASE_CSS}${LABEL_CSS}
@page { size: ${s.page[0]}in ${s.page[1]}in; margin: 0; }
.page { width: ${s.page[0]}in; height: ${s.page[1]}in; }
/* A design is 2.625 × 1 em: it takes the label's width and as much height as suits it (up to 1¼ in, so
   big shipping labels don't get giant text), centered down the label. */
.slot { position: absolute; width: ${r(s.width)}in; height: ${r(s.height)}in; font-size: ${r(Math.min(s.height, 1.25))}in; display: flex; align-items: center; }
.slot > .rl { width: 100%; flex: none; }
.slot.outlined::after { content: ''; position: absolute; inset: 0; border: .5pt dashed #9a9a9a; border-radius: .06in; pointer-events: none; }`;
  return { pageSize: s.page, css, body };
}

/**
 * Envelopes, one per page (landscape). items: { to: lines, ret: lines, retLabel } for each envelope;
 * either address can be empty. retLabel: the return address as a return-label design (a .rl, see
 * label-styles), printed in the corner at the envelope's returnLabelIn height, instead of ret.
 */
export function envelopesHtml(items, { envelope = 'a7', offsetX = 0, offsetY = 0, outline = false } = {}) {
  const e = ENVELOPES[envelope] ?? ENVELOPES.a7;
  const [w, h] = e.page;
  const block = (lines) => lines.map((l) => `<span class="fit" data-size="1" style="font-size:1em">${esc(l)}</span>`).join('');
  const body = items.map(({ to = [], ret = [], retLabel = '' }) => `<section class="page${outline ? ' outlined' : ''}">
    ${retLabel ? `<div class="retl" style="left:${r(e.returnAt[0] + offsetX)}in;top:${r(e.returnAt[1] + offsetY)}in">${retLabel}</div>` : ret.length ? `<div class="txt ret" style="left:${r(e.returnAt[0] + offsetX)}in;top:${r(e.returnAt[1] + offsetY)}in;width:${e.returnMaxWidth}in;height:1.2in;font-size:${e.returnPt}pt">${block(ret)}</div>` : ''}
    ${to.length ? `<div class="txt to" style="left:${r(e.toLeft + offsetX)}in;top:${r(e.toCenterY - 0.85 + offsetY)}in;width:${e.toMaxWidth}in;height:1.7in;font-size:${e.toMaxPt}pt">${block(to)}</div>` : ''}
  </section>`).join('');
  const labels = items.some((it) => it.retLabel);
  const css = `${BASE_CSS}${labels ? LABEL_CSS : ''}
@page { size: ${w}in ${h}in; margin: 0; }
.retl { position: absolute; font-size: ${e.returnLabelIn}in; }
.page { width: ${w}in; height: ${h}in; font-family: Helvetica, Arial, sans-serif; color: #000; }
.page.outlined { outline: .5pt solid #b0b0b0; outline-offset: -.02in; }
.page > .txt { position: absolute; display: flex; flex-direction: column; line-height: 1.18; }
.page > .txt.ret { justify-content: flex-start; }
.page > .txt.to { justify-content: center; }
.page > .txt .fit { display: block; white-space: nowrap; overflow: hidden; }`; // not the return design's own lines
  return { pageSize: e.page, css, body: body || '<section class="page"></section>' };
}
