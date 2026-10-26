// Designs for return-address labels: everyday and holiday styles, each drawn in HTML/CSS and inline
// SVG so script fonts and artwork print sharply. Pure functions (unit tested in Node), plus fitLabel,
// which runs in the browser to shrink any line that doesn't fit.
//
// Every design is sized in em of the label's height: a label is 2.625em × 1em, which is the shape of
// both Avery 5195 / 8195 / 18294 (1¾ × ⅔ in) and 5160 / 8160 (2⅝ × 1 in). Set the font-size of the
// element holding .rl to the label's height and the design fills it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LABEL_FONT_LINK = 'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Pinyon+Script'
  + '&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Cinzel:wght@400;600&family=Josefin+Sans:wght@400;600;700&display=swap';

export const LABEL_CSS = `
.rl { position: relative; width: 2.625em; height: 1em; overflow: hidden; box-sizing: border-box; border-radius: .07em;
  background: #fff; color: #1f2328; font-family: 'Josefin Sans', Arial, sans-serif; line-height: 1.12; text-align: left; }
.rl * { box-sizing: border-box; }
.rl .txt { position: absolute; top: .08em; bottom: .08em; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.rl .txt.c { align-items: stretch; text-align: center; }
.rl .fit { display: block; white-space: nowrap; } /* not clipped: tall script letters reach above their line */
.rl .ad { font-family: 'Josefin Sans', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.rl .scr { font-family: 'Great Vibes', 'Brush Script MT', cursive; line-height: 1.05; }
.rl .pin { font-family: 'Pinyon Script', 'Great Vibes', cursive; line-height: 1.1; }
.rl .pf { font-family: 'Playfair Display', Georgia, serif; }
.rl .cz { font-family: Cinzel, Georgia, serif; }
.rl svg { position: absolute; display: block; overflow: visible; }
`;

/** The big letter for a monogram: the last name's first letter, else the name's. */
export function initialOf(last, name) {
  const word = String(last || '').trim() || String(name || '').replace(/^the\s+/i, '').trim();
  return (word.match(/[A-Za-zÀ-ÿ]/)?.[0] ?? '').toUpperCase();
}

// One line that shrinks to fit: size is the starting size in em of the label's height.
const line = (text, size, cls = '', style = '') => `<span class="fit ${cls}" data-size="${size}" style="font-size:${size}em;${style}"><span>${esc(text)}</span></span>`;
const addressBlock = (lines, size, cls = 'ad', style = '') => lines.map((l) => line(l, size, cls, style)).join('');

// ---------- artwork ----------
const flourishBar = (y) => `<svg viewBox="0 0 220 12" style="left:.2em;width:2.225em;top:${y}em;height:.12em" aria-hidden="true">
  <g fill="none" stroke="#222" stroke-width="1.1" stroke-linecap="round"><path d="M9 6H92M128 6H211"/>
  <path d="M92 6c3-5 9-5 12 0M128 6c-3-5-9-5-12 0M92 6c3 5 9 5 12 0M128 6c-3 5-9 5-12 0"/></g>
  <circle cx="4.5" cy="6" r="2" fill="#222"/><circle cx="215.5" cy="6" r="2" fill="#222"/><path d="M110 1.2 115 6 110 10.8 105 6Z" fill="#222"/></svg>`;

function laurelBranch() {
  // A gently curved stem with pairs of leaves along it.
  const P = [[30, 97], [6, 72], [8, 28], [27, 3]];
  const at = (t) => {
    const u = 1 - t;
    const x = u ** 3 * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t ** 3 * P[3][0];
    const y = u ** 3 * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t ** 3 * P[3][1];
    return [x, y];
  };
  let leaves = '';
  for (let i = 1; i <= 7; i++) {
    const t = i / 8.2;
    const [x, y] = at(t);
    const [x2, y2] = at(t + 0.01);
    const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI + 90;
    const size = 1 - i * 0.05;
    leaves += `<ellipse cx="0" cy="-8" rx="${(3.4 * size).toFixed(2)}" ry="${(8.5 * size).toFixed(2)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(ang - 55).toFixed(1)})"/>`
      + `<ellipse cx="0" cy="-8" rx="${(3.4 * size).toFixed(2)}" ry="${(8.5 * size).toFixed(2)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(ang + 35).toFixed(1)})"/>`;
  }
  const [tx, ty] = at(1);
  return `<path d="M${P[0]} C${P[1]} ${P[2]} ${P[3]}" fill="none" stroke="#3f6b47" stroke-width="1.6" stroke-linecap="round"/>
    <g fill="#3f6b47">${leaves}<ellipse cx="${tx}" cy="${ty - 4}" rx="3" ry="7"/></g>`;
}

