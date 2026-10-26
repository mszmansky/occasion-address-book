// Designs for return-address labels: everyday and holiday styles, each drawn in HTML/CSS and inline
// SVG so script fonts and artwork print sharply. Pure functions (unit tested in Node), plus fitLabel,
// which runs in the browser to shrink any line that doesn't fit.
//
// Every design is sized in em of the label's height: a label is 2.625em × 1em, which is the shape of
// both Avery 5195 / 8195 / 18294 (1¾ × ⅔ in) and 5160 / 8160 (2⅝ × 1 in). Set the font-size of the
// element holding .rl to the label's height and the design fills it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LABEL_FONT_LINK = 'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Pinyon+Script'
  + '&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Cinzel:wght@400;600&family=Josefin+Sans:wght@400;600;700&family=Pacifico&display=swap';

export const LABEL_CSS = `
.rl { position: relative; width: 2.625em; height: 1em; overflow: hidden; box-sizing: border-box; border-radius: .07em;
  background: #fff; color: #1f2328; font-family: 'Josefin Sans', Arial, sans-serif; line-height: 1.12; text-align: left; }
.rl * { box-sizing: border-box; }
.rl .txt { position: absolute; top: .08em; bottom: .08em; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.rl .txt.c { align-items: stretch; text-align: center; }
.rl .fit { display: block; white-space: nowrap; } /* not clipped: tall script letters reach above their line */
.rl .fit > span { display: inline-block; } /* measured (and watched for size changes) when fitting */
.rl .ad { font-family: 'Josefin Sans', Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.rl .scr { font-family: 'Great Vibes', 'Brush Script MT', cursive; line-height: 1.05; }
.rl .pin { font-family: 'Pinyon Script', 'Great Vibes', cursive; line-height: 1.1; }
.rl .pf { font-family: 'Playfair Display', Georgia, serif; }
.rl .cz { font-family: Cinzel, Georgia, serif; }
.rl .pac { font-family: Pacifico, 'Brush Script MT', cursive; line-height: 1.25; }
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

// ---------- more artwork: patriotic, spring, summer, fall, fun ----------
const RED = '#b91c1c';
const NAVY = '#1e3a8a';
const flag = () => {
  let stripes = '';
  for (let i = 0; i < 13; i++) stripes += `<rect y="${((i * 100) / 13).toFixed(2)}" width="70" height="${(100 / 13 + 0.05).toFixed(2)}" fill="${i % 2 ? '#fff' : RED}"/>`;
  let stars = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) stars += star(6.5 + c * 10.5, 6 + r * 10.4, 2.9);
  return `${stripes}<rect width="34" height="53.85" fill="${NAVY}"/><g fill="#fff">${stars}</g>`;
};
const buntingFan = () => {
  let pleats = '';
  for (let a = 15; a < 180; a += 15) {
    const r = (a * Math.PI) / 180;
    pleats += `<path d="M50 0L${(50 + 48 * Math.cos(r)).toFixed(1)} ${(48 * Math.sin(r)).toFixed(1)}"/>`;
  }
  return `<path d="M2 0A48 48 0 0 0 98 0Z" fill="${RED}"/><path d="M12 0A38 38 0 0 0 88 0Z" fill="#fff"/><path d="M24 0A26 26 0 0 0 76 0Z" fill="${NAVY}"/>
    <g stroke="rgba(0,0,0,.18)" stroke-width="1">${pleats}</g><g fill="#fff">${star(50, 10, 4.2)}${star(38, 6, 3)}${star(62, 6, 3)}</g>`;
};
const scatteredStars = () => [[12, 18, 7, '#fff'], [34, 10, 4, '#ef4444'], [52, 30, 5, '#fff'], [20, 46, 4.5, '#ef4444'], [44, 58, 7.5, '#fff'], [14, 76, 5, '#fff'], [36, 86, 4, '#ef4444'], [62, 80, 4, '#fff'], [64, 12, 3, '#fff']]
  .map(([x, y, r, c]) => `<g fill="${c}">${star(x, y, r)}</g>`).join('');

const tulip = (x, y, c, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M-10 0C-12-12-8-20-5-21L0-12 5-21C8-20 12-12 10 0C6 7-6 7-10 0Z" fill="${c}"/><path d="M0-12 5-21C8-20 12-12 10 0" fill="rgba(255,255,255,.18)"/></g>`;
const tulips = () => `<g fill="none" stroke="#3f8f3a" stroke-width="2.8" stroke-linecap="round"><path d="M50 98C46 78 34 60 28 44"/><path d="M50 98C50 74 50 52 50 36"/><path d="M50 98C55 78 66 62 72 48"/></g>
  <g fill="#5aa84f"><ellipse cx="38" cy="80" rx="6" ry="17" transform="rotate(-28 38 80)"/><ellipse cx="62" cy="82" rx="6" ry="16" transform="rotate(30 62 82)"/></g>
  ${tulip(28, 44, '#ec4899', -18)}${tulip(50, 36, '#facc15')}${tulip(72, 48, '#a855f7', 18)}`;

