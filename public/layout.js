/* Shared geometry for the GameCube-style touch overlay.
   Everything is treated as a circle (pills use their half-diagonal) so overlap
   is a single distance check. Exported for the headless harness in
   test-layout.js — change numbers here, then re-run `node test-layout.js`.

   Landscape only. padLayout returns null when the viewport is too narrow or
   too short to hold the controls; the caller shows a rotate prompt instead of
   rendering something broken. */

const MIN_W = 520, MIN_H = 300;

function padLayout(W, H, insetTop = 0) {
  if (W < MIN_W || H - insetTop < MIN_H || W < H) return null;

  // Scale against the usable height, not the raw viewport — a tall status bar
  // plus toolbar eats enough room that the right-hand stack (A, B, Z, R) would
  // otherwise collide on shorter screens.
  const s = Math.min(1, Math.max(0.62, Math.min(W / 840, (H - insetTop) / 390)));
  const r = n => Math.round(n * s);

  const stickR = r(58), dpadR = Math.round(r(40) * 1.2), aR = r(42), bR = r(32);
  const cR = Math.max(16, r(21));

  // shoulders: roughly double the previous 64x34
  const pillW = r(128), pillH = r(60);
  const pillR = Math.hypot(pillW, pillH) / 2;

  const startW = r(88), startH = r(34);
  const startR = Math.hypot(startW, startH) / 2;

  const edge = r(16);
  const bottom = H - r(20);
  // insetTop clears the phone's status bar and the in-game toolbar
  const top = insetTop + edge + pillH / 2;

  // ---- top edge: L and R only. Z sits above B on the right (see below).
  const l  = { id: 'l', x: edge + pillW / 2,     y: top, r: pillR, w: pillW, h: pillH };
  const rr = { id: 'r', x: W - edge - pillW / 2, y: top, r: pillR, w: pillW, h: pillH };

  // ---- left half: stick at the bottom, d-pad stacked directly above it
  const stick = { id: 'stick', x: edge + stickR + r(22), y: bottom - stickR - r(16), r: stickR };
  const dpad  = { id: 'dpad',  x: stick.x, y: stick.y - stickR - dpadR - r(14), r: dpadR };

  // ---- right half: A anchored bottom-right, B above-left, C diamond further left
  const a = { id: 'a', x: W - edge - aR - r(24), y: bottom - aR - r(10), r: aR };
  const b = { id: 'b', x: a.x - r(20), y: a.y - aR - bR - r(16), r: bR };
  const z = { id: 'z', x: b.x, y: b.y - bR - pillH / 2 - r(14), r: pillR, w: pillW, h: pillH };

  const cGap = cR * 2 + r(12);
  const cx = a.x - aR - (cGap + cR) - r(30);
  const cy = bottom - (cGap + cR) - r(14);
  const c = [
    { id: 'cup',    x: cx,        y: cy - cGap, r: cR },
    { id: 'cleft',  x: cx - cGap, y: cy,        r: cR },
    { id: 'cright', x: cx + cGap, y: cy,        r: cR },
    { id: 'cdown',  x: cx,        y: cy + cGap, r: cR }
  ];

  const start = { id: 'start', x: W / 2, y: bottom - startH / 2, r: startR, w: startW, h: startH };

  return [stick, dpad, a, b, ...c, l, z, rr, start];
}

/* Box overlap. Circles use their bounding square, which is slightly
   conservative at the corners — that errs toward more spacing, not less.
   Distance radii were wrong for the wide shoulder pills: two rectangles
   sitting side by side read as overlapping on half-diagonals alone. */
function box(p) {
  const hw = (p.w || p.r * 2) / 2, hh = (p.h || p.r * 2) / 2;
  return { l: p.x - hw, r: p.x + hw, t: p.y - hh, b: p.y + hh };
}

function padCollisions(items, pad = 6) {
  const hits = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const p = box(items[i]), q = box(items[j]);
      const gx = Math.max(q.l - p.r, p.l - q.r);
      const gy = Math.max(q.t - p.b, p.t - q.b);
      const gap = Math.max(gx, gy);
      if (gap < pad) hits.push(`${items[i].id}/${items[j].id} gap=${Math.round(gap)}`);
    }
  }
  return hits;
}

function padOutOfBounds(items, W, H) {
  return items.filter(p => {
    const hw = (p.w || p.r * 2) / 2, hh = (p.h || p.r * 2) / 2;
    return p.x - hw < 0 || p.x + hw > W || p.y - hh < 0 || p.y + hh > H;
  }).map(p => p.id);
}

if (typeof module !== 'undefined')
  module.exports = { padLayout, padCollisions, padOutOfBounds, MIN_W, MIN_H };
