// Small feedback effects: toast, haptics, arrival chime, leaf burst.

const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// Audio must be unlocked by a tap before it can play later (e.g. on arrival with the phone pocketed).
let audio = null;
export function primeAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio */ }
}

export function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [freq, delay] of [[660, 0], [880, 0.15]]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.65);
  }
}

const LEAF_COLORS = ['#e2782c', '#c4432a', '#e9b23a', '#6dbb5e', '#3f8a46'];

export function leafBurst(count = 36) {
  if (!motionOK()) return;
  const layer = document.createElement('div');
  layer.className = 'leaf-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  const w = innerWidth;
  const h = innerHeight;
  for (let i = 0; i < count; i++) {
    const leaf = document.createElement('i');
    leaf.className = 'leaf';
    leaf.style.background = LEAF_COLORS[i % LEAF_COLORS.length];
    layer.append(leaf);
    const x0 = w / 2 + (Math.random() - 0.5) * 60;
    const y0 = h * 0.38;
    const x1 = x0 + (Math.random() - 0.5) * w;
    const peak = y0 - 120 - Math.random() * 180;
    const spin = (Math.random() - 0.5) * 720;
    leaf.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg) scale(0.5)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${peak}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${x1}px, ${h + 40}px) rotate(${spin}deg) scale(0.9)`, opacity: 0.8 },
    ], { duration: 1800 + Math.random() * 1200, delay: Math.random() * 150, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 3500);
}
