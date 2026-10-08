// Per-device state in localStorage: settings, stats, streaks, stamps. Nothing here is sent anywhere.

export const STATS_DEFAULTS = { completed: 0, meters: 0, minutes: 0, days: [], stamps: {}, lastPos: null };

export function loadJSON(key, defaults) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return { ...structuredClone(defaults), ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return structuredClone(defaults);
  }
}

export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full */ }
}

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Consecutive days with at least one quest. Today without a quest yet doesn't break it.
export function computeStreak(days, today = new Date()) {
  const done = new Set(days);
  const d = new Date(today);
  if (!done.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (done.has(dayKey(d))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function recordCompletion(stats, { type, meters, minutes, date = new Date() }) {
  const day = dayKey(date);
  return {
    isNewStamp: !stats.stamps[type],
    next: {
      ...stats,
      completed: stats.completed + 1,
      meters: stats.meters + meters,
      minutes: stats.minutes + minutes,
      days: stats.days.includes(day) ? stats.days : [...stats.days, day].slice(-400),
      stamps: { ...stats.stamps, [type]: (stats.stamps[type] || 0) + 1 },
    },
  };
}
