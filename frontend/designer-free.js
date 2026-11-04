// The Invitation Designer's card: text, pictures and lines placed anywhere. Drag a part to move it
// (it snaps to the card's center lines and to the other parts), drag its handles to size it, click
// a selected text box again (or double-click it) to type in it. Positions are kept as percentages of
// the card and text sizes in cqw (hundredths of its width), so the layout prints the same on any card.
//
// createFreeEditor(root, ctx) builds the card in root (inside the canvas, which is the card itself)
// and returns the editor's controls. ctx:
//   canvas         the card element (its size is set here from the chosen card)
//   bar            the element for the selected part's own buttons
//   cards          { key: { name, card: [w, h] inches } } the cards invitations print on
//   colorInput(), changed(soon), lineHtml(), lineInfo(), lineOptions, pickPicture(), uploadFile(),
//   lineColor(), run(fn), esc, toHex   as for the rows editor

import { freeHtml, cardShape } from './layout-core.js';
import { isFreeDesign } from './design-core.js';

const NAMES = { text: 'Text', image: 'Picture', line: 'Line' };
const SNAP = 1.2; // percent of the card
const BOX_BORDERS = [['', 'No border'], ['1px solid', 'Thin line'], ['3px solid', 'Thick line'], ['2px dashed', 'Dashed'], ['3px dotted', 'Dotted'], ['4px double', 'Double line'], ['rounded', 'Rounded']];
const IMG_BORDERS = [['', 'No border'], ['1px solid', 'Thin line'], ['4px solid', 'Thick line'], ['5px double', 'Double line'], ['2px dashed', 'Dashed'], ['3px dotted', 'Dotted'], ['rounded', 'Rounded corners']];
// Sizes earlier designs used, as the browser draws them, for turning them into card-relative sizes.
const KEYWORD_PX = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
const FONT_SIZE_PX = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };
export const LEGACY_WIDTH = 480; // earlier invitations were laid out about this wide (5 inches)

/** Turns fixed text sizes (px, pt, size keywords, <font size>) inside el into card-relative cqw. */
export function sizesToCqw(el, refPx = LEGACY_WIDTH) {
  const cqw = (px) => `${Math.round((px / refPx) * 100 * 1000) / 1000}cqw`;
  for (const n of [el, ...el.querySelectorAll('*')]) {
    if (n.tagName === 'FONT' && n.getAttribute('size')) {
      const px = FONT_SIZE_PX[Number(n.getAttribute('size'))];
      n.removeAttribute('size');
      if (px && !n.style.fontSize) n.style.fontSize = cqw(px);
    }
    const fs = n.style?.fontSize;
    if (!fs) continue;
    if (/px$/.test(fs)) n.style.fontSize = cqw(parseFloat(fs));
    else if (/pt$/.test(fs)) n.style.fontSize = cqw((parseFloat(fs) * 96) / 72);
    else if (KEYWORD_PX[fs]) n.style.fontSize = cqw(KEYWORD_PX[fs]);
  }
}

