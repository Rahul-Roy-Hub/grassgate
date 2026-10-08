import { buildQuests, anywhereQuests, STAMPS } from './quests.js';
import { loadVision, verifyPhoto, OUTDOOR_MIN } from './vision.js';
import { flavorQuest, loadLLM, llmSupported, questContext, LLM_MODELS } from './llm.js';
import { codeForWindow, normalizeSecret, formatSecret, windowOf, windowEnd } from './unlock.js';
import { getPosition, watchPosition, distanceM, bearingDeg, compass, formatDistance, walkMinutes } from './geo.js';
import { loadJSON, saveJSON, computeStreak, recordCompletion, STATS_DEFAULTS } from './store.js';
import { addEntry, listEntries, deleteEntry, clearJournal } from './journal.js';
import { startCompass, stopCompass, compassAvailable, needsPermission } from './compass.js';
import { sunTimes, dayPhase, sceneSVG, seasonOf, greeting, daylightLine } from './scenery.js';
import { toast, buzz, chime, primeAudio, leafBurst } from './fx.js';
import { inject as injectAnalytics } from '../vendor/vercel-analytics.mjs';

// Vercel Web Analytics: cookieless page views only. No location, photos or quest data are sent.
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
injectAnalytics({ mode: isLocal ? 'development' : 'production' });

const $ = (id) => document.getElementById(id);

// Tiny DOM builder. Strings become text nodes, so OSM names can't inject markup.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- persistent state (this device only) ----------

const settings = loadJSON('gg:settings', {
  secret: '', radius: 800, useLLM: false, llmModel: LLM_MODELS[0], demo: false, onboarded: false,
});
let stats = loadJSON('gg:stats', STATS_DEFAULTS);
if (settings.completed) { // v0.1 kept a bare counter in settings
  stats.completed = Math.max(stats.completed, settings.completed);
  delete settings.completed;
}
const saveSettings = () => saveJSON('gg:settings', settings);
const saveStats = () => saveJSON('gg:stats', stats);

const state = {
  screen: null,
  run: null,
  quests: [],
  quest: null,
  origin: null,
  walk: null,
  stopWatch: null,
  stream: null,
  codeTimer: null,
  visionReady: false,
  installPrompt: null,
  photoUrl: null,
  journalUrls: [],
  ob: 0,
};

// ---------- navigation ----------

const TAB_OF = { today: 'today', quests: 'today', journal: 'journal', settings: 'settings' };
const IMMERSIVE = new Set(['onboarding', 'walk', 'camera', 'result']);

function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `screen-${name}`);
  state.screen = name;
  document.body.classList.toggle('immersive', IMMERSIVE.has(name));
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.tab === TAB_OF[name]) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  const heading = [...document.querySelectorAll(`#screen-${name} h1`)].find((el) => el.offsetParent);
  heading?.focus({ preventScroll: true });
}

function leaveFlow() {
  state.run = null;
  stopWatching();
  stopCompass();
  stopCamera();
  clearInterval(state.codeTimer);
}

function goTab(name) {
  leaveFlow();
  if (name === 'today') renderToday();
  if (name === 'journal') renderJournal();
  if (name === 'settings') renderSettings();
  show(name);
}

function renderTopBar() {
  const chip = $('top-status');
  chip.textContent = settings.secret ? 'Paired' : 'Not paired';
  chip.classList.toggle('ok', !!settings.secret);
  chip.setAttribute('aria-label', settings.secret ? 'Paired with your browser. Open settings.' : 'Not paired. Open settings to pair.');
  $('demo-badge').hidden = !settings.demo;
}

// ---------- model download progress ----------

const loading = new Map();
function progress(key, text, pct) {
  if (text == null) loading.delete(key);
  else loading.set(key, { text, pct });
  const last = [...loading.values()].pop();
  $('model-bar').hidden = !last;
  if (last) {
    $('model-text').textContent = last.text;
    $('model-progress').value = Math.max(0, Math.min(100, last.pct || 0));
  }
}

function onVisionProgress(p) {
  if (p.status === 'progress' && /\.onnx$/.test(p.file)) progress('vision', 'Downloading the vision model (once)…', p.progress);
  if (p.status === 'ready') progress('vision');
}

