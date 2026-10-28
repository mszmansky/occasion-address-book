// Label and envelope layout. Pure functions over a jsPDF instance, so they run in the browser
// and in Node tests alike. All measurements are in inches.

// Label sheets (Letter). Each person picks the ones they use (Settings > Printer); 5160 and 5195 to
// start. Avery's numbers for the same layout are listed together (laser and inkjet versions).
const avery = (name, group, cols, rows, width, height, left, top, pitchX, pitchY, extra = {}) => ({
  name, group, page: [8.5, 11], cols, rows, width, height,
  left, top,          // page margin to the first label
  pitchX, pitchY,     // distance from one label's corner to the next
  padX: 0.12, padY: 0.08, maxPt: 11, minPt: 6.5, // printable inset inside each label; text sizes
  ...extra,
});
export const LABEL_GROUPS = ['Address labels', 'Shipping and large labels', 'Return address labels'];
// Store brands sold as "Avery compatible" use the same Avery numbers.
export const LABEL_SHEETS = {
  avery5160: avery('Avery 5160 / 5260 / 8160 / 18160 / 18660 address labels (1 × 2⅝ in, 30 per sheet)', 'Address labels', 3, 10, 2.625, 1, 0.1875, 0.5, 2.75, 1),
  avery5161: avery('Avery 5161 / 5261 / 8161 address labels (1 × 4 in, 20 per sheet)', 'Address labels', 2, 10, 4, 1, 0.15625, 0.5, 4.1875, 1),
  avery5162: avery('Avery 5162 / 5262 / 8162 address labels (1⅓ × 4 in, 14 per sheet)', 'Address labels', 2, 7, 4, 4 / 3, 0.15625, 0.8333, 4.1875, 4 / 3),
  avery5197: avery('Avery 5197 / 8197 address labels (1½ × 4 in, 12 per sheet)', 'Address labels', 2, 6, 4, 1.5, 0.15625, 0.75, 4.1875, 1.5),
  avery5163: avery('Avery 5163 / 5263 / 8163 / 18163 shipping labels (2 × 4 in, 10 per sheet)', 'Shipping and large labels', 2, 5, 4, 2, 0.15625, 0.5, 4.1875, 2),
  avery5164: avery('Avery 5164 / 5264 / 8164 shipping labels (3⅓ × 4 in, 6 per sheet)', 'Shipping and large labels', 2, 3, 4, 10 / 3, 0.15625, 0.5, 4.1875, 10 / 3),
  avery5168: avery('Avery 5168 / 8168 shipping labels (3½ × 5 in, 4 per sheet)', 'Shipping and large labels', 2, 2, 3.5, 5, 0.5, 0.5, 4, 5),
  avery5126: avery('Avery 5126 / 8126 half-sheet labels (5½ × 8½ in, 2 per sheet)', 'Shipping and large labels', 1, 2, 8.5, 5.5, 0, 0, 8.5, 5.5, { padX: 0.4, padY: 0.3 }),
  avery5165: avery('Avery 5165 / 8165 full-sheet labels (8½ × 11 in, 1 per sheet)', 'Shipping and large labels', 1, 1, 8.5, 11, 0, 0, 8.5, 11, { padX: 0.5, padY: 0.5 }),
  // Return address labels; 5195, 8195 and 18294 (and others) share this template.
  avery5195: avery('Avery 5195 / 6240 / 8195 / 18294 return address labels (⅔ × 1¾ in, 60 per sheet)', 'Return address labels', 4, 15, 1.75, 2 / 3, 0.28, 0.5, 2.0625, 2 / 3,
    { padX: 0.08, padY: 0.05, maxPt: 8.5, minPt: 5.5, wrapPt: 6.5 }), // small labels: shrink further before wrapping
  avery5167: avery('Avery 5167 / 5267 / 8167 / 18167 return address labels (½ × 1¾ in, 80 per sheet)', 'Return address labels', 4, 20, 1.75, 0.5, 0.28, 0.5, 2.0625, 0.5,
    { padX: 0.06, padY: 0.03, maxPt: 7, minPt: 5, wrapPt: 5.5 }),
};
export const DEFAULT_LABELS = ['avery5160', 'avery5195'];
/** The label sheets someone uses, in the order above (their choice, else 5160 and 5195). */
export const usedLabels = (keys) => {
  const set = new Set(Array.isArray(keys) && keys.length ? keys : DEFAULT_LABELS);
  return Object.keys(LABEL_SHEETS).filter((k) => set.has(k));
};

