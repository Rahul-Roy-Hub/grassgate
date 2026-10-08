import { formatSecret } from './otp.js';

const $ = (id) => document.getElementById(id);

const cleanSite = (line) => line.trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '')
  .replace(/^www\./, '')
  .replace(/[/?#].*$/, '');

const pairLink = (appUrl, secret) => `${appUrl.replace(/#.*$/, '')}#pair=${secret}`;

async function render() {
  const s = await chrome.storage.local.get({ sites: [], unlockMinutes: 30, appUrl: '', secret: '', unlockUntil: 0 });
  $('secret').textContent = formatSecret(s.secret);
  const link = pairLink(s.appUrl, s.secret);
  $('pair-link').href = link;
  $('pair-link').textContent = link;
  $('sites').value = s.sites.join('\n');
  $('minutes').value = s.unlockMinutes;
  $('app-url').value = s.appUrl;
  $('lock-status').textContent = Date.now() < s.unlockUntil
    ? `Unlocked until ${new Date(s.unlockUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : `Locked: ${s.sites.length} site${s.sites.length === 1 ? '' : 's'}.`;
}

$('save').addEventListener('click', async () => {
  const sites = [...new Set($('sites').value.split('\n').map(cleanSite).filter(Boolean))];
  const unlockMinutes = Math.max(5, Math.min(240, Number($('minutes').value) || 30));
  let appUrl = $('app-url').value.trim();
  if (appUrl && !appUrl.endsWith('/')) appUrl += '/';
  await chrome.storage.local.set({ sites, unlockMinutes, appUrl });
  $('saved').textContent = 'Saved.';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
  render();
});

$('lock-now').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'lockNow' });
  render();
});

$('new-secret').addEventListener('click', async () => {
  if (!confirm('Make a new pairing code? Your phone will need to pair again.')) return;
  await chrome.runtime.sendMessage({ type: 'newSecret' });
  render();
});

$('copy-link').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('pair-link').href);
  $('copy-link').textContent = 'Copied';
  setTimeout(() => { $('copy-link').textContent = 'Copy pairing link'; }, 1500);
});

render();