const onLLMProgress = (p) => progress('llm', 'Loading the local LLM…', (p.progress || 0) * 100);

// Download CLIP while the user picks a quest and walks, so the photo check is instant.
function warmVision() {
  loadVision(onVisionProgress).then(
    () => { state.visionReady = true; progress('vision'); },
    () => progress('vision'),
  );
}

// ---------- today ----------

function renderToday() {
  const now = new Date();
  const pos = stats.lastPos;
  const sun = pos ? sunTimes(now, pos.lat, pos.lon) : null;
  const phase = dayPhase(now, sun);
  $('hero-art').innerHTML = sceneSVG(phase, seasonOf(pos?.lat ?? 45, now)); // our own markup, no user data
  $('hero-title').textContent = greeting(phase, now);
  $('hero-sub').textContent = daylightLine(now, sun) || 'Real places near you, checked by AI that runs on this phone.';

  const paired = !!settings.secret;
  $('lock-card').classList.toggle('unpaired', !paired);
  $('lock-icon').textContent = paired ? '🔒' : '🔗';
  $('lock-title').textContent = paired ? 'Your feeds are locked' : 'Pair your browser first';
  $('lock-text').textContent = paired
    ? 'Finish one quest outside to get an unlock code.'
    : 'Grass Gate unlocks the sites your browser extension blocks. It takes a minute.';
  $('btn-pair-now').hidden = paired;

  $('stat-streak').textContent = computeStreak(stats.days);
  $('stat-quests').textContent = stats.completed;
  $('stat-km').textContent = (stats.meters / 1000).toFixed(1);
  const mins = Math.round(stats.minutes);
  $('stat-time').textContent = mins < 100 ? mins : (mins / 60).toFixed(1);
  $('stat-time-label').textContent = mins < 100 ? 'min outside' : 'hours outside';

  renderStamps();
  $('btn-install').hidden = !state.installPrompt;
  renderTopBar();
}

function renderStamps() {
  const got = STAMPS.filter((s) => stats.stamps[s.id]).length;
  $('stamps-count').textContent = `${got} of ${STAMPS.length} collected`;
  $('stamps').replaceChildren(...STAMPS.map((s) => {
    const n = stats.stamps[s.id] || 0;
    return h('li', { class: n ? 'stamp got' : 'stamp', title: n ? `${s.label}: found ${n}×` : `${s.label}: not found yet` },
      h('span', { class: 'stamp-badge', 'aria-hidden': 'true' }, s.emoji),
      h('span', { class: 'stamp-label' }, s.label),
      n > 1 ? h('span', { class: 'stamp-count' }, `×${n}`) : null);
  }));
}

// ---------- quests ----------

function renderSkeletons() {
  $('quest-list').replaceChildren(...[0, 1, 2].map(() =>
    h('li', {}, h('div', { class: 'card skeleton', 'aria-hidden': 'true' },
      h('span', { class: 'sk-emoji' }), h('span', { class: 'sk-lines' }, h('i'), h('i'), h('i'))))));
}

async function findQuests() {
  leaveFlow();
  const run = {};
  state.run = run;
  show('quests');
  renderSkeletons();
  $('quests-status').textContent = 'Finding where you are…';
  warmVision();

  let quests;
  let note;
  try {
    const pos = await getPosition();
    if (state.run !== run) return;
    state.origin = pos;
    stats.lastPos = { lat: +pos.lat.toFixed(2), lon: +pos.lon.toFixed(2) }; // ~1 km, enough for sunset times
    saveStats();
    $('quests-status').textContent = 'Reading the map around you…';
    quests = await buildQuests(pos, settings.radius);
    note = quests.some((q) => q.lat != null)
      ? `Real places within ${formatDistance(settings.radius)} of you. Pick one.`
      : 'Nothing mapped nearby, so these work anywhere outside.';
  } catch (err) {
    quests = anywhereQuests(3);
    note = `${err.message} These quests work anywhere outside.`;
  }
  if (state.run !== run) return;

  state.quests = quests;
  $('quests-status').textContent = note;
  renderQuestList();
  if (settings.useLLM && llmSupported()) flavorAll(quests);
}

