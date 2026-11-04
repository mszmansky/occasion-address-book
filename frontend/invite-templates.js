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

// ---------- more artwork ----------
const f1 = (n) => Number(n).toFixed(1);
const confettiOf = (palette, seed0 = 11) => () => {
  let bits = '';
  let seed = seed0;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 70; i++) {
    const x = f1(rnd() * 300);
    const y = f1(4 + rnd() * 52);
    const c = palette[i % palette.length];
    bits += i % 3 ? `<rect x="${x}" y="${y}" width="9" height="4" rx="1.2" fill="${c}" transform="rotate(${Math.round(rnd() * 180)} ${x} ${y})"/>` : `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`;
  }
  return bits;
};
const sparkles = (pts, c = GOLD) => `<g fill="${c}">${pts.map(([x, y, r]) => star(x, y, r)).join('')}</g>`;

// Holiday Party
const bauble = (x, len, r, c) => `<path d="M${x} 0V${len}" stroke="#a8a29e" stroke-width="1.2"/><rect x="${x - 3.5}" y="${len - 1}" width="7" height="5" rx="1" fill="${GOLD}"/>
  <circle cx="${x}" cy="${len + 3 + r}" r="${r}" fill="${c}"/>
  <path d="M${x - r * 0.92} ${len + 3 + r * 0.8}Q${x} ${len + 3 + r * 1.25} ${x + r * 0.92} ${len + 3 + r * 0.8}" fill="none" stroke="#fff" stroke-width="1.6" opacity=".55"/>
  <ellipse cx="${f1(x - r * 0.4)}" cy="${f1(len + 3 + r * 0.55)}" rx="${f1(r * 0.25)}" ry="${f1(r * 0.15)}" fill="#fff" opacity=".6" transform="rotate(-35 ${f1(x - r * 0.4)} ${f1(len + 3 + r * 0.55)})"/>`;
const ornaments = () => `${bauble(24, 16, 13, '#b91c1c')}${bauble(52, 32, 16, '#166534')}${bauble(80, 10, 12, GOLD)}${sparkles([[12, 86, 3], [90, 70, 3.5], [66, 92, 2.5]])}`;
const gift = (box, lid, ribbon) => () => `<rect x="18" y="46" width="64" height="44" rx="2" fill="${box}"/><rect x="14" y="35" width="72" height="13" rx="2" fill="${lid}"/>
  <rect x="45" y="35" width="10" height="55" fill="${ribbon}"/>
  <ellipse cx="39" cy="28" rx="12" ry="7" fill="${ribbon}" transform="rotate(-28 39 28)"/><ellipse cx="61" cy="28" rx="12" ry="7" fill="${ribbon}" transform="rotate(28 61 28)"/>
  <ellipse cx="39" cy="28" rx="6" ry="3" fill="#000" opacity=".15" transform="rotate(-28 39 28)"/><ellipse cx="61" cy="28" rx="6" ry="3" fill="#000" opacity=".15" transform="rotate(28 61 28)"/>
  <path d="M47 34L38 46M53 34L62 46" stroke="${ribbon}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="33" r="5" fill="${ribbon}"/>`;