// Envelope sizes. Each person picks the ones they use (Settings > Printer); A2 and A7 to start.
// Layout in inches: the return address at the top left, the recipient block a little left of center
// and a little below the middle, where the Post Office looks for it.
function envelope(name, w, h, group, extra = {}) {
  const small = h < 4.2;
  const toLeft = Math.round(w * (w >= 9 ? 0.42 : 0.38) * 100) / 100;
  const returnAt = w >= 7 ? [0.35, 0.35] : [0.3, 0.3];
  return {
    name, group, page: [w, h],
    returnAt, returnMaxWidth: Math.round(Math.min(3.2, toLeft - returnAt[0] - 0.15) * 100) / 100, returnPt: small ? 8 : 9,
    returnLabelIn: Math.round(Math.min(0.9, Math.max(0.6, h * 0.17)) * 100) / 100, // a return design: its height
    toLeft, toCenterY: Math.round(h * 0.56 * 100) / 100, toMaxWidth: Math.round((w - toLeft - 0.4) * 100) / 100,
    toMaxPt: small ? 11 : w >= 9 ? 13 : 12, toMinPt: small ? 7 : 8,
    ...extra,
  };
}
export const ENVELOPE_GROUPS = ['Cards and invitations', 'Business', 'Large'];
export const ENVELOPES = {
  a1: envelope('A1 / 4 Bar envelopes (5⅛ × 3⅝ in)', 5.125, 3.625, 'Cards and invitations'), // 3½ × 5 cards
  a2: envelope('A2 envelopes (5¾ × 4⅜ in)', 5.75, 4.375, 'Cards and invitations', { // fits 4¼ × 5½ cards, like Avery 8387
    returnAt: [0.3, 0.3], returnMaxWidth: 2.4, returnPt: 8, returnLabelIn: 0.72,
    toLeft: 2.05, toCenterY: 2.45, toMaxWidth: 3.4, toMaxPt: 11.5, toMinPt: 7.5,
  }),
  a6: envelope('A6 envelopes (6½ × 4¾ in)', 6.5, 4.75, 'Cards and invitations'), // 4½ × 6¼ cards
  a7: envelope('A7 envelopes (7¼ × 5¼ in)', 7.25, 5.25, 'Cards and invitations', { // fits 5 × 7 cards
    returnAt: [0.35, 0.38], returnMaxWidth: 3.0, returnPt: 9, returnLabelIn: 0.85,
    toLeft: 2.85, toCenterY: 2.95, toMaxWidth: 4.0, toMaxPt: 12.5, toMinPt: 8,
  }),
  a8: envelope('A8 envelopes (8⅛ × 5½ in)', 8.125, 5.5, 'Cards and invitations'),
  a9: envelope('A9 envelopes (8¾ × 5¾ in)', 8.75, 5.75, 'Cards and invitations'), // 5½ × 8½ cards
  a10: envelope('A10 envelopes (9½ × 6 in)', 9.5, 6, 'Cards and invitations'),
  sq6: envelope('6 in square envelopes (6 × 6 in)', 6, 6, 'Cards and invitations'), // square: extra postage
  n6: envelope('#6¾ envelopes (6½ × 3⅝ in)', 6.5, 3.625, 'Business'),
  monarch: envelope('Monarch #7¾ envelopes (7½ × 3⅞ in)', 7.5, 3.875, 'Business'),
  n9: envelope('#9 envelopes (8⅞ × 3⅞ in)', 8.875, 3.875, 'Business'),
  n10: envelope('#10 envelopes (9½ × 4⅛ in)', 9.5, 4.125, 'Business'),
  n11: envelope('#11 envelopes (10⅜ × 4½ in)', 10.375, 4.5, 'Business'),
  n12: envelope('#12 envelopes (11 × 4¾ in)', 11, 4.75, 'Business'),
  n14: envelope('#14 envelopes (11½ × 5 in)', 11.5, 5, 'Business'),
  b6x9: envelope('6 × 9 in booklet envelopes', 9, 6, 'Large'),
  c9x12: envelope('9 × 12 in catalog envelopes', 12, 9, 'Large'),
};
export const DEFAULT_ENVELOPES = ['a2', 'a7'];
/** The envelope sizes someone uses, in the order above (their choice, else A2 and A7). */
export const usedEnvelopes = (keys) => {
  const set = new Set(Array.isArray(keys) && keys.length ? keys : DEFAULT_ENVELOPES);
  return Object.keys(ENVELOPES).filter((k) => set.has(k));
};

