// The two kinds of design layouts, as the HTML that's saved, printed and emailed. Pure functions:
// the Designers build these models while you work and turn them into HTML here (unit tested in Node).
//
// Emails: rows of one to three columns, each column a stack of blocks (text, picture, line, space).
// Written as plain tables, the one layout every mail app (Gmail, Outlook, Apple Mail, phones) draws
// the same way.
//
// Invitations: parts placed anywhere on the card, by percentages of its width and height, with text
// sizes in cqw (hundredths of the card's width), so the same layout fits whatever card it's printed on.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HEX = /^#[0-9a-f]{6}$/i;
const num = (n, digits = 2) => String(Math.round(Number(n) * 10 ** digits) / 10 ** digits);

// ---------- emails: rows and columns ----------

export const EMAIL_WIDTH = 600; // the usual width of an email's content, in pixels
export const ROW_LAYOUTS = {
  1: { label: '1 column', widths: [100] },
  '1-1': { label: '2 columns', widths: [50, 50] },
  '1-2': { label: '2 columns, wide right', widths: [33.33, 66.67] },
  '2-1': { label: '2 columns, wide left', widths: [66.67, 33.33] },
  '1-1-1': { label: '3 columns', widths: [33.33, 33.33, 33.34] },
};
export const COL_GAP = 8; // padding each side of a column when a row has more than one

/** The pixel width a block has in its column (for pictures, which Outlook sizes by pixels). */
export function columnPixels(layout, col) {
  const widths = (ROW_LAYOUTS[layout] ?? ROW_LAYOUTS[1]).widths;
  const pad = widths.length > 1 ? COL_GAP * 2 : 0;
  return Math.max(40, Math.round((EMAIL_WIDTH * widths[col]) / 100 - pad));
}

/** One block as email HTML. colPx: the column's width in pixels. */
export function blockHtml(b, colPx = EMAIL_WIDTH) {
  if (b.type === 'image') {
    const w = Math.max(5, Math.min(100, Number(b.width) || 100));
    const align = ['left', 'right'].includes(b.align) ? b.align : 'center';
    const border = b.border ? `;border:${b.border}` : '';
    const radius = b.radius ? `;border-radius:${b.radius}` : '';
    return `<div data-block="image" style="text-align:${align};padding:4px 0"><img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${Math.round((colPx * w) / 100)}" style="width:${num(w)}%;max-width:100%;height:auto;display:inline-block${border}${radius}"></div>`;
  }
  if (b.type === 'line') return `<div data-block="line" style="padding:6px 0">${b.html ?? ''}</div>`;
  if (b.type === 'spacer') {
    const h = Math.max(4, Math.min(200, Math.round(Number(b.h) || 24)));
    return `<div data-block="spacer" style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</div>`;
  }
  const fill = HEX.test(b.bg ?? '') ? `;background-color:${b.bg};padding:10px 12px` : '';
  return `<div data-block="text" style="padding:4px 0${fill}">${b.html ?? ''}</div>`;
}

/** Rows of columns as email-safe HTML: one table per row, a cell per column. */
export function rowsHtml(rows) {
  const out = rows.map((row) => {
    const layout = ROW_LAYOUTS[row.layout] ? row.layout : '1';
    const widths = ROW_LAYOUTS[layout].widths;
    const multi = widths.length > 1;
    const bg = HEX.test(row.bg ?? '') ? row.bg : '';
    const pad = `${bg ? 8 : 0}px ${multi ? COL_GAP : (bg ? 12 : 0)}px`;
    const cells = widths.map((w, i) => {
      const blocks = (row.cols?.[i] ?? []).map((b) => blockHtml(b, columnPixels(layout, i))).join('');
      return `<td data-col width="${num(w)}%" valign="top" style="width:${num(w)}%;vertical-align:top;padding:${pad}">${blocks}</td>`;
    }).join('');
    return `<table data-row role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse${bg ? `;background-color:${bg}` : ''}"><tr>${cells}</tr></table>`;
  }).join('');
  return `<div data-rows>${out}</div>`;
}

/** Which layout a row's column widths come closest to. */
export function layoutOf(widths) {
  let best = '1';
  let bestErr = Infinity;
  for (const [key, l] of Object.entries(ROW_LAYOUTS)) {
    if (l.widths.length !== widths.length) continue;
    const err = l.widths.reduce((s, w, i) => s + Math.abs(w - widths[i]), 0);
    if (err < bestErr) { best = key; bestErr = err; }
  }
  return best;
}

// ---------- invitations: placed anywhere ----------

/** The card's shape: width and height in inches, turned for landscape. */
export function cardShape(card, orient) {
  const [a, b] = card;
  const long = Math.max(a, b);
  const short = Math.min(a, b);
  return orient === 'landscape' ? [long, short] : [short, long];
}

/** Point size on the card → cqw (hundredths of the card's width). */
export const ptToCqw = (pt, cardWidthIn) => (pt * 100) / (72 * cardWidthIn);
export const cqwToPt = (cqw, cardWidthIn) => (cqw * 72 * cardWidthIn) / 100;

/**
 * A free layout as HTML. layout: { size (a card key), orient, shape: [w, h] in inches,
 * items: [{ type: 'text' | 'image' | 'line', x, y, w (percent), z, html }] } — html is the part's own markup.
 */
export function freeHtml({ size = 'card5x7', orient = 'portrait', shape = [5, 7], items = [] }) {
  const parts = items.map((it, i) => {
    const type = ['text', 'image', 'line'].includes(it.type) ? it.type : 'text';
    const z = Math.max(1, Math.min(999, Math.round(Number(it.z) || i + 1)));
    const align = type === 'text' && it.align ? `;text-align:${it.align}` : '';
    return `<div data-item="${type}" style="position:absolute;left:${num(it.x)}%;top:${num(it.y)}%;width:${num(it.w)}%;z-index:${z}${align}">${it.html ?? ''}</div>`;
  }).join('');
  return `<div data-free="${esc(size)}" data-orient="${orient === 'landscape' ? 'landscape' : 'portrait'}" data-aspect="${num(shape[0])}:${num(shape[1])}" style="position:absolute;inset:0">${parts}</div>`;
}