const blossom = (x, y, r, c = '#f9a8d4') => {
  let petals = '';
  for (let i = 0; i < 5; i++) petals += `<ellipse cx="0" cy="${-r * 0.55}" rx="${r * 0.42}" ry="${r * 0.55}" transform="rotate(${i * 72})"/>`;
  return `<g transform="translate(${x} ${y})"><g fill="${c}">${petals}</g><circle r="${r * 0.22}" fill="#fde68a"/></g>`;
};
const blossoms = () => `<g fill="none" stroke="#6b4226" stroke-width="3" stroke-linecap="round"><path d="M2 96C28 74 50 52 96 6"/><path d="M34 68C40 56 44 48 44 38"/><path d="M58 46C68 44 76 46 86 52"/></g>
  ${blossom(44, 34, 13)}${blossom(20, 80, 11, '#fbcfe8')}${blossom(86, 52, 11)}${blossom(70, 26, 10, '#fbcfe8')}${blossom(92, 8, 8)}${blossom(56, 60, 7, '#fbcfe8')}`;

const butterfly = () => `<g transform="translate(50 52)">
  <ellipse cx="-18" cy="-14" rx="18" ry="24" fill="#14b8a6" transform="rotate(-25 -18 -14)"/><ellipse cx="18" cy="-14" rx="18" ry="24" fill="#14b8a6" transform="rotate(25 18 -14)"/>
  <ellipse cx="-14" cy="16" rx="12" ry="16" fill="#f97316" transform="rotate(20 -14 16)"/><ellipse cx="14" cy="16" rx="12" ry="16" fill="#f97316" transform="rotate(-20 14 16)"/>
  <g fill="#fff" opacity=".85"><circle cx="-22" cy="-20" r="4"/><circle cx="22" cy="-20" r="4"/><circle cx="-14" cy="18" r="3"/><circle cx="14" cy="18" r="3"/></g>
  <ellipse rx="3.5" ry="22" fill="#1f2937"/><path d="M-2-20C-6-32-12-36-16-38M2-20C6-32 12-36 16-38" fill="none" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round"/></g>`;

const beach = () => `<rect width="80" height="100" fill="#bae6fd"/><circle cx="58" cy="24" r="13" fill="#fbbf24"/>
  <path d="M0 56Q10 50 20 56T40 56T60 56T80 56V78H0Z" fill="#0ea5e9"/><path d="M0 64Q10 58 20 64T40 64T60 64T80 64" fill="none" stroke="#e0f2fe" stroke-width="2"/>
  <path d="M0 78Q40 70 80 80V100H0Z" fill="#fde68a"/><path d="M18 34Q24 30 30 34M40 22Q45 19 50 22" fill="none" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/>`;

const sunflower = () => {
  let petals = '';
  for (let i = 0; i < 20; i++) petals += `<ellipse cx="0" cy="-30" rx="6.5" ry="16" fill="${i % 2 ? '#facc15' : '#eab308'}" transform="rotate(${i * 18})"/>`;
  let seeds = '';
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4;
    const r = 2.6 * Math.sqrt(i + 1);
    seeds += `<circle cx="${(r * Math.cos(a)).toFixed(1)}" cy="${(r * Math.sin(a)).toFixed(1)}" r="1.7"/>`;
  }
  return `<g transform="translate(50 50)">${petals}<circle r="17" fill="#78350f"/><g fill="#a16207">${seeds}</g></g>`;
};