async function flavorAll(quests) {
  const ctx = questContext(state.origin);
  for (const q of quests) {
    if (state.quests !== quests) break; // rerolled
    try {
      Object.assign(q, await flavorQuest(q, ctx, settings.llmModel, onLLMProgress), { flavored: true });
      progress('llm');
      if (state.screen === 'quests') renderQuestList();
    } catch (err) {
      console.warn('Local LLM failed, keeping template text', err);
      break;
    }
  }
  progress('llm');
}

function questCard(q) {
  const chips = [
    q.lat != null
      ? h('span', { class: 'chip' }, `🚶 ${walkMinutes(q.dist)} min · ${formatDistance(q.dist)} ${q.dir}`)
      : h('span', { class: 'chip' }, '📍 Anywhere outside'),
    !stats.stamps[q.type] ? h('span', { class: 'chip new' }, 'New stamp') : null,
    q.flavored ? h('span', { class: 'chip ai', title: `Written on this device by ${settings.llmModel}` }, '✨ local LLM') : null,
  ];
  return h('li', {}, h('button', { class: 'card quest-card', type: 'button', onclick: () => startWalk(q) },
    h('span', { class: 'emoji-tile', 'aria-hidden': 'true' }, q.emoji),
    h('span', { class: 'card-body' },
      h('strong', { class: 'card-title' }, q.title),
      h('span', { class: 'card-text' }, q.text),
      h('span', { class: 'chips' }, chips))));
}

function renderQuestList() {
  $('quest-list').replaceChildren(...state.quests.map(questCard));
}

// ---------- walking ----------

const RING = 2 * Math.PI * 54;
const rotation = { arrow: 0, face: 0 };

// Rotate the short way round, so 359° → 1° doesn't spin the arrow a full turn.
function rotate(el, key, deg) {
  const delta = ((((deg - rotation[key]) % 360) + 540) % 360) - 180;
  rotation[key] += delta;
  el.style.transform = `rotate(${rotation[key]}deg)`;
}

function setRing(p) {
  const ring = $('ring-fg');
  ring.style.strokeDasharray = RING;
  ring.style.strokeDashoffset = RING * (1 - Math.max(0, Math.min(1, p)));
}

function stopWatching() {
  state.stopWatch?.();
  state.stopWatch = null;
}

function mapLink(from, to) {
  const f = (n) => n.toFixed(5);
  return from
    ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${f(from.lat)}%2C${f(from.lon)}%3B${f(to.lat)}%2C${f(to.lon)}`
    : `https://www.openstreetmap.org/?mlat=${f(to.lat)}&mlon=${f(to.lon)}#map=17/${f(to.lat)}/${f(to.lon)}`;
}

function startWalk(q) {
  const resume = state.walk && state.quest === q; // back from the camera keeps time and distance
  leaveFlow();
  primeAudio(); // so the arrival chime can play later
  const anywhere = q.lat == null;
  state.quest = q;
  if (!resume) state.walk = {
    startedAt: Date.now(),
    meters: 0,
    last: null,
    startDist: q.dist ?? 0,
    dist: q.dist ?? 0,
    bearing: !anywhere && state.origin ? bearingDeg(state.origin, q) : 0,
    heading: null,
    arrived: anywhere,
  };

  $('walk-type').textContent = `${q.emoji} ${q.label} quest`;
  $('walk-title').textContent = q.title;
  $('walk-text').textContent = q.text;
  $('walk-arrow').hidden = anywhere;
  $('dial-face').hidden = anywhere;
  $('dial-emoji').hidden = !anywhere;
  $('dial-emoji').textContent = q.emoji;
  $('walk-map').hidden = anywhere;
  $('btn-compass').hidden = true;

  if (anywhere) {
    $('walk-dist').textContent = 'Anywhere';
    $('walk-eta').textContent = 'Just step outside.';
    $('walk-dir').textContent = '';
    $('walk-tip').textContent = 'Head out the door, find it, then open the camera.';
    setRing(1);
  } else {
    const w = state.walk;
    $('walk-dist').textContent = formatDistance(w.dist);
    $('walk-eta').textContent = `~${walkMinutes(w.dist)} min walk`;
    $('walk-dir').textContent = `Head ${compass(w.bearing)}`;
    $('walk-tip').textContent = 'Pocket the phone and walk. While the app is open, it buzzes and chimes when you arrive.';
    $('walk-map').href = mapLink(state.origin, q);
    setRing((w.startDist - w.dist) / Math.max(1, w.startDist - q.tolerance));
    pointArrow();
    state.stopWatch = watchPosition(updateWalk, (err) => { $('walk-dir').textContent = err.message; });
    if (compassAvailable()) {
      if (needsPermission()) $('btn-compass').hidden = false;
      else enableCompass(false);
    }
  }
  setArrived(state.walk.arrived, false);
  show('walk');
}

