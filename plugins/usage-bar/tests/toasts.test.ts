import { describe, expect, mock, test } from 'claude-code/testing';
import { engineBeneath, measure, PERIOD, session, week } from './helpers';

// The weekly reset after PERIOD's.
const NEXT_PERIOD = '2026-10-19T07:00:00Z';

describe('toasts', () => {
  test('toastsEachThresholdOnce_andCountsExactly50AsCrossed', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    for (const percent of [49.9, 50, 51, 75, 90]) {
      await measure($, [week(percent)]);
    }

    expect(toasts.map((t) => t.match(/(\d+)%/)?.[1])).toEqual([
      '50',
      '75',
      '90',
    ]);
    expect(toasts[0]).toBe('week 50%');
  });

  test('toastsOnlyTheHighest_whenOneReadingCrossesSeveral', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    await measure($, [week(40)]);
    await measure($, [week(96)]);
    await measure($, [week(97)]);

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toBe('week 96%');
  });

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('neverToasts_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    await measure($, [], 96, 5);

    expect(toasts).toEqual([]);
  });

  test('doesNotRepeat_whenStayingAboveAThreshold', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    for (const percent of [55, 60, 70]) {
      await measure($, [week(percent)]);
    }

    expect(toasts).toHaveLength(1);
  });

  // A reload, or a new session in any project, starts with an empty module and the same user-global store.
  test('doesNotRepeat_afterReloadOrNewSession', async ($, on) => {
    mock.store(on, {
      'toasted:seven_day': { resetsAt: PERIOD, thresholds: [50] },
    });
    const { toasts } = engineBeneath(on);

    await measure($, [week(60)]);

    expect(toasts).toEqual([]);
  });

  // 0.1.0 alerted at 50, 80 and 95; its records outlive the update until the period resets.
  test('doesNotRepeat_whenAnOlderVersionStoredAHigherThreshold', async ($, on) => {
    mock.store(on, {
      'toasted:seven_day': { resetsAt: PERIOD, thresholds: [50, 80] },
    });
    const { toasts } = engineBeneath(on);

    await measure($, [week(82)]);

    expect(toasts).toEqual([]);
  });

  test('reArmsAllThresholds_whenResetsAtChanges', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    await measure($, [week(96)]);
    await measure($, [week(2, NEXT_PERIOD)]);
    await measure($, [week(50, NEXT_PERIOD)]);
    await measure($, [week(75, NEXT_PERIOD)]);

    expect(toasts.map((t) => t.match(/(\d+)%/)?.[1])).toEqual([
      '96',
      '50',
      '75',
    ]);
  });

  // The desktop app shows one toast per plugin at a time and drops the next, so a second toast from one reading would be lost.
  test('showsOneToastNamingBoth_whenOneReadingCrossesBothWindows', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    await measure($, [session(62), week(97)]);

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toBe('session 62% · week 97%');
  });

  // A failed save may repeat a toast on the next reading, but never loses one.
  test('stillToasts_whenSavingAWindowRecordFails', async ($, on) => {
    // A store in memory whose weekly write fails; mock.store has no way to fail a write.
    const store = new Map<string, unknown>();
    on('store.get', (_$, e) => ({ value: store.get(e.key) }));
    on('store.set', (_$, e) => {
      if (e.key === 'toasted:seven_day') throw new Error('disk full');
      store.set(e.key, e.value);

      return { value: undefined };
    });
    const { toasts } = engineBeneath(on);

    await measure($, [session(62), week(97)]).catch(() => undefined);

    expect(toasts).toEqual(['session 62% · week 97%']);
  });

  test('tracksSessionAndWeeklyWindowsSeparately', async ($, on) => {
    mock.store(on);
    const { toasts } = engineBeneath(on);

    await measure($, [session(50), week(50)]);
    await measure($, [session(75), week(55)]);

    expect(toasts).toHaveLength(2);
    expect(toasts[1]).toBe('session 75%');
  });
});
