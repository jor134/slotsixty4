/* Drives vr.js input mapping with fake gamepads — no headset needed.
   Checks Quest controllers and a Bluetooth pad land on the right N64
   indices, that the stick is analog, and that buttons release. */
import fs from 'fs';

const BIND = { a:0, b:1, z:12, l:10, r:11, start:3, cup:23, cdown:22,
  cleft:21, cright:20, dup:4, ddown:5, dleft:6, dright:7,
  sxp:16, sxn:17, syp:18, syn:19 };

const sent = [];
globalThis.window = globalThis;
globalThis.B = id => BIND[id];
globalThis.AXIS_MAX = 0x7fff;
globalThis.sendInput = (i, v) => sent.push([i, Math.round(v)]);
globalThis.HTMLCanvasElement = function () {};
HTMLCanvasElement.prototype = { getContext() { return null; } };
globalThis.document = {
  getElementById: () => null, querySelector: () => null,
  body: { classList: { add(){}, remove(){}, contains: () => false } }
};
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = { getItem: () => null, setItem(){} };
let pads = [];
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => pads }, configurable: true, writable: true
});

new Function(fs.readFileSync('public/vr.js', 'utf8'))();

const mkPad = (down, axes, id = 'Generic BT Pad') => ({
  connected: true, id,
  buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: down.includes(i) })),
  axes
});

let fail = 0, n = 0;
const check = (c, m) => { n++; if (!c) { fail++; console.log('  FAIL ' + m); } };
const last = i => { const h = sent.filter(s => s[0] === i); return h.length ? h[h.length - 1][1] : null; };
const reset = () => { sent.length = 0; window.vrReleaseAll(); sent.length = 0; };

// --- bluetooth pad: face buttons
reset();
pads = [mkPad([0], [0,0,0,0])];
window.vrPollPad();
check(last(BIND.a) === 0x7fff, 'BT button 0 -> N64 A');
pads = [mkPad([], [0,0,0,0])];
window.vrPollPad();
check(last(BIND.a) === 0, 'N64 A released');

reset();
pads = [mkPad([1, 6, 4, 5, 9], [0,0,0,0])];
window.vrPollPad();
check(last(BIND.b) === 0x7fff, 'B mapped');
check(last(BIND.z) === 0x7fff, 'Z mapped from trigger');
check(last(BIND.l) === 0x7fff, 'L mapped');
check(last(BIND.r) === 0x7fff, 'R mapped');
check(last(BIND.start) === 0x7fff, 'Start mapped');

// --- d-pad
reset();
pads = [mkPad([12, 15], [0,0,0,0])];
window.vrPollPad();
check(last(BIND.dup) === 0x7fff, 'd-pad up');
check(last(BIND.dright) === 0x7fff, 'd-pad right');

// --- analog stick is actually analog, not on/off
reset();
pads = [mkPad([], [0.5, -1, 0, 0])];
window.vrPollPad();
const half = last(BIND.sxp);
check(half > 0x3000 && half < 0x5000, 'half deflection is analog, got ' + half);
check(last(BIND.syn) === 0x7fff, 'full up deflection');
check(last(BIND.sxn) === 0, 'opposite axis zeroed');

// --- deadzone
reset();
pads = [mkPad([], [0.1, 0.1, 0, 0])];
window.vrPollPad();
check(last(BIND.sxp) === 0 && last(BIND.syp) === 0, 'deadzone suppresses drift');

// --- C buttons from the right stick
reset();
pads = [mkPad([], [0, 0, -1, 1])];
window.vrPollPad();
check(last(BIND.cleft) === 0x7fff, 'right stick left -> C left');
check(last(BIND.cdown) === 0x7fff, 'right stick down -> C down');

// --- quest controllers
reset();
window.vrApplyPad(mkPad([0, 1], [0, 0, 0, 0], 'oculus-touch'), 'right');
check(last(BIND.a) === 0x7fff, 'right trigger -> A');
check(last(BIND.b) === 0x7fff, 'right grip -> B');

reset();
window.vrApplyPad(mkPad([0, 1], [0, 0, 0, 0], 'oculus-touch'), 'left');
check(last(BIND.z) === 0x7fff, 'left trigger -> Z');
check(last(BIND.l) === 0x7fff, 'left grip -> L');

reset();
window.vrApplyPad(mkPad([], [0, 0, 0.8, 0], 'oculus-touch'), 'left');
const lx = last(BIND.sxp);
check(lx > 0x5000 && lx < 0x7fff, 'left thumbstick drives the analog stick, got ' + lx);

// --- quest controllers are skipped by the bluetooth path
reset();
pads = [mkPad([0], [0,0,0,0], 'oculus-touch-v3')];
window.vrPollPad();
check(last(BIND.a) === null, 'XR controllers not double-handled as BT pads');

// --- nothing stuck after release
reset();
pads = [mkPad([0, 1, 4, 5], [1, 1, 1, 1])];
window.vrPollPad();
sent.length = 0;
window.vrReleaseAll();
const stuck = sent.filter(s => s[1] !== 0);
check(stuck.length === 0, 'all buttons released, stuck: ' + JSON.stringify(stuck));

console.log(`\n${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