export function createFreeEditor(root, ctx) {
  const { esc, toHex, canvas } = ctx;
  root.classList.add('fb-root');
  let card = { size: 'card5x7', orient: 'portrait' };
  let selected = null; // the selected .fb-item
  let editing = null;  // the text item being typed in

  const shape = () => cardShape((ctx.cards[card.size] ?? ctx.cards.card5x7).card, card.orient);
  /** Sizes the card on screen: as large as fits, keeping its shape. */
  function sizeCanvas() {
    const [w, h] = shape();
    const width = Math.round(Math.min(card.orient === 'landscape' ? 620 : 470, (560 * w) / h));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${Math.round((width * h) / w)}px`;
    requestAnimationFrame(place);
  }

  // ---- parts ----
  function itemEl({ type, x, y, w, html, fill = '', border = '', radius = '' }) {
    const el = document.createElement('div');
    el.className = 'fb-item';
    el.dataset.item = type;
    Object.assign(el.style, { left: `${x}%`, top: `${y}%`, width: `${w}%` });
    if (type === 'text') {
      el.innerHTML = `<div class="fb-text" spellcheck="true">${html || '<p style="text-align:center"><br></p>'}</div>`;
      const t = el.firstElementChild;
      if (fill) t.style.backgroundColor = fill;
      if (border) t.style.border = border;
      if (radius) t.style.borderRadius = radius;
      if (fill || border) t.style.padding = '0.5em 0.7em';
    } else el.innerHTML = html;
    return el;
  }
  const items = () => [...root.querySelectorAll(':scope > .fb-item')];
  const pct = (n) => Math.round(n * 100) / 100;

  // A design made before free layouts (or a template): laid out as it would print, then each part is
  // placed where it fell.
  async function convert(html) {
    const [w, h] = shape();
    const width = LEGACY_WIDTH;
    const height = (width * h) / w;
    const probe = document.createElement('div');
    probe.className = 'fb-probe';
    Object.assign(probe.style, { position: 'absolute', left: '-10000px', top: '0', width: `${width}px`, padding: `${width * 0.08}px`, boxSizing: 'border-box', fontSize: '16px', lineHeight: '1.5', fontFamily: canvas.style.fontFamily });
    probe.innerHTML = html;
    document.body.append(probe);
    // Pictures take their room once they've loaded.
    await Promise.all([...probe.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((done) => {
      img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); setTimeout(done, 5000);
    }))));
    const base = probe.getBoundingClientRect();
    const out = [];
    let group = [];
    const at = (r) => ({ x: pct(((r.left - base.left) / width) * 100), y: pct(((r.top - base.top) / height) * 100), w: pct((r.width / width) * 100) });
    const flushGroup = () => {
      if (!group.length) return;
      const rects = group.map((n) => (n.nodeType === 1 ? n.getBoundingClientRect() : (() => { const r = document.createRange(); r.selectNode(n); return r.getBoundingClientRect(); })()));
      const top = Math.min(...rects.map((r) => r.top));
      const box = { left: base.left + width * 0.08, top, width: width * 0.84 };
      const wrap = document.createElement('div');
      for (const n of group) {
        const c = n.cloneNode(true);
        // Paragraph spacing as it was (new text has none, like a text box).
        if (c.nodeType === 1 && /^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(c.tagName) && !c.style.margin) c.style.margin = getComputedStyle(n).marginTop === '0px' ? '0 0 0.75em' : '0.4em 0 0.6em';
        wrap.append(c);
      }
      sizesToCqw(wrap);
      if (wrap.textContent.trim() || wrap.querySelector('img')) out.push({ type: 'text', ...at(box), html: wrap.innerHTML });
      group = [];
    };
    for (const n of [...probe.childNodes]) {
      if (n.nodeType === 3) { if (n.textContent.trim()) group.push(n); continue; }
      if (n.nodeType !== 1) continue;
      if (n.style.clear === 'both' && !n.textContent.trim()) continue;
      const only = n.matches('p, div') && n.dataset.box === undefined && n.children.length === 1 && n.firstElementChild.tagName === 'IMG' && !n.textContent.trim() ? n.firstElementChild : null;
      const img = n.tagName === 'IMG' ? n : only;
      if (n.tagName === 'HR' || (img && ctx.lineInfo(img))) {
        flushGroup();
        const line = (img ?? n).cloneNode(true);
        Object.assign(line.style, { width: '100%', margin: '0' });
        out.push({ type: 'line', ...at((img ?? n).getBoundingClientRect()), html: line.outerHTML });
        continue;
      }
      if (img && !img.style.float) {
        flushGroup();
        const c = img.cloneNode(true);
        const border = img.style.border; const radius = img.style.borderRadius;
        c.removeAttribute('style'); c.removeAttribute('width'); c.removeAttribute('height'); c.removeAttribute('align');
        c.setAttribute('style', `display:block;width:100%;height:auto${border ? `;border:${border}` : ''}${radius ? `;border-radius:${radius}` : ''}`);
        out.push({ type: 'image', ...at(img.getBoundingClientRect()), html: c.outerHTML });
        continue;
      }
      if (n.dataset.box !== undefined) {
        flushGroup();
        const wrap = document.createElement('div');
        wrap.innerHTML = n.innerHTML;
        sizesToCqw(wrap);
        const fill = toHex(n.style.backgroundColor) ?? '';
        const border = n.dataset.box && n.dataset.box !== 'none' ? n.style.border : '';
        if (wrap.textContent.trim() || wrap.querySelector('img')) out.push({ type: 'text', ...at(n.getBoundingClientRect()), html: wrap.innerHTML, fill, border, radius: n.style.borderRadius });
        continue;
      }
      group.push(n);
    }
    flushGroup();
    probe.remove();
    return out;
  }

  function load(html) {
    select(null);
    root.innerHTML = '';
    if (isFreeDesign(html)) {
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      const wrap = doc.body.firstElementChild;
      card = { size: ctx.cards[wrap.dataset.free] ? wrap.dataset.free : 'card5x7', orient: wrap.dataset.orient === 'landscape' ? 'landscape' : 'portrait' };
      sizeCanvas();
      for (const n of [...wrap.querySelectorAll(':scope > [data-item]')].sort((a, b) => (Number(a.style.zIndex) || 0) - (Number(b.style.zIndex) || 0))) {
        const type = ['text', 'image', 'line'].includes(n.dataset.item) ? n.dataset.item : 'text';
        const el = itemEl({ type, x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0, w: parseFloat(n.style.width) || 50, html: n.innerHTML });
        if (type === 'text') {
          // A text box's fill and border are on a wrapper inside the part.
          const t = el.querySelector('.fb-text');
          const only = t.childNodes.length === 1 && t.firstElementChild?.tagName === 'DIV' && /background|border/.test(t.firstElementChild.getAttribute('style') ?? '') ? t.firstElementChild : null;
          if (only) { t.setAttribute('style', only.getAttribute('style')); t.innerHTML = only.innerHTML; }
        }
        root.append(el);
      }
      return null;
    }
    sizeCanvas();
    return convert(html ?? '').then((list) => { for (const it of list) root.append(itemEl(it)); });
  }

  // ---- the card as saved HTML ----
  function itemHtml(el) {
    const type = el.dataset.item;
    if (type === 'text') {
      const t = el.querySelector('.fb-text').cloneNode(true);
      t.removeAttribute('contenteditable'); t.removeAttribute('spellcheck'); t.removeAttribute('class');
      return t.getAttribute('style') ? t.outerHTML : t.innerHTML;
    }
    return el.innerHTML;
  }
  const html = () => freeHtml({
    size: card.size, orient: card.orient, shape: shape(),
    items: items().filter((el) => el.dataset.item !== 'text' || el.textContent.trim() || el.querySelector('img'))
      .map((el, i) => ({ type: el.dataset.item, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), z: i + 1, html: itemHtml(el) })),
  });

  // ---- selection frame and handles ----
  const frame = Object.assign(document.createElement('div'), { className: 'fb-frame', hidden: true });
  frame.innerHTML = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span class="fb-h fb-h-${h}" data-h="${h}"></span>`).join('')
    + '<span class="fb-move" data-h="move" title="Drag to move"></span>';
  canvas.append(frame);
  const guides = { v: Object.assign(document.createElement('div'), { className: 'fb-guide fb-guide-v', hidden: true }), h: Object.assign(document.createElement('div'), { className: 'fb-guide fb-guide-h', hidden: true }) };
  canvas.append(guides.v, guides.h);
  const HANDLES = { text: ['e', 'w'], line: ['e', 'w'], image: ['nw', 'ne', 'se', 'sw'] };
  function place() {
    if (!selected || !selected.isConnected) { frame.hidden = true; return; }
    Object.assign(frame.style, { left: `${selected.offsetLeft}px`, top: `${selected.offsetTop}px`, width: `${selected.offsetWidth}px`, height: `${Math.max(selected.offsetHeight, 8)}px` });
    frame.dataset.type = selected.dataset.item;
    frame.classList.toggle('editing', selected === editing);
    frame.querySelectorAll('[data-h]').forEach((hd) => { hd.hidden = hd.dataset.h !== 'move' && !HANDLES[selected.dataset.item].includes(hd.dataset.h); });
    frame.hidden = false;
  }
  function select(el) {
    if (editing && editing !== el) stopEditing();
    root.querySelectorAll('.fb-selected').forEach((x) => x.classList.remove('fb-selected'));
    selected = el && root.contains(el) ? el : null;
    selected?.classList.add('fb-selected');
    renderBar();
    place();
  }
  function startEditing(el, at) {
    const t = el.querySelector('.fb-text');
    if (!t) return;
    editing = el;
    t.contentEditable = 'true';
    t.focus();
    const sel = window.getSelection();
    let r = null;
    if (at) r = document.caretRangeFromPoint?.(at.x, at.y) ?? null;
    if (!r || !t.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(t); r.collapse(false); }
    sel.removeAllRanges(); sel.addRange(r);
    place();
  }
  function stopEditing() {
    const el = editing;
    if (!el) return;
    editing = null;
    const t = el.querySelector('.fb-text');
    t.contentEditable = 'false';
    // A text part left empty goes away.
    if (!t.textContent.trim() && !t.querySelector('img')) { el.remove(); if (selected === el) selected = null; ctx.changed(); }
    place();
  }

  // ---- the selected part's own buttons ----
  const btn = (attrs, label, title = label, cls = '') => `<button type="button" class="btn sm ${cls}" ${attrs} title="${esc(title)}">${label}</button>`;
  const sep = '<span class="imgbar-sep"></span>';
  function renderBar() {
    const bar = ctx.bar;
    if (!selected) { bar.hidden = true; bar.innerHTML = ''; return; }
    const type = selected.dataset.item;
    let inner = `<span class="small muted">${NAMES[type]}</span>`;
    if (type === 'text') {
      const t = selected.querySelector('.fb-text');
      const style = t.getAttribute('style') ?? '';
      const border = /border-radius/.test(style) ? 'rounded' : (/(?:^|;)\s*border\s*:\s*(\d+px \w+)/i.exec(style)?.[1] ?? '');
      inner += ctx.colorInput('fbFill', toHex(t.style.backgroundColor) ?? '#ffffff', 'Fill', 'Fill color') + btn('data-fb="nofill"', 'No fill', 'No fill color');
      inner += `${sep}<span class="imgbar-group"><span class="small muted">Border</span><select data-fb-border aria-label="Text box border">${BOX_BORDERS.map(([k, l]) => `<option value="${k}" ${k === border ? 'selected' : ''}>${l}</option>`).join('')}</select>${ctx.colorInput('fbBorderColor', toHex(t.style.borderTopColor) ?? ctx.lineColor(), 'Color', 'Text box border color', border ? '' : 'hidden')}</span>`;
    } else if (type === 'image') {
      const img = selected.querySelector('img');
      const style = img?.getAttribute('style') ?? '';
      const border = /border-radius/.test(style) ? 'rounded' : (/(?:^|;)\s*border\s*:\s*(\d+px \w+)/i.exec(style)?.[1] ?? '');
      inner += `<span class="imgbar-group"><span class="small muted">Border</span><select data-fb-imgborder aria-label="Picture border">${IMG_BORDERS.map(([k, l]) => `<option value="${k}" ${k === border ? 'selected' : ''}>${l}</option>`).join('')}</select>${ctx.colorInput('fbImgBorderColor', toHex(img?.style.borderColor) ?? ctx.lineColor(), 'Color', 'Picture border color', border ? '' : 'hidden')}</span>`;
      inner += btn('data-fb="replace"', 'Replace…', 'Choose another picture');
    } else if (type === 'line') {
      const info = ctx.lineInfo(selected.querySelector('hr, img'));
      inner += `<select data-fb-line aria-label="Line style">${ctx.lineOptions}</select>${ctx.colorInput('fbLineColor', info?.color ?? ctx.lineColor(), 'Color', 'Line color')}`;
    }
    inner += sep + btn('data-fb="center"', 'Center', 'Center it across the card');
    inner += sep + btn('data-fb="front"', 'Bring to front', 'In front of the other parts') + btn('data-fb="back"', 'Send to back', 'Behind the other parts');
    inner += sep + btn('data-fb="duplicate"', 'Duplicate', `Duplicate the ${NAMES[type].toLowerCase()}`) + btn('data-fb="remove"', 'Remove', `Remove the ${NAMES[type].toLowerCase()}`, 'danger');
    bar.innerHTML = inner;
    bar.hidden = false;
    if (type === 'line') bar.querySelector('[data-fb-line]').value = ctx.lineInfo(selected.querySelector('hr, img'))?.type ?? 'thin';
  }
  function setTextBox(fill, border, color) {
    const t = selected.querySelector('.fb-text');
    if (fill !== undefined) t.style.backgroundColor = fill;
    if (border !== undefined) {
      t.style.border = border === 'rounded' ? `2px solid ${color}` : border ? `${border} ${color}` : '';
      t.style.borderRadius = border === 'rounded' ? '12px' : '';
    }
    t.style.padding = t.style.backgroundColor || t.style.borderStyle ? '0.5em 0.7em' : '';
    if (!t.getAttribute('style')) t.removeAttribute('style');
    ctx.changed(); place();
  }
  function setImgBorder(kind, color) {
    const img = selected.querySelector('img');
    if (!img) return;
    img.style.border = kind === 'rounded' ? `3px solid ${color}` : kind ? `${kind} ${color}` : '';
    img.style.borderRadius = kind === 'rounded' ? '14px' : '';
    ctx.changed(); place();
  }
  async function setLine({ type, color }) {
    const el = selected.querySelector('hr, img');
    const info = ctx.lineInfo(el) ?? { type: 'thin', color: ctx.lineColor() };
    ctx.bar.classList.add('busy');
    try {
      const fresh = await ctx.lineHtml(type ?? info.type, color ?? info.color, '100%');
      selected.innerHTML = fresh.replace(/margin:[^;"]+/, 'margin:0');
      ctx.changed(); renderBar(); place();
    } finally { ctx.bar.classList.remove('busy'); }
  }
  const center = (el) => { el.style.left = `${pct((100 - parseFloat(el.style.width)) / 2)}%`; };
  ctx.bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-fb]')?.dataset.fb;
    if (!act || !selected) return;
    const el = selected;
    if (act === 'remove') { el.remove(); select(null); ctx.changed(); }
    if (act === 'duplicate') {
      const copy = el.cloneNode(true);
      copy.classList.remove('fb-selected');
      copy.querySelector('.fb-text')?.setAttribute('contenteditable', 'false');
      copy.style.left = `${Math.min(95, parseFloat(el.style.left) + 3)}%`;
      copy.style.top = `${Math.min(95, parseFloat(el.style.top) + 3)}%`;
      root.append(copy); select(copy); ctx.changed();
    }
    if (act === 'front') { root.append(el); ctx.changed(); place(); }
    if (act === 'back') { root.prepend(el); ctx.changed(); place(); }
    if (act === 'center') { center(el); ctx.changed(); place(); }
    if (act === 'nofill') { setTextBox('', undefined); renderBar(); }
    if (act === 'replace') ctx.run(async () => { const url = await ctx.pickPicture(); if (url) { el.querySelector('img').src = url; ctx.changed(); } });
  });
  const onBarColor = (e) => {
    const t = e.target;
    if (t.type !== 'color' || !selected) return;
    const sw = ctx.bar.querySelector(`[data-color-for="${t.name}"]`);
    if (sw) sw.style.background = t.value;
    if (t.name === 'fbFill') { selected.querySelector('.fb-text').style.backgroundColor = t.value; setTextBox(undefined, undefined); }
    if (t.name === 'fbBorderColor') { const k = ctx.bar.querySelector('[data-fb-border]').value; if (k) setTextBox(undefined, k, t.value); }
    if (t.name === 'fbImgBorderColor') { const k = ctx.bar.querySelector('[data-fb-imgborder]').value; if (k) setImgBorder(k, t.value); }
    if (t.name === 'fbLineColor' && e.type === 'change') ctx.run(() => setLine({ color: t.value }));
  };
  ctx.bar.addEventListener('input', onBarColor);
  ctx.bar.addEventListener('change', (e) => {
    onBarColor(e);
    const t = e.target;
    if (!selected) return;
    if (t.matches('[data-fb-border]')) { setTextBox(undefined, t.value, ctx.bar.querySelector('[name=fbBorderColor]').value); renderBar(); }
    if (t.matches('[data-fb-imgborder]')) { setImgBorder(t.value, ctx.bar.querySelector('[name=fbImgBorderColor]').value); renderBar(); }
    if (t.matches('[data-fb-line]')) ctx.run(() => setLine({ type: t.value }));
  });

  // ---- moving and sizing ----
  let drag = null;
  const cardBox = () => root.getBoundingClientRect();
  function snapMove(el, x, y) {
    const cb = cardBox();
    const w = (el.offsetWidth / cb.width) * 100;
    const h = (el.offsetHeight / cb.height) * 100;
    let gx = null; let gy = null;
    const xs = [50]; const ys = [50];
    for (const o of items()) {
      if (o === el) continue;
      xs.push(parseFloat(o.style.left) + (o.offsetWidth / cb.width) * 50);
      ys.push(parseFloat(o.style.top) + (o.offsetHeight / cb.height) * 50);
    }
    const cx = x + w / 2; const cy = y + h / 2;
    for (const v of xs) if (Math.abs(cx - v) < SNAP) { x = v - w / 2; gx = v; break; }
    for (const v of ys) if (Math.abs(cy - v) < SNAP) { y = v - h / 2; gy = v; break; }
    guides.v.hidden = gx === null; guides.h.hidden = gy === null;
    if (gx !== null) guides.v.style.left = `${gx}%`;
    if (gy !== null) guides.h.style.top = `${gy}%`;
    return { x: pct(Math.max(-w + 3, Math.min(97, x))), y: pct(Math.max(-h + 3, Math.min(97, y))) };
  }
  // A text box's empty space doesn't hide what's under it: a click there goes to a picture or line
  // below (the text box is chosen when nothing else is there).
  function onText(item, x, y) {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (x >= b.left - 3 && x <= b.right + 3 && y >= b.top - 3 && y <= b.bottom + 3) return true;
    }
    return false;
  }
  function pick(x, y, hit) {
    if (!hit || hit.dataset.item !== 'text' || hit === selected || hit === editing || onText(hit, x, y)) return hit;
    const below = document.elementsFromPoint(x, y).map((n) => n.closest?.('.fb-item')).find((n) => n && n !== hit && root.contains(n) && (n.dataset.item !== 'text' || onText(n, x, y)));
    return below ?? hit;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const handle = e.target.closest('[data-h]');
    const item = pick(e.clientX, e.clientY, e.target.closest('.fb-item'));
    if (handle && selected) {
      e.preventDefault();
      drag = { mode: handle.dataset.h, el: selected, x: e.clientX, y: e.clientY, left: parseFloat(selected.style.left), top: parseFloat(selected.style.top), w: parseFloat(selected.style.width), moved: false };
      return;
    }
    if (!item) { select(null); return; }
    if (item === editing) return; // typing: the mouse selects text
    e.preventDefault();
    const wasSelected = selected === item;
    if (!wasSelected) select(item);
    drag = { mode: 'move', el: item, x: e.clientX, y: e.clientY, left: parseFloat(item.style.left), top: parseFloat(item.style.top), w: parseFloat(item.style.width), moved: false, wasSelected };
  });
  // Clicking the space around the card lets go of what's selected.
  canvas.parentElement.addEventListener('pointerdown', (e) => { if (!canvas.contains(e.target)) select(null); });
  window.addEventListener('pointermove', onMove, { passive: false });
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    e.preventDefault();
    const cb = cardBox();
    const px = (dx / cb.width) * 100; const py = (dy / cb.height) * 100;
    const el = drag.el;
    if (drag.mode === 'move') {
      const p = snapMove(el, drag.left + px, drag.top + py);
      el.style.left = `${p.x}%`; el.style.top = `${p.y}%`;
    } else {
      const m = drag.mode;
      let { left, w } = drag;
      let top = drag.top;
      if (m.includes('e')) w = drag.w + px;
      if (m.includes('w')) { w = drag.w - px; left = drag.left + px; }
      w = Math.max(5, Math.min(140, w));
      if (m.includes('w')) left = drag.left + drag.w - w;
      if (el.dataset.item === 'image' && m.includes('n')) {
        // Keep the picture's bottom in place when sizing from a top corner.
        const ratio = el.offsetHeight / el.offsetWidth;
        top = drag.top - ((w - drag.w) * ratio * cb.width) / cb.height;
      }
      el.style.width = `${pct(w)}%`; el.style.left = `${pct(left)}%`; el.style.top = `${pct(top)}%`;
    }
    place();
  }
  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    guides.v.hidden = true; guides.h.hidden = true;
    if (d.moved) { ctx.changed(); place(); return; }
    // A second click on a selected text box starts typing in it.
    if (d.mode === 'move' && d.wasSelected && d.el.dataset.item === 'text') startEditing(d.el, { x: d.x, y: d.y });
  }
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.fb-item');
    if (item?.dataset.item === 'text' && item !== editing) { select(item); startEditing(item, { x: e.clientX, y: e.clientY }); }
  });
  root.addEventListener('input', place);
  // The card never scrolls (typing near an edge would otherwise shift everything on it).
  root.addEventListener('scroll', () => { root.scrollLeft = 0; root.scrollTop = 0; });
  window.addEventListener('resize', place);

  // Keys: arrows nudge the selected part (Shift for bigger steps), Delete removes it, Escape stops
  // typing, then lets go of it.
  root.closest('form')?.addEventListener('keydown', (e) => {
    if (!selected) return;
    const typing = editing || e.target.closest?.('input, select, textarea, [contenteditable=true]');
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (editing) { stopEditing(); select(selected); } else select(null);
      return;
    }
    if (typing) return;
    const step = e.shiftKey ? 5 : 0.5;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) {
      e.preventDefault();
      selected.style.left = `${pct(parseFloat(selected.style.left) + nudge[0])}%`;
      selected.style.top = `${pct(parseFloat(selected.style.top) + nudge[1])}%`;
      place(); ctx.changed(true);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); selected.remove(); select(null); ctx.changed(); }
    if (e.key === 'Enter' && selected.dataset.item === 'text') { e.preventDefault(); startEditing(selected); }
  });

  // ---- adding ----
  function addItem(it, { edit = false } = {}) {
    const el = itemEl(it);
    root.append(el);
    select(el);
    if (edit) startEditing(el);
    ctx.changed();
    return el;
  }
  async function addPicture(file, at) {
    const url = file ? await ctx.uploadFile(file) : await ctx.pickPicture();
    if (!url) return;
    const w = 40;
    const x = at ? pct(at.x - w / 2) : 30;
    const y = at ? pct(at.y - 10) : 8;
    addItem({ type: 'image', x, y, w, html: `<img src="${esc(url)}" alt="" style="display:block;width:100%;height:auto">` });
  }
  async function add(type) {
    if (type === 'text') return addItem({ type, x: 15, y: 42, w: 70, html: '<p style="text-align:center"><br></p>' }, { edit: true });
    if (type === 'image') return addPicture();
    if (type === 'line') {
      const line = (await ctx.lineHtml('thin', ctx.lineColor(), '100%')).replace(/margin:[^;"]+/, 'margin:0');
      return addItem({ type, x: 25, y: 50, w: 50, html: line });
    }
    return undefined;
  }
  canvas.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  canvas.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /^image\//.test(f.type));
    if (!file) return;
    e.preventDefault();
    const cb = cardBox();
    ctx.run(() => addPicture(file, { x: ((e.clientX - cb.left) / cb.width) * 100, y: ((e.clientY - cb.top) / cb.height) * 100 }));
  });

  function setCard(size, orient) {
    card = { size: ctx.cards[size] ? size : card.size, orient: orient === 'landscape' ? 'landscape' : 'portrait' };
    sizeCanvas();
    ctx.changed();
  }

  function destroy() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('resize', place);
  }

  return {
    load, html, select, destroy, setCard, place,
    card: () => ({ ...card, shape: shape() }),
    add, addPicture: (file) => addPicture(file),
    addText: (inner) => addItem({ type: 'text', x: 15, y: 42, w: 70, html: inner }),
    selectedType: () => selected?.dataset.item ?? null,
    editingText: () => editing?.querySelector('.fb-text') ?? null,
    /** The text the toolbar formats as a whole: the selected text part (typing in it is turned on). */
    wholeText: () => {
      if (selected?.dataset.item !== 'text') return null;
      const t = selected.querySelector('.fb-text');
      if (editing !== selected) { editing = selected; t.contentEditable = 'true'; place(); }
      return t;
    },
    textHost: (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.fb-text') ?? null,
    stopEditing: () => { stopEditing(); place(); },
  };
}