const snowflake = () => {
  const arm = '<path d="M0 0V-44M0-17-11-28M0-17 11-28M0-31-8-39M0-31 8-39"/>';
  return `<g fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round">${[0, 60, 120, 180, 240, 300].map((a) => `<g transform="rotate(${a})">${arm}</g>`).join('')}</g><circle r="6" fill="#fff"/>`;
};

const pines = `<ellipse cx="38" cy="112" rx="70" ry="24" fill="#fff"/>
  <g fill="#fff">
    <path d="M30 18 44 44H38L50 66H42L54 90H6L18 66H10L22 44H16Z"/>
    <path d="M66 42 76 60H72L80 76H74L83 94H49L58 76H52L60 60H56Z" opacity=".85"/>
    <rect x="27" y="90" width="6" height="8"/>
  </g>
  <g fill="#fff">${[[8, 14], [58, 10], [74, 28], [14, 40], [84, 52], [50, 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`).join('')}</g>`;

const star = (x, y, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.42 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
};
const night = `<g fill="#f3d27a"><circle cx="36" cy="44" r="22"/></g><circle cx="47" cy="37" r="20" fill="#1e2a44"/>
  <g fill="#f3d27a">${star(64, 18, 6)}${star(18, 80, 4.5)}${star(62, 76, 3.5)}${star(14, 16, 3)}${star(76, 52, 2.6)}</g>`;


const wreath = () => {
  let leaves = '';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * 360;
    const r = (a * Math.PI) / 180;
    const x = 50 + 31 * Math.cos(r);
    const y = 50 + 31 * Math.sin(r);
    const tilt = i % 2 ? 28 : -28;
    leaves += `<ellipse cx="0" cy="0" rx="5.2" ry="11" fill="${i % 3 ? '#166534' : '#15803d'}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a + tilt).toFixed(1)})"/>`;
  }
  const berries = [20, 75, 130, 200, 250, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    return `<circle cx="${(50 + 33 * Math.cos(r)).toFixed(1)}" cy="${(50 + 33 * Math.sin(r)).toFixed(1)}" r="3.4" fill="#dc2626"/>`;
  }).join('');
  return `${leaves}${berries}
    <g fill="#b91c1c"><path d="M50 80 34 98 40 99 50 86Z"/><path d="M50 80 66 98 60 99 50 86Z"/>
    <ellipse cx="38" cy="78" rx="12" ry="7" transform="rotate(-18 38 78)"/><ellipse cx="62" cy="78" rx="12" ry="7" transform="rotate(18 62 78)"/>
    <circle cx="50" cy="80" r="5.5" fill="#991b1b"/></g>`;
};

const tree = () => `<path d="M50 14 30 42H40L22 64H34L16 88H84L66 64H78L60 42H70Z" fill="#4ea36b"/>
  <path d="M50 14 30 42H40L22 64H34L16 88H50Z" fill="#5fb87b"/>
  <rect x="44" y="88" width="12" height="9" fill="#7c4a2d"/>
  <g fill="#fbbf24">${star(50, 12, 9)}</g>
  <path d="M34 50Q50 58 64 47M27 73Q50 82 74 70" fill="none" stroke="#fde68a" stroke-width="1.6"/>
  ${[[42, 36, '#ef4444'], [58, 39, '#fde047'], [36, 56, '#fde047'], [55, 58, '#ef4444'], [68, 61, '#fff'], [28, 79, '#ef4444'], [46, 78, '#fff'], [64, 81, '#fde047'], [48, 47, '#fff']]
    .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="3.3" fill="${c}"/>`).join('')}`;

const mistletoe = () => `<g fill="none" stroke="#7aa34a" stroke-width="2.6" stroke-linecap="round">
    <path d="M50 22C48 38 40 50 28 62"/><path d="M50 22C51 40 50 54 50 70"/><path d="M50 22C53 38 61 50 73 60"/></g>
  <g fill="#9bc95a"><ellipse cx="20" cy="66" rx="6" ry="15" transform="rotate(55 20 66)"/><ellipse cx="32" cy="74" rx="6" ry="15" transform="rotate(-5 32 74)"/>
    <ellipse cx="44" cy="80" rx="6" ry="14" transform="rotate(20 44 80)"/><ellipse cx="57" cy="80" rx="6" ry="14" transform="rotate(-20 57 80)"/>
    <ellipse cx="69" cy="72" rx="6" ry="15" transform="rotate(8 69 72)"/><ellipse cx="81" cy="64" rx="6" ry="15" transform="rotate(-55 81 64)"/></g>
  <g fill="#7fae46"><ellipse cx="38" cy="50" rx="5" ry="12" transform="rotate(40 38 50)"/><ellipse cx="62" cy="49" rx="5" ry="12" transform="rotate(-40 62 49)"/></g>
  <g fill="#f8fafc" stroke="#cbd5e1" stroke-width=".8">${[[46, 44], [53, 46], [49, 51], [42, 50], [57, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6"/>`).join('')}</g>
  <g fill="#dc2626"><ellipse cx="41" cy="16" rx="9" ry="5.5" transform="rotate(-20 41 16)"/><ellipse cx="59" cy="16" rx="9" ry="5.5" transform="rotate(20 59 16)"/>
    <path d="M48 19 42 33 46 33 50 22Z"/><path d="M52 19 58 33 54 33 50 22Z"/><circle cx="50" cy="18" r="4" fill="#b91c1c"/></g>`;

const santa = () => `<path d="M22 46C26 18 52 6 74 15C82 19 86 26 84 33C76 34 71 39 70 46Z" fill="#d42a2a"/>
  <circle cx="84" cy="33" r="6.5" fill="#fff"/>
  <ellipse cx="50" cy="60" rx="20" ry="14" fill="#f6cfae"/>
  <path d="M27 58C24 84 38 96 50 97C62 96 76 84 73 58C66 70 58 72 50 70C42 72 34 70 27 58Z" fill="#fff"/>
  <path d="M29 62C29 76 39 86 50 86C61 86 71 76 71 62" fill="none" stroke="#e5e7eb" stroke-width="1.2"/>
  <ellipse cx="43" cy="68" rx="8" ry="4" fill="#fff"/><ellipse cx="57" cy="68" rx="8" ry="4" fill="#fff"/>
  <circle cx="50" cy="64" r="3.4" fill="#e9967a"/>
  <circle cx="43" cy="57" r="2" fill="#3b2a20"/><circle cx="57" cy="57" r="2" fill="#3b2a20"/>
  <circle cx="37" cy="62" r="3.6" fill="#f4a1a1" opacity=".75"/><circle cx="63" cy="62" r="3.6" fill="#f4a1a1" opacity=".75"/>
  <rect x="20" y="40" width="60" height="11" rx="5.5" fill="#fff"/>`;

// ---------- the designs ----------
// render({ name, address: [lines], initial, last }) → the inside of one label.
export const LABEL_STYLES = [
  {
    id: 'plain', name: 'Plain', group: 'Everyday',
    render: ({ name, address }) => `<div class="rl" style="font-family:Helvetica,Arial,sans-serif"><div class="txt" style="left:.12em;right:.1em">
      ${line(name, 0.16, '', 'font-weight:600')}${addressBlock(address, 0.15, '', 'font-weight:400')}</div></div>`,
  },
  {
    id: 'monogram', name: 'Monogram', group: 'Everyday',
    render: ({ name, address, initial }) => `<div class="rl">
      <svg class="mono" viewBox="0 0 100 106" style="left:.04em;top:.07em;width:.76em;height:.86em;color:#9f1239" aria-hidden="true"><text x="14" y="86" font-size="88" fill="currentColor" style="font-family:'Great Vibes','Brush Script MT',cursive">${esc(initial)}</text></svg>
      <div style="position:absolute;left:.82em;top:.17em;bottom:.17em;border-left:.012em solid #c9a227"></div>
      <div class="txt" style="left:.92em;right:.08em">${line(name, 0.19, 'pf', 'font-style:italic;line-height:1.25;margin-bottom:.035em')}${addressBlock(address, 0.105, 'ad', 'color:#4b5563;line-height:1.3')}</div></div>`,
  },
  {
    id: 'script', name: 'Script', group: 'Everyday',
    render: ({ name, address }) => `<div class="rl"><div class="txt c" style="left:.1em;right:.1em">
      ${line(name, 0.34, 'scr', 'margin-bottom:.02em')}${addressBlock(address, 0.1)}</div></div>`,
  },
  {
    id: 'flourish', name: 'Flourish', group: 'Everyday',
    render: ({ name, address }) => `<div class="rl">${flourishBar(0.07)}${flourishBar(0.81)}
      <div class="txt c" style="left:.16em;right:.16em;top:.19em;bottom:.19em">${line(name, 0.15, 'ad', 'font-weight:700;letter-spacing:.14em')}${addressBlock(address, 0.112)}</div></div>`,
  },
  {
    id: 'laurel', name: 'Laurel', group: 'Everyday',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 40 100" style="left:.05em;top:.07em;width:.34em;height:.86em" aria-hidden="true">${laurelBranch()}</svg>
      <svg viewBox="0 0 40 100" style="right:.05em;top:.07em;width:.34em;height:.86em;transform:scaleX(-1)" aria-hidden="true">${laurelBranch()}</svg>
      <div class="txt c" style="left:.4em;right:.4em">${line(name, 0.27, 'scr')}${addressBlock(address, 0.112, 'pf', '')}</div></div>`,
  },
  {
    id: 'bold', name: 'Bold surname', group: 'Everyday',
    render: ({ name, address, last }) => `<div class="rl"><div class="txt c" style="left:.12em;right:.12em">
      ${line((last || name).toUpperCase(), 0.29, '', 'font-weight:700;letter-spacing:.2em;padding-left:.2em')}
      <span style="display:block;height:.018em;background:#1f2328;margin:.03em 4% .06em"></span>
      ${addressBlock(address, 0.105, 'ad', 'letter-spacing:.1em')}</div></div>`,
  },
  {
    id: 'frame', name: 'Frame', group: 'Everyday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:.12em;right:.12em;top:.2em;bottom:.09em;border:.03em solid #1f2328"></div>
      <span class="fit cz" data-size="0.19" style="position:absolute;left:.3em;right:.3em;top:.08em;text-align:center;font-size:.19em;font-weight:600;line-height:1.1"><span style="background:#fff;padding:0 .35em">${esc(name.toUpperCase())}</span></span>
      <div class="txt c" style="left:.2em;right:.2em;top:.34em;bottom:.14em">${addressBlock(address, 0.12, 'pf')}</div></div>`,
  },
  {
    id: 'wreath', name: 'Wreath', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 100 100" style="left:.06em;top:.07em;width:.86em;height:.86em" aria-hidden="true">${wreath()}</svg>
      <div class="txt" style="left:.98em;right:.08em">${line(name, 0.3, 'scr', 'color:#14532d')}${addressBlock(address, 0.1, 'ad', 'color:#3f5e4a')}</div></div>`,
  },
  {
    id: 'tree', name: 'Christmas tree', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.74em;background:#14532d"></div>
      <svg viewBox="0 0 100 100" style="left:.03em;top:.06em;width:.68em;height:.88em" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${tree()}</svg>
      <div class="txt" style="left:.86em;right:.08em">${line(name, 0.3, 'scr', 'color:#14532d')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'mistletoe', name: 'Mistletoe', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl" style="background:#1f4d36">
      <svg viewBox="0 0 100 100" style="left:.04em;top:.05em;width:.86em;height:.9em" aria-hidden="true">${mistletoe()}</svg>
      <div class="txt" style="left:.96em;right:.08em">${line(name, 0.3, 'scr', 'color:#f3d27a')}${addressBlock(address, 0.1, 'ad', 'color:#f6eedb')}</div></div>`,
  },
  {
    id: 'santa', name: 'Santa Claus', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.84em;background:#fdeee6"></div>
      <svg viewBox="0 0 100 100" style="left:.04em;top:.05em;width:.8em;height:.9em" aria-hidden="true">${santa()}</svg>
      <div class="txt" style="left:.96em;right:.08em">${line(name, 0.3, 'scr', 'color:#b91c1c')}${addressBlock(address, 0.1, 'ad', 'color:#4b5563')}</div></div>`,
  },
  {
    id: 'candy', name: 'Candy stripe', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.6em;background:repeating-linear-gradient(135deg,#b91c1c 0 .055em,#fff .055em .11em)"></div>
      <div class="txt" style="left:.72em;right:.08em">${line(name, 0.3, 'scr', 'color:#b91c1c')}${addressBlock(address, 0.1, 'ad', 'color:#4b5563')}</div></div>`,
  },
  {
    id: 'pines', name: 'Snowy pines', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl" style="background:linear-gradient(#bcd4ec,#eef4fa)">
      <svg viewBox="0 0 90 100" style="left:0;bottom:0;width:.9em;height:1em" aria-hidden="true">${pines}</svg>
      <div class="txt" style="left:.92em;right:.08em">${line(name, 0.2, 'pf', 'font-style:italic;color:#1e3a5f;margin-bottom:.02em')}${addressBlock(address, 0.1, 'ad', 'color:#1e3a5f')}</div></div>`,
  },
  {
    id: 'snowflake', name: 'Snowflake', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.62em;background:#7f1d1d"></div>
      <svg viewBox="-50 -50 100 100" style="left:.09em;top:.28em;width:.44em;height:.44em" aria-hidden="true">${snowflake()}</svg>
      <div class="txt" style="left:.74em;right:.08em">${line(name, 0.3, 'scr', 'color:#7f1d1d')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'ribbon', name: 'Polka-dot ribbon', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.42em;background:radial-gradient(circle,#b91c1c 26%,transparent 29%) 0 0/.14em .14em"></div>
      <div style="position:absolute;right:0;top:0;bottom:0;width:.42em;background:radial-gradient(circle,#b91c1c 26%,transparent 29%) 0 0/.14em .14em"></div>
      <div style="position:absolute;left:.42em;right:.42em;top:0;bottom:0;background:#b91c1c"></div>
      <div class="txt c" style="left:.48em;right:.48em;color:#fff">${line(name, 0.27, 'scr')}${addressBlock(address, 0.092, 'ad', 'letter-spacing:.08em')}</div></div>`,
  },
  {
    id: 'night', name: 'Starry night', group: 'Holiday',
    render: ({ name, address }) => `<div class="rl" style="background:#1e2a44">
      <svg viewBox="0 0 90 100" style="left:.04em;top:0;width:.76em;height:1em" aria-hidden="true">${night}</svg>
      <div class="txt" style="left:.82em;right:.08em">${line(name, 0.3, 'scr', 'color:#f3d27a')}${addressBlock(address, 0.1, 'ad', 'color:#e5e7eb')}</div></div>`,
  },
];

export const labelStyle = (id) => LABEL_STYLES.find((s) => s.id === id) ?? LABEL_STYLES[0];

/** One label's HTML for a style. lines: the return address lines (name first). */
export function renderReturnLabel(styleId, lines, { last = '' } = {}) {
  const [name = '', ...address] = lines;
  return labelStyle(styleId).render({ name, address, last, initial: initialOf(last, name) });
}

/**
 * Loads the fonts a page declares (their Latin part) before anything is measured. Browsers load a
 * font only once text uses it, and Safari reports fonts "ready" before that, so measuring right away
 * would size text in a stand-in font.
 */
export async function loadLabelFonts(doc) {
  const fonts = doc && doc.fonts;
  if (!fonts) return;
  const latin = [...fonts].filter((f) => /U\+0+-/i.test(f.unicodeRange) || /^U\+0-10FFFF$/i.test(f.unicodeRange));
  await Promise.all(latin.map((f) => f.load().catch(() => {})));
}

/**
 * Shrinks lines that don't fit their label (runs in the browser, after fonts load). Each .fit line
 * starts at its data-size and shrinks until it fits its width; then, if the text column is too tall,
 * every line in it shrinks together.
 */
export function fitLabel(root) {
  // A monogram letter is scaled and centred by its ink, since script capitals reach well past their
  // own letter space (and by different amounts for each letter).
  for (const text of root.querySelectorAll('svg.mono text')) {
    const svg = text.ownerSVGElement;
    const vb = svg.viewBox.baseVal;
    const ctx = (fitLabel.canvas ||= svg.ownerDocument.createElement('canvas')).getContext('2d');
    const cs = getComputedStyle(text);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    const m = ctx.measureText(text.textContent);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(w > 0 && h > 0)) continue;
    const k = Math.min((vb.width * 0.96) / w, (vb.height * 0.94) / h);
    text.setAttribute('font-size', (100 * k).toFixed(2));
    text.setAttribute('x', ((vb.width - w * k) / 2 + m.actualBoundingBoxLeft * k).toFixed(2));
    text.setAttribute('y', ((vb.height - h * k) / 2 + m.actualBoundingBoxAscent * k).toFixed(2));
  }
  // A line's text sits in an inner span, measured against the line's width (with a little room for
  // script flourishes past the last letter); a line without one is measured by its overflow.
  const fits = [...root.querySelectorAll('.fit')];
  const tooWide = (el) => (el.firstElementChild ? el.firstElementChild.offsetWidth > el.clientWidth * 0.97 : el.scrollWidth > el.clientWidth + 0.5);
  for (const el of fits) {
    let s = Number(el.dataset.size) || 0.1;
    el.style.fontSize = `${s}em`;
    for (let i = 0; i < 40 && tooWide(el); i++) { s *= 0.95; el.style.fontSize = `${s}em`; }
  }
  for (const box of root.querySelectorAll('.txt')) {
    const inBox = [...box.querySelectorAll('.fit')];
    for (let i = 0; i < 30 && box.scrollHeight > box.clientHeight + 0.5; i++) {
      for (const el of inBox) el.style.fontSize = `${parseFloat(el.style.fontSize) * 0.95}em`;
    }
  }
}
