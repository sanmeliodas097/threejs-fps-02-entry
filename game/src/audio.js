// EMBERLINE — all sound is synthesized with WebAudio: no audio files, no
// network. One shared noise buffer, one master gain, short envelopes.
let ctx = null;
let master = null;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

function noise(dur, filterFreq, type, gain, when = 0) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type || 'lowpass';
  f.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// kind: 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol'
export const sfx = {
  shot(kind, vol = 1) {
    const v = vol;
    if (kind === 'shotgun') { noise(0.28, 900, 'lowpass', 0.9 * v); tone(90, 0.18, 'sine', 0.5 * v, 45); }
    else if (kind === 'sniper') { noise(0.35, 2400, 'bandpass', 0.9 * v); tone(140, 0.25, 'sawtooth', 0.25 * v, 50); }
    else if (kind === 'smg') { noise(0.09, 1800, 'bandpass', 0.55 * v); tone(190, 0.06, 'square', 0.12 * v, 90); }
    else if (kind === 'pistol') { noise(0.12, 1500, 'bandpass', 0.6 * v); tone(160, 0.08, 'square', 0.15 * v, 70); }
    else { noise(0.14, 1400, 'bandpass', 0.75 * v); tone(150, 0.1, 'sawtooth', 0.2 * v, 60); }
  },
  dryFire() { tone(1200, 0.03, 'square', 0.12); },
  reload() { tone(500, 0.04, 'square', 0.12); tone(700, 0.04, 'square', 0.12, 0, 0.18); tone(900, 0.05, 'square', 0.14, 0, 0.55); },
  hit() { tone(1900, 0.05, 'sine', 0.25); },
  kill() { tone(660, 0.07, 'sine', 0.25); tone(990, 0.12, 'sine', 0.25, 0, 0.07); },
  step() { noise(0.05, 500, 'lowpass', 0.10); },
  hurt() { tone(220, 0.12, 'sawtooth', 0.2, 110); },
  plantBeep() { tone(1200, 0.08, 'sine', 0.22); },
  bombBeep() { tone(1500, 0.06, 'square', 0.18); },
  explosion() { noise(1.1, 300, 'lowpass', 1.0); tone(60, 0.9, 'sine', 0.7, 28); noise(0.4, 3000, 'highpass', 0.35); },
  buy() { tone(880, 0.06, 'sine', 0.2); tone(1320, 0.09, 'sine', 0.2, 0, 0.06); },
  denied() { tone(180, 0.15, 'square', 0.2, 140); },
  roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'sine', 0.22, 0, i * 0.09)); },
  roundLoss() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'sine', 0.2, 0, i * 0.1)); },
  grenadePin() { tone(1400, 0.03, 'square', 0.15); },
  bounce() { tone(300, 0.05, 'sine', 0.12, 180); },
  defuse() { tone(1000, 0.07, 'sine', 0.2); tone(1000, 0.07, 'sine', 0.2, 0, 0.15); },
};
