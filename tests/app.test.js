import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, recordCompletion, dayKey, STATS_DEFAULTS } from '../app/js/store.js';
import { sunTimes, dayPhase, seasonOf, sceneSVG } from '../app/js/scenery.js';
import { STAMPS } from '../app/js/quests.js';

const day = (s) => new Date(`${s}T12:00:00`);

test('streak counts consecutive days and survives a quest-less today', () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07'];
  assert.equal(computeStreak(days, day('2026-10-07')), 3);
  assert.equal(computeStreak(days, day('2026-10-08')), 3, 'no quest yet today keeps the streak');
  assert.equal(computeStreak(days, day('2026-10-09')), 0, 'a missed day breaks it');
  assert.equal(computeStreak([], day('2026-10-08')), 0);
});

test('recordCompletion adds totals, one day entry per day, and flags new stamps', () => {
  const date = day('2026-10-08');
  const first = recordCompletion(STATS_DEFAULTS, { type: 'tree', meters: 420, minutes: 11, date });
  assert.equal(first.isNewStamp, true);
  assert.deepEqual(first.next.days, [dayKey(date)]);
  const second = recordCompletion(first.next, { type: 'tree', meters: 80, minutes: 4, date });
  assert.equal(second.isNewStamp, false);
  assert.equal(second.next.completed, 2);
  assert.equal(second.next.meters, 500);
  assert.equal(second.next.stamps.tree, 2);
  assert.deepEqual(second.next.days, [dayKey(date)]);
  assert.deepEqual(STATS_DEFAULTS.stamps, {}, 'defaults are never mutated');
});

test('sunrise and sunset match published times (San Francisco, 8 Oct 2026)', () => {
  const sun = sunTimes(new Date('2026-10-08T19:00:00Z'), 37.77, -122.42);
  // Published: sunrise 7:12, sunset 18:44 PDT (UTC−7).
  const near = (d, iso) => Math.abs(d - new Date(iso)) < 5 * 60000;
  assert.ok(near(sun.sunrise, '2026-10-08T14:12:00Z'), sun.sunrise.toISOString());
  assert.ok(near(sun.sunset, '2026-10-09T01:44:00Z'), sun.sunset.toISOString());
  assert.equal(sunTimes(new Date('2026-06-21T12:00:00Z'), 80, 0), null, 'polar day has no sunset');
});

test('day phases follow the sun', () => {
  const sun = { sunrise: new Date('2026-10-08T07:00:00'), sunset: new Date('2026-10-08T18:45:00') };
  assert.equal(dayPhase(new Date('2026-10-08T05:00:00'), sun), 'night');
  assert.equal(dayPhase(new Date('2026-10-08T07:30:00'), sun), 'dawn');
  assert.equal(dayPhase(new Date('2026-10-08T12:00:00'), sun), 'day');
  assert.equal(dayPhase(new Date('2026-10-08T18:15:00'), sun), 'golden');
  assert.equal(dayPhase(new Date('2026-10-08T19:00:00'), sun), 'dusk');
  assert.equal(dayPhase(new Date('2026-10-08T21:00:00'), sun), 'night');
});

test('seasons flip for the southern hemisphere, and every scene renders', () => {
  assert.equal(seasonOf(52, day('2026-10-08')), 'autumn');
  assert.equal(seasonOf(-33, day('2026-10-08')), 'spring');
  for (const phase of ['dawn', 'day', 'golden', 'dusk', 'night']) {
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      assert.match(sceneSVG(phase, season), /^<svg[\s\S]*<\/svg>$/);
    }
  }
});

test('every stamp is unique', () => {
  assert.equal(new Set(STAMPS.map((s) => s.id)).size, STAMPS.length);
});
