const { padLayout, padCollisions, padOutOfBounds } = require('./layout.js');

const LANDSCAPE = [
  [667, 375], [736, 414], [812, 375], [844, 390], [852, 393],
  [896, 414], [926, 428], [932, 430], [956, 440],
  [568, 320], [1024, 768], [1180, 820], [1366, 1024],
  [740, 360], [640, 360], [1000, 400], [900, 340], [520, 300]
];

// Should be refused outright, not rendered badly.
const REJECT = [[375, 812], [390, 844], [430, 932], [320, 568], [480, 280], [400, 900]];

let fail = 0, checks = 0;
const assert = (c, m) => { checks++; if (!c) { fail++; console.log('  FAIL ' + m); } };

const INSETS = [0, 44, 60];
for (const [W, H] of LANDSCAPE) for (const inset of INSETS) {
  const items = padLayout(W, H, inset);
  if (H - inset < 300) { assert(items === null, `${W}x${H}+${inset} should refuse`); continue; }
  assert(items !== null, `${W}x${H}+${inset} refused a valid landscape viewport`);
  if (!items) continue;

  // nothing may intrude on the reserved strip at the top
  const intruders = items.filter(p => p.y - (p.h || p.r * 2) / 2 < inset).map(p => p.id);
  assert(intruders.length === 0, `${W}x${H}+${inset} inside top inset: ${intruders.join(', ')}`);
  const hits = padCollisions(items);
  const oob = padOutOfBounds(items, W, H);
  assert(hits.length === 0, `${W}x${H}+${inset} overlap: ${hits.join(', ')}`);
  assert(oob.length === 0, `${W}x${H} off-screen: ${oob.join(', ')}`);
  assert(items.length === 12, `${W}x${H} expected 12 controls, got ${items.length}`);
  assert(items.every(p => p.r >= 15), `${W}x${H} touch target too small`);

  const left = items.filter(p => ['stick', 'dpad', 'l'].includes(p.id));
  assert(left.every(p => p.x < W / 2), `${W}x${H} left cluster crossed centre`);
  const right = items.filter(p => ['a', 'b', 'cup', 'cdown', 'r', 'z'].includes(p.id));
  assert(right.every(p => p.x > W / 2), `${W}x${H} right cluster crossed centre`);

  // shoulders must actually be large now
  const pill = items.find(p => p.id === 'l');
  assert(pill.w >= 78 && pill.h >= 36, `${W}x${H} shoulder pill too small: ${pill.w}x${pill.h}`);

  // D-pad must sit directly above the stick
  const dp = items.find(p => p.id === 'dpad'), sk = items.find(p => p.id === 'stick');
  assert(Math.abs(dp.x - sk.x) < 4, `${W}x${H}+${inset} d-pad not aligned over stick`);
  assert(dp.y + dp.r < sk.y - sk.r, `${W}x${H}+${inset} d-pad not above stick`);

  // Z must sit directly above B, not beside it or below it
  const z = items.find(p => p.id === 'z'), bb = items.find(p => p.id === 'b');
  assert(Math.abs(z.x - bb.x) < 4, `${W}x${H} Z not aligned over B`);
  assert(z.y + z.h / 2 < bb.y - bb.r, `${W}x${H} Z not above B`);
  assert(bb.y - bb.r - (z.y + z.h / 2) < 40, `${W}x${H} Z drifted too far from B`);
}

for (const [W, H] of REJECT) {
  assert(padLayout(W, H) === null, `${W}x${H} should have been refused`);
}

console.log(`\n${checks - fail}/${checks} assertions passed`);
process.exit(fail ? 1 : 0);