const watermelon = () => {
  const seeds = [[34, 40, -20], [44, 48, -8], [56, 48, 8], [66, 40, 20], [50, 58, 0], [40, 36, -14], [60, 36, 14]]
    .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="3.4" transform="rotate(${r} ${x} ${y})"/>`).join('');
  return `<path d="M6 28A44 44 0 0 0 94 28Z" fill="#15803d"/><path d="M11 28A39 39 0 0 0 89 28Z" fill="#bbf7d0"/><path d="M15 28A35 35 0 0 0 85 28Z" fill="#f43f5e"/><g fill="#1f2937">${seeds}</g>`;
};

const leaf = (x, y, rot, c, k = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${k})"><path d="M0-17C11-9 11 9 0 17C-11 9-11-9 0-17Z" fill="${c}"/><path d="M0-15V20" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/></g>`;
const fallLeaves = () => leaf(26, 26, -30, '#ea580c', 1.2) + leaf(60, 22, 40, '#b91c1c') + leaf(44, 52, 10, '#ca8a04', 1.3) + leaf(20, 74, 60, '#b91c1c', 1.1) + leaf(64, 74, -50, '#ea580c', 1.15) + leaf(78, 46, 80, '#ca8a04', 0.8);

const pumpkin = () => `<path d="M50 34C49 26 52 20 58 16" fill="none" stroke="#78350f" stroke-width="4" stroke-linecap="round"/>
  <path d="M58 22C70 14 80 20 82 26C72 30 62 28 58 22Z" fill="#4d7c0f"/><path d="M46 34C38 26 30 28 30 22" fill="none" stroke="#4d7c0f" stroke-width="1.6"/>
  <ellipse cx="28" cy="62" rx="16" ry="26" fill="#c2410c"/><ellipse cx="72" cy="62" rx="16" ry="26" fill="#c2410c"/>
  <ellipse cx="38" cy="62" rx="16" ry="28" fill="#ea580c"/><ellipse cx="62" cy="62" rx="16" ry="28" fill="#ea580c"/>
  <ellipse cx="50" cy="62" rx="14" ry="29" fill="#f97316"/>`;

const CONFETTI = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
const confetti = () => {
  let bits = '';
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 262;
    const edge = i < 26;
    if (edge && x > 80) continue;
    const y = edge ? rnd() * 100 : (rnd() < 0.5 ? rnd() * 12 : 88 + rnd() * 12);
    const c = CONFETTI[i % CONFETTI.length];
    bits += i % 3 ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="7" height="3.4" rx="1" fill="${c}" transform="rotate(${Math.round(rnd() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${c}"/>`;
  }
  return bits;
};

const balloon = (x, y, c) => `<path d="M${x} ${y + 22}C${x - 4} ${y + 40} ${x + 6} ${y + 52} ${x - 2} ${y + 78}" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
  <ellipse cx="${x}" cy="${y}" rx="15" ry="19" fill="${c}"/><path d="M${x - 3} ${y + 21}h6l-3-4Z" fill="${c}"/>
  <ellipse cx="${x - 5}" cy="${y - 7}" rx="3.5" ry="6" fill="#fff" opacity=".45" transform="rotate(25 ${x - 5} ${y - 7})"/>`;
const balloons = () => balloon(30, 30, '#ef4444') + balloon(66, 24, '#3b82f6') + balloon(50, 44, '#facc15');

const rainbow = () => {
  const colors = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'];
  const arcs = colors.map((c, i) => {
    const r = 40 - i * 6;
    return `<path d="M${50 - r} 74A${r} ${r} 0 0 1 ${50 + r} 74" fill="none" stroke="${c}" stroke-width="6.2"/>`;
  }).join('');
  const cloud = (x) => `<g fill="#fff"><circle cx="${x - 7}" cy="76" r="7"/><circle cx="${x + 2}" cy="72" r="9"/><circle cx="${x + 10}" cy="77" r="6"/><rect x="${x - 14}" y="76" width="30" height="7" rx="3.5"/></g>`;
  return `${arcs}${cloud(12)}${cloud(84)}`;
};

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

  // ---------- Patriotic ----------
  {
    id: 'flag', name: 'Stars & stripes', group: 'Patriotic',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 70 100" preserveAspectRatio="none" style="left:0;top:0;width:.7em;height:1em" aria-hidden="true">${flag()}</svg>
      <div class="txt" style="left:.82em;right:.08em">${line(name, 0.3, 'scr', `color:${NAVY}`)}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'bunting', name: 'Bunting', group: 'Patriotic',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 100 50" style="left:.79em;top:0;width:1.05em;height:.27em" aria-hidden="true">${buntingFan()}</svg>
      <div class="txt c" style="left:.12em;right:.12em;top:.27em;bottom:.07em">${line(name, 0.17, 'cz', `font-weight:600;color:${NAVY}`)}${addressBlock(address, 0.1, 'ad', `color:${RED}`)}</div></div>`,
  },
  {
    id: 'starspangled', name: 'Star-spangled', group: 'Patriotic',
    render: ({ name, address }) => `<div class="rl" style="background:${NAVY}">
      <svg viewBox="0 0 75 100" style="left:.03em;top:0;width:.75em;height:1em" aria-hidden="true">${scatteredStars()}</svg>
      <div style="position:absolute;left:0;right:0;bottom:0;height:.08em;background:repeating-linear-gradient(90deg,${RED} 0 .08em,#fff .08em .16em)"></div>
      <div class="txt" style="left:.8em;right:.08em;bottom:.12em">${line(name, 0.3, 'scr', 'color:#fff')}${addressBlock(address, 0.1, 'ad', 'color:#dbeafe')}</div></div>`,
  },
  {
    id: 'americana', name: 'Americana', group: 'Patriotic',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;right:0;top:0;height:.15em;background:${NAVY}"></div>
      <svg viewBox="0 0 262 15" style="left:0;top:0;width:2.625em;height:.15em" aria-hidden="true"><g fill="#fff">${Array.from({ length: 13 }, (_, i) => star(11 + i * 20, 7.5, 4.2)).join('')}</g></svg>
      <div style="position:absolute;left:0;right:0;bottom:0;height:.14em;background:repeating-linear-gradient(180deg,${RED} 0 .028em,#fff .028em .056em)"></div>
      <div class="txt c" style="left:.12em;right:.12em;top:.17em;bottom:.16em">${line(name.toUpperCase(), 0.17, 'cz', `font-weight:600;color:${NAVY}`)}${addressBlock(address, 0.1, 'ad', `color:${RED}`)}</div></div>`,
  },
  // ---------- Spring ----------
  {
    id: 'tulips', name: 'Tulips', group: 'Spring',
    render: ({ name, address }) => `<div class="rl" style="background:#fdf2f8">
      <svg viewBox="0 0 100 100" style="left:.02em;top:.02em;width:.86em;height:.96em" aria-hidden="true">${tulips()}</svg>
      <div class="txt" style="left:.9em;right:.08em">${line(name, 0.3, 'scr', 'color:#be185d')}${addressBlock(address, 0.1, 'ad', 'color:#4b5563')}</div></div>`,
  },
  {
    id: 'blossoms', name: 'Cherry blossoms', group: 'Spring',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 100 100" style="left:0;top:0;width:1em;height:1em" aria-hidden="true">${blossoms()}</svg>
      <div class="txt" style="left:1em;right:.08em">${line(name, 0.3, 'scr', 'color:#9d174d')}${addressBlock(address, 0.1, 'ad', 'color:#57534e')}</div></div>`,
  },
  {
    id: 'butterfly', name: 'Butterfly', group: 'Spring',
    render: ({ name, address }) => `<div class="rl" style="background:#f0fdfa">
      <svg viewBox="0 0 100 100" style="left:.04em;top:.06em;width:.84em;height:.88em" aria-hidden="true">${butterfly()}</svg>
      <div class="txt" style="left:.92em;right:.08em">${line(name, 0.3, 'scr', 'color:#0f766e')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  // ---------- Summer ----------
  {
    id: 'beach', name: 'Beach', group: 'Summer',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 80 100" preserveAspectRatio="none" style="left:0;top:0;width:.8em;height:1em" aria-hidden="true">${beach()}</svg>
      <div class="txt" style="left:.92em;right:.08em">${line(name, 0.3, 'scr', 'color:#0e7490')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'sunflower', name: 'Sunflower', group: 'Summer',
    render: ({ name, address }) => `<div class="rl" style="background:#fffbeb">
      <svg viewBox="0 0 100 100" style="left:.04em;top:.05em;width:.9em;height:.9em" aria-hidden="true">${sunflower()}</svg>
      <div class="txt" style="left:1em;right:.08em">${line(name, 0.3, 'scr', 'color:#92400e')}${addressBlock(address, 0.1, 'ad', 'color:#57534e')}</div></div>`,
  },
  {
    id: 'watermelon', name: 'Watermelon', group: 'Summer',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.84em;background:#ecfdf5"></div>
      <svg viewBox="0 0 100 80" style="left:.04em;top:.18em;width:.76em;height:.6em" aria-hidden="true">${watermelon()}</svg>
      <div class="txt" style="left:.96em;right:.08em">${line(name, 0.3, 'scr', 'color:#be123c')}${addressBlock(address, 0.1, 'ad', 'color:#166534')}</div></div>`,
  },
  // ---------- Fall ----------
  {
    id: 'leaves', name: 'Autumn leaves', group: 'Fall',
    render: ({ name, address }) => `<div class="rl" style="background:#fff7ed">
      <svg viewBox="0 0 100 100" style="left:0;top:0;width:.92em;height:1em" aria-hidden="true">${fallLeaves()}</svg>
      <div class="txt" style="left:.94em;right:.08em">${line(name, 0.3, 'scr', 'color:#9a3412')}${addressBlock(address, 0.1, 'ad', 'color:#57534e')}</div></div>`,
  },
  {
    id: 'pumpkin', name: 'Pumpkin', group: 'Fall',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 100 100" style="left:.05em;top:.04em;width:.86em;height:.92em" aria-hidden="true">${pumpkin()}</svg>
      <div class="txt" style="left:.96em;right:.08em">${line(name, 0.3, 'scr', 'color:#c2410c')}${addressBlock(address, 0.1, 'ad', 'color:#57534e')}</div></div>`,
  },
  {
    id: 'flannel', name: 'Flannel', group: 'Fall',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.62em;background:repeating-linear-gradient(0deg,rgba(17,17,17,.55) 0 .1em,transparent .1em .2em),repeating-linear-gradient(90deg,rgba(17,17,17,.55) 0 .1em,transparent .1em .2em),#b91c1c"></div>
      <div class="txt" style="left:.74em;right:.08em">${line(name, 0.3, 'scr', 'color:#7f1d1d')}${addressBlock(address, 0.1, 'ad', 'color:#292524')}</div></div>`,
  },
  // ---------- Fun ----------
  {
    id: 'confetti', name: 'Confetti', group: 'Fun',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 262 100" style="left:0;top:0;width:2.625em;height:1em" aria-hidden="true">${confetti()}</svg>
      <div class="txt" style="left:.86em;right:.08em">${line(name, 0.22, 'pac', 'color:#7c3aed')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'balloons', name: 'Balloons', group: 'Fun',
    render: ({ name, address }) => `<div class="rl">
      <svg viewBox="0 0 100 100" style="left:.04em;top:.04em;width:.84em;height:.94em" aria-hidden="true">${balloons()}</svg>
      <div class="txt" style="left:.9em;right:.08em">${line(name, 0.22, 'pac', 'color:#db2777')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
  {
    id: 'rainbow', name: 'Rainbow', group: 'Fun',
    render: ({ name, address }) => `<div class="rl">
      <div style="position:absolute;left:0;top:0;bottom:0;width:.9em;background:#e0f2fe"></div>
      <svg viewBox="0 0 100 100" style="left:.02em;top:.02em;width:.86em;height:.96em" aria-hidden="true">${rainbow()}</svg>
      <div class="txt" style="left:1em;right:.08em">${line(name, 0.22, 'pac', 'color:#2563eb')}${addressBlock(address, 0.1, 'ad', 'color:#374151')}</div></div>`,
  },
];

/** The themes, in the order the Styles list shows them. */
export const LABEL_THEMES = ['Everyday', 'Holiday', 'Patriotic', 'Spring', 'Summer', 'Fall', 'Fun'];

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
