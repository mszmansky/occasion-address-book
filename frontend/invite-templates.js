// Starting designs for invitations and emails, picked by theme on the Edit occasion screen. Each is an
// ordinary design (font, colors, border and HTML with fill-in fields), so everything in it can be
// changed in the Designer afterwards. Its picture is drawn here as SVG; when a template is used the app
// turns it into a PNG and uploads it (mail apps can't show SVG), and it becomes a normal picture.
// Pure functions (unit tested in Node).

import { ART } from './label-styles.js';
import { fontByKey } from './design-core.js';

const { star, burst } = ART;

export const TEMPLATE_THEMES = ['Holiday Party', 'Holidays', 'Birthday Party', "New Year's Eve", 'Grad Party', 'Showers', 'Get-Togethers'];

// ---------- artwork ----------
const PARTY = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
const GOLD = '#d4a017';

const confettiStrip = () => {
  let bits = '';
  let seed = 11;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 300).toFixed(1);
    const y = (4 + rnd() * 52).toFixed(1);
    const c = PARTY[i % PARTY.length];
    bits += i % 3 ? `<rect x="${x}" y="${y}" width="9" height="4" rx="1.2" fill="${c}" transform="rotate(${Math.round(rnd() * 180)} ${x} ${y})"/>` : `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`;
  }
  return bits;
};

const flute = (x, rot) => `<g transform="translate(${x} 52) rotate(${rot})">
  <path d="M-10-42H10L7-2Q0 5-7-2Z" fill="rgba(255,255,255,.12)" stroke="#e5e7eb" stroke-width="1.6"/>
  <path d="M-9.2-30H9.2L7-2Q0 5-7-2Z" fill="#f3d27a"/>
  <g fill="#fff" opacity=".85"><circle cx="-2" cy="-10" r="1.3"/><circle cx="3" cy="-18" r="1.1"/><circle cx="-3" cy="-24" r="1"/><circle cx="2" cy="-6" r="1"/></g>
  <path d="M0 3V34" stroke="#e5e7eb" stroke-width="2.6"/><ellipse cx="0" cy="36" rx="11" ry="2.8" fill="#e5e7eb"/></g>`;
const champagne = () => `${flute(38, -14)}${flute(62, 14)}
  <g stroke="${GOLD}" stroke-width="2" stroke-linecap="round"><path d="M50 4V12M40 8l4 6M60 8l-4 6M34 16l6 3M66 16l-6 3"/></g>
  <g fill="#f3d27a">${star(18, 22, 4)}${star(84, 26, 3.5)}${star(14, 70, 2.6)}${star(88, 74, 3)}</g>`;

const clock = () => {
  let ticks = '';
  for (let i = 0; i < 12; i++) ticks += `<path d="M50 ${i % 3 ? 17 : 15}V${i % 3 ? 21 : 24}" transform="rotate(${i * 30} 50 54)"/>`;
  return `<circle cx="50" cy="54" r="40" fill="#fff8e1" stroke="${GOLD}" stroke-width="5"/>
    <g stroke="#1f1b3a" stroke-width="2.6" stroke-linecap="round">${ticks}</g>
    <path d="M50 54V24" stroke="#1f1b3a" stroke-width="3" stroke-linecap="round"/><path d="M50 54L47 34" stroke="#1f1b3a" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="50" cy="54" r="3.5" fill="#b91c1c"/>
    <path d="M42 10h16M50 10V14" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/>
    <g fill="#f3d27a">${star(10, 16, 4)}${star(90, 20, 3.5)}${star(8, 92, 2.6)}${star(92, 88, 3)}</g>`;
};

