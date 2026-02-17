const fs = require('fs');
const path = require('path');

require(path.join(__dirname, 'pngremix-decoder.js'));

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function summarize(filePath) {
  const buf = fs.readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dec = globalThis.PngRemixDecoder.decode(ab);
  const s = dec.settings_dict || {};

  let stateCount = 0;
  let oneShot = 0;
  let shouldReset = 0;
  let shouldResetState = 0;
  let ignoreBounce = 0;
  let frameAnim = 0;

  for (const sp of (dec.sprites_array || [])) {
    const sts = Array.isArray(sp && sp.states) ? sp.states : [];
    stateCount = Math.max(stateCount, sts.length);
    for (const st of sts) {
      if (!st || typeof st !== 'object') continue;
      if (st.one_shot) oneShot += 1;
      if (st.should_reset) shouldReset += 1;
      if (st.should_reset_state) shouldResetState += 1;
      if (st.ignore_bounce) ignoreBounce += 1;

      const hf = Math.max(1, Math.floor(num(st.hframes) || 1));
      const vf = Math.max(1, Math.floor(num(st.vframes) || 1));
      const total = hf * vf;
      if (total > 1 && !st.non_animated_sheet && num(st.animation_speed) > 0) frameAnim += 1;
    }
  }

  return {
    file: path.basename(filePath),
    version: dec.version || '-',
    sprites: (dec.sprites_array || []).length,
    stateCount,
    settings: {
      bounce_state: !!s.bounce_state,
      yAmp: num(s.yAmp),
      yFrq: num(s.yFrq),
      max_fps: num(s.max_fps) || 0,
    },
    flags: {
      one_shot: oneShot,
      should_reset: shouldReset,
      should_reset_state: shouldResetState,
      ignore_bounce: ignoreBounce,
      frameAnimLayers: frameAnim,
    },
  };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scan-remix-node.cjs <file1.pngRemix> [file2.pngRemix ...]');
    process.exit(1);
  }

  for (const f of files) {
    const fp = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    try {
      console.log(JSON.stringify(summarize(fp), null, 2));
    } catch (e) {
      console.error('Failed:', fp, String(e && e.stack ? e.stack : e));
    }
  }
}

main();
