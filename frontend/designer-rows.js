// The Email Designer's page: rows of one to three columns, each column a stack of blocks (text,
// picture, line, space). Drag a block by its grip (or a picture, line or space anywhere) to another
// spot or column; drag a row by its grip to reorder rows. What's saved is plain tables
// (layout-core.js), which every mail app draws the same way.
//
// createRowsEditor(root, ctx) builds the page in root and returns the editor's controls. ctx is how
// it reaches the rest of the Designer:
//   bar            the element for the selected block's or row's own buttons
//   colorInput()   a color swatch (opens the Designer's color window)
//   changed(soon)  something changed (soon: typing or dragging a color, grouped into one undo step)
//   lineHtml(type, color, width)  a divider line's HTML (async: calligraphy lines are pictures)
//   lineInfo(el)   { type, color } of a divider line element, or null
//   lineOptions    the <option>s for the line style list
//   pickPicture()  asks for a picture file and uploads it; resolves to its address, or null
//   uploadFile(f)  uploads a dropped picture file; resolves to its address
//   lineColor()    the color a new line starts in
//   esc, toHex     helpers

import { ROW_LAYOUTS, rowsHtml, layoutOf } from './layout-core.js';

const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></g></svg>';
export const BLOCK_ICONS = {
  text: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 3.5h10M8 3.5v9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  image: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="6.25" r="1.25" fill="currentColor"/><path d="m2.5 12 3.8-3.8 2.4 2.4 1.8-1.8L13.5 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  line: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  spacer: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2v12M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
export const LAYOUT_ICON = (key) => {
  const widths = ROW_LAYOUTS[key].widths;
  let x = 1;
  const rects = widths.map((w) => { const width = (w / 100) * 20 - 1.5; const r = `<rect x="${x.toFixed(1)}" y="2" width="${width.toFixed(1)}" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>`; x += width + 1.5; return r; });
  return `<svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true">${rects.join('')}</svg>`;
};
const NAMES = { text: 'Text', image: 'Picture', line: 'Line', spacer: 'Space', row: 'Row' };
const SPACES = [[12, 'Small'], [24, 'Medium'], [48, 'Large']];
const SIZES = [[25, 'Small'], [50, 'Medium'], [75, 'Large'], [100, 'Full width']];
const IMG_BORDERS = [['', 'No border'], ['1px solid', 'Thin line'], ['4px solid', 'Thick line'], ['5px double', 'Double line'], ['2px dashed', 'Dashed'], ['3px dotted', 'Dotted'], ['rounded', 'Rounded corners']];

export function createRowsEditor(root, ctx) {
  const { esc, toHex } = ctx;
  root.classList.add('rb-root');
  let selected = null; // the selected .rb-block or .rb-row

  // ---- building the page from saved HTML ----
  function parseBlock(el) {
    const type = el.dataset.block;
    if (type === 'image') {
      const img = el.querySelector('img');
      if (!img) return null;
      const style = img.getAttribute('style') ?? '';
      return {
        type, src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '',
        width: parseFloat(img.style.width) || 100, align: el.style.textAlign || 'center',
        border: /(?:^|;)\s*border\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? '',
        radius: /border-radius\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? '',
      };
    }
    if (type === 'line') return { type, html: el.innerHTML };
    if (type === 'spacer') return { type, h: parseFloat(el.style.height) || 24 };
    return { type: 'text', html: el.innerHTML, bg: toHex(el.style.backgroundColor) ?? '' };
  }
  const hasContent = (html) => {
    const d = document.createElement('div'); d.innerHTML = html;
    return Boolean(d.textContent.trim() || d.querySelector('img, hr'));
  };
  // A design made before rows (or a template): its parts become one-column rows, top to bottom.
  function legacyRows(body) {
    const rows = [];
    const one = (b) => rows.push({ layout: '1', bg: '', cols: [[b]] });
    let text = [];
    const flush = () => {
      const html = text.join('').trim();
      if (html && hasContent(html)) one({ type: 'text', html });
      text = [];
    };
    const imageBlock = (img) => {
      const place = img.style.float || img.getAttribute('align') || '';
      return {
        type: 'image', src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '',
        width: parseFloat(img.style.width) || 100,
        align: place === 'left' ? 'left' : place === 'right' ? 'right' : 'center',
        border: /(?:^|;)\s*border\s*:\s*([^;]+)/i.exec(img.getAttribute('style') ?? '')?.[1]?.trim() ?? '',
        radius: img.style.borderRadius || '',
      };
    };
    for (const node of [...body.childNodes]) {
      if (node.nodeType === 3) { if (node.textContent.trim()) text.push(esc(node.textContent)); continue; }
      if (node.nodeType !== 1) continue;
      const el = node;
      if (el.style.clear === 'both' && !el.textContent.trim()) continue;
      const only = el.matches('p, div') && !el.dataset.box && el.children.length === 1 && el.firstElementChild.tagName === 'IMG' && !el.textContent.trim() ? el.firstElementChild : null;
      const img = el.tagName === 'IMG' ? el : only;
      if (el.tagName === 'HR' || (img && ctx.lineInfo(img))) { flush(); one({ type: 'line', html: (img ?? el).outerHTML }); continue; }
      if (img && !img.style.float) { flush(); one(imageBlock(img)); continue; }
      if (el.dataset.box !== undefined) {
        flush();
        if (hasContent(el.innerHTML)) one({ type: 'text', html: el.innerHTML, bg: toHex(el.style.backgroundColor) ?? '' });
        continue;
      }
      text.push(el.outerHTML);
    }
    flush();
    return rows;
  }
  function parse(html) {
    const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
    const wrap = doc.body.querySelector(':scope > [data-rows]');
    if (!wrap) return legacyRows(doc.body);
    return [...wrap.querySelectorAll(':scope > table[data-row]')].map((t) => {
      const tds = [...t.querySelectorAll(':scope > tbody > tr > td[data-col], :scope > tr > td[data-col]')];
      const layout = layoutOf(tds.map((td) => parseFloat(td.getAttribute('width')) || 100 / tds.length));
      return { layout, bg: toHex(t.style.backgroundColor) ?? '', cols: tds.map((td) => [...td.children].filter((c) => c.dataset.block).map(parseBlock).filter(Boolean)) };
    });
  }

  // ---- the page as editable parts ----
  const grip = (what) => `<span class="rb-grip" data-drag="${what}" title="Drag to move" aria-hidden="true">${GRIP}</span>`;
  const imgStyle = (b) => `width:${b.width}%;max-width:100%;height:auto;display:inline-block${b.border ? `;border:${b.border}` : ''}${b.radius ? `;border-radius:${b.radius}` : ''}`;
  function blockEl(b) {
    const el = document.createElement('div');
    el.className = 'rb-block';
    el.dataset.block = b.type;
    if (b.type === 'text') {
      if (b.bg) { el.dataset.bg = b.bg; el.style.backgroundColor = b.bg; }
      el.innerHTML = `${grip('block')}<div class="rb-text" contenteditable="true" spellcheck="true">${b.html || '<p><br></p>'}</div>`;
    } else if (b.type === 'image') {
      el.dataset.align = b.align || 'center';
      el.style.textAlign = el.dataset.align;
      el.innerHTML = b.src
        ? `${grip('block')}<img src="${esc(b.src)}" alt="${esc(b.alt)}" style="${esc(imgStyle(b))}" draggable="false">`
        : `${grip('block')}<button type="button" class="rb-upload" data-upload title="Choose a picture" aria-label="Choose a picture">${BLOCK_ICONS.image}</button>`;
    } else if (b.type === 'line') {
      el.innerHTML = `${grip('block')}${b.html}`;
    } else {
      el.dataset.h = String(b.h ?? 24);
      el.style.height = `${b.h ?? 24}px`;
      el.innerHTML = grip('block');
    }
    return el;
  }
  const emptyEl = () => {
    const el = document.createElement('div');
    el.className = 'rb-empty';
    el.innerHTML = ['text', 'image', 'line', 'spacer'].map((t) => `<button type="button" class="rb-add" data-add="${t}" title="Add ${NAMES[t].toLowerCase()}" aria-label="Add ${NAMES[t].toLowerCase()}">${BLOCK_ICONS[t]}</button>`).join('');
    return el;
  };
  function colEl(blocks, width) {
    const el = document.createElement('div');
    el.className = 'rb-col';
    el.style.flexBasis = `${width}%`;
    for (const b of blocks) el.append(blockEl(b));
    el.append(emptyEl());
    return el;
  }
  function rowEl(row) {
    const el = document.createElement('div');
    el.className = 'rb-row';
    el.dataset.layout = ROW_LAYOUTS[row.layout] ? row.layout : '1';
    if (row.bg) { el.dataset.bg = row.bg; el.style.backgroundColor = row.bg; }
    const cols = document.createElement('div');
    cols.className = 'rb-cols';
    ROW_LAYOUTS[el.dataset.layout].widths.forEach((w, i) => cols.append(colEl(row.cols?.[i] ?? [], w)));
    el.innerHTML = `<span class="rb-grip rb-row-grip" data-drag="row" title="Drag to move the row" aria-hidden="true">${GRIP}</span>`;
    el.append(cols);
    return el;
  }
  const rowsOf = () => [...root.querySelectorAll(':scope > .rb-row')];

  function load(html) {
    select(null);
    root.innerHTML = '';
    const rows = parse(html);
    for (const r of rows.length ? rows : [{ layout: '1', cols: [[{ type: 'text', html: '<p><br></p>' }]] }]) root.append(rowEl(r));
  }

  // ---- the page as saved HTML ----
  function blockModel(el) {
    const type = el.dataset.block;
    if (type === 'text') return { type, html: el.querySelector('.rb-text').innerHTML, bg: el.dataset.bg ?? '' };
    if (type === 'image') {
      const img = el.querySelector('img');
      if (!img) return null; // a picture not chosen yet
      const style = img.getAttribute('style') ?? '';
      return {
        type, src: img.getAttribute('src'), alt: img.getAttribute('alt') ?? '', width: parseFloat(img.style.width) || 100, align: el.dataset.align || 'center',
        border: /(?:^|;)\s*border\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? '', radius: /border-radius\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? '',
      };
    }
    if (type === 'line') { const c = el.cloneNode(true); c.querySelector('.rb-grip')?.remove(); return { type, html: c.innerHTML }; }
    return { type: 'spacer', h: Number(el.dataset.h) || 24 };
  }
  const model = () => rowsOf().map((r) => ({
    layout: r.dataset.layout, bg: r.dataset.bg ?? '',
    cols: [...r.querySelectorAll(':scope > .rb-cols > .rb-col')].map((c) => [...c.querySelectorAll(':scope > .rb-block')].map(blockModel).filter(Boolean)),
  }));
  const html = () => rowsHtml(model());

  // ---- selecting ----
  function select(el) {
    root.querySelectorAll('.rb-selected').forEach((x) => x.classList.remove('rb-selected'));
    selected = el && root.contains(el) ? el : null;
    selected?.classList.add('rb-selected');
    renderBar();
  }
  const selectedType = () => (!selected ? null : selected.classList.contains('rb-row') ? 'row' : selected.dataset.block);

  // ---- the selected part's own buttons ----
  const btn = (attrs, label, title = label, cls = '') => `<button type="button" class="btn sm ${cls}" ${attrs} title="${esc(title)}">${label}</button>`;
  const pressed = (on) => `aria-pressed="${on}"`;
  const sep = '<span class="imgbar-sep"></span>';
  const common = (what) => `${sep}${btn('data-rb="duplicate"', 'Duplicate', `Duplicate the ${what}`)}${btn('data-rb="remove"', 'Remove', `Remove the ${what}`, 'danger')}`;
  function renderBar() {
    const bar = ctx.bar;
    const type = selectedType();
    bar.hidden = !type;
    if (!type) { bar.innerHTML = ''; return; }
    let inner = `<span class="small muted">${NAMES[type]}</span>`;
    if (type === 'row') {
      const layout = selected.dataset.layout;
      inner += Object.keys(ROW_LAYOUTS).map((k) => btn(`data-rb-layout="${k}" ${pressed(k === layout)}`, LAYOUT_ICON(k), ROW_LAYOUTS[k].label, 'icon-only')).join('');
      inner += sep + ctx.colorInput('rbFill', selected.dataset.bg || '#ffffff', 'Fill', 'Row fill color') + btn('data-rb="nofill"', 'No fill', 'No fill color');
      inner += common('row');
    } else if (type === 'text') {
      inner += ctx.colorInput('rbFill', selected.dataset.bg || '#ffffff', 'Fill', 'Fill color') + btn('data-rb="nofill"', 'No fill', 'No fill color');
      inner += common('text');
    } else if (type === 'image') {
      const img = selected.querySelector('img');
      const w = img ? Math.round(parseFloat(img.style.width) || 100) : 100;
      inner += SIZES.map(([v, l]) => btn(`data-rb-width="${v}" ${pressed(v === w)}`, l, `${l}: ${v}% of the column`)).join('');
      inner += `<input type="range" min="10" max="100" step="1" value="${w}" data-rb-range aria-label="Picture width" title="Picture width"><span class="small muted img-size" data-rb-size>${w}%</span>`;
      inner += sep + [['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([k, l]) => btn(`data-rb-align="${k}" ${pressed(selected.dataset.align === k)}`, l, `Place the picture on the ${k}`)).join('');
      if (img) {
        const style = img.getAttribute('style') ?? '';
        const border = /border-radius/.test(style) ? 'rounded' : (/(?:^|;)\s*border\s*:\s*(\d+px \w+)/i.exec(style)?.[1] ?? '');
        const color = toHex(img.style.borderColor) ?? ctx.lineColor();
        inner += `${sep}<span class="imgbar-group"><span class="small muted">Border</span><select data-rb-border aria-label="Picture border">${IMG_BORDERS.map(([k, l]) => `<option value="${k}" ${k === border ? 'selected' : ''}>${l}</option>`).join('')}</select>${ctx.colorInput('rbBorderColor', color, 'Color', 'Picture border color', border ? '' : 'hidden')}</span>`;
        inner += btn('data-rb="replace"', 'Replace…', 'Choose another picture');
      }
      inner += common('picture');
    } else if (type === 'line') {
      const info = ctx.lineInfo(selected.querySelector('hr, img'));
      const width = selected.querySelector('hr, img')?.style.width || '50%';
      inner += `<select data-rb-line aria-label="Line style">${ctx.lineOptions}</select>`;
      inner += ctx.colorInput('rbLineColor', info?.color ?? ctx.lineColor(), 'Color', 'Line color');
      inner += sep + [['25%', 'Short'], ['50%', 'Medium'], ['75%', 'Long'], ['100%', 'Full width']].map(([v, l]) => btn(`data-rb-linewidth="${v}" ${pressed(v === width)}`, l)).join('');
      inner += common('line');
      bar.innerHTML = inner;
      bar.querySelector('[data-rb-line]').value = info?.type ?? 'thin';
      return;
    } else if (type === 'spacer') {
      const h = Number(selected.dataset.h) || 24;
      inner += SPACES.map(([v, l]) => btn(`data-rb-space="${v}" ${pressed(v === h)}`, l, `${l} space`)).join('');
      inner += `<input type="range" min="4" max="160" step="2" value="${h}" data-rb-spacerange aria-label="Space height" title="Space height"><span class="small muted img-size" data-rb-hsize>${h}px</span>`;
      inner += common('space');
    }
    bar.innerHTML = inner;
  }

  // ---- adding ----
  const newBlock = (type) => (type === 'text' ? { type, html: '<p><br></p>' } : type === 'spacer' ? { type, h: 24 } : type === 'image' ? { type, src: '', width: 100, align: 'center' } : null);
  // Where a new part goes: after the selected block (or the text being typed in), else a new row after
  // the selected row, else a new row at the end.
  function placeNew(el) {
    const caretBlock = document.activeElement?.closest?.('.rb-block');
    const after = selected?.classList.contains('rb-block') ? selected : (caretBlock && root.contains(caretBlock) ? caretBlock : null);
    if (after) { after.after(el); return; }
    const row = rowEl({ layout: '1', cols: [[]] });
    row.querySelector('.rb-col').prepend(el);
    if (selected?.classList.contains('rb-row')) selected.after(row); else root.append(row);
  }
  function focusText(el) {
    const t = el.querySelector('.rb-text');
    if (!t) return;
    t.focus();
    const r = document.createRange(); r.selectNodeContents(t); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  async function add(type, { into, before } = {}) {
    let el;
    if (type === 'line') el = blockEl({ type, html: await ctx.lineHtml('thin', ctx.lineColor(), '50%') });
    else el = blockEl(newBlock(type));
    if (into) into.insertBefore(el, before ?? into.querySelector(':scope > .rb-empty'));
    else placeNew(el);
    select(el);
    if (type === 'text') focusText(el);
    ctx.changed();
    if (type === 'image') await choosePicture(el);
    return el;
  }
  function addRow(layout) {
    const row = rowEl({ layout, cols: [] });
    const at = selected?.closest('.rb-row');
    if (at) at.after(row); else root.append(row);
    select(row);
    ctx.changed();
    return row;
  }
  async function choosePicture(block, file) {
    const url = file ? await ctx.uploadFile(file) : await ctx.pickPicture();
    if (!url) return;
    const old = block.querySelector('img');
    const b = old ? { ...blockModel(block), src: url } : { type: 'image', src: url, width: 100, align: block.dataset.align || 'center' };
    const fresh = blockEl(b);
    block.replaceWith(fresh);
    select(fresh);
    ctx.changed();
  }
  /** A picture file dropped or chosen from the toolbar: a new picture block. */
  async function addPicture(file, { into, before } = {}) {
    const el = blockEl({ type: 'image', src: '', width: 100, align: 'center' });
    if (into) into.insertBefore(el, before ?? into.querySelector(':scope > .rb-empty')); else placeNew(el);
    await choosePicture(el, file);
    if (!el.isConnected) return;
    el.remove(); // the upload didn't happen
    select(null);
  }
  /** Inserts a fill-in field when no text has the cursor: as a new text block. */
  function addText(html) {
    const el = blockEl({ type: 'text', html });
    placeNew(el);
    select(el);
    ctx.changed();
  }

  // ---- changing the selected part ----
  function setLayout(row, layout) {
    const cols = [...row.querySelectorAll(':scope > .rb-cols > .rb-col')];
    const widths = ROW_LAYOUTS[layout].widths;
    // Blocks of columns that go away move into the last column that stays.
    const keep = cols.slice(0, widths.length);
    for (const c of cols.slice(widths.length)) {
      const last = keep[keep.length - 1];
      c.querySelectorAll(':scope > .rb-block').forEach((b) => last.insertBefore(b, last.querySelector(':scope > .rb-empty')));
      c.remove();
    }
    const host = row.querySelector(':scope > .rb-cols');
    widths.forEach((w, i) => { const c = keep[i] ?? host.appendChild(colEl([], w)); c.style.flexBasis = `${w}%`; });
    row.dataset.layout = layout;
  }
  function setImage(block, change) {
    const b = { ...blockModel(block), ...change };
    const fresh = blockEl(b);
    block.replaceWith(fresh);
    select(fresh);
  }
  async function setLine(block, { type, color, width }) {
    const el = block.querySelector('hr, img');
    const info = ctx.lineInfo(el) ?? { type: 'thin', color: ctx.lineColor() };
    ctx.bar.classList.add('busy');
    try {
      const fresh = blockEl({ type: 'line', html: await ctx.lineHtml(type ?? info.type, color ?? info.color, width ?? (el?.style.width || '50%')) });
      block.replaceWith(fresh);
      select(fresh);
      ctx.changed();
    } finally { ctx.bar.classList.remove('busy'); }
  }
  function remove(el) {
    if (!el) return;
    const row = el.closest('.rb-row');
    el.remove();
    if (el === row && !rowsOf().length) root.append(rowEl({ layout: '1', cols: [[{ type: 'text', html: '<p><br></p>' }]] }));
    select(null);
    ctx.changed();
  }
  function duplicate(el) {
    const copy = el.classList.contains('rb-row')
      ? rowEl({ layout: el.dataset.layout, bg: el.dataset.bg ?? '', cols: [...el.querySelectorAll(':scope > .rb-cols > .rb-col')].map((c) => [...c.querySelectorAll(':scope > .rb-block')].map(blockModel).filter(Boolean)) })
      : blockEl(blockModel(el) ?? newBlock('image'));
    el.after(copy);
    select(copy);
    ctx.changed();
  }

  ctx.bar.addEventListener('click', (e) => {
    if (!selected) return;
    const t = e.target.closest('button');
    if (!t) return;
    const act = t.dataset.rb;
    if (act === 'remove') return remove(selected);
    if (act === 'duplicate') return duplicate(selected);
    if (act === 'nofill') { delete selected.dataset.bg; selected.style.backgroundColor = ''; renderBar(); ctx.changed(); return undefined; }
    if (act === 'replace') return choosePicture(selected);
    if (t.dataset.rbLayout) { setLayout(selected, t.dataset.rbLayout); renderBar(); ctx.changed(); return undefined; }
    if (t.dataset.rbWidth) { setImage(selected, { width: Number(t.dataset.rbWidth) }); ctx.changed(); return undefined; }
    if (t.dataset.rbAlign) { setImage(selected, { align: t.dataset.rbAlign }); ctx.changed(); return undefined; }
    if (t.dataset.rbLinewidth) return setLine(selected, { width: t.dataset.rbLinewidth });
    if (t.dataset.rbSpace) { setSpace(selected, Number(t.dataset.rbSpace)); renderBar(); ctx.changed(); }
    return undefined;
  });
  function setSpace(block, h) { block.dataset.h = String(h); block.style.height = `${h}px`; }
  ctx.bar.addEventListener('input', (e) => {
    const t = e.target;
    if (!selected) return;
    if (t.matches('[data-rb-range]')) {
      const img = selected.querySelector('img');
      if (img) img.style.width = `${t.value}%`;
      ctx.bar.querySelector('[data-rb-size]').textContent = `${t.value}%`;
      ctx.bar.querySelectorAll('[data-rb-width]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rbWidth === t.value)));
      ctx.changed(true);
    }
    if (t.matches('[data-rb-spacerange]')) {
      setSpace(selected, Number(t.value));
      ctx.bar.querySelector('[data-rb-hsize]').textContent = `${t.value}px`;
      ctx.bar.querySelectorAll('[data-rb-space]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rbSpace === t.value)));
      ctx.changed(true);
    }
  });
  const onBarColor = (e) => {
    const t = e.target;
    if (t.type !== 'color' || !selected) return;
    const sw = ctx.bar.querySelector(`[data-color-for="${t.name}"]`);
    if (sw) sw.style.background = t.value;
    if (t.name === 'rbFill') { selected.dataset.bg = t.value; selected.style.backgroundColor = t.value; ctx.changed(true); }
    if (t.name === 'rbBorderColor' && e.type === 'change') {
      const kind = ctx.bar.querySelector('[data-rb-border]')?.value;
      if (kind) setImageBorder(kind, t.value);
    }
    if (t.name === 'rbLineColor' && e.type === 'change') setLine(selected, { color: t.value });
  };
  function setImageBorder(kind, color) {
    setImage(selected, kind === 'rounded' ? { border: `3px solid ${color}`, radius: '14px' } : { border: kind ? `${kind} ${color}` : '', radius: '' });
    ctx.changed();
  }
  ctx.bar.addEventListener('input', onBarColor);
  ctx.bar.addEventListener('change', (e) => {
    onBarColor(e);
    const t = e.target;
    if (!selected) return;
    if (t.matches('[data-rb-border]')) setImageBorder(t.value, ctx.bar.querySelector('[name=rbBorderColor]')?.value ?? ctx.lineColor());
    if (t.matches('[data-rb-line]')) setLine(selected, { type: t.value });
    if (t.matches('[data-rb-range], [data-rb-spacerange]')) { const keep = selected; renderBar(); select(keep); ctx.changed(); }
  });

  // ---- clicking ----
  root.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const add = e.target.closest('[data-add]');
    if (add) { const col = add.closest('.rb-col'); ctx.run(() => addInto(add.dataset.add, col)); return; }
    if (e.target.closest('[data-upload]')) { const b = e.target.closest('.rb-block'); select(b); ctx.run(() => choosePicture(b)); return; }
    const block = e.target.closest('.rb-block');
    if (block) { if (selected !== block) select(block); return; }
    const row = e.target.closest('.rb-row');
    select(row);
  });
  const addInto = (type, col) => add(type, { into: col });
  root.addEventListener('focusin', (e) => {
    const block = e.target.closest?.('.rb-block');
    if (block && selected !== block) select(block);
  });

  // ---- dragging ----
  // A block moves by its grip (pictures, lines and spaces anywhere on them) to a spot in any column,
  // or between rows to start a new row; a row moves by its grip. Toolbar buttons can be dragged in too.
  const host = root.parentElement; // the page, which holds the drop marker
  const marker = Object.assign(document.createElement('div'), { className: 'rb-marker', hidden: true });
  host.append(marker);
  const ghost = Object.assign(document.createElement('div'), { className: 'rb-ghost', hidden: true });
  document.body.append(ghost);
  let drag = null;
  let suppressClick = false;

  function dropTarget(x, y) {
    const hostBox = host.getBoundingClientRect();
    const rows = rowsOf().filter((r) => r !== drag.el);
    if (drag.kind !== 'row') {
      const col = document.elementsFromPoint(x, y).map((n) => n.closest?.('.rb-col')).find((c) => c && root.contains(c) && !drag.el?.contains(c));
      if (col) {
        const blocks = [...col.querySelectorAll(':scope > .rb-block')].filter((b) => b !== drag.el);
        const before = blocks.find((b) => { const r = b.getBoundingClientRect(); return y < r.top + r.height / 2; }) ?? null;
        const cr = col.getBoundingClientRect();
        let top;
        if (before) top = before.getBoundingClientRect().top - 3;
        else if (blocks.length) top = blocks[blocks.length - 1].getBoundingClientRect().bottom + 1;
        else top = cr.top + 4;
        return { col, before, box: { left: cr.left - hostBox.left + 4, top: top - hostBox.top, width: cr.width - 8 } };
      }
    }
    // Between rows: a new row (a block) or a row's new place.
    const before = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }) ?? null;
    const rb = root.getBoundingClientRect();
    let top;
    if (before) top = before.getBoundingClientRect().top - 3;
    else if (rows.length) top = rows[rows.length - 1].getBoundingClientRect().bottom + 1;
    else top = rb.top;
    return { rowBefore: before, box: { left: rb.left - hostBox.left, top: top - hostBox.top, width: rb.width } };
  }
  function startDrag(e, kind, el, newType) {
    drag = { kind, el, newType, x: e.clientX, y: e.clientY, on: false, pointer: e.pointerId };
  }
  function moveDrag(e) {
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.on = true;
      document.body.classList.add('rb-dragging-now');
      drag.el?.classList.add('rb-dragging');
      ghost.innerHTML = `${BLOCK_ICONS[drag.newType ?? drag.el?.dataset.block] ?? GRIP} ${NAMES[drag.kind === 'row' ? 'row' : (drag.newType ?? drag.el?.dataset.block)] ?? ''}`;
      ghost.hidden = false;
      window.getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY + 12}px`;
    const inside = (() => { const r = host.getBoundingClientRect(); return e.clientX >= r.left - 40 && e.clientX <= r.right + 40 && e.clientY >= r.top - 40 && e.clientY <= r.bottom + 40; })();
    drag.target = inside ? dropTarget(e.clientX, e.clientY) : null;
    marker.hidden = !drag.target;
    if (drag.target) Object.assign(marker.style, { left: `${drag.target.box.left}px`, top: `${drag.target.box.top}px`, width: `${drag.target.box.width}px` });
  }
  async function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    marker.hidden = true; ghost.hidden = true;
    document.body.classList.remove('rb-dragging-now');
    d.el?.classList.remove('rb-dragging');
    if (!d.on) { if (d.newType) ctx.run(() => (d.newType.startsWith('row:') ? addRow(d.newType.slice(4)) : add(d.newType))); return; }
    suppressClick = Boolean(d.el);
    setTimeout(() => { suppressClick = false; }, 0);
    if (e.type === 'pointercancel' || !d.target) return;
    const t = d.target;
    const oldRow = d.el?.closest('.rb-row');
    if (d.kind === 'row') {
      const row = d.el ?? rowEl({ layout: d.newType.slice(4), cols: [] });
      root.insertBefore(row, t.rowBefore);
      select(row);
      ctx.changed();
      return;
    }
    let block = d.el;
    if (!block) {
      if (d.newType === 'image') block = blockEl(newBlock('image'));
      else if (d.newType === 'line') block = blockEl({ type: 'line', html: await ctx.lineHtml('thin', ctx.lineColor(), '50%') });
      else block = blockEl(newBlock(d.newType));
    }
    if (t.col) t.col.insertBefore(block, t.before ?? t.col.querySelector(':scope > .rb-empty'));
    else {
      const row = rowEl({ layout: '1', cols: [] });
      row.querySelector('.rb-col').prepend(block);
      root.insertBefore(row, t.rowBefore);
    }
    // A row left with nothing in it by the move goes away.
    if (oldRow && oldRow !== block.closest('.rb-row') && !oldRow.querySelector('.rb-block') && rowsOf().length > 1) oldRow.remove();
    select(block);
    if (d.newType === 'text') focusText(block);
    ctx.changed();
    if (d.newType === 'image') ctx.run(() => choosePicture(block));
  }
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const g = e.target.closest('[data-drag]');
    if (g) { e.preventDefault(); startDrag(e, g.dataset.drag, g.closest(g.dataset.drag === 'row' ? '.rb-row' : '.rb-block')); return; }
    const block = e.target.closest('.rb-block');
    if (block && block.dataset.block !== 'text' && !e.target.closest('button')) startDrag(e, 'block', block);
  });
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  /** Lets a toolbar button be dragged onto the page (or clicked to add at the usual place). */
  function palette(button, type) {
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(e, type.startsWith('row:') ? 'row' : 'block', null, type);
    });
  }

  // Pictures dropped from the computer go where they're dropped.
  host.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  host.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /^image\//.test(f.type));
    if (!file) return;
    e.preventDefault();
    drag = { kind: 'block', el: null };
    const t = dropTarget(e.clientX, e.clientY);
    drag = null;
    if (t.col) ctx.run(() => addPicture(file, { into: t.col, before: t.before }));
    else ctx.run(() => addPicture(file));
  });

  // Keys: Delete removes the selected part (not while typing), Escape lets go of it.
  root.closest('form')?.addEventListener('keydown', (e) => {
    if (!selected) return;
    const typing = e.target.closest?.('[contenteditable=true], input, select, textarea');
    if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); select(null); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { e.preventDefault(); remove(selected); }
  });

  function destroy() {
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    ghost.remove();
  }

  return {
    load, html, select, palette, destroy, addRow, addText,
    add: (type) => add(type),
    addPicture: (file) => addPicture(file),
    selectedType,
    /** The text the toolbar formats as a whole when nothing is selected: the selected text block. */
    wholeText: () => (selected?.dataset.block === 'text' ? selected.querySelector('.rb-text') : null),
    textHost: (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.rb-text') ?? null,
  };
}