const cap = (x, y, rot, k) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${k})">
  <path d="M-22 8V26Q0 36 22 26V8L0 16Z" fill="#1f2937"/>
  <path d="M0-16L42 0L0 16L-42 0Z" fill="#111827"/><circle cx="0" cy="0" r="2.6" fill="${GOLD}"/>
  <path d="M0 0L30 6V28" fill="none" stroke="${GOLD}" stroke-width="2"/><path d="M27 28h6l2 12H25Z" fill="${GOLD}"/></g>`;
const gradCap = () => `${cap(50, 46, 0, 1)}<g fill="${GOLD}">${star(14, 18, 5)}${star(86, 20, 4)}${star(12, 80, 3)}${star(90, 78, 3.5)}</g>`;
const capsToss = () => `${cap(26, 34, -22, 0.5)}${cap(74, 26, 18, 0.45)}${cap(50, 64, -6, 0.55)}
  <g fill="${GOLD}">${star(50, 12, 4)}${star(10, 64, 3)}${star(90, 60, 3.5)}${star(84, 90, 2.5)}${star(16, 92, 2.5)}</g>`;
const diploma = () => `<g transform="rotate(-14 50 50)">
  <rect x="14" y="38" width="72" height="24" fill="#fdf6e3" stroke="#c9b98f" stroke-width="1.4"/>
  <ellipse cx="14" cy="50" rx="5" ry="12" fill="#efe3c2" stroke="#c9b98f" stroke-width="1.4"/><ellipse cx="86" cy="50" rx="5" ry="12" fill="#efe3c2" stroke="#c9b98f" stroke-width="1.4"/>
  <rect x="46" y="38" width="8" height="24" fill="#b91c1c"/>
  <path d="M50 62L40 82L45 81L50 70L55 81L60 82Z" fill="#991b1b"/>
  <ellipse cx="42" cy="62" rx="9" ry="5" fill="#b91c1c" transform="rotate(-25 42 62)"/><ellipse cx="58" cy="62" rx="9" ry="5" fill="#b91c1c" transform="rotate(25 58 62)"/><circle cx="50" cy="62" r="4" fill="#7f1d1d"/></g>
  <g fill="${GOLD}">${star(16, 16, 4)}${star(86, 84, 4)}</g>`;

const carriage = () => {
  const wheel = (x) => `<circle cx="${x}" cy="82" r="10" fill="#fff" stroke="#475569" stroke-width="3"/><path d="M${x - 10} 82h20M${x} 72v20" stroke="#94a3b8" stroke-width="1.4"/>`;
  return `<path d="M18 48A32 30 0 0 0 82 48Z" fill="#93c5fd"/><path d="M50 48V16A32 32 0 0 1 82 48Z" fill="#60a5fa"/>
    <path d="M18 48h64" stroke="#3b82f6" stroke-width="2"/><path d="M24 60Q30 66 36 60T48 60T60 60T72 60" fill="none" stroke="#fff" stroke-width="2"/>
    <path d="M18 48Q12 40 6 42" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round"/>${wheel(32)}${wheel(68)}
    <path d="M88 14c-3-4-9-1-6 4l6 6 6-6c3-5-3-8-6-4Z" fill="#f9a8d4"/><path d="M12 14c-2-3-7-1-5 3l5 5 5-5c2-4-3-6-5-3Z" fill="#fde68a"/>`;
};

const heart = (x, y, k, c) => `<path d="M${x} ${y + 6 * k}c-${8 * k}-${5 * k}-${10 * k}-${12 * k}-${5 * k}-${14 * k}c${2.5 * k}-${1 * k} ${4 * k} 0 ${5 * k} ${2 * k}c${1 * k}-${2 * k} ${2.5 * k}-${3 * k} ${5 * k}-${2 * k}c${5 * k} ${2 * k} ${3 * k} ${9 * k}-${5 * k} ${14 * k}Z" fill="${c}"/>`;
const rings = () => `<circle cx="40" cy="58" r="21" fill="none" stroke="${GOLD}" stroke-width="6"/><circle cx="60" cy="58" r="21" fill="none" stroke="#e8c766" stroke-width="6"/>
  <path d="M40 37l-6-8h12Z" fill="#bfdbfe" stroke="#93c5fd" stroke-width="1"/><path d="M34 29l3-5h6l3 5Z" fill="#dbeafe" stroke="#93c5fd" stroke-width="1"/>
  ${heart(80, 18, 1.4, '#f9a8d4')}${heart(18, 16, 1, '#fda4af')}${heart(86, 86, 0.9, '#fda4af')}`;

const stringLights = () => {
  const colors = ['#fde68a', '#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7'];
  const seg = (x0, x1, sag) => (t) => [x0 + (x1 - x0) * t, 10 + sag * 4 * t * (1 - t)];
  const curves = [seg(0, 150, 28), seg(150, 300, 28)];
  let bulbs = '';
  let i = 0;
  for (const c of curves) {
    for (let k = 1; k <= 6; k++) {
      const [x, y] = c(k / 7);
      const col = colors[i++ % colors.length];
      bulbs += `<circle cx="${x.toFixed(1)}" cy="${(y + 12).toFixed(1)}" r="11" fill="${col}" opacity=".22"/><rect x="${(x - 2.5).toFixed(1)}" y="${y.toFixed(1)}" width="5" height="4" fill="#374151"/><ellipse cx="${x.toFixed(1)}" cy="${(y + 11).toFixed(1)}" rx="5" ry="7.5" fill="${col}"/>`;
    }
  }
  return `<path d="M0 10Q75 66 150 10Q225 66 300 10" fill="none" stroke="#9ca3af" stroke-width="1.6"/>${bulbs}`;
};

const dinner = () => `<g stroke="#9ca3af" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M14 22V40M10 22V34Q10 40 14 40Q18 40 18 34V22M14 40V82"/></g>
  <path d="M86 22Q94 40 86 52V82" fill="none" stroke="#9ca3af" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="52" r="30" fill="#fff" stroke="#d6d3d1" stroke-width="3"/><circle cx="50" cy="52" r="21" fill="none" stroke="#e7e5e4" stroke-width="2"/>
  <path d="M38 50q12-14 24 0" fill="none" stroke="#65a30d" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="54" r="5" fill="#dc2626"/>`;

const onCircle = (art, fill = '#fff') => () => `<circle cx="50" cy="50" r="49" fill="${fill}"/><g transform="translate(9 9) scale(.82)">${art()}</g>`;
const snowScene = () => `<rect width="90" height="100" rx="12" fill="#7ea6d3"/><g fill="#fff" opacity=".9">${[[10, 12], [30, 6], [52, 16], [72, 8], [82, 30], [20, 34], [62, 36]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>${ART.pines()}`;
const nightScene = () => `<rect width="90" height="100" rx="12" fill="#1e2a44"/>${ART.night()}`;
const fireworksBig = () => burst(30, 34, 26, '#ef4444') + burst(68, 30, 22, '#fde68a', 10) + burst(50, 72, 20, '#93c5fd', 10) + burst(14, 78, 10, '#fff', 8) + burst(88, 74, 9, '#fff', 8);

// box: the viewBox; width: how wide the picture sits in the design.
const ARTWORK = {
  wreath: { draw: ART.wreath, width: '36%' },
  tree: { draw: ART.tree, width: '36%' },
  santa: { file: 'art/santa.png', width: '34%' },
  pines: { draw: snowScene, box: [90, 100], width: '30%' },
  night: { draw: nightScene, box: [90, 100], width: '30%' },
  mistletoe: { file: 'art/mistletoe.jpg', width: '34%' },
  balloons: { draw: ART.balloons, width: '34%' },
  cupcake: { draw: ART.cupcake, width: '32%' },
  confetti: { draw: confettiStrip, box: [300, 60], width: '100%' },
  champagne: { draw: champagne, width: '36%' },
  fireworks: { draw: fireworksBig, width: '40%' },
  clock: { draw: clock, width: '32%' },
  cap: { draw: gradCap, width: '40%' },
  diploma: { draw: diploma, width: '40%' },
  caps: { draw: capsToss, width: '40%' },
  carriage: { draw: carriage, width: '34%' },
  rings: { draw: rings, width: '34%' },
  blossoms: { draw: ART.blossoms, width: '34%' },
  lights: { draw: stringLights, box: [300, 70], width: '100%' },
  sunflower: { draw: ART.sunflower, width: '32%' },
  dinner: { file: 'art/dinner.jpg', width: '56%' },
};

// ---------- the templates ----------
const fam = (key) => fontByKey(key).stack.replace(/"/g, "'");
const P = (inner, style = '') => `<p style="text-align:center;margin:0 0 10px${style ? `;${style}` : ''}">${inner}</p>`;
const WHEN = '<b>{{date}}</b><br>{{time}}<br>{{location}}';

/** An invitation: picture, title, greeting, what it is, when and where, from. */
function invitation({ title, titleFont, titleColor, titleSize = 40, line, when = WHEN, whenColor = '', sign = 'Hope you can make it!', textFont = '' }) {
  const tf = textFont ? `;font-family:${fam(textFont)}` : '';
  return `<h1 style="text-align:center;margin:4px 0 8px;font-family:${fam(titleFont)};font-size:${titleSize}px;font-weight:normal;line-height:1.1;color:${titleColor}">${title}</h1>`
    + P('Dear {{greeting}},', tf.slice(1))
    + P(line, tf.slice(1))
    + P(when, `${whenColor ? `color:${whenColor}` : ''}${tf}`.replace(/^;/, ''))
    + P(`${sign}<br>{{from}}`, `margin-bottom:0${tf}`);
}
/** A greeting (no event): picture, title, greeting, wishes, from. */
function greeting({ title, titleFont, titleColor, titleSize = 42, wish, sign = 'With love,' }) {
  return `<h1 style="text-align:center;margin:4px 0 10px;font-family:${fam(titleFont)};font-size:${titleSize}px;font-weight:normal;line-height:1.1;color:${titleColor}">${title}</h1>`
    + P('Dear {{greeting}},') + P(wish) + P(`${sign}<br>{{from}}`, 'margin-bottom:0');
}

export const TEMPLATES = [
  // Holiday Party
  { id: 'hp-wreath', name: 'Wreath', theme: 'Holiday Party', art: 'wreath',
    design: { font: 'georgia', background: '#ffffff', color: '#1f2937', border: 'double', borderColor: '#166534' },
    body: invitation({ title: 'Holiday Party', titleFont: 'great-vibes', titleColor: '#b91c1c', titleSize: 46, line: 'Please join us to celebrate the season with good food, good cheer and good friends.', whenColor: '#166534' }) },
  { id: 'hp-tree', name: 'Christmas tree', theme: 'Holiday Party', art: 'tree',
    design: { font: 'playfair', background: '#fdf8ee', color: '#1f2937', border: 'thick', borderColor: '#b91c1c' },
    body: invitation({ title: 'Deck the Halls', titleFont: 'christmas', titleColor: '#166534', titleSize: 40, line: "You're invited to our Christmas party!", whenColor: '#b91c1c', sign: 'Merry Christmas!' }) },
  { id: 'hp-santa', name: 'Santa Claus', theme: 'Holiday Party', art: 'santa',
    design: { font: 'trebuchet', background: '#b91c1c', color: '#ffffff', border: 'dashed', borderColor: '#ffffff' },
    body: invitation({ title: 'Ho Ho Ho!', titleFont: 'lobster', titleColor: '#ffffff', titleSize: 42, line: 'Come celebrate with us at our holiday party.', whenColor: '#fde68a' }) },
  // Holidays (greetings)
  { id: 'ho-pines', name: 'Snowy pines', theme: 'Holidays', art: 'pines',
    design: { font: 'georgia', background: '#f1f6fb', color: '#1e3a5f', border: 'thin', borderColor: '#7ea6d3' },
    body: greeting({ title: "Season's Greetings", titleFont: 'great-vibes', titleColor: '#1e3a5f', titleSize: 44, wish: 'Wishing you peace, joy and love this holiday season and all the best in the New Year.' }) },
  { id: 'ho-night', name: 'Starry night', theme: 'Holidays', art: 'night',
    design: { font: 'playfair', background: '#1e2a44', color: '#f6eedb', border: 'thin', borderColor: '#f3d27a' },
    body: greeting({ title: 'Peace on Earth', titleFont: 'cinzel', titleColor: '#f3d27a', titleSize: 30, wish: 'May the light of the season fill your home with warmth and happiness.' }) },
  { id: 'ho-mistletoe', name: 'Mistletoe', theme: 'Holidays', art: 'mistletoe',
    design: { font: 'georgia', background: '#1f4d36', color: '#f6eedb', border: 'double', borderColor: '#f3d27a' },
    body: greeting({ title: 'Merry Christmas', titleFont: 'great-vibes', titleColor: '#f3d27a', titleSize: 46, wish: 'Wishing you a holiday season full of love and laughter, and a happy New Year.' }) },
  // Birthday Party
  { id: 'bd-balloons', name: 'Balloons', theme: 'Birthday Party', art: 'balloons',
    design: { font: 'verdana', background: '#ffffff', color: '#374151', border: 'rounded', borderColor: '#3b82f6' },
    body: invitation({ title: "Let's Celebrate!", titleFont: 'pacifico', titleColor: '#db2777', titleSize: 34, line: "You're invited to a birthday party!", whenColor: '#2563eb', sign: 'See you there!' }) },
  { id: 'bd-cupcake', name: 'Cupcake', theme: 'Birthday Party', art: 'cupcake',
    design: { font: 'trebuchet', background: '#fdf2f8', color: '#4b5563', border: 'dotted', borderColor: '#ec4899' },
    body: invitation({ title: 'Birthday Party', titleFont: 'dancing', titleColor: '#be185d', titleSize: 42, line: 'Join us for cake, fun and lots of birthday wishes.', whenColor: '#be185d' }) },
  { id: 'bd-confetti', name: 'Confetti', theme: 'Birthday Party', art: 'confetti',
    design: { font: 'arial', background: '#ffffff', color: '#1f2937', border: 'none', borderColor: '#7c3aed' },
    body: invitation({ title: 'Party Time!', titleFont: 'lobster', titleColor: '#7c3aed', titleSize: 44, line: 'Come help us celebrate a very special birthday.', whenColor: '#7c3aed', sign: "Can't wait to see you!" }) },
  // New Year's Eve
  { id: 'ny-champagne', name: 'Champagne', theme: "New Year's Eve", art: 'champagne',
    design: { font: 'playfair', background: '#111827', color: '#f3f4f6', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: "New Year's Eve", titleFont: 'great-vibes', titleColor: '#f3d27a', titleSize: 46, line: 'Ring in the New Year with us. Cheers to new beginnings!', whenColor: '#f3d27a', sign: 'Cheers!' }) },
  { id: 'ny-fireworks', name: 'Fireworks', theme: "New Year's Eve", art: 'fireworks',
    design: { font: 'arial', background: '#0f1d4a', color: '#ffffff', border: 'none', borderColor: '#fde68a' },
    body: invitation({ title: 'Happy New Year!', titleFont: 'lobster', titleColor: '#fde68a', titleSize: 40, line: "Join us to count down to midnight and welcome the New Year.", whenColor: '#93c5fd' }) },
  { id: 'ny-clock', name: 'Midnight', theme: "New Year's Eve", art: 'clock',
    design: { font: 'georgia', background: '#2e1a47', color: '#f5f3ff', border: 'double', borderColor: '#d4a017' },
    body: invitation({ title: 'Countdown to Midnight', titleFont: 'cinzel', titleColor: '#f3d27a', titleSize: 26, line: "Celebrate New Year's Eve with us. Dress to sparkle!", whenColor: '#f3d27a' }) },
  // Grad Party
  { id: 'gr-cap', name: 'Graduation cap', theme: 'Grad Party', art: 'cap',
    design: { font: 'georgia', background: '#ffffff', color: '#111827', border: 'thick', borderColor: '#111827' },
    body: invitation({ title: 'Graduation Party', titleFont: 'cinzel', titleColor: '#111827', titleSize: 28, line: 'Please join us in celebrating our graduate!', whenColor: '#a16207', sign: 'Congratulations!' }) },
  { id: 'gr-diploma', name: 'Diploma', theme: 'Grad Party', art: 'diploma',
    design: { font: 'playfair', background: '#fdfaf2', color: '#1f2937', border: 'double', borderColor: '#b91c1c' },
    body: invitation({ title: 'Class Dismissed!', titleFont: 'dancing', titleColor: '#7f1d1d', titleSize: 42, line: 'Come celebrate this milestone with us at an open house.', whenColor: '#7f1d1d' }) },
  { id: 'gr-caps', name: 'Hats off', theme: 'Grad Party', art: 'caps',
    design: { font: 'trebuchet', background: '#1f2937', color: '#f9fafb', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: 'Hats Off to the Graduate', titleFont: 'amatic', titleColor: '#f3d27a', titleSize: 40, line: 'Join us for a graduation celebration!', whenColor: '#f3d27a' }) },
  // Showers
  { id: 'sh-baby', name: 'Baby shower', theme: 'Showers', art: 'carriage',
    design: { font: 'trebuchet', background: '#f0f7ff', color: '#334155', border: 'rounded', borderColor: '#93c5fd' },
    body: invitation({ title: 'Baby Shower', titleFont: 'dancing', titleColor: '#2563eb', titleSize: 44, line: 'Please join us for a baby shower honoring the parents-to-be.', whenColor: '#2563eb', sign: 'With love,' }) },
  { id: 'sh-bridal', name: 'Bridal shower', theme: 'Showers', art: 'rings',
    design: { font: 'georgia', background: '#fff5f7', color: '#4b5563', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: 'Bridal Shower', titleFont: 'great-vibes', titleColor: '#be185d', titleSize: 46, line: 'Please join us for a shower honoring the bride-to-be.', whenColor: '#a16207', sign: 'With love,' }) },
  { id: 'sh-floral', name: 'Cherry blossoms', theme: 'Showers', art: 'blossoms',
    design: { font: 'playfair', background: '#ffffff', color: '#44403c', border: 'rounded', borderColor: '#f9a8d4' },
    body: invitation({ title: "You're Invited", titleFont: 'great-vibes', titleColor: '#9d174d', titleSize: 46, line: 'Please join us for a shower to celebrate a very special someone.', whenColor: '#9d174d', sign: 'With love,' }) },
  // Get-Togethers
  { id: 'gt-lights', name: 'String lights', theme: 'Get-Togethers', art: 'lights',
    design: { font: 'trebuchet', background: '#172033', color: '#f1f5f9', border: 'none', borderColor: '#fde68a' },
    body: invitation({ title: "Let's Get Together", titleFont: 'amatic', titleColor: '#fde68a', titleSize: 46, line: 'Come by for food, drinks and good company.', whenColor: '#fde68a', sign: 'See you there!' }) },
  { id: 'gt-sunflower', name: 'Sunflower', theme: 'Get-Togethers', art: 'sunflower',
    design: { font: 'verdana', background: '#fffbeb', color: '#44403c', border: 'thick', borderColor: '#eab308' },
    body: invitation({ title: 'Backyard Bash', titleFont: 'pacifico', titleColor: '#92400e', titleSize: 34, line: 'Join us for a cookout and an afternoon in the sun.', whenColor: '#92400e', sign: 'Bring your appetite!' }) },
  { id: 'gt-dinner', name: 'Dinner party', theme: 'Get-Togethers', art: 'dinner',
    design: { font: 'georgia', background: '#faf7f2', color: '#292524', border: 'thin', borderColor: '#a8a29e' },
    body: invitation({ title: 'Dinner Party', titleFont: 'playfair', titleColor: '#292524', titleSize: 34, line: 'Please join us for dinner and conversation.', whenColor: '#57534e', sign: 'Kindly let us know if you can come.' }) },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

/** The template's picture as a standalone SVG document; scale: pixels per viewBox unit. */
export function artSvg(t, scale = 1) {
  const a = ARTWORK[t.art];
  const [w, h] = a.box ?? [100, 100];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}">${a.draw()}</svg>`;
}
export const artSize = (t) => ARTWORK[t.art].box ?? [100, 100];
/** The template's picture file, for templates whose picture is an image rather than a drawing ('' otherwise). */
export const artFile = (t) => ARTWORK[t.art].file ?? '';

/** The template as a design for the Designer, its picture at src (a PNG link, or a data: URL for previews). */
export function templateDesign(t, src) {
  const a = ARTWORK[t.art];
  const img = `<img src="${String(src).replace(/"/g, '&quot;')}" alt="${t.name}" style="display:block;width:${a.width};max-width:100%;height:auto;margin:0 auto 6px">`;
  return { ...t.design, html: `${img}${t.body}` };
}
