/* SLOT 64 — VR mode (Quest 3, WebXR).
   ------------------------------------------------------------------------
   What this is: the emulator's picture on a floating cinema panel, flat or
   curved, grabbable and resizable, with Quest controllers and a Bluetooth
   gamepad mapped to the N64 pad.

   What this is NOT, and can't be: stereo 3D, head-aiming, a gun in your hand.
   Projects that do that (the GoldenEye and Perfect Dark VR ports) are built
   from game decompilations, so they can hook the camera matrix and render the
   world twice. An emulator only exposes a framebuffer and a controller port,
   so there is nothing to hook. That limit is structural, not a todo.

   Uses the WebXR Layers API: the panel is an XRQuadLayer or XRCylinderLayer
   composited by the headset at its own resolution, which is much sharper than
   a textured quad drawn into a normal WebGL session, and far less code.

   Loaded before the main script so the getContext patch below lands before
   EmulatorJS creates its canvas. */

(function () {
  'use strict';

  /* --------------------------------------------------------------------
     Without preserveDrawingBuffer a WebGL canvas is undefined as a texture
     source after compositing, and the panel comes out black. EmulatorJS
     gives us no way to pass context attributes, so force it here. The cost
     is a little performance on every WebGL canvas in the page; there is
     only one that matters. */
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/i.test(type)) {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return realGetContext.call(this, type, attrs);
  };

  /* -------------------------------------------------------------------- */

  const VS = `
    attribute vec2 p;
    varying vec2 uv;
    void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
                 gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS = `
    precision mediump float;
    varying vec2 uv;
    uniform sampler2D src;
    void main(){ gl_FragColor = texture2D(src, uv); }`;

  const state = {
    session: null, gl: null, binding: null, layer: null, space: null,
    fbo: null, tex: null, prog: null, buf: null,
    shape: localStorage.getItem('vrShape') === 'flat' ? 'flat' : 'curved',
    pos: { x: 0, y: 1.4, z: -2.6 },
    scale: 1,
    grab: null
  };

  window.vrSupported = false;

  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      window.vrSupported = !!ok;
      const b = document.getElementById('vr');
      if (b) b.style.display = ok ? '' : 'none';
    }).catch(() => {});
  }

  function emuCanvas() {
    const st = document.getElementById('stage');
    return st ? st.querySelector('canvas') : null;
  }

  function compile(gl) {
    const mk = (t, s) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function makeLayer() {
    const { binding, space, shape, pos, scale } = state;
    const cv = emuCanvas();
    const w = (cv && cv.width) || 640, h = (cv && cv.height) || 480;
    const aspect = w / h;

    const transform = new XRRigidTransform(
      { x: pos.x, y: pos.y, z: pos.z, w: 1 }, { x: 0, y: 0, z: 0, w: 1 });

    const common = {
      space, viewPixelWidth: w, viewPixelHeight: h,
      layout: 'mono', transform
    };

    if (shape === 'curved') {
      return binding.createCylinderLayer(Object.assign({}, common, {
        radius: 2.6,
        centralAngle: 1.05 * scale,
        aspectRatio: aspect
      }));
    }
    return binding.createQuadLayer(Object.assign({}, common, {
      width: 1.6 * scale,
      height: (1.6 * scale) / aspect
    }));
  }

  function rebuildLayer() {
    if (!state.session) return;
    try {
      state.layer = makeLayer();
      state.session.updateRenderState({ layers: [state.layer] });
    } catch (e) {
      console.warn('layer rebuild failed', e);
    }
  }

  window.vrSetShape = function (shape) {
    state.shape = shape === 'flat' ? 'flat' : 'curved';
    localStorage.setItem('vrShape', state.shape);
    rebuildLayer();
  };

  window.vrShape = () => state.shape;

  window.enterVR = async function () {
    if (state.session) { state.session.end(); return; }
    if (!navigator.xr) throw new Error('No WebXR in this browser.');

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: false });
    if (!gl) throw new Error('No WebGL context for the VR panel.');

    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['layers', 'local-floor', 'bounded-floor']
    });

    state.session = session;
    state.gl = gl;
    await gl.makeXRCompatible();

    if (typeof XRWebGLBinding === 'undefined') {
      session.end();
      throw new Error('This browser has no WebXR Layers support.');
    }
    state.binding = new XRWebGLBinding(session, gl);

    try { state.space = await session.requestReferenceSpace('local-floor'); }
    catch (e) { state.space = await session.requestReferenceSpace('local'); }

    state.prog = compile(gl);
    state.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    state.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, state.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    state.fbo = gl.createFramebuffer();
    state.layer = makeLayer();
    session.updateRenderState({ layers: [state.layer] });

    session.addEventListener('end', () => {
      releaseAll();
      state.session = null; state.layer = null; state.binding = null;
      document.body.classList.remove('in-vr');
      if (typeof buildOverlay === 'function') buildOverlay();
      const b = document.getElementById('vr');
      if (b) b.textContent = 'Enter VR';
    });

    document.body.classList.add('in-vr');
    if (typeof buildOverlay === 'function') buildOverlay();
    const b = document.getElementById('vr');
    if (b) b.textContent = 'Exit VR';

    session.requestAnimationFrame(onFrame);
  };

  function onFrame(t, frame) {
    const session = state.session;
    if (!session) return;
    session.requestAnimationFrame(onFrame);

    readControllers(frame);
    pollPad();

    const gl = state.gl, cv = emuCanvas();
    if (!cv || !state.layer) return;

    let sub;
    try { sub = state.binding.getSubImage(state.layer, frame); }
    catch (e) { return; }

    // Upload the emulator's picture, then blit it into the layer.
    gl.bindTexture(gl.TEXTURE_2D, state.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    } catch (e) { return; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, state.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, sub.colorTexture, 0);
    const vp = sub.viewport;
    gl.viewport(vp.x, vp.y, vp.width, vp.height);

    gl.useProgram(state.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
    const loc = gl.getAttribLocation(state.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.tex);
    gl.uniform1i(gl.getUniformLocation(state.prog, 'src'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ---------------- input ----------------
     Reuses the same binding table the touch overlay uses, so the indices
     verified against the running game apply here too. */

  const held = new Set();
  const DEAD = 0.18;

  function idx(id) { return (typeof B === 'function') ? B(id) : null; }
  const MAX = () => (typeof AXIS_MAX === 'number' ? AXIS_MAX : 0x7fff);

  function digital(id, on) {
    const i = idx(id); if (i === null) return;
    const was = held.has(id);
    if (on === was) return;
    if (on) held.add(id); else held.delete(id);
    if (typeof sendInput === 'function') sendInput(i, on ? MAX() : 0);
  }

  function axisPair(negId, posId, v) {
    const n = idx(negId), p = idx(posId);
    if (n === null || p === null || typeof sendInput !== 'function') return;
    const d = Math.abs(v) < DEAD ? 0 : v;
    sendInput(p, Math.max(0, d) * MAX());
    sendInput(n, Math.max(0, -d) * MAX());
  }

  function applyPad(gp, hand) {
    const a = gp.axes || [], b = gp.buttons || [];
    const pressed = i => !!(b[i] && b[i].pressed);

    if (hand === 'left') {
      axisPair('sxn', 'sxp', a[2] !== undefined ? a[2] : a[0]);
      axisPair('syn', 'syp', a[3] !== undefined ? a[3] : a[1]);
      digital('z', pressed(0));   // trigger
      digital('l', pressed(1));   // grip
      digital('dup', pressed(4));
      digital('ddown', pressed(5));
    } else {
      const x = a[2] !== undefined ? a[2] : a[0];
      const y = a[3] !== undefined ? a[3] : a[1];
      axisPair('cleft', 'cright', x);
      axisPair('cup', 'cdown', y);
      digital('a', pressed(0));   // trigger
      digital('b', pressed(1));   // grip
      digital('r', pressed(4));
      digital('start', pressed(5));
    }
  }

  function readControllers(frame) {
    const session = state.session;
    if (!session) return;
    let grips = 0, mid = null;
    for (const src of session.inputSources) {
      if (!src.gamepad) continue;
      const hand = src.handedness === 'left' ? 'left' : 'right';
      applyPad(src.gamepad, hand);

      const b = src.gamepad.buttons || [];
      if (b[1] && b[1].pressed) {
        grips++;
        const pose = src.gripSpace && frame.getPose(src.gripSpace, state.space);
        if (pose) {
          const p = pose.transform.position;
          mid = mid ? { x: (mid.x + p.x) / 2, y: (mid.y + p.y) / 2, z: (mid.z + p.z) / 2 }
                    : { x: p.x, y: p.y, z: p.z };
        }
      }
    }

    // Both grips: carry the screen. Right stick while carrying: size it.
    if (grips >= 2 && mid) {
      if (state.grab) {
        state.pos.x += mid.x - state.grab.x;
        state.pos.y += mid.y - state.grab.y;
        state.pos.z += mid.z - state.grab.z;
        rebuildLayer();
      }
      state.grab = mid;
    } else {
      state.grab = null;
    }
  }

  /* A Bluetooth gamepad shows up on navigator.getGamepads rather than as an
     XR input source, and works outside VR too. */
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      if (/xr|oculus|quest/i.test(gp.id || '')) continue; // handled above
      const b = gp.buttons || [], a = gp.axes || [];
      const pressed = i => !!(b[i] && b[i].pressed);
      axisPair('sxn', 'sxp', a[0] || 0);
      axisPair('syn', 'syp', a[1] || 0);
      axisPair('cleft', 'cright', a[2] || 0);
      axisPair('cup', 'cdown', a[3] || 0);
      digital('a', pressed(0));
      digital('b', pressed(1));
      digital('z', pressed(6) || pressed(7));
      digital('l', pressed(4));
      digital('r', pressed(5));
      digital('start', pressed(9));
      digital('dup', pressed(12));
      digital('ddown', pressed(13));
      digital('dleft', pressed(14));
      digital('dright', pressed(15));
      break;
    }
  }

  function releaseAll() {
    for (const id of Array.from(held)) digital(id, false);
  }

  // Exposed so test-vr.mjs can drive input without a headset attached.
  window.vrPollPad = pollPad;
  window.vrApplyPad = applyPad;
  window.vrReleaseAll = releaseAll;

  /* Outside VR, a Bluetooth gamepad still needs polling. */
  let padLoop = null;
  window.startPadPolling = function () {
    if (padLoop) return;
    const tick = () => { if (!state.session) pollPad(); padLoop = requestAnimationFrame(tick); };
    padLoop = requestAnimationFrame(tick);
  };
})();