// Holidays
const menorah = () => {
  const xs = [14, 23, 32, 41, 50, 59, 68, 77, 86];
  const arms = [1, 2, 3, 4].map((i) => `<path d="M${50 - 9 * i} 48V${58 + i * 3}Q${50 - 9 * i} ${70 + i * 4} 50 ${70 + i * 4}Q${50 + 9 * i} ${70 + i * 4} ${50 + 9 * i} ${58 + i * 3}V48" fill="none" stroke="${GOLD}" stroke-width="3"/>`).join('');
  const candles = xs.map((x) => {
    const top = x === 50 ? 26 : 34;
    return `<rect x="${x - 2.5}" y="${top}" width="5" height="${48 - top}" fill="${x === 50 ? '#fff' : '#60a5fa'}" stroke="#93c5fd" stroke-width=".8"/><path d="M${x} ${top - 9}Q${x + 4} ${top - 3} ${x} ${top - 1}Q${x - 4} ${top - 3} ${x} ${top - 9}Z" fill="#fbbf24"/>`;
  }).join('');
  return `${arms}<path d="M50 48V92M36 94H64" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/><g fill="${GOLD}">${xs.map((x) => `<rect x="${x - 4}" y="46" width="8" height="3" rx="1"/>`).join('')}</g>${candles}`;
};
const petal = (a, len, w, c) => `<path d="M0 0Q${w} ${-len * 0.45} 0 ${-len}Q${-w} ${-len * 0.45} 0 0Z" fill="${c}" transform="rotate(${a})"/>`;
const poinsettia = () => `<g transform="translate(50 52)">${[22, 112, 202, 292].map((a) => petal(a, 46, 14, '#15803d')).join('')}
  ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => petal(a, 40, 13, '#b91c1c')).join('')}${[22, 67, 112, 157, 202, 247, 292, 337].map((a) => petal(a, 28, 10, '#dc2626')).join('')}
  <g fill="#facc15">${[[0, 0], [4, 3], [-4, 3], [3, -4], [-3, -4], [0, 5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`).join('')}</g></g>`;
const snowflakeArt = () => `<circle cx="50" cy="50" r="48" fill="#bfdbfe"/><g transform="translate(50 50) scale(.95)">${ART.snowflake()}</g>`;

// Birthday Party
const cake = () => `<rect x="18" y="58" width="64" height="30" rx="4" fill="#f472b6"/><rect x="26" y="36" width="48" height="24" rx="4" fill="#fbcfe8"/>
  <path d="M18 62Q22 70 26 62T34 62T42 62T50 62T58 62T66 62T74 62T82 62V60H18Z" fill="#fff"/>
  <path d="M26 40Q30 47 34 40T42 40T50 40T58 40T66 40T74 40V38H26Z" fill="#fff"/>
  <rect x="12" y="88" width="76" height="5" rx="2" fill="#e5e7eb"/>
  ${[36, 50, 64].map((x, i) => `<rect x="${x - 2}" y="20" width="4" height="16" fill="${['#60a5fa', '#facc15', '#34d399'][i]}"/><path d="M${x} 10Q${x + 4} 16 ${x} 19Q${x - 4} 16 ${x} 10Z" fill="#f97316"/>`).join('')}
  <g fill="#fff">${[[28, 76], [42, 72], [56, 78], [70, 72], [36, 50], [62, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>`;
const hat = (x, y, rot, c1, c2) => `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0-34L16 12H-16Z" fill="${c1}"/><path d="M-7-13L6-11M-11-1L10 2" stroke="${c2}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="0" cy="-36" r="5" fill="${c2}"/><path d="M-16 12Q0 18 16 12" fill="none" stroke="${c2}" stroke-width="3"/></g>`;
const partyHats = () => `${hat(32, 56, -14, '#3b82f6', '#facc15')}${hat(68, 52, 12, '#ec4899', '#a7f3d0')}
  <path d="M8 86q8-10 16 0t16 0M60 90q8-10 16 0t16 0" fill="none" stroke="#a855f7" stroke-width="3" stroke-linecap="round"/>
  <g fill="#f59e0b"><circle cx="14" cy="20" r="3"/><circle cx="88" cy="16" r="2.5"/></g><g fill="#10b981"><circle cx="50" cy="12" r="2.5"/><circle cx="90" cy="76" r="3"/></g>`;
const bunting = () => {
  const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
  const y = (x) => 8 + 22 * Math.sin((Math.PI * x) / 300);
  let flags = '';
  for (let i = 0; i < 11; i++) {
    const x = 12 + i * 25.6;
    flags += `<path d="M${f1(x)} ${f1(y(x))}L${f1(x + 20)} ${f1(y(x + 20))}L${f1(x + 10)} ${f1(y(x + 10) + 26)}Z" fill="${colors[i % colors.length]}"/>`;
  }
  return `<path d="M2 ${f1(y(2))}Q150 52 298 ${f1(y(298))}" fill="none" stroke="#64748b" stroke-width="1.6"/>${flags}`;
};

// New Year's Eve
const discoBall = () => {
  let tiles = '';
  for (let i = -3; i <= 3; i++) tiles += `<ellipse cx="50" cy="56" rx="34" ry="${f1(Math.abs(i) * 11 + 0.5)}" fill="none" stroke="#475569" stroke-width="1" transform="rotate(90 50 56)" opacity=".7"/>`;
  for (let i = -3; i <= 3; i++) { const yy = 56 + i * 9.5; const half = Math.sqrt(Math.max(0, 34 ** 2 - (i * 9.5) ** 2)); tiles += `<path d="M${f1(50 - half)} ${f1(yy)}H${f1(50 + half)}" stroke="#475569" stroke-width="1" opacity=".7"/>`; }
  return `<path d="M50 4V22" stroke="#cbd5e1" stroke-width="2"/><circle cx="50" cy="56" r="34" fill="#cbd5e1"/><circle cx="50" cy="56" r="34" fill="#94a3b8" opacity=".35"/>
    ${tiles}<g fill="#fff">${[[38, 40], [44, 34], [36, 50], [62, 72], [56, 44]].map(([x, yy]) => `<rect x="${x}" y="${yy}" width="6" height="6" opacity=".85"/>`).join('')}</g>
    ${sparkles([[14, 30, 5], [86, 26, 4], [88, 82, 5], [12, 84, 3.5]], '#f3d27a')}`;
};
const horn = (x, y, rot, c1, c2) => `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 0L36 -8L36 8Z" fill="${c1}"/><path d="M9 -2V2M18 -4V4M27 -6V6" stroke="${c2}" stroke-width="3"/><ellipse cx="36" cy="0" rx="3" ry="8" fill="${c2}"/><rect x="-6" y="-2" width="7" height="4" rx="1" fill="#e5e7eb"/></g>`;
const horns = () => `${horn(14, 70, -30, '#d4a017', '#1f2937')}${horn(86, 70, 210, '#e5e7eb', '#d4a017')}
  <path d="M30 22q8 10 0 18t0 18M70 22q-8 10 0 18t0 18M50 8q6 8 0 14t0 14" fill="none" stroke="#f3d27a" stroke-width="2.6" stroke-linecap="round"/>
  <g fill="#f3d27a"><circle cx="20" cy="30" r="2.4"/><circle cx="82" cy="34" r="2.4"/><circle cx="50" cy="58" r="2.4"/></g><g fill="#e5e7eb"><circle cx="40" cy="70" r="2"/><circle cx="62" cy="82" r="2"/><circle cx="90" cy="14" r="2"/></g>`;
const sparkler = () => `<path d="M18 92L56 42" stroke="#94a3b8" stroke-width="3.5" stroke-linecap="round"/>${burst(60, 38, 30, '#fde68a', 14)}${burst(60, 38, 16, '#fff', 10)}
  <g fill="#fde68a">${[[20, 20], [88, 22], [90, 64], [34, 12], [82, 82]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>`;

// Grad Party
const books = () => `<rect x="14" y="72" width="72" height="16" rx="2" fill="#1e3a8a"/><rect x="18" y="56" width="64" height="16" rx="2" fill="#b91c1c"/><rect x="22" y="40" width="58" height="16" rx="2" fill="#15803d"/>
  <path d="M14 76H86M18 60H82M22 44H80" stroke="#fff" stroke-width="1.2" opacity=".5"/><path d="M80 75V85M76 59V69M74 43V53" stroke="${GOLD}" stroke-width="3"/>
  <path d="M50 38Q42 26 50 24Q58 26 50 38Z" fill="#dc2626" transform="translate(0 -2)"/><circle cx="50" cy="28" r="10" fill="#dc2626"/><path d="M50 18V12" stroke="#78350f" stroke-width="2"/><path d="M51 14Q58 10 60 15Q54 18 51 14Z" fill="#16a34a"/>
  <ellipse cx="46" cy="25" rx="3" ry="2" fill="#fff" opacity=".5"/>`;
const tassel = () => `<path d="M50 4Q30 4 32 22Q34 36 50 36" fill="none" stroke="${GOLD}" stroke-width="3"/><circle cx="50" cy="38" r="6" fill="${GOLD}"/>
  <rect x="44" y="42" width="12" height="8" rx="2" fill="#b8860b"/>
  <g stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round">${[-10, -6, -2, 2, 6, 10].map((dx) => `<path d="M${50 + dx / 3} 50Q${50 + dx} 70 ${50 + dx * 1.4} 92"/>`).join('')}</g>
  ${sparkles([[16, 70, 4], [86, 80, 3.5], [18, 18, 3]])}`;
const pennant = () => `<path d="M22 12V94" stroke="#78350f" stroke-width="4" stroke-linecap="round"/><path d="M24 16L90 36L24 58Z" fill="#1e3a8a"/><path d="M24 16L90 36L24 58Z" fill="none" stroke="${GOLD}" stroke-width="2"/>
  <text x="48" y="42" font-family="Arial Black, Arial, sans-serif" font-size="13" font-weight="900" fill="${GOLD}" text-anchor="middle" transform="rotate(0)">GRAD</text>
  ${sparkles([[70, 70, 5], [86, 86, 3.5], [50, 84, 3]])}`;
const bulb = () => `<g stroke="#facc15" stroke-width="3" stroke-linecap="round">${[-60, -30, 0, 30, 60, -90, 90].map((a) => `<path d="M50 2V10" transform="rotate(${a} 50 40)"/>`).join('')}</g>
  <path d="M50 16A22 22 0 0 0 36 56Q40 60 40 66H60Q60 60 64 56A22 22 0 0 0 50 16Z" fill="#fef08a" stroke="#eab308" stroke-width="2.4"/>
  <path d="M44 66V52L50 46L56 52V66" fill="none" stroke="#ca8a04" stroke-width="1.8"/>
  <rect x="40" y="66" width="20" height="6" rx="1.5" fill="#94a3b8"/><rect x="41" y="72" width="18" height="5" rx="1.5" fill="#64748b"/><rect x="44" y="77" width="12" height="5" rx="2" fill="#475569"/>
  ${cap(50, 92, 0, 0.32)}`;

// Showers
const onesie = (x, c) => `<g transform="translate(${x} 34)"><path d="M-12 0L-20 6L-16 14L-10 11V30Q-10 36-4 38L-2 44H2L4 38Q10 36 10 30V11L16 14L20 6L12 0Q8 6 0 6Q-8 6-12 0Z" fill="${c}"/>
  <rect x="-3" y="-4" width="6" height="8" rx="1" fill="#a8a29e"/></g>`;
const clothesline = () => `<path d="M2 24Q50 40 98 24" fill="none" stroke="#a8a29e" stroke-width="1.6"/>${onesie(22, '#bfdbfe')}${onesie(50, '#fde68a')}${onesie(78, '#fbcfe8')}
  ${heart(50, 82, 1.1, '#f9a8d4')}${heart(24, 86, 0.7, '#93c5fd')}${heart(76, 86, 0.7, '#fde68a')}`;
const bottle = () => `<path d="M42 22Q42 8 50 8Q58 8 58 22Z" fill="#fcd34d"/><rect x="38" y="22" width="24" height="10" rx="2" fill="#60a5fa"/>
  <rect x="36" y="32" width="28" height="56" rx="8" fill="#fff" stroke="#93c5fd" stroke-width="2.4"/><path d="M38 54H62V80Q62 86 56 86H44Q38 86 38 80Z" fill="#fef3c7"/>
  <path d="M36 44h8M36 54h8M36 64h8M36 74h8" stroke="#93c5fd" stroke-width="1.6"/>
  ${heart(20, 30, 0.9, '#f9a8d4')}${heart(82, 64, 1, '#93c5fd')}${sparkles([[18, 76, 3], [84, 22, 3.5]], '#fcd34d')}`;
const umbrella = () => `<path d="M10 50A40 38 0 0 1 90 50Q80 44 70 50Q60 44 50 50Q40 44 30 50Q20 44 10 50Z" fill="#f9a8d4"/>
  <path d="M30 50Q34 22 50 12Q66 22 70 50" fill="none" stroke="#fbcfe8" stroke-width="2"/><path d="M50 12V50" stroke="#fbcfe8" stroke-width="2"/>
  <path d="M50 50V84Q50 92 42 92Q36 92 36 86" fill="none" stroke="#78716c" stroke-width="3" stroke-linecap="round"/><path d="M50 6V12" stroke="#78716c" stroke-width="3" stroke-linecap="round"/>
  <g fill="#93c5fd">${[[18, 66], [82, 62], [26, 84], [74, 82], [62, 72]].map(([x, y]) => `<path d="M${x} ${y - 6}Q${x + 4} ${y} ${x} ${y + 2}Q${x - 4} ${y} ${x} ${y - 6}Z"/>`).join('')}</g>`;
const tieredCake = () => `<rect x="18" y="66" width="64" height="24" rx="3" fill="#fff" stroke="#e7e5e4" stroke-width="1.5"/><rect x="26" y="46" width="48" height="20" rx="3" fill="#fff" stroke="#e7e5e4" stroke-width="1.5"/><rect x="34" y="30" width="32" height="16" rx="3" fill="#fff" stroke="#e7e5e4" stroke-width="1.5"/>
  <rect x="18" y="80" width="64" height="4" fill="#f9a8d4"/><rect x="26" y="58" width="48" height="4" fill="#f9a8d4"/><rect x="34" y="40" width="32" height="3" fill="#f9a8d4"/>
  <g fill="#fbcfe8">${[[24, 72], [36, 72], [48, 72], [60, 72], [72, 72], [32, 52], [44, 52], [56, 52], [68, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>
  <circle cx="44" cy="26" r="5" fill="#f472b6"/><circle cx="56" cy="26" r="5" fill="#fda4af"/><circle cx="50" cy="22" r="5" fill="#f9a8d4"/><path d="M38 28q-4-4 0-6M62 28q4-4 0-6" stroke="#16a34a" stroke-width="2" fill="none"/>
  <rect x="12" y="90" width="76" height="4" rx="2" fill="#d6d3d1"/>${heart(14, 30, 0.8, '#fda4af')}${heart(86, 36, 0.8, '#f9a8d4')}`;
const hearts = () => `${heart(50, 30, 3, '#f472b6')}${heart(26, 58, 1.6, '#fda4af')}${heart(76, 60, 1.8, '#fb7185')}${heart(44, 82, 1.1, '#f9a8d4')}${heart(78, 20, 0.9, '#fda4af')}${heart(18, 22, 0.8, '#fb7185')}`;

// Get-Togethers
const grill = () => `<path d="M38 26q-6-8 0-14M50 24q-6-8 0-14M62 26q-6-8 0-14" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>
  <path d="M14 44H86A36 30 0 0 1 14 44Z" fill="#1f2937"/><rect x="10" y="40" width="80" height="5" rx="2" fill="#374151"/>
  <rect x="20" y="33" width="26" height="8" rx="4" fill="#b45309"/><rect x="52" y="33" width="26" height="8" rx="4" fill="#92400e"/><path d="M24 37h18M56 37h18" stroke="#78350f" stroke-width="1.4" stroke-dasharray="3 3"/>
  <path d="M30 70L20 94M70 70L80 94M50 74V94" stroke="#374151" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="94" r="3" fill="#374151"/>
  <path d="M24 50Q28 44 32 50M66 50Q70 44 74 50" fill="none" stroke="#f97316" stroke-width="2.4"/>`;
const cup = (x, rot, c) => `<g transform="translate(${x} 0) rotate(${rot} 0 70)"><ellipse cx="0" cy="88" rx="22" ry="5" fill="#e7e5e4"/><path d="M-16 50H16V78Q16 86 8 86H-8Q-16 86-16 78Z" fill="${c}"/>
  <path d="M16 56Q26 56 26 66Q26 74 16 74" fill="none" stroke="${c}" stroke-width="4"/><ellipse cx="0" cy="50" rx="16" ry="4" fill="#78350f"/>
  <path d="M-4 40q-5-6 0-12M6 40q-5-6 0-12" fill="none" stroke="#d6d3d1" stroke-width="2.4" stroke-linecap="round"/></g>`;
const coffee = () => `${cup(32, -6, '#fff7ed')}${cup(68, 6, '#fecaca')}<path d="M32 50H48" stroke="#fed7aa" stroke-width="0"/>${heart(50, 16, 1.2, '#f87171')}`;
const pizza = () => `<path d="M50 92L14 22Q50 6 86 22Z" fill="#facc15"/><path d="M14 22Q50 6 86 22L82 30Q50 16 18 30Z" fill="#d97706"/>
  <g fill="#dc2626">${[[50, 34], [38, 50], [62, 52], [50, 70], [32, 34], [68, 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5"/>`).join('')}</g>
  <g fill="#16a34a">${[[44, 42], [58, 62], [42, 60]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.4"/>`).join('')}</g>
  <path d="M56 80Q58 90 54 92" fill="none" stroke="#facc15" stroke-width="3" stroke-linecap="round"/>`;
const die = (x, y, rot, pips) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-16" y="-16" width="32" height="32" rx="6" fill="#fff" stroke="#cbd5e1" stroke-width="1.6"/>
  <g fill="#1f2937">${pips.map(([px, py]) => `<circle cx="${px * 8}" cy="${py * 8}" r="3"/>`).join('')}</g></g>`;
const games = () => `${die(34, 58, -14, [[-1, -1], [0, 0], [1, 1]])}${die(66, 46, 12, [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]])}
  <path d="M62 92a6 6 0 1 1 8 0l3 4H59Z" fill="#3b82f6"/><path d="M22 92a5 5 0 1 1 7 0l2 3H20Z" fill="#ef4444"/>
  ${sparkles([[16, 22, 4], [84, 82, 3.5], [86, 16, 3]], '#f59e0b')}`;
const pot = () => `<path d="M34 26q-6-8 0-14M50 24q-6-8 0-14M66 26q-6-8 0-14" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>
  <path d="M16 46H84V76Q84 90 70 90H30Q16 90 16 76Z" fill="#dc2626"/><path d="M8 54H16M84 54H92" stroke="#991b1b" stroke-width="6" stroke-linecap="round"/>
  <path d="M12 46Q50 28 88 46Z" fill="#b91c1c"/><rect x="44" y="30" width="12" height="6" rx="3" fill="#7f1d1d"/>
  <path d="M22 62H78" stroke="#fff" stroke-width="2" opacity=".35"/><path d="M76 40L94 16" stroke="#a16207" stroke-width="4" stroke-linecap="round"/>`;

// box: the viewBox; width: how wide the picture sits in the design.
const ARTWORK = {
  wreath: { draw: ART.wreath, width: '36%' },
  tree: { draw: ART.tree, width: '36%' },
  santa: { file: 'art/santa.png', width: '34%' },
  pines: { draw: snowScene, box: [90, 100], width: '30%' },
  night: { draw: nightScene, box: [90, 100], width: '30%' },
  mistletoe: { file: 'art/mistletoe.png', width: '24%' },
  balloons: { draw: ART.balloons, width: '34%' },
  cupcake: { draw: ART.cupcake, width: '32%' },
  confetti: { draw: confettiStrip, box: [300, 60], width: '100%' },
  champagne: { file: 'art/champagne.jpg', width: '36%' },
  fireworks: { draw: fireworksBig, width: '40%' },
  clock: { draw: clock, width: '32%' },
  cap: { draw: gradCap, width: '40%' },
  diploma: { draw: diploma, width: '40%' },
  caps: { file: 'art/caps.jpg', width: '50%' },
  carriage: { draw: carriage, width: '34%' },
  rings: { draw: rings, width: '34%' },
  blossoms: { draw: ART.blossoms, width: '34%' },
  lights: { draw: stringLights, box: [300, 70], width: '100%' },
  sunflower: { draw: ART.sunflower, width: '32%' },
  dinner: { file: 'art/dinner.jpg', width: '56%' },
  ornaments: { draw: ornaments, width: '36%' },
  gift: { file: 'art/gift.jpg', width: '32%' },
  gingerbread: { file: 'art/gingerbread.jpg', width: '34%' },
  canes: { file: 'art/canes.jpg', width: '30%' },
  cocoa: { file: 'art/cocoa.jpg', width: '30%' },
  snowman: { file: 'art/snowman.jpg', width: '30%' },
  menorah: { draw: menorah, width: '40%' },
  holly: { file: 'art/holly.jpg', width: '30%' },
  poinsettia: { draw: poinsettia, width: '32%' },
  cardinal: { file: 'art/cardinal.jpg', width: '36%' },
  snowflake: { draw: snowflakeArt, width: '28%' },
  cake: { draw: cake, width: '34%' },
  hats: { draw: partyHats, width: '34%' },
  bunting: { draw: bunting, box: [300, 60], width: '100%' },
  stars: { draw: ART.twinkle, width: '32%' },
  present: { draw: gift('#7c3aed', '#6d28d9', '#facc15'), width: '30%' },
  disco: { draw: discoBall, width: '34%' },
  goldConfetti: { draw: confettiOf(['#d4a017', '#f3d27a', '#e5e7eb', '#b8860b'], 7), box: [300, 60], width: '100%' },
  horns: { draw: horns, width: '36%' },
  sparkler: { draw: sparkler, width: '34%' },
  nightStars: { draw: () => `<rect width="100" height="100" rx="50" fill="#1e2a44"/>${sparkles([[30, 34, 12], [66, 26, 7], [62, 64, 10], [28, 72, 6], [80, 48, 4]], '#f3d27a')}`, width: '30%' },
  books: { draw: books, width: '34%' },
  tassel: { draw: tassel, width: '30%' },
  pennant: { draw: pennant, width: '34%' },
  bulb: { draw: bulb, width: '28%' },
  schoolConfetti: { draw: confettiOf(['#1e3a8a', '#d4a017', '#ffffff', '#3b82f6'], 23), box: [300, 60], width: '100%' },
  clothesline: { draw: clothesline, width: '44%' },
  bottle: { draw: bottle, width: '28%' },
  umbrella: { draw: umbrella, width: '34%' },
  tieredCake: { draw: tieredCake, width: '32%' },
  hearts: { draw: hearts, width: '32%' },
  grill: { draw: grill, width: '34%' },
  coffee: { draw: coffee, width: '36%' },
  pizza: { draw: pizza, width: '30%' },
  games: { draw: games, width: '34%' },
  pot: { draw: pot, width: '34%' },
};

// ---------- the templates ----------
const fam = (key) => fontByKey(key).stack.replace(/"/g, "'");
const P = (inner, style = '') => `<p style="text-align:center;margin:0 0 10px${style ? `;${style}` : ''}">${inner}</p>`;
const WHEN = '<b>{{date}}</b><br>{{time}}<br>{{location}}';

/** An invitation: picture, title, greeting, what it is, when and where, from. */
// A text box like the Designer's Text box (no border, centered), so each part can be moved, resized or bordered.
const BOX = (width, inner) => `<div data-box="none" align="center" style="width:${width};padding:6px 12px;margin:6px auto">${inner}</div>`;

function invitation({ title, titleFont, titleColor, titleSize = 40, line, when = WHEN, whenColor = '', sign = 'Hope you can make it!', textFont = '' }) {
  const tf = textFont ? `;font-family:${fam(textFont)}` : '';
  // One wide box for the title, greeting and the longer line; a narrower one for the shorter when, where and sign-off.
  return BOX('90%', `<h1 style="text-align:center;margin:4px 0 8px;font-family:${fam(titleFont)};font-size:${titleSize}px;font-weight:normal;line-height:1.1;color:${titleColor}">${title}</h1>`
    + P('Dear {{greeting}},', tf.slice(1))
    + P(line, `margin-bottom:0${tf}`))
    + BOX('60%', P(when, `${whenColor ? `color:${whenColor}` : ''}${tf}`.replace(/^;/, ''))
    + P(`${sign}<br>{{from}}`, `margin-bottom:0${tf}`));
}
/** A greeting (no event): picture, title, greeting, wishes, from. */
function greeting({ title, titleFont, titleColor, titleSize = 42, wish, sign = 'With love,' }) {
  return BOX('90%', `<h1 style="text-align:center;margin:4px 0 10px;font-family:${fam(titleFont)};font-size:${titleSize}px;font-weight:normal;line-height:1.1;color:${titleColor}">${title}</h1>`
    + P('Dear {{greeting}},') + P(wish, 'margin-bottom:0'))
    + BOX('60%', P(`${sign}<br>{{from}}`, 'margin-bottom:0'));
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
  { id: 'hp-ornaments', name: 'Ornaments', theme: 'Holiday Party', art: 'ornaments',
    design: { font: 'georgia', background: '#fffdf7', color: '#1f2937', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: "'Tis the Season", titleFont: 'great-vibes', titleColor: '#b91c1c', titleSize: 46, line: 'Join us for an evening of holiday cheer, festive treats and good company.', whenColor: '#166534' }) },
  { id: 'hp-gift', name: 'Wrapped gift', theme: 'Holiday Party', art: 'gift',
    design: { font: 'trebuchet', background: '#f0fdf4', color: '#14532d', border: 'dashed', borderColor: '#dc2626' },
    body: invitation({ title: 'Holiday Gift Exchange', titleFont: 'lobster', titleColor: '#b91c1c', titleSize: 34, line: 'Bring a wrapped gift and join the fun at our holiday party.', whenColor: '#b91c1c', sign: 'See you there!' }) },
  { id: 'hp-gingerbread', name: 'Gingerbread house', theme: 'Holiday Party', art: 'gingerbread',
    design: { font: 'verdana', background: '#fff7ed', color: '#431407', border: 'rounded', borderColor: '#b45309' },
    body: invitation({ title: 'Sweet Holiday Party', titleFont: 'pacifico', titleColor: '#9a3412', titleSize: 32, line: 'Come decorate cookies, sip cocoa and celebrate the season with us.', whenColor: '#9a3412' }) },
  { id: 'hp-canes', name: 'Candy canes', theme: 'Holiday Party', art: 'canes',
    design: { font: 'arial', background: '#ffffff', color: '#1f2937', border: 'thick', borderColor: '#dc2626' },
    body: invitation({ title: 'Christmas Party', titleFont: 'christmas', titleColor: '#dc2626', titleSize: 42, line: "Grab your ugliest sweater: you're invited to our Christmas party!", whenColor: '#15803d', sign: 'Merry Christmas!' }) },
  { id: 'hp-cocoa', name: 'Hot cocoa', theme: 'Holiday Party', art: 'cocoa',
    design: { font: 'georgia', background: '#fef2f2', color: '#3f1d1d', border: 'double', borderColor: '#b91c1c' },
    body: invitation({ title: 'Cocoa & Cookies', titleFont: 'dancing', titleColor: '#991b1b', titleSize: 42, line: 'Warm up with us at a cozy holiday get-together.', whenColor: '#991b1b', sign: 'Stay warm!' }) },
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
  { id: 'ho-snowman', name: 'Snowman', theme: 'Holidays', art: 'snowman',
    design: { font: 'trebuchet', background: '#eff6ff', color: '#1e3a8a', border: 'rounded', borderColor: '#93c5fd' },
    body: greeting({ title: 'Warm Winter Wishes', titleFont: 'pacifico', titleColor: '#1d4ed8', titleSize: 32, wish: 'Wishing you snowy days, cozy nights and a happy holiday season.' }) },
  { id: 'ho-menorah', name: 'Menorah', theme: 'Holidays', art: 'menorah',
    design: { font: 'georgia', background: '#0f2547', color: '#e0ecff', border: 'thin', borderColor: '#d4a017' },
    body: greeting({ title: 'Happy Hanukkah', titleFont: 'cinzel', titleColor: '#f3d27a', titleSize: 32, wish: 'May the festival of lights fill your home with warmth, joy and love.' }) },
  { id: 'ho-holly', name: 'Holly', theme: 'Holidays', art: 'holly',
    design: { font: 'playfair', background: '#ffffff', color: '#1f2937', border: 'double', borderColor: '#166534' },
    body: greeting({ title: 'Happy Holidays', titleFont: 'great-vibes', titleColor: '#b91c1c', titleSize: 46, wish: 'Wishing you a joyful holiday season and a bright, happy New Year.' }) },
  { id: 'ho-poinsettia', name: 'Poinsettia', theme: 'Holidays', art: 'poinsettia',
    design: { font: 'georgia', background: '#fdf8f0', color: '#3f1d1d', border: 'thin', borderColor: '#b91c1c' },
    body: greeting({ title: 'Merry & Bright', titleFont: 'dancing', titleColor: '#b91c1c', titleSize: 44, wish: 'May your holidays sparkle with joy and your New Year be filled with blessings.' }) },
  { id: 'ho-cardinal', name: 'Cardinal', theme: 'Holidays', art: 'cardinal',
    design: { font: 'palatino', background: '#f8fafc', color: '#1f2937', border: 'groove', borderColor: '#94a3b8' },
    body: greeting({ title: 'Peace & Joy', titleFont: 'playfair', titleColor: '#991b1b', titleSize: 38, wish: 'Thinking of you this season and wishing you peace, joy and good health in the year ahead.' }) },
  // Birthday Party
  { id: 'bd-balloons', name: 'Balloons', theme: 'Birthday Party', art: 'balloons',
    design: { font: 'verdana', background: '#ffffff', color: '#374151', border: 'rounded', borderColor: '#3b82f6' },
    body: invitation({ title: "Let's Celebrate!", titleFont: 'pacifico', titleColor: '#db2777', titleSize: 34, line: "You're invited to {{subject}}'s birthday party!", whenColor: '#2563eb', sign: 'See you there!' }) },
  { id: 'bd-cupcake', name: 'Cupcake', theme: 'Birthday Party', art: 'cupcake',
    design: { font: 'trebuchet', background: '#fdf2f8', color: '#4b5563', border: 'dotted', borderColor: '#ec4899' },
    body: invitation({ title: 'Birthday Party', titleFont: 'dancing', titleColor: '#be185d', titleSize: 42, line: 'Join us for cake, fun and lots of birthday wishes for {{subject}}.', whenColor: '#be185d' }) },
  { id: 'bd-confetti', name: 'Confetti', theme: 'Birthday Party', art: 'confetti',
    design: { font: 'arial', background: '#ffffff', color: '#1f2937', border: 'none', borderColor: '#7c3aed' },
    body: invitation({ title: 'Party Time!', titleFont: 'lobster', titleColor: '#7c3aed', titleSize: 44, line: "Come help us celebrate {{subject}}'s very special birthday.", whenColor: '#7c3aed', sign: "Can't wait to see you!" }) },
  { id: 'bd-cake', name: 'Birthday cake', theme: 'Birthday Party', art: 'cake',
    design: { font: 'verdana', background: '#fff1f2', color: '#4c0519', border: 'rounded', borderColor: '#f472b6' },
    body: invitation({ title: 'Make a Wish!', titleFont: 'pacifico', titleColor: '#db2777', titleSize: 34, line: "Join us for cake and candles to celebrate {{subject}}'s birthday!", whenColor: '#db2777', sign: 'See you there!' }) },
  { id: 'bd-hats', name: 'Party hats', theme: 'Birthday Party', art: 'hats',
    design: { font: 'trebuchet', background: '#eff6ff', color: '#1e293b', border: 'dashed', borderColor: '#3b82f6' },
    body: invitation({ title: "It's a Party!", titleFont: 'lobster', titleColor: '#2563eb', titleSize: 42, line: '{{subject}} is turning another year older. Come celebrate!', whenColor: '#db2777' }) },
  { id: 'bd-bunting', name: 'Bunting', theme: 'Birthday Party', art: 'bunting',
    design: { font: 'arial', background: '#fffbeb', color: '#292524', border: 'none', borderColor: '#f59e0b' },
    body: invitation({ title: 'Birthday Bash', titleFont: 'amatic', titleColor: '#b45309', titleSize: 52, line: "You're invited to a birthday bash for {{subject}}!", whenColor: '#0f766e', sign: "Can't wait to celebrate!" }) },
  { id: 'bd-stars', name: 'Stars', theme: 'Birthday Party', art: 'stars',
    design: { font: 'verdana', background: '#ffffff', color: '#334155', border: 'dotted', borderColor: '#a855f7' },
    body: invitation({ title: 'Shine Bright!', titleFont: 'dancing', titleColor: '#7c3aed', titleSize: 44, line: "Help us celebrate {{subject}}'s special day with fun, food and friends.", whenColor: '#7c3aed' }) },
  { id: 'bd-present', name: 'Present', theme: 'Birthday Party', art: 'present',
    design: { font: 'trebuchet', background: '#faf5ff', color: '#3b0764', border: 'thick', borderColor: '#7c3aed' },
    body: invitation({ title: 'Surprise Party!', titleFont: 'lobster', titleColor: '#6d28d9', titleSize: 40, line: "Shh! It's a surprise party for {{subject}}. Please arrive early!", whenColor: '#a16207', sign: "Don't tell!" }) },
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
  { id: 'ny-disco', name: 'Disco ball', theme: "New Year's Eve", art: 'disco',
    design: { font: 'arial', background: '#1e1b4b', color: '#e0e7ff', border: 'none', borderColor: '#f3d27a' },
    body: invitation({ title: 'Dance Into the New Year', titleFont: 'lobster', titleColor: '#f3d27a', titleSize: 34, line: 'Put on your dancing shoes and party with us until midnight!', whenColor: '#c7d2fe' }) },
  { id: 'ny-gold', name: 'Gold confetti', theme: "New Year's Eve", art: 'goldConfetti',
    design: { font: 'playfair', background: '#ffffff', color: '#1c1917', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: 'Cheers to the New Year', titleFont: 'great-vibes', titleColor: '#a16207', titleSize: 44, line: "Join us for a New Year's Eve celebration with champagne and good friends.", whenColor: '#a16207', sign: 'Cheers!' }) },
  { id: 'ny-horns', name: 'Party horns', theme: "New Year's Eve", art: 'horns',
    design: { font: 'trebuchet', background: '#111827', color: '#f9fafb', border: 'dashed', borderColor: '#f3d27a' },
    body: invitation({ title: 'Ring It In!', titleFont: 'amatic', titleColor: '#f3d27a', titleSize: 54, line: 'Noisemakers, confetti and a midnight toast. Come celebrate with us!', whenColor: '#f3d27a' }) },
  { id: 'ny-sparkler', name: 'Sparkler', theme: "New Year's Eve", art: 'sparkler',
    design: { font: 'georgia', background: '#0b1020', color: '#f1f5f9', border: 'double', borderColor: '#fde68a' },
    body: invitation({ title: 'A Sparkling New Year', titleFont: 'dancing', titleColor: '#fde68a', titleSize: 42, line: 'Celebrate the last night of the year with us.', whenColor: '#fde68a' }) },
  { id: 'ny-stars', name: 'Midnight stars', theme: "New Year's Eve", art: 'nightStars',
    design: { font: 'palatino', background: '#1e2a44', color: '#f6eedb', border: 'thin', borderColor: '#f3d27a' },
    body: invitation({ title: "New Year's Eve Party", titleFont: 'cinzel', titleColor: '#f3d27a', titleSize: 28, line: 'Join us under the stars as we welcome the New Year.', whenColor: '#f3d27a', sign: 'Happy New Year!' }) },
  // Grad Party
  { id: 'gr-cap', name: 'Graduation cap', theme: 'Grad Party', art: 'cap',
    design: { font: 'georgia', background: '#ffffff', color: '#111827', border: 'thick', borderColor: '#111827' },
    body: invitation({ title: 'Graduation Party', titleFont: 'cinzel', titleColor: '#111827', titleSize: 28, line: 'Please join us in celebrating our graduate, {{subject}}!', whenColor: '#a16207', sign: 'Congratulations!' }) },
  { id: 'gr-diploma', name: 'Diploma', theme: 'Grad Party', art: 'diploma',
    design: { font: 'playfair', background: '#fdfaf2', color: '#1f2937', border: 'double', borderColor: '#b91c1c' },
    body: invitation({ title: 'Class Dismissed!', titleFont: 'dancing', titleColor: '#7f1d1d', titleSize: 42, line: "Come celebrate {{subject}}'s milestone with us at an open house.", whenColor: '#7f1d1d' }) },
  { id: 'gr-caps', name: 'Hats off', theme: 'Grad Party', art: 'caps',
    design: { font: 'trebuchet', background: '#1f2937', color: '#f9fafb', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: 'Hats Off to the Graduate', titleFont: 'amatic', titleColor: '#f3d27a', titleSize: 40, line: 'Join us for a graduation celebration for {{subject}}!', whenColor: '#f3d27a' }) },
  { id: 'gr-books', name: 'Books', theme: 'Grad Party', art: 'books',
    design: { font: 'georgia', background: '#f8fafc', color: '#0f172a', border: 'thin', borderColor: '#1e3a8a' },
    body: invitation({ title: 'Graduation Open House', titleFont: 'playfair', titleColor: '#1e3a8a', titleSize: 32, line: 'Please stop by to celebrate {{subject}} and all the hard work that got us here.', whenColor: '#b91c1c' }) },
  { id: 'gr-tassel', name: 'Tassel', theme: 'Grad Party', art: 'tassel',
    design: { font: 'trebuchet', background: '#111827', color: '#f9fafb', border: 'double', borderColor: '#d4a017' },
    body: invitation({ title: 'The Tassel Was Worth the Hassle', titleFont: 'amatic', titleColor: '#f3d27a', titleSize: 40, line: 'Join us for a party in honor of {{subject}}!', whenColor: '#f3d27a', sign: 'Congratulations!' }) },
  { id: 'gr-pennant', name: 'Pennant', theme: 'Grad Party', art: 'pennant',
    design: { font: 'arial', background: '#eff6ff', color: '#1e293b', border: 'thick', borderColor: '#1e3a8a' },
    body: invitation({ title: 'Grad Party', titleFont: 'lobster', titleColor: '#1e3a8a', titleSize: 44, line: "Help us cheer for {{subject}}, our newest graduate!", whenColor: '#a16207', sign: 'Go grad!' }) },
  { id: 'gr-bulb', name: 'Bright future', theme: 'Grad Party', art: 'bulb',
    design: { font: 'verdana', background: '#fffbeb', color: '#292524', border: 'rounded', borderColor: '#eab308' },
    body: invitation({ title: 'The Future Is Bright', titleFont: 'dancing', titleColor: '#a16207', titleSize: 40, line: "Celebrate {{subject}}'s graduation and the bright future ahead.", whenColor: '#a16207' }) },
  { id: 'gr-confetti', name: 'School colors', theme: 'Grad Party', art: 'schoolConfetti',
    design: { font: 'trebuchet', background: '#ffffff', color: '#0f172a', border: 'none', borderColor: '#1e3a8a' },
    body: invitation({ title: 'Congrats, Grad!', titleFont: 'pacifico', titleColor: '#1e3a8a', titleSize: 36, line: "Join us for a graduation celebration for {{subject}}!", whenColor: '#a16207', sign: 'See you there!' }) },
  // Showers
  { id: 'sh-baby', name: 'Baby shower', theme: 'Showers', art: 'carriage',
    design: { font: 'trebuchet', background: '#f0f7ff', color: '#334155', border: 'rounded', borderColor: '#93c5fd' },
    body: invitation({ title: 'Baby Shower', titleFont: 'dancing', titleColor: '#2563eb', titleSize: 44, line: 'Please join us for a baby shower honoring {{subject}}.', whenColor: '#2563eb', sign: 'With love,' }) },
  { id: 'sh-bridal', name: 'Bridal shower', theme: 'Showers', art: 'rings',
    design: { font: 'georgia', background: '#fff5f7', color: '#4b5563', border: 'thin', borderColor: '#d4a017' },
    body: invitation({ title: 'Bridal Shower', titleFont: 'great-vibes', titleColor: '#be185d', titleSize: 46, line: 'Please join us for a shower honoring the bride-to-be, {{subject}}.', whenColor: '#a16207', sign: 'With love,' }) },
  { id: 'sh-floral', name: 'Cherry blossoms', theme: 'Showers', art: 'blossoms',
    design: { font: 'playfair', background: '#ffffff', color: '#44403c', border: 'rounded', borderColor: '#f9a8d4' },
    body: invitation({ title: "You're Invited", titleFont: 'great-vibes', titleColor: '#9d174d', titleSize: 46, line: 'Please join us for a shower to celebrate {{subject}}.', whenColor: '#9d174d', sign: 'With love,' }) },
  { id: 'sh-clothesline', name: 'Little clothes', theme: 'Showers', art: 'clothesline',
    design: { font: 'trebuchet', background: '#fffdf7', color: '#44403c', border: 'dotted', borderColor: '#fcd34d' },
    body: invitation({ title: 'Oh Baby!', titleFont: 'pacifico', titleColor: '#0369a1', titleSize: 38, line: 'Please join us for a baby shower honoring {{subject}}.', whenColor: '#b45309', sign: 'With love,' }) },
  { id: 'sh-bottle', name: 'Baby bottle', theme: 'Showers', art: 'bottle',
    design: { font: 'verdana', background: '#fdf2f8', color: '#4a044e', border: 'rounded', borderColor: '#f9a8d4' },
    body: invitation({ title: 'A Little One Is on the Way', titleFont: 'dancing', titleColor: '#be185d', titleSize: 36, line: 'Join us to shower {{subject}} with love.', whenColor: '#be185d', sign: 'With love,' }) },
  { id: 'sh-umbrella', name: 'Umbrella', theme: 'Showers', art: 'umbrella',
    design: { font: 'georgia', background: '#ffffff', color: '#334155', border: 'thin', borderColor: '#f9a8d4' },
    body: invitation({ title: "It's a Shower!", titleFont: 'great-vibes', titleColor: '#be185d', titleSize: 44, line: 'Please join us for a shower in honor of {{subject}}.', whenColor: '#0369a1', sign: 'With love,' }) },
  { id: 'sh-cake', name: 'Tiered cake', theme: 'Showers', art: 'tieredCake',
    design: { font: 'playfair', background: '#fffaf5', color: '#44403c', border: 'double', borderColor: '#d4a017' },
    body: invitation({ title: 'Bridal Shower', titleFont: 'great-vibes', titleColor: '#9d174d', titleSize: 46, line: 'Join us for a sweet celebration honoring the bride-to-be, {{subject}}.', whenColor: '#a16207', sign: 'With love,' }) },
  { id: 'sh-hearts', name: 'Hearts', theme: 'Showers', art: 'hearts',
    design: { font: 'trebuchet', background: '#fff1f2', color: '#4c0519', border: 'rounded', borderColor: '#fb7185' },
    body: invitation({ title: 'Love Is in the Air', titleFont: 'dancing', titleColor: '#e11d48', titleSize: 42, line: 'Please join us for a couples shower celebrating {{subject}}.', whenColor: '#e11d48', sign: 'With love,' }) },
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
  { id: 'gt-grill', name: 'Cookout', theme: 'Get-Togethers', art: 'grill',
    design: { font: 'arial', background: '#fff7ed', color: '#1c1917', border: 'thick', borderColor: '#ea580c' },
    body: invitation({ title: 'Summer Cookout', titleFont: 'amatic', titleColor: '#c2410c', titleSize: 54, line: "Burgers, hot dogs and good friends. Come hungry!", whenColor: '#c2410c', sign: 'See you there!' }) },
  { id: 'gt-coffee', name: 'Coffee', theme: 'Get-Togethers', art: 'coffee',
    design: { font: 'georgia', background: '#fafaf9', color: '#292524', border: 'thin', borderColor: '#a8a29e' },
    body: invitation({ title: 'Coffee & Catch-Up', titleFont: 'dancing', titleColor: '#78350f', titleSize: 42, line: "It's been too long! Come over for coffee and conversation.", whenColor: '#78350f', sign: 'Hope you can make it!' }) },
  { id: 'gt-pizza', name: 'Pizza night', theme: 'Get-Togethers', art: 'pizza',
    design: { font: 'trebuchet', background: '#fefce8', color: '#1c1917', border: 'dashed', borderColor: '#dc2626' },
    body: invitation({ title: 'Pizza Night', titleFont: 'lobster', titleColor: '#b91c1c', titleSize: 44, line: "We've got the pizza. You bring the appetite!", whenColor: '#15803d', sign: 'See you there!' }) },
  { id: 'gt-games', name: 'Game night', theme: 'Get-Togethers', art: 'games',
    design: { font: 'verdana', background: '#eef2ff', color: '#1e1b4b', border: 'rounded', borderColor: '#6366f1' },
    body: invitation({ title: 'Game Night', titleFont: 'pacifico', titleColor: '#4338ca', titleSize: 38, line: 'Board games, card games and snacks. Bring your favorite game!', whenColor: '#4338ca', sign: "Let the games begin!" }) },
  { id: 'gt-potluck', name: 'Potluck', theme: 'Get-Togethers', art: 'pot',
    design: { font: 'georgia', background: '#fef2f2', color: '#292524', border: 'double', borderColor: '#b91c1c' },
    body: invitation({ title: 'Potluck Dinner', titleFont: 'playfair', titleColor: '#991b1b', titleSize: 36, line: 'Bring a dish to share and join us for an evening of good food.', whenColor: '#991b1b', sign: 'See you there!' }) },
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
