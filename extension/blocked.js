import { sceneSVG, dayPhase, seasonOf } from './scenery.js';

const $ = (id) => document.getElementById(id);
const target = location.hash.slice(1);

const LINES = [
  'The feed will still be there in twenty minutes. The light outside won’t.',
  'Nothing in that tab has leaves.',
  'Ten minutes outside beats ten more minutes of scrolling.',
  'The algorithm can wait. The trees have been waiting longer.',
  'Your thumb could use a break. Your legs could use a walk.',
];

let host = '';
try { host = new URL(target).hostname.replace(/^www\./, ''); } catch { /* opened directly */ }

const now = new Date();
$('scene').innerHTML = sceneSVG(dayPhase(now), seasonOf(45, now)); // our own markup
$('site').textContent = host ? `${host} is behind the gate` : 'Grass Gate';
$('line').textContent = LINES[Math.floor(Math.random() * LINES.length)];

const send = (msg) => chrome.runtime.sendMessage(msg);

function goBack() {
  if (/^https?:\/\//.test(target)) location.replace(target);
  else $('msg').textContent = 'Unlocked. Open your site again.';
}

const status = await send({ type: 'status' });
$('app-link').href = status.appUrl;
$('app-link').textContent = status.appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
$('pair-note').hidden = status.paired;
if (!status.locked) {
  goBack();
} else if (host) {
  const { count } = await send({ type: 'blockedHit' });
  $('attempts').hidden = false;
  $('attempts').textContent = count === 1 ? 'First try today' : `Try #${count} today`;
}

let busy = false;
async function unlock() {
  if (busy) return;
  busy = true;
  $('unlock').disabled = true;
  $('msg').className = 'small';
  $('msg').textContent = 'Checking…';
  const res = await send({ type: 'unlock', code: $('code').value });
  busy = false;
  $('unlock').disabled = false;
  if (res.ok) {
    $('msg').className = 'small ok';
    $('msg').textContent = `Unlocked until ${new Date(res.unlockUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Enjoy, then go back outside.`;
    setTimeout(goBack, 900);
  } else {
    $('msg').className = 'small error';
    $('msg').textContent = res.error;
    $('code').select();
  }
}

$('unlock').addEventListener('click', unlock);
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
$('code').addEventListener('input', (e) => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
  e.target.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  if (digits.length === 6) unlock();
});
$('code').focus();
