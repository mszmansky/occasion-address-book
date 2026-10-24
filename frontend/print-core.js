// Label and envelope layout. Pure functions over a jsPDF instance, so they run in the browser
// and in Node tests alike. All measurements are in inches.

export const LABEL_SHEETS = {
  avery5160: {
    name: 'Avery 5160 / 8160 address labels (30 per sheet)',
    page: [8.5, 11],
    cols: 3, rows: 10,
    width: 2.625, height: 1,
    left: 0.1875, top: 0.5,      // page margin to the first label
    pitchX: 2.75, pitchY: 1,     // distance from one label's corner to the next
    padX: 0.12, padY: 0.08,      // printable inset inside each label
    maxPt: 11, minPt: 6.5,
  },
};

export const ENVELOPES = {
  a2: {
    name: 'A2 envelopes (5¾ × 4⅜ in)', // fits 4¼ × 5½ cards, like Avery 8387
    page: [5.75, 4.375],
    returnAt: [0.3, 0.3], returnMaxWidth: 2.4, returnPt: 8,
    toLeft: 2.05, toCenterY: 2.45, toMaxWidth: 3.4, toMaxPt: 11.5, toMinPt: 7.5,
  },
  a7: {
    name: 'A7 envelopes (7¼ × 5¼ in)', // fits 5 × 7 cards
    page: [7.25, 5.25],          // landscape: width × height
    returnAt: [0.35, 0.38], returnMaxWidth: 3.0, returnPt: 9,
    // Recipient block: left edge and the vertical centre line it is centred on.
    toLeft: 2.85, toCenterY: 2.95, toMaxWidth: 4.0, toMaxPt: 12.5, toMinPt: 8,
  },
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
    const { pt, lines } = fitBlock(doc, item, { maxWidth, maxHeight, maxPt: s.maxPt, minPt: s.minPt, wrapPt: 8 });
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