const US = /^(us|u\.s\.a?\.?|usa|united states( of america)?)$/i;

/** Lines for one envelope or label: name, street lines, "City, ST 12345", and the country when it isn't the US. */
export function addressLines(name, a = {}) {
  const cityLine = [[a.city, a.state].filter(Boolean).join(', '), a.zip].filter(Boolean).join(a.state ? '  ' : ' ');
  return [name, a.line1, a.line2, cityLine, a.country && !US.test(a.country.trim()) ? a.country.toUpperCase() : '']
    .map((l) => String(l ?? '').trim()).filter(Boolean);
}

/** Which name goes on the envelope: the formal or informal greeting when chosen and present, else the Household Greeting. */
export const envelopeName = (h, style) => (style === 'formal' && h.formalName ? h.formalName
  : style === 'informal' && String(h.greeting ?? '').trim() ? h.greeting : h.labelName);

/** True when a household has enough address to mail to. */
export const isMailable = (a = {}) => Boolean(a.line1 && a.city && (a.zip || (a.country && !US.test(a.country.trim()))));

/**
 * A short note for an address that can't be mailed to yet: "No mailing address" when there's
 * nothing, otherwise what's missing ("Missing ZIP", "Missing street and ZIP"). Empty when mailable.
 */
export function addressProblem(a = {}) {
  if (isMailable(a)) return '';
  const has = (k) => String(a?.[k] ?? '').trim();
  if (!['line1', 'line2', 'city', 'state', 'zip'].some(has)) return 'No mailing address';
  const missing = [!has('line1') && 'street', !has('city') && 'city', !has('zip') && 'ZIP'].filter(Boolean);
  return `Missing ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]}`;
}

const LINE = 1.18; // line height as a multiple of the font size

// Picks the font size (and, if needed, line wrapping) for an address block:
//   1. the largest size down to wrapPt at which every line fits as is;
//   2. otherwise the largest size at which it fits with over-wide lines wrapped onto two;
//   3. otherwise the largest size down to minPt that fits as is (lines that still don't fit get clipped).
// Steps are 0.5 pt. Returns { pt, lines }.
export function fitBlock(doc, lines, { maxWidth, maxHeight, maxPt, minPt, wrapPt = minPt }) {
  const fits = (ls, pt) => (ls.length * pt * LINE) / 72 <= maxHeight && Math.max(...ls.map((l) => doc.getTextWidth(l))) <= maxWidth;
  const sizes = (from, to) => { const out = []; for (let pt = from; pt >= to; pt -= 0.5) out.push(pt); return out; };
  for (const pt of sizes(maxPt, wrapPt)) { doc.setFontSize(pt); if (fits(lines, pt)) return { pt, lines }; }
  for (const pt of sizes(maxPt, minPt)) {
    doc.setFontSize(pt);
    const wrapped = lines.flatMap((l) => (doc.getTextWidth(l) > maxWidth ? doc.splitTextToSize(l, maxWidth) : [l]));
    if (wrapped.length > lines.length && fits(wrapped, pt)) return { pt, lines: wrapped };
  }
  for (const pt of sizes(wrapPt, minPt)) { doc.setFontSize(pt); if (fits(lines, pt)) return { pt, lines }; }
  return { pt: minPt, lines };
}

