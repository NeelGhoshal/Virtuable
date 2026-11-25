// One recognisable sound per action. Direction carries meaning: up is on, down is off.
const CUES = {
  unmute: [[440, 0, 0.12], [660, 0.13, 0.18]],
  mute: [[440, 0, 0.12], [294, 0.13, 0.22]],
  raise: [[392, 0, 0.1], [523, 0.11, 0.1], [784, 0.22, 0.24]],
  lower: [[784, 0, 0.1], [523, 0.11, 0.1], [392, 0.22, 0.24]],
  agree: [[880, 0, 0.07], [880, 0.12, 0.07]],
  inBox: [[1046, 0, 0.04]],
  listen: [[523, 0, 0.16]],
  tick: [[620, 0, 0.05]],
  done: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.2]],
  error: [[196, 0, 0.3]],
};

let ctx;
export const sound = { enabled: true };

export function wakeAudio() {
  ctx ||= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}

export function play(name) {
  if (!sound.enabled || !CUES[name]) return;
  wakeAudio();
  for (const [hz, at, len] of CUES[name]) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}
