// Emberline audio: everything is synthesized with WebAudio. No audio files,
// no network. One shared noise buffer; every sound is a few oscillators.
let ctx = null;
let noiseBuf = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function noise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  shot(kind, dist = 0) {
    if (!ctx) return;
    const att = Math.max(0.15, 1 - dist / 60);
    if (kind === 'rifle') { noise(0.11, 2400, 0.5 * att); tone(160, 0.09, 0.35 * att, 'square', 60); }
    else if (kind === 'smg') { noise(0.07, 3000, 0.35 * att); tone(200, 0.06, 0.25 * att, 'square', 80); }
    else if (kind === 'dmr') { noise(0.22, 1600, 0.65 * att); tone(110, 0.18, 0.45 * att, 'square', 45); }
    else { noise(0.08, 2800, 0.4 * att); tone(220, 0.07, 0.3 * att, 'square', 90); }
  },
  dry() { tone(1200, 0.04, 0.15, 'square'); },
  reload() { tone(900, 0.05, 0.2, 'square'); tone(600, 0.05, 0.2, 'square', 0, 0.18); tone(1100, 0.04, 0.18, 'square', 0, 0.55); },
  hit() { tone(1800, 0.05, 0.25, 'sine'); },
  kill() { tone(1800, 0.05, 0.25, 'sine'); tone(2400, 0.09, 0.25, 'sine', 0, 0.06); },
  hurt() { noise(0.12, 500, 0.3); tone(90, 0.12, 0.3, 'sawtooth', 50); },
  step() { noise(0.05, 700, 0.07); },
  plantBeep(n) { tone(n % 4 === 0 ? 1400 : 1000, 0.07, 0.3, 'sine'); },
  defuseTick() { tone(1500, 0.04, 0.2, 'sine'); },
  explosion() {
    noise(0.9, 300, 0.9); tone(120, 0.8, 0.7, 'sine', 28); noise(0.4, 1200, 0.4, 'highpass', 0.05);
  },
  grenadePin() { tone(1400, 0.03, 0.15, 'square'); },
  buy() { tone(700, 0.06, 0.2, 'sine'); tone(1050, 0.08, 0.2, 'sine', 0, 0.07); },
  roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 0.25, 'sine', 0, i * 0.12)); },
  roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 0.25, 'sine', 0, i * 0.13)); },
  click() { tone(800, 0.04, 0.15, 'sine'); },
};