async function enableCompass(fromTap) {
  const ok = await startCompass((heading) => {
    if (!state.walk) return;
    state.walk.heading = heading;
    $('btn-compass').hidden = true;
    pointArrow();
  }).catch(() => false);
  if (!fromTap) return;
  if (!ok) { toast('No compass access. The arrow stays north-up.'); return; }
  setTimeout(() => {
    if (state.screen === 'walk' && state.walk?.heading == null) {
      $('btn-compass').hidden = true;
      toast('This device has no compass. The arrow stays north-up.');
    }
  }, 2500);
}

function pointArrow() {
  const w = state.walk;
  const heading = w.heading ?? 0;
  rotate($('walk-arrow'), 'arrow', w.bearing - heading);
  rotate($('dial-face'), 'face', -heading);
}

// Count real steps only: ignore GPS jitter under the accuracy radius and teleport-sized jumps.
function trackSteps(w, pos) {
  if (!w.last) { w.last = pos; return; }
  const step = distanceM(w.last, pos);
  if (step > 300) { w.last = pos; return; }
  if (step >= Math.max(8, Math.min(pos.accuracy, 30))) {
    w.meters += step;
    w.last = pos;
  }
}

function updateWalk(pos) {
  const w = state.walk;
  const q = state.quest;
  if (!w || q.lat == null) return;
  trackSteps(w, pos);
  w.dist = distanceM(pos, q);
  w.bearing = bearingDeg(pos, q);
  w.startDist = Math.max(w.startDist, w.dist);
  pointArrow();
  $('walk-dir').textContent = `Head ${compass(w.bearing)} · GPS ±${Math.round(pos.accuracy)} m`;
  $('walk-dist').textContent = formatDistance(w.dist);
  if (w.arrived) return;

  const span = Math.max(1, w.startDist - q.tolerance);
  setRing((w.startDist - w.dist) / span);
  $('walk-eta').textContent = `~${walkMinutes(w.dist)} min walk`;
  if (w.dist <= q.tolerance + Math.min(pos.accuracy, 50)) {
    w.arrived = true; // sticky, so GPS wobble at the spot doesn't re-lock the camera
    setArrived(true, true);
  }
}

function setArrived(arrived, announce) {
  const q = state.quest;
  const mapped = q.lat != null;
  const btn = $('btn-camera');
  $('screen-walk').classList.toggle('arrived', arrived && mapped);
  btn.disabled = !(arrived || settings.demo);
  if (arrived) btn.textContent = mapped ? 'You’re here. Open the camera' : 'I’m outside. Open the camera';
  else btn.textContent = settings.demo ? 'Demo mode: open the camera' : 'Get closer to unlock the camera';
  if (arrived && mapped) {
    setRing(1);
    $('walk-eta').textContent = 'You made it.';
  }
  if (announce) {
    buzz([180, 80, 180]);
    chime();
    toast(`You made it. Now find ${q.thing}.`);
  }
}

// ---------- camera + verification ----------

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

function setCam(mode, message = '') {
  $('viewfinder').dataset.state = mode;
  $('cam-status').textContent = message;
  $('btn-shoot').disabled = mode !== 'live';
  $('btn-cam-retry').style.visibility = mode === 'error' ? 'visible' : 'hidden';
}

