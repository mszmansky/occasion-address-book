// Designed invitations and emails: fonts, fill-in fields and rendering. Pure functions, used by the
// app (design window, printing) and by the API (emails).
//
// KEEP IN SYNC: backend/src/lib/design-core.mjs is an exact copy (a test checks they match), because
// the Lambda package only contains backend/.

// Fonts offered in the design window. "web" fonts come from Google Fonts: they always show in the
// app and on printed invitations; in email, Apple Mail shows them and Gmail/Outlook use the fallback.
export const FONTS = [
  { key: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { key: 'times', label: 'Times', stack: "'Times New Roman', Times, serif" },
  { key: 'palatino', label: 'Palatino', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { key: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { key: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { key: 'trebuchet', label: 'Trebuchet', stack: "'Trebuchet MS', Arial, sans-serif" },
  { key: 'courier', label: 'Courier', stack: "'Courier New', Courier, monospace" },
  { key: 'great-vibes', label: 'Great Vibes', stack: "'Great Vibes', 'Brush Script MT', cursive", web: 'Great+Vibes' },
  { key: 'dancing', label: 'Dancing Script', stack: "'Dancing Script', 'Brush Script MT', cursive", web: 'Dancing+Script:wght@400;700' },
  { key: 'playfair', label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", web: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
  { key: 'cinzel', label: 'Cinzel', stack: "Cinzel, Georgia, serif", web: 'Cinzel:wght@400;700' },
  { key: 'lobster', label: 'Lobster', stack: "Lobster, Georgia, serif", web: 'Lobster' },
  { key: 'pacifico', label: 'Pacifico', stack: "Pacifico, 'Brush Script MT', cursive", web: 'Pacifico' },
  { key: 'christmas', label: 'Mountains of Christmas', stack: "'Mountains of Christmas', Georgia, serif", web: 'Mountains+of+Christmas:wght@400;700' },
  { key: 'amatic', label: 'Amatic SC', stack: "'Amatic SC', 'Arial Narrow', sans-serif", web: 'Amatic+SC:wght@400;700' },
];

export const FIELDS = [
  ['greeting', 'Greeting'],
  ['occasion', 'Occasion name'],
  ['date', 'Date'],
  ['time', 'Time'],
  ['location', 'Location'],
  ['from', 'Your name'],
];

export const DESIGN_DEFAULTS = { background: '#ffffff', color: '#1d2125', font: 'georgia', border: 'none', borderColor: '#9f1239' };

// Page borders: a frame drawn a little inside the edge of the invitation or email.
export const BORDERS = [
  { key: 'none', label: 'No border' },
  { key: 'thin', label: 'Thin line', css: '1px solid' },
  { key: 'thick', label: 'Thick line', css: '4px solid' },
  { key: 'double', label: 'Double line', css: '5px double' },
  { key: 'dashed', label: 'Dashed', css: '2px dashed' },
  { key: 'dotted', label: 'Dotted', css: '3px dotted' },
  { key: 'rounded', label: 'Rounded', css: '2px solid', radius: '18px' },
  { key: 'groove', label: 'Engraved', css: '6px groove' },
];
// Ends the design below any picture placed beside the text.
const CLEAR = '<div style="clear:both"></div>';

export const borderByKey = (key) => BORDERS.find((b) => b.key === key) ?? BORDERS[0];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fontByKey = (key) => FONTS.find((f) => f.key === key) ?? FONTS[0];

/** The Google Fonts stylesheet for the web fonts a design uses (its base font and any in the text), or ''. */
export function fontLink(design = {}) {
  const html = String(design.html ?? '');
  const family = (f) => f.stack.split(',')[0].replace(/['"]/g, '').trim();
  const used = FONTS.filter((f) => f.web && (f.key === design.font || html.includes(family(f))));
  return used.length ? `https://fonts.googleapis.com/css2?${used.map((f) => `family=${f.web}`).join('&')}&display=swap` : '';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "2026-12-19" → "Saturday, December 19, 2026" (no time zone shifts). */
export function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The values for the fill-in fields of one invitation. */
export function fieldValues({ occasion = {}, greeting = '', fromName = '' } = {}) {
  return { greeting, occasion: occasion.name ?? '', date: longDate(occasion.date), time: occasion.time ?? '', location: occasion.location ?? '', from: fromName };
}

/** Replaces {{greeting}} and the other fields with their (escaped) values; line breaks become <br>. */
export function fillFields(html, values = {}) {
  return String(html ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in values ? esc(values[k]).replace(/\r?\n/g, '<br>') : m));
}

/** The design as one block: its background, base font and color around the filled-in content. */
export function renderDesign(design = {}, values = {}, { padding = '32px' } = {}) {
  const d = { ...DESIGN_DEFAULTS, ...design };
  const bg = /^#[0-9a-f]{6}$/i.test(d.background) ? d.background : DESIGN_DEFAULTS.background;
  const color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : DESIGN_DEFAULTS.color;
  const font = fontByKey(d.font).stack.replace(/"/g, "'");
  const b = borderByKey(d.border);
  if (!b.css) return `<div class="design" style="background:${bg};color:${color};font-family:${font};font-size:16px;line-height:1.5;padding:${padding}">${fillFields(d.html, values)}${CLEAR}</div>`;
  const edge = /^#[0-9a-f]{6}$/i.test(d.borderColor) ? d.borderColor : DESIGN_DEFAULTS.borderColor;
  // The frame sits about half the padding in from the edge, with the rest of the padding inside it.
  return `<div class="design" style="background:${bg};color:${color};font-family:${font};font-size:16px;line-height:1.5;padding:calc(${padding} / 2)">`
    + `<div class="design-frame" style="border:${b.css} ${edge};${b.radius ? `border-radius:${b.radius};` : ''}padding:calc(${padding} / 2);height:100%;box-sizing:border-box">${fillFields(d.html, values)}${CLEAR}</div></div>`;
}

/** Plain-text version of filled-in content, for the text part of an email. */
export function designText(html, values = {}) {
  return fillFields(html, values)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(li|tr)>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A starting design: the old plain email message if there is one, else a short greeting. */
export function starterHtml(message) {
  const body = String(message ?? '').trim();
  const paras = body ? body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p><br></p>';
  return `<p>Dear {{greeting}},</p>${paras}`;
}