/** Font size alone, for callers that never wrap. */
export const fitFont = (doc, lines, opts) => fitBlock(doc, lines, { ...opts, wrapPt: opts.minPt }).pt;

// Shortens a line that still doesn't fit at the smallest size, so it never runs off the label.
function clip(doc, line, maxWidth) {
  if (doc.getTextWidth(line) <= maxWidth) return line;
  let s = line;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function drawBlock(doc, lines, x, yTop, pt, maxWidth) {
  doc.setFontSize(pt);
  const lh = (pt * LINE) / 72;
  lines.forEach((l, i) => {
    // jsPDF positions text by its baseline; put the first baseline one ascent below the top.
    doc.text(clip(doc, l, maxWidth), x, yTop + (pt * 0.92) / 72 + i * lh);
  });
  return (lines.length * pt * LINE) / 72;
}

/**
 * Fills label sheets.
 * @param {Function} JsPDF       the jsPDF constructor
 * @param {string[][]} items     each label's lines
 * @param {object} opts          { sheet, start (1-based label to start on), offsetX, offsetY, outline }
 * @returns jsPDF document
 */
export function buildLabels(JsPDF, items, { sheet = 'avery5160', start = 1, offsetX = 0, offsetY = 0, outline = false } = {}) {
  const s = LABEL_SHEETS[sheet];
  const perPage = s.cols * s.rows;
  const doc = new JsPDF({ unit: 'in', format: s.page, orientation: 'portrait', compress: true });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);
  const first = Math.min(Math.max(1, Math.floor(start) || 1), perPage) - 1;
  const total = first + items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));

  for (let slot = 0; slot < pages * perPage; slot++) {
    const page = Math.floor(slot / perPage);
    if (slot % perPage === 0 && page > 0) doc.addPage(s.page, 'portrait');
    const pos = slot % perPage;
    const col = pos % s.cols;
    const row = Math.floor(pos / s.cols);
    const x = s.left + col * s.pitchX + offsetX;
    const y = s.top + row * s.pitchY + offsetY;
    if (outline) {
      doc.setDrawColor(170);
      doc.setLineWidth(0.005);
      doc.roundedRect(x, y, s.width, s.height, 0.06, 0.06);
    }
    const item = items[slot - first];
    if (slot < first || !item) continue;
    const maxWidth = s.width - 2 * s.padX;
    const maxHeight = s.height - 2 * s.padY;
    const { pt, lines } = fitBlock(doc, item, { maxWidth, maxHeight, maxPt: s.maxPt, minPt: s.minPt, wrapPt: s.wrapPt ?? 8 });
    const blockH = (lines.length * pt * LINE) / 72;
    // Centre the block vertically within the label.
    drawBlock(doc, lines, x + s.padX, y + (s.height - blockH) / 2, pt, maxWidth);
  }
  return doc;
}

/**
 * One envelope per page, with an optional return address in the top-left corner.
 * @param {Function} JsPDF
 * @param {string[][]} items      recipient lines per envelope
 * @param {object} opts           { envelope, returnLines, offsetX, offsetY, outline }
 */
