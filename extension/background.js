// Grass Gate extension: blocks feed sites with declarativeNetRequest and unlocks them
// for a while when given a valid code from the phone. Everything is checked offline.

import { verifyCode, newSecret } from './otp.js';

const DEFAULTS = {
  sites: ['x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'tiktok.com', 'facebook.com', 'youtube.com'],
  unlockMinutes: 30,
  appUrl: 'http://localhost:8080/',
  secret: '',
  unlockUntil: 0,
  usedCodes: [],
  failures: [],
  blocked: { day: '', count: 0 },
  unlocks: { day: '', count: 0 },
};

const RULE_ID = 1;
const MAX_FAILURES_PER_MIN = 5;

const getState = () => chrome.storage.local.get(DEFAULTS);

const today = () => new Date().toDateString();
const countToday = (c) => (c.day === today() ? c.count : 0);
const bump = (c) => ({ day: today(), count: countToday(c) + 1 });

const matchesSite = (url, sites) => {
  try {
    const host = new URL(url).hostname;
    return sites.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
};

async function applyRules({ reloadTabs = false } = {}) {
  const s = await getState();
  const locked = Date.now() >= s.unlockUntil;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = locked && s.sites.length
    ? [{
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'redirect',
          // \0 is the whole matched URL, so the blocked page can send you back afterwards.
          redirect: { regexSubstitution: `${chrome.runtime.getURL('blocked.html')}#\\0` },
        },
        condition: { regexFilter: '^https?://.*', requestDomains: s.sites, resourceTypes: ['main_frame'] },
      }]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules });

  await chrome.alarms.clear('relock');
  if (!locked) chrome.alarms.create('relock', { when: s.unlockUntil });
  await chrome.action.setBadgeText({ text: locked ? '' : 'open' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2f5d3a' });

  if (locked && reloadTabs) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) if (tab.url && matchesSite(tab.url, s.sites)) chrome.tabs.reload(tab.id);
  }
}

async function unlock(rawCode) {
  const s = await getState();
  const now = Date.now();
  const recent = s.failures.filter((t) => now - t < 60_000);
  if (recent.length >= MAX_FAILURES_PER_MIN) return { ok: false, error: 'Too many wrong codes. Wait a minute.' };
  if (!s.secret) return { ok: false, error: 'Not paired yet. Open the extension options to pair your phone.' };

  const code = String(rawCode || '').replace(/\D/g, '');
  if (s.usedCodes.includes(code)) return { ok: false, error: 'That code was already used. Do another quest.' };
  if (!(await verifyCode(s.secret, code, now))) {
    await chrome.storage.local.set({ failures: [...recent, now] });
    return { ok: false, error: 'Wrong or expired code.' };
  }

  const unlockUntil = now + s.unlockMinutes * 60_000;
  await chrome.storage.local.set({
    unlockUntil, usedCodes: [...s.usedCodes.slice(-20), code], failures: [], unlocks: bump(s.unlocks),
  });
  await applyRules();
  return { ok: true, unlockUntil };
}

async function handle(msg) {
  switch (msg?.type) {
    case 'status': {
      const s = await getState();
      return {
        ok: true,
        locked: Date.now() >= s.unlockUntil,
        unlockUntil: s.unlockUntil,
        paired: !!s.secret,
        appUrl: s.appUrl,
        sites: s.sites.length,
        blockedToday: countToday(s.blocked),
        unlocksToday: countToday(s.unlocks),
      };
    }
    case 'blockedHit': {
      const s = await getState();
      const blocked = bump(s.blocked);
      await chrome.storage.local.set({ blocked });
      return { ok: true, count: blocked.count };
    }
    case 'unlock':
      return unlock(msg.code);
    case 'lockNow':
      await chrome.storage.local.set({ unlockUntil: 0 });
      await applyRules({ reloadTabs: true });
      return { ok: true };
    case 'newSecret':
      await chrome.storage.local.set({ secret: newSecret() });
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own pages.
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await getState();
  if (!s.secret) await chrome.storage.local.set({ secret: newSecret() });
  await applyRules();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => applyRules());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relock') applyRules({ reloadTabs: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sites) applyRules({ reloadTabs: true });
});
