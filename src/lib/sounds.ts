// Tiny Web Audio sound effects (no assets needed)
let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, dur = 0.12, type: OscillatorType = "sine", vol = 0.15, when = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sounds = {
  send() {
    tone(880, 0.08, "sine", 0.18);
    tone(1320, 0.1, "sine", 0.12, 0.04);
  },
  receive() {
    tone(520, 0.08, "sine", 0.16);
    tone(780, 0.12, "sine", 0.14, 0.05);
  },
  join() {
    tone(660, 0.1, "triangle", 0.18);
    tone(990, 0.16, "triangle", 0.14, 0.08);
  },
  call() {
    tone(440, 0.18, "sine", 0.2);
    tone(550, 0.18, "sine", 0.2, 0.12);
  },
  unlock() {
    tone(1200, 0.06, "sine", 0.12);
    tone(1600, 0.08, "sine", 0.1, 0.04);
  },
};