async function openCamera() {
  stopWatching();
  stopCompass();
  stopCamera();
  show('camera');
  $('cam-target').textContent = `Find ${state.quest.thing}`;
  setCam('starting', 'Starting the camera…');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
    if (state.screen !== 'camera') { stopCamera(); return; }
    const video = $('video');
    video.srcObject = state.stream;
    await video.play();
    setCam('live', '');
  } catch (err) {
    setCam('error', err.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow it in your browser’s site settings, then tap ↻.'
      : `Camera unavailable (${err.name || err.message}). It needs HTTPS or localhost.`);
  }
}

function captureFrame(video, canvas, maxSide = 640) {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

async function shoot() {
  const video = $('video');
  if (!video.videoWidth || $('viewfinder').dataset.state !== 'live') return;
  const blob = await captureFrame(video, $('freeze'));
  buzz(20);
  setCam('checking', state.visionReady ? 'Checking on this phone…' : 'Downloading the vision model (once), then checking…');
  try {
    const result = await verifyPhoto(blob, state.quest, onVisionProgress);
    state.visionReady = true;
    stopCamera();
    if (result.pass) await completeQuest(result, blob);
    else showFail(result);
  } catch (err) {
    console.error(err);
    setCam('live', `The vision model couldn’t run: ${err.message}`);
  }
}

// ---------- results ----------

function setResultActions([primaryLabel, primaryFn], [altLabel, altFn]) {
  $('btn-result-next').textContent = primaryLabel;
  $('btn-result-next').onclick = primaryFn;
  $('btn-result-alt').textContent = altLabel;
  $('btn-result-alt').onclick = altFn;
}

function bar(label, value, ok) {
  const pct = Math.round(value * 100);
  return h('div', { class: ok === true ? 'bar-row ok' : ok === false ? 'bar-row bad' : 'bar-row' },
    h('span', { class: 'bar-label', title: label }, label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${pct}%` })),
    h('span', { class: 'bar-pct' }, `${pct}%`));
}

function renderScores(r) {
  $('result-scores').replaceChildren(
    bar('Outdoors', r.outdoor, r.outdoor >= OUTDOOR_MIN),
    bar(`Match: ${state.quest.thing}`, r.match, r.targetOk),
    h('p', { class: 'muted small bars-sub' }, `CLIP’s top guesses (target ranked #${r.rank})`),
    ...r.top.map((t) => bar(t.label, t.score, null)),
  );
}

async function completeQuest(result, blob) {
  const q = state.quest;
  const w = state.walk;
  const minutes = Math.min(90, (Date.now() - w.startedAt) / 60000);
  const meters = Math.round(w.meters);
  const { next, isNewStamp } = recordCompletion(stats, { type: q.type, meters, minutes });
  stats = next;
  saveStats();

  let saved = false;
  try {
    await addEntry({
      id: newId(), ts: Date.now(), type: q.type, emoji: q.emoji, label: q.label,
      title: q.title, text: q.text, placeName: q.placeName || null, meters, minutes, photo: blob,
    });
    saved = true;
  } catch (err) {
    console.warn('Journal save failed', err);
  }
  showPass(result, { blob, meters, minutes, isNewStamp, saved });
}

function showPass(r, info) {
  const q = state.quest;
  $('result-pass').hidden = false;
  $('result-fail').hidden = true;

  const streak = computeStreak(stats.days);
  const chips = [
    info.meters >= 20 ? `🚶 ${formatDistance(info.meters)} walked` : null,
    `⏱ ${Math.max(1, Math.round(info.minutes))} min outside`,
    streak > 1 ? `🔥 ${streak}-day streak` : '🔥 Streak started',
    info.isNewStamp ? `${q.emoji} New stamp: ${q.label}` : null,
  ].filter(Boolean);
  $('result-chips').replaceChildren(...chips.map((c) => h('li', { class: 'chip big-chip' }, c)));

  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = URL.createObjectURL(info.blob);
  $('result-img').src = state.photoUrl;
  $('result-caption').textContent = info.saved
    ? 'Saved to your field journal. It stays on this phone.'
    : 'Couldn’t save to the journal in this browser mode.';

  const paired = !!settings.secret;
  $('code-card').hidden = !paired;
  $('unpaired-note').hidden = paired;
  if (paired) showCode();

  renderScores(r);
  setResultActions(['Done', () => goTab('today')], ['Another quest', findQuests]);
  show('result');
  leafBurst();
  buzz([30, 40, 30]);
}

const FAIL_TIPS = {
  indoor: () => ['Step outside first. Windows and screens don’t count.', 'Point the camera at the open scene, not a wall.'],
  target: (q) => [`Get close so ${q.thing} fills most of the frame.`, 'Hold still for a sharp shot. Daylight helps.', 'Still stuck? Pick another quest, no penalty.'],
};

function showFail(r) {
  $('result-pass').hidden = true;
  $('result-fail').hidden = false;
  $('fail-reason').textContent = r.reason;
  $('fail-tips').replaceChildren(...FAIL_TIPS[r.kind](state.quest).map((t) => h('li', {}, t)));
  renderScores(r);
  setResultActions(['Try again', openCamera], ['Pick another', () => (state.quests.length ? show('quests') : findQuests())]);
  show('result');
  buzz(60);
}

// One quest gives one code: it's pinned to when you finished and isn't refreshed.
async function showCode() {
  clearInterval(state.codeTimer);
  const w = windowOf();
  const issued = Date.now();
  const expires = windowEnd(w + 1); // the extension also accepts the previous window
  const code = await codeForWindow(settings.secret, w);
  $('code').setAttribute('aria-label', `Unlock code ${code.split('').join(' ')}`);
  $('code').replaceChildren(...code.split('').map((d, i) => h('span', { class: i === 3 ? 'gap' : '' }, d)));
  $('code-card').classList.remove('expired');

  const tick = () => {
    const left = expires - Date.now();
    if (left <= 0) {
      clearInterval(state.codeTimer);
      $('code-card').classList.add('expired');
      $('code-meter').style.width = '0%';
      $('code-timer').textContent = 'Expired. Finish another quest for a new code.';
      return;
    }
    const s = Math.ceil(left / 1000);
    $('code-meter').style.width = `${(left / (expires - issued)) * 100}%`;
    $('code-timer').textContent = `Valid for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · works once`;
  };
  tick();
  state.codeTimer = setInterval(tick, 1000);
}

// ---------- journal ----------

const fmtShortDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });

async function renderJournal() {
  state.journalUrls.forEach((u) => URL.revokeObjectURL(u));
  state.journalUrls = [];
  let entries;
  try {
    entries = await listEntries();
  } catch {
    $('journal-note').textContent = 'The journal needs browser storage, which is blocked here (private browsing?).';
    $('journal-grid').replaceChildren();
    $('journal-empty').hidden = true;
    return;
  }
  $('journal-note').textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · photos never leave this phone`
    : '';
  $('journal-empty').hidden = entries.length > 0;
  $('journal-grid').replaceChildren(...entries.map((e) => {
    const url = URL.createObjectURL(e.photo);
    state.journalUrls.push(url);
    return h('li', {}, h('button', { class: 'entry', type: 'button', onclick: () => openEntry(e, url) },
      h('img', { src: url, alt: '', loading: 'lazy' }),
      h('span', { class: 'entry-body' },
        h('strong', {}, `${e.emoji} ${e.title}`),
        h('span', { class: 'muted small' }, [e.placeName, fmtShortDate(e.ts)].filter(Boolean).join(' · ')))));
  }));
}

function openEntry(e, url) {
  $('entry-img').src = url;
  $('entry-img').alt = `Your ${e.label.toLowerCase()} photo`;
  $('entry-type').textContent = `${e.emoji} ${e.label}`;
  $('entry-title').textContent = e.title;
  $('entry-meta').textContent = [
    new Date(e.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    e.placeName,
    e.meters >= 20 ? `${formatDistance(e.meters)} walked` : null,
    `${Math.max(1, Math.round(e.minutes))} min outside`,
  ].filter(Boolean).join(' · ');
  $('entry-text').textContent = e.text;
  $('entry-delete').onclick = async () => {
    if (!confirm('Delete this journal entry? Its photo is removed from this phone.')) return;
    await deleteEntry(e.id);
    $('entry-dialog').close();
    toast('Entry deleted.');
    renderJournal();
  };
  $('entry-dialog').showModal();
}

// ---------- settings ----------

function renderSettings() {
  $('set-secret').value = formatSecret(settings.secret);
  $('set-secret-status').textContent = settings.secret
    ? '✓ Paired. Codes from this phone unlock that browser.'
    : 'Open the extension’s options page to find your code.';
  $('set-radius').value = String(settings.radius);
  $('set-demo').checked = settings.demo;
  const gpu = llmSupported();
  $('set-llm').checked = settings.useLLM && gpu;
  $('set-llm').disabled = !gpu;
  $('set-llm-model').disabled = !gpu;
  $('set-llm-model').replaceChildren(...LLM_MODELS.map((m) => new Option(m, m, false, m === settings.llmModel)));
  $('set-llm-note').textContent = gpu
    ? 'Runs in this browser via WebGPU (0.4–1.5 GB, once). The quest facts stay fixed; it only writes the words.'
    : 'This browser has no WebGPU, so quests use the built-in templates.';
  renderTopBar();
}

// Returns an error message, or null when saved.
function savePairing(raw) {
  const s = normalizeSecret(raw);
  if (s && s.length < 12) return 'That code looks too short. It has 16 letters and numbers.';
  const changed = s !== settings.secret;
  settings.secret = s;
  saveSettings();
  renderTopBar();
  if (changed && s) toast('Paired with your browser.');
  return null;
}

function bindSettings() {
  $('set-secret').addEventListener('change', (e) => {
    const error = savePairing(e.target.value);
    if (error) $('set-secret-status').textContent = error; else renderSettings();
  });
  $('set-radius').addEventListener('change', (e) => { settings.radius = Number(e.target.value); saveSettings(); });
  $('set-demo').addEventListener('change', (e) => { settings.demo = e.target.checked; saveSettings(); renderTopBar(); });
  $('set-llm').addEventListener('change', (e) => { settings.useLLM = e.target.checked; saveSettings(); });
  $('set-llm-model').addEventListener('change', (e) => { settings.llmModel = e.target.value; saveSettings(); });

  $('btn-preload').addEventListener('click', async () => {
    const status = $('preload-status');
    $('btn-preload').disabled = true;
    try {
      status.textContent = 'Downloading CLIP…';
      await loadVision(onVisionProgress);
      state.visionReady = true;
      progress('vision');
      if (settings.useLLM && llmSupported()) {
        status.textContent = 'Downloading the local LLM…';
        await loadLLM(settings.llmModel, onLLMProgress);
        progress('llm');
      }
      status.textContent = '✓ Ready. Photo checks now work with no signal.';
    } catch (err) {
      progress('vision');
      progress('llm');
      status.textContent = `Download failed: ${err.message}`;
    } finally {
      $('btn-preload').disabled = false;
    }
  });

  $('btn-show-intro').addEventListener('click', () => startOnboarding());
  $('btn-reset-stats').addEventListener('click', () => {
    if (!confirm('Reset your streak, totals and stamps? Your journal is kept.')) return;
    stats = { ...structuredClone(STATS_DEFAULTS), lastPos: stats.lastPos };
    saveStats();
    toast('Stats reset.');
  });
  $('btn-clear-journal').addEventListener('click', async () => {
    if (!confirm('Delete every journal entry and photo from this phone?')) return;
    try { await clearJournal(); toast('Journal cleared.'); } catch { toast('Couldn’t clear the journal.'); }
  });
}

// ---------- onboarding ----------

const SLIDES = [
  { art: '🔒', title: 'Your feeds stay locked.', text: 'The Grass Gate browser extension blocks the sites you doomscroll. The only way back in is outside.' },
  { art: '🗺️', title: 'Real quests, real places.', text: 'Grass Gate finds a tree, a lake or a park bench near you on OpenStreetMap, then walks you there.' },
  { art: '📷', title: 'Checked on your phone.', text: 'An open-weight vision model checks your photo right here. Nothing is uploaded, and after one download it works without signal.' },
  { art: '🔗', title: 'Pair your browser.', text: 'Type the code from the extension’s options page, or open its pairing link on this phone.', pair: true },
];

function startOnboarding() {
  leaveFlow();
  state.ob = 0;
  renderOnboarding();
  show('onboarding');
}

function renderOnboarding() {
  const s = SLIDES[state.ob];
  const last = state.ob === SLIDES.length - 1;
  $('ob-art').textContent = s.art;
  $('ob-title').textContent = s.title;
  $('ob-text').textContent = s.text;
  $('ob-pair').hidden = !s.pair;
  if (s.pair) {
    $('ob-secret').value = formatSecret(settings.secret);
    $('ob-pair-status').textContent = settings.secret ? '✓ Paired' : 'No extension yet? You can pair later in Settings.';
  }
  $('ob-dots').replaceChildren(...SLIDES.map((_, i) => h('i', { class: i === state.ob ? 'on' : '' })));
  $('ob-back').hidden = state.ob === 0;
  $('ob-next').textContent = last ? (settings.secret ? 'Let’s go' : 'Pair later') : 'Next';
  $('ob-skip').hidden = last;
  if (state.screen === 'onboarding') $('ob-title').focus({ preventScroll: true });
}

function finishOnboarding() {
  settings.onboarded = true;
  saveSettings();
  goTab('today');
}

function bindOnboarding() {
  $('ob-next').addEventListener('click', () => {
    if (state.ob < SLIDES.length - 1) { state.ob += 1; renderOnboarding(); } else finishOnboarding();
  });
  $('ob-back').addEventListener('click', () => { state.ob = Math.max(0, state.ob - 1); renderOnboarding(); });
  $('ob-skip').addEventListener('click', finishOnboarding);
  const pairFromIntro = (e) => {
    const error = savePairing(e.target.value);
    if (error) $('ob-pair-status').textContent = error; else renderOnboarding();
  };
  $('ob-secret').addEventListener('input', (e) => { if (normalizeSecret(e.target.value).length >= 16) pairFromIntro(e); });
  $('ob-secret').addEventListener('change', pairFromIntro);
}

// ---------- pairing link (#pair=CODE from the extension) ----------

function readPairHash() {
  const m = location.hash.match(/pair=([A-Za-z0-9-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const error = savePairing(m[1]);
  if (error) toast(error);
}

// ---------- wiring ----------

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => goTab(tab.dataset.tab));
$('top-status').addEventListener('click', () => goTab('settings'));
$('btn-pair-now').addEventListener('click', () => goTab('settings'));
$('btn-result-pair').addEventListener('click', () => goTab('settings'));
$('btn-start').addEventListener('click', findQuests);
$('btn-journal-start').addEventListener('click', findQuests);
$('btn-reroll').addEventListener('click', findQuests);
$('btn-quests-back').addEventListener('click', () => goTab('today'));
$('btn-walk-back').addEventListener('click', () => { leaveFlow(); show('quests'); });
$('btn-compass').addEventListener('click', () => enableCompass(true));
$('btn-camera').addEventListener('click', openCamera);
$('btn-shoot').addEventListener('click', shoot);
$('btn-cam-retry').addEventListener('click', openCamera);
$('btn-cam-back').addEventListener('click', () => startWalk(state.quest));
$('entry-close').addEventListener('click', () => $('entry-dialog').close());
$('entry-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
bindSettings();
bindOnboarding();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  if (state.screen === 'today') $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', () => {
  const prompt = state.installPrompt;
  state.installPrompt = null;
  $('btn-install').hidden = true;
  prompt?.prompt();
});
window.addEventListener('appinstalled', () => toast('Installed. Grass Gate is on your home screen.'));

window.addEventListener('hashchange', () => { readPairHash(); if (state.screen === 'today') renderToday(); });
setInterval(() => { if (state.screen === 'today' && !document.hidden) renderToday(); }, 60000);

readPairHash();
renderTopBar();
if (settings.onboarded) goTab('today');
else startOnboarding();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
}
