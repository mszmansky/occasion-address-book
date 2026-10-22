// Calligraphy-style divider lines for designs, drawn on a canvas in the chosen color and saved as a
// PNG picture (mail apps can't draw these themselves). Strokes are laid down with a round "brush"
// whose width changes along the curve, which gives the thick-and-thin look of a pen.

export const FLOURISHES = [
  { key: 'scroll', label: 'Scroll flourish' },
  { key: 'swash', label: 'Swash flourish' },
  { key: 'fleuron', label: 'Fleuron flourish' },
  { key: 'vine', label: 'Vine flourish' },
];
export const flourishByLabel = (alt) => FLOURISHES.find((f) => f.label === alt) ?? null;

const W = 1200;
const H = 150;
const MID = H / 2;

const bez = (p0, p1, p2, p3) => (t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

// Lays a brush along point(t), t from 0 to 1, with width(t) in pixels.
function brush(ctx, point, width, steps = 600) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = point(t);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, width(t) / 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

// A curl that winds inward from angle a0, radius r0, around (cx, cy).
const spiral = (cx, cy, r0, a0, turns, dir = 1) => (t) => {
  const a = a0 + dir * t * turns * Math.PI * 2;
  const r = r0 * (1 - 0.82 * t);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

const taper = (max, min = 1.2) => (t) => min + (max - min) * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

function mirrored(ctx, draw) {
  draw();
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}

const DRAW = {
  scroll(ctx) {
    mirrored(ctx, () => {
      // From the center out: a long wave, then a curl at the end.
      brush(ctx, bez([585, MID], [470, MID - 34], [330, MID + 40], [188, MID + 12]), taper(9, 1.6));
      brush(ctx, spiral(162, MID - 16, 30, Math.PI * 0.45, 1.15, 1), (t) => 3.4 * (1 - t) + 1.1);
      // A small inner curl near the center.
      brush(ctx, bez([560, MID + 4], [520, MID + 30], [470, MID + 26], [462, MID + 8]), taper(4, 1));
    });
    ctx.beginPath();
    ctx.moveTo(W / 2, MID - 14); ctx.lineTo(W / 2 + 12, MID); ctx.lineTo(W / 2, MID + 14); ctx.lineTo(W / 2 - 12, MID);
    ctx.closePath(); ctx.fill();
  },
  swash(ctx) {
    // One sweeping pen stroke, thin-thick-thin, finishing in a loop.
    brush(ctx, bez([70, MID + 18], [380, MID - 70], [760, MID + 70], [1060, MID - 6]), (t) => 1.4 + 11 * Math.sin(Math.PI * t) ** 1.5);
    brush(ctx, spiral(1090, MID - 22, 26, Math.PI * 0.75, 0.9, -1), (t) => 2.6 * (1 - t) + 1);
    brush(ctx, bez([110, MID + 30], [150, MID + 46], [240, MID + 40], [300, MID + 22]), taper(3, 0.8));
  },
  fleuron(ctx) {
    mirrored(ctx, () => {
      brush(ctx, (t) => [90 + t * 440, MID], (t) => 0.8 + 5.4 * t ** 1.6);
      ctx.beginPath(); ctx.arc(76, MID, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.font = '76px "Apple Symbols", "Segoe UI Symbol", "DejaVu Sans", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❦', W / 2, MID + 4);
  },
  vine(ctx) {
    const wave = (t) => [60 + t * (W - 120), MID + 16 * Math.sin(t * Math.PI * 6)];
    brush(ctx, wave, (t) => 1.4 + 2.6 * Math.sin(Math.PI * t), 900);
    // Leaves on alternating sides at the crests.
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const [x, y] = wave(t);
      const up = i % 2 ? -1 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(up * -0.6);
      ctx.beginPath();
      ctx.ellipse(0, up * 13, 6, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
};

/** Draws a flourish in a color; resolves to a PNG blob (1200 × 150, shown at any width). */
export function drawFlourish(key, color) {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  (DRAW[key] ?? DRAW.scroll)(ctx);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the line'))), 'image/png'));
}
