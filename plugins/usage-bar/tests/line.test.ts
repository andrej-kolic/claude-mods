import { describe, type Engine, expect, mock, test } from 'claude-code/testing';
import {
  abovePrompt,
  engineBeneath,
  engineUsage,
  lineText,
  measure,
  mountLine,
  NOW,
  SURFACES,
  session,
  week,
} from './helpers';

// The colors of the Text that shows this percent and of the Text that shows its bar; 'missing' when no Text shows a bar.
async function limitColors(
  $: Engine,
  surface: (typeof SURFACES)[number],
  percent: string,
) {
  const { texts } = await mountLine($, surface);
  const bar = texts.find((t) => /[⣿⣀]/.test(t.text));

  return {
    percent: texts.find((t) => t.text === percent)?.props.color,
    bar: bar ? bar.props.color : 'missing',
  };
}

describe('line', () => {
  // Not logged in, or in the first seconds after startup: no reading has arrived yet.
  test('showsNoDataPlaceholder_beforeTheFirstReading', async ($, on) => {
    mock.store(on);
    engineBeneath(on);

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('usage: no data yet');
    }
  });

  // The CLI always keeps a cost ledger, so before the startup quota check the engine holds only `$0.00`.
  test('showsNoDataPlaceholder_whenTheEngineHoldsOnlyTheZeroCostLedger', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    engineUsage(on, { usd: 0 });

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('usage: no data yet');
    }
  });

  // A survey takes the row above the prompt: the line leaves it to what draws beneath.
  test('leavesTheRowToTheSurvey_whileOneShows', async ($, on) => {
    mock.store(on);
    engineBeneath(on, { band: 'survey' });
    await measure($, [week(40)]);

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'usage-bar',
        surface,
        ...abovePrompt(),
        props: { ...abovePrompt().props, hasSurvey: true },
      });
      const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text);
      await ui.unmount();
      expect(texts).toEqual(['survey']);
    }
  });

  // The row's text on a surface, its Texts joined by a space.
  async function rowText($: Engine, surface: (typeof SURFACES)[number]) {
    const ui = await $.ui.mount({
      plugin: 'usage-bar',
      surface,
      ...abovePrompt(),
    });
    const text = (await ui.findAll({ type: 'Text' }))
      .map((t) => t.text)
      .join(' ');
    await ui.unmount();

    return text;
  }

  // Another mod draws in the row above the prompt too: the line shows above it, never in its place.
  // One test per surface, so a failure on one never hides the other.
  for (const surface of SURFACES) {
    test(`keepsAnotherModsRowBelowTheLine_beforeTheFirstReading_on_${surface}`, async ($, on) => {
      mock.store(on);
      engineBeneath(on, { band: 'other mod' });

      const text = await rowText($, surface);
      expect(text).toMatch(/usage: no data yet.*other mod/);
    });

    test(`keepsAnotherModsRowBelowTheLine_withAReading_on_${surface}`, async ($, on) => {
      mock.store(on);
      engineBeneath(on, { band: 'other mod' });
      await measure($, [week(40)]);

      const text = await rowText($, surface);
      expect(text).toMatch(/week.*other mod/);
    });
  }

  // /clear starts a session with no reading, while the engine still holds the last response's limits.
  test('showsTheEnginesLastLimits_afterClearBeforeAnyTurn', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    on('session.usage', () => ({
      value: {
        startedAt: NOW,
        context: { window: 200_000 },
        rateLimits: [week(40)],
        cost: { usd: 0 },
      },
    }));

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe(
        'context – · $0.00 · week ⣿⣿⣿⣀⣀⣀⣀⣀ 40% (↻ 3d2h)',
      );
    }
  });

  // The engine's limits stand in only for a missing reading; a measured one is what the line shows.
  test('showsTheStoredReading_overADifferentEngineUsage', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    on('session.usage', () => ({
      value: {
        startedAt: NOW,
        context: { window: 200_000 },
        rateLimits: [week(40)],
        cost: { usd: 0 },
      },
    }));
    await measure($, [week(70)], 12, 1.5);

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe(
        'context 12% · $1.50 · week ⣿⣿⣿⣿⣿⣀⣀⣀ 70% (↻ 3d2h)',
      );
    }
  });

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('showsOnlyCtxAndCost_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await measure($, [], 3, 0.12);

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 3% · $0.12');
    }
  });

  // Claude Code's startup quota check: limits arrive before any response reports the context fill.
  test('showsDashForCtx_inTheStartupReading', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [session(3), week(21)],
      cost: { usd: 0 },
      changed: ['rateLimits', 'cost'],
    });

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe(
        'context – · $0.00 · session ⣀⣀⣀⣀⣀⣀⣀⣀ 3% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 21% (↻ 3d2h)',
      );
    }
  });

  // Where Claude Code keeps no cost record, a reading has no cost: a dash, not a made-up $0.00.
  test('showsDashForCost_whenReadingHasNoCost', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await $.session.measure({
      context: { window: 200_000, percent: 3 },
      rateLimits: [],
      changed: ['context'],
    });

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 3% · $–');
    }
  });

  test('roundsPercentsDownAndShowsCostWithTwoDecimals', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await measure($, [session(41.9), week(18.6)], 62.7, 1.8);

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe(
        'context 62% · $1.80 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      );
    }
  });

  // Each line's length is the width it needs.
  test('picksTheWidestLayoutThatFits_byTheLinesActualLength', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await measure($, [session(41), week(18)], 62, 1.84);

    const layouts = [
      'context 62% · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · w ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s 41% (↻ 2h10m) · w 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s 41% · w 18%',
    ];
    for (const surface of SURFACES) {
      for (const [i, line] of layouts.entries()) {
        expect(await lineText($, surface, line.length)).toBe(line);
        expect(await lineText($, surface, line.length - 1)).toBe(
          layouts[i + 1] ?? line,
        );
      }
    }
  });

  test('fitsItsWidth_downToTheNarrowestLayout', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    await measure($, [session(100), week(100)], 100, 123.45);

    for (const surface of SURFACES) {
      for (let columns = 40; columns <= 110; columns++) {
        expect(
          (await lineText($, surface, columns))?.length,
        ).toBeLessThanOrEqual(columns);
      }
    }
  });

  test('countsDownToEachReset_inDaysAndHoursOrHoursAndMinutes_droppingAZeroPart', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const at = (ms: number) => new Date(NOW + ms).toISOString();

    for (const [resetsAt, shown] of [
      [at(3 * 86_400_000 + 2 * 3_600_000 + 59 * 60_000), '(↻ 3d2h)'],
      [at(2 * 3_600_000 + 10 * 60_000), '(↻ 2h10m)'],
      [at(3 * 86_400_000), '(↻ 3d)'],
      [at(4 * 3_600_000), '(↻ 4h)'],
      [at(45 * 60_000), '(↻ 45m)'],
      [at(30_000), '(↻ 1m)'],
      // A reset already passed while no new reading came: the shown percent is last period's.
      [at(-60_000), '(↻ now)'],
    ] as const) {
      await measure($, [session(10, resetsAt)]);
      for (const surface of SURFACES) {
        expect(await lineText($, surface)).toContain(shown);
      }
    }
  });

  // Readings come only with turns, so an idle session's countdown moves on a timer of its own.
  test('redrawsTheCountdownEachMinute_withoutANewReading', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    on('session.start', (_$, e) => ({ cwd: e.cwd }));
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    });
    await measure($, [session(10)]);

    const ui = await $.ui.mount({
      plugin: 'usage-bar',
      surface: 'terminal',
      ...abovePrompt(),
    });
    const countdown = async () =>
      (await ui.findAll({ type: 'Box' })).find((box) => box.key === 'item:2')
        ?.text;
    expect(await countdown()).toBe('session ⣀⣀⣀⣀⣀⣀⣀⣀ 10% (↻ 2h10m)');
    await clock.advance(60_000);
    expect(await countdown()).toBe('session ⣀⣀⣀⣀⣀⣀⣀⣀ 10% (↻ 2h9m)');
    await ui.unmount();
  });

  // session.start can fire again in one module's life; a second timer would redraw the line twice a minute.
  test('keepsOneTimer_whenSessionStartFiresAgain', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    on('session.start', (_$, e) => ({ cwd: e.cwd }));
    let ticks = 0;
    on('state.set', (_$, e, next) => {
      if (e.key === 'minute') ticks++;
      return next(e);
    });
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    });
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    });

    await clock.advance(60_000);

    expect(ticks).toBe(1);
  });

  test('fillsBarRoundedDown_soItNeverLooksFullerThanItIs', async ($, on) => {
    mock.store(on);
    engineBeneath(on);

    for (const [percent, shown] of [
      [12.4, '⣀⣀⣀⣀⣀⣀⣀⣀ 12%'],
      [99, '⣿⣿⣿⣿⣿⣿⣿⣀ 99%'],
      [100, '⣿⣿⣿⣿⣿⣿⣿⣿ 100%'],
    ] as const) {
      await measure($, [week(percent)]);
      for (const surface of SURFACES) {
        expect(await lineText($, surface)).toContain(shown);
      }
    }
  });

  test('colorsPercentOnly_warningFrom75AndErrorFrom90', async ($, on) => {
    mock.store(on);
    engineBeneath(on);

    for (const [percent, color] of [
      [74.9, undefined],
      [75, 'warning'],
      [89, 'warning'],
      [90, 'error'],
    ] as const) {
      await measure($, [week(percent)]);
      for (const surface of SURFACES) {
        expect(
          await limitColors($, surface, `${Math.floor(percent)}%`),
        ).toEqual({ percent: color, bar: undefined });
      }
    }
  });
});