export function buildEnvelopes(JsPDF, items, { envelope = 'a7', returnLines = [], offsetX = 0, offsetY = 0, outline = false } = {}) {
  const e = ENVELOPES[envelope];
  const doc = new JsPDF({ unit: 'in', format: e.page, orientation: 'landscape', compress: true });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);
  items.forEach((lines, i) => {
    if (i > 0) doc.addPage(e.page, 'landscape');
    if (outline) {
      doc.setDrawColor(170);
      doc.setLineWidth(0.01);
      doc.rect(0.02, 0.02, e.page[0] - 0.04, e.page[1] - 0.04);
    }
    if (returnLines.length) {
      const rpt = fitFont(doc, returnLines, { maxWidth: e.returnMaxWidth, maxHeight: 1.2, maxPt: e.returnPt, minPt: 7 });
      drawBlock(doc, returnLines, e.returnAt[0] + offsetX, e.returnAt[1] + offsetY, rpt, e.returnMaxWidth);
    }
    if (!lines?.length) return; // return address only, to address by hand
    const fit = fitBlock(doc, lines, { maxWidth: e.toMaxWidth, maxHeight: 1.7, maxPt: e.toMaxPt, minPt: e.toMinPt, wrapPt: 10.5 });
    const blockH = (fit.lines.length * fit.pt * LINE) / 72;
    drawBlock(doc, fit.lines, e.toLeft + offsetX, e.toCenterY - blockH / 2 + offsetY, fit.pt, e.toMaxWidth);
  });
  if (!items.length) doc.text('Nothing to print', 1, 1);
  return doc;
}

/** Sort key for "last name": the first person's last name, else the label name minus "The"/"Family". */
export function sortKey(h) {
  const last = h.members?.find((m) => m.lastName)?.lastName;
  return (last || String(h.labelName ?? '').replace(/^the\s+/i, '').replace(/\s+(family|household)$/i, '')).toLowerCase();
}

// ---------- invitations ----------
// What invitations print on. Sizes in inches. A sheet holds cols × rows cards; postcards can have the
// address printed on the back.
export const INVITE_MEDIA = {
  avery8387: { name: 'Avery 8387 postcards (4¼ × 5½ in, 4 per sheet)', sheet: [8.5, 11], card: [4.25, 5.5], cols: 2, rows: 2, pad: 0.35, postcard: true },
  postcard4x6: { name: '4 × 6 in postcards', sheet: [4, 6], card: [4, 6], cols: 1, rows: 1, pad: 0.3, postcard: true },
  card5x7: { name: '5 × 7 in cards', sheet: [5, 7], card: [5, 7], cols: 1, rows: 1, pad: 0.4 },
  half: { name: '5½ × 8½ in (half Letter)', sheet: [5.5, 8.5], card: [5.5, 8.5], cols: 1, rows: 1, pad: 0.45 },
  letter: { name: '8½ × 11 in Letter', sheet: [8.5, 11], card: [8.5, 11], cols: 1, rows: 1, pad: 0.75 },
};

/**
 * The printed pages for n invitations: each page lists, cell by cell (left to right, top to bottom),
 * which invitation goes there (null for an unused cell). With backs, every front page is followed by
 * its back page, laid out for two-sided printing flipped on the long edge: turning the sheet over
 * swaps left and right, so each row is reversed and every address lands behind its own invitation.
 */
export function invitePages(n, media, { backs = false } = {}) {
  const per = media.cols * media.rows;
  const pages = [];
  for (let first = 0; first < n; first += per) {
    const cells = Array.from({ length: per }, (_, i) => (first + i < n ? first + i : null));
    pages.push({ side: 'front', cells });
    if (backs) {
      const back = [];
      for (let r = 0; r < media.rows; r++) back.push(...cells.slice(r * media.cols, (r + 1) * media.cols).reverse());
      pages.push({ side: 'back', cells: back });
    }
  }
  return pages;
}

/**
 * How invitations sit on the stock for an orientation. A single card per page simply turns the page
 * (landscape 7 × 5); a sheet of several cards (Avery 8387) stays as it is, so each card's design is
 * turned a quarter within its place instead. sheet and card are as laid out on the printed page.
 */
export function inviteLayout(media, orientation = 'portrait') {
  const landscape = orientation === 'landscape';
  const single = media.cols * media.rows === 1;
  const turnPage = landscape && single && media.card[0] < media.card[1];
  const sheet = turnPage ? [media.sheet[1], media.sheet[0]] : media.sheet;
  const card = turnPage ? [media.card[1], media.card[0]] : media.card;
  return { sheet, card, landscape, rotateFront: landscape !== card[0] > card[1] };
}
