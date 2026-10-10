import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const abovePrompt = (bodyColumns = 120) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

const SURFACES = ['terminal', 'desktop'] as const

// The clock every test runs at, and the resets the line counts down to from it.
const NOW = Date.parse('2026-10-09T05:00:00Z')
const SESSION_PERIOD = '2026-10-09T07:10:00Z' // (↻ 2h10m)
const PERIOD = '2026-10-12T07:00:00Z' // (↻ 3d2h)
const NEXT_PERIOD = '2026-10-19T07:00:00Z'

const week = (percentUsed: number, resetsAt = PERIOD): SessionRateLimit => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt,
})

// Stands for the engine beneath the plugin: records toasts, answers session.measure, and runs a clock from NOW.
function engineBeneath(on: On): { toasts: string[]; clock: MockClock } {
  const clock = mock.clock(on, { now: NOW })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  // The engine's own measure beneath the plugin, echoing what changed.
  on('session.measure', ($, e) => ({ changed: e.changed }))

  return { toasts, clock }
}

const measure = ($: Engine, rateLimits: SessionRateLimit[], percent = 10, usd = 0) =>
  $.session.measure({
    context: { window: 200_000, percent },
    rateLimits,
    cost: { usd },
    changed: ['context', 'rateLimits', 'cost'],
  })

const session = (percentUsed: number, resetsAt = SESSION_PERIOD): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt })


async function mountLine($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) {
  const ui = await $.ui.mount({ plugin: 'usage-bar', surface, ...abovePrompt(bodyColumns) })
  // Items are drawn apart with a dot between; ` · ` stands for that.
  const boxes = await ui.findAll({ type: 'Box' })
  const items = boxes.filter(box => box.key?.startsWith('item:')).map(box => box.text)
  // The whole line sits at the right edge, and the gap either side of each dot is the layout's, not typed spaces.
  expect(boxes[0]?.props.justifyContent).toBe('flex-end')
  if (items.length > 0) expect(boxes[0]?.props.columnGap).toBe(1)
  const line = items.length > 0 ? items.join(' · ') : boxes[0]?.text
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return { line, texts }
}

const lineText = async ($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) =>
  (await mountLine($, surface, bodyColumns)).line

// The colors of the Text that shows this percent and of the Text that shows its bar; 'missing' when no Text shows a bar.
async function limitColors($: Engine, surface: (typeof SURFACES)[number], percent: string) {
  const { texts } = await mountLine($, surface)
  const bar = texts.find(t => /[⣿⣀]/.test(t.text))

  return {
    percent: texts.find(t => t.text === percent)?.props.color,
    bar: bar ? bar.props.color : 'missing',
  }
}

describe('line', () => {
  // Not logged in, or in the first seconds after startup: no reading has arrived yet.
  test('showsNoDataPlaceholder_beforeTheFirstReading', async ($, on) => {
    mock.store(on)

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('usage: no data yet')
    }
  })

  // A survey takes the row above the prompt: the line leaves it to what draws beneath.
  test('leavesTheRowToTheSurvey_whileOneShows', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, null, 'survey'))
    await measure($, [week(40)])

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'usage-bar',
        surface,
        ...abovePrompt(),
        props: { ...abovePrompt().props, hasSurvey: true },
      })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      await ui.unmount()
      expect(texts).toEqual(['survey'])
    }
  })

  // /clear starts a session with no reading, while the engine still holds the last response's limits.
  test('showsTheEnginesLastLimits_afterClearBeforeAnyTurn', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    on('session.usage', () => ({
      value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [week(40)], cost: { usd: 0 } },
    }))

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context – · $0.00 · week ⣿⣿⣿⣀⣀⣀⣀⣀ 40% (↻ 3d2h)')
    }
  })

  // The engine's limits stand in only for a missing reading; a measured one is what the line shows.
  test('showsTheStoredReading_overADifferentEngineUsage', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    on('session.usage', () => ({
      value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [week(40)], cost: { usd: 0 } },
    }))
    await measure($, [week(70)], 12, 1.5)

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 12% · $1.50 · week ⣿⣿⣿⣿⣿⣀⣀⣀ 70% (↻ 3d2h)')
    }
  })

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('showsOnlyCtxAndCost_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await measure($, [], 3, 0.12)

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 3% · $0.12')
    }
  })

  // Claude Code's startup quota check: limits arrive before any response reports the context fill.
  test('showsDashForCtx_inTheStartupReading', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [session(3), week(21)],
      cost: { usd: 0 },
      changed: ['rateLimits', 'cost'],
    })

    for (const surface of SURFACES) {
      expect((await lineText($, surface))).toBe(
        'context – · $0.00 · session ⣀⣀⣀⣀⣀⣀⣀⣀ 3% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 21% (↻ 3d2h)',
      )
    }
  })

  // Where Claude Code keeps no cost record, a reading has no cost: a dash, not a made-up $0.00.
  test('showsDashForCost_whenReadingHasNoCost', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await $.session.measure({ context: { window: 200_000, percent: 3 }, rateLimits: [], changed: ['context'] })

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 3% · $–')
    }
  })

  test('roundsPercentsDownAndShowsCostWithTwoDecimals', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await measure($, [session(41.9), week(18.6)], 62.7, 1.8)

    for (const surface of SURFACES) {
      expect((await lineText($, surface))).toBe(
        'context 62% · $1.80 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      )
    }
  })

  // Each line's length is the width it needs.
  test('picksTheWidestLayoutThatFits_byTheLinesActualLength', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await measure($, [session(41), week(18)], 62, 1.84)

    const layouts = [
      'context 62% · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · w ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s 41% (↻ 2h10m) · w 18% (↻ 3d2h)',
      'ctx 62% · $1.84 · s 41% · w 18%',
    ]
    for (const surface of SURFACES) {
      for (const [i, line] of layouts.entries()) {
        expect((await lineText($, surface, line.length))).toBe(line)
        expect((await lineText($, surface, line.length - 1))).toBe(layouts[i + 1] ?? line)
      }
    }
  })

  test('fitsItsWidth_downToTheNarrowestLayout', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    await measure($, [session(100), week(100)], 100, 123.45)

    for (const surface of SURFACES) {
      for (let columns = 40; columns <= 110; columns++) {
        expect((await lineText($, surface, columns))?.length).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('countsDownToEachReset_inDaysAndHoursOrHoursAndMinutes_droppingAZeroPart', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const at = (ms: number) => new Date(NOW + ms).toISOString()

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
      await measure($, [session(10, resetsAt)])
      for (const surface of SURFACES) {
        expect(await lineText($, surface)).toContain(shown)
      }
    }
  })

  // Readings come only with turns, so an idle session's countdown moves on a timer of its own.
  test('redrawsTheCountdownEachMinute_withoutANewReading', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await measure($, [session(10)])

    const ui = await $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', ...abovePrompt() })
    const countdown = async () => (await ui.findAll({ type: 'Box' })).find(box => box.key === 'item:2')?.text
    expect(await countdown()).toBe('session ⣀⣀⣀⣀⣀⣀⣀⣀ 10% (↻ 2h10m)')
    await clock.advance(60_000)
    expect(await countdown()).toBe('session ⣀⣀⣀⣀⣀⣀⣀⣀ 10% (↻ 2h9m)')
    await ui.unmount()
  })

  // session.start can fire again in one module's life; a second timer would redraw the line twice a minute.
  test('keepsOneTimer_whenSessionStartFiresAgain', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    let ticks = 0
    on('state.set', ($, e, next) => {
      if (e.key === 'minute') ticks++
      return next(e)
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    await clock.advance(60_000)

    expect(ticks).toBe(1)
  })

  test('fillsBarRoundedDown_soItNeverLooksFullerThanItIs', async ($, on) => {
    mock.store(on)
    engineBeneath(on)

    for (const [percent, shown] of [[12.4, '⣀⣀⣀⣀⣀⣀⣀⣀ 12%'], [99, '⣿⣿⣿⣿⣿⣿⣿⣀ 99%'], [100, '⣿⣿⣿⣿⣿⣿⣿⣿ 100%']] as const) {
      await measure($, [week(percent)])
      for (const surface of SURFACES) {
        expect(await lineText($, surface)).toContain(shown)
      }
    }
  })

  test('colorsPercentOnly_warningFrom75AndErrorFrom90', async ($, on) => {
    mock.store(on)
    engineBeneath(on)

    for (const [percent, color] of [[74.9, undefined], [75, 'warning'], [89, 'warning'], [90, 'error']] as const) {
      await measure($, [week(percent)])
      for (const surface of SURFACES) {
        expect(await limitColors($, surface, `${Math.floor(percent)}%`)).toEqual({ percent: color, bar: undefined })
      }
    }
  })
})

describe('toasts', () => {
  test('toastsEachThresholdOnce_andCountsExactly50AsCrossed', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    for (const percent of [49.9, 50, 51, 75, 90]) {
      await measure($, [week(percent)])
    }

    expect(toasts.map(t => t.match(/(\d+)%/)?.[1])).toEqual(['50', '75', '90'])
    expect(toasts[0]).toBe('week 50%')
  })

  test('toastsOnlyTheHighest_whenOneReadingCrossesSeveral', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    await measure($, [week(40)])
    await measure($, [week(96)])
    await measure($, [week(97)])

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toBe('week 96%')
  })

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('neverToasts_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    await measure($, [], 96, 5)

    expect(toasts).toEqual([])
  })

  test('doesNotRepeat_whenStayingAboveAThreshold', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    for (const percent of [55, 60, 70]) {
      await measure($, [week(percent)])
    }

    expect(toasts).toHaveLength(1)
  })

  // A reload, or a new session in any project, starts with an empty module and the same user-global store.
  test('doesNotRepeat_afterReloadOrNewSession', async ($, on) => {
    mock.store(on, { 'toasted:seven_day': { resetsAt: PERIOD, thresholds: [50] } })
    const { toasts } = engineBeneath(on)

    await measure($, [week(60)])

    expect(toasts).toEqual([])
  })

  // 0.1.0 alerted at 50, 80 and 95; its records outlive the update until the period resets.
  test('doesNotRepeat_whenAnOlderVersionStoredAHigherThreshold', async ($, on) => {
    mock.store(on, { 'toasted:seven_day': { resetsAt: PERIOD, thresholds: [50, 80] } })
    const { toasts } = engineBeneath(on)

    await measure($, [week(82)])

    expect(toasts).toEqual([])
  })

  test('reArmsAllThresholds_whenResetsAtChanges', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    await measure($, [week(96)])
    await measure($, [week(2, NEXT_PERIOD)])
    await measure($, [week(50, NEXT_PERIOD)])
    await measure($, [week(75, NEXT_PERIOD)])

    expect(toasts.map(t => t.match(/(\d+)%/)?.[1])).toEqual(['96', '50', '75'])
  })

  // The desktop app shows one toast per plugin at a time and drops the next, so a second toast from one reading would be lost.
  test('showsOneToastNamingBoth_whenOneReadingCrossesBothWindows', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    await measure($, [session(62), week(97)])

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toBe('session 62% · week 97%')
  })

  // A failed save may repeat a toast on the next reading, but never loses one.
  test('stillToasts_whenSavingAWindowRecordFails', async ($, on) => {
    // A store in memory whose weekly write fails; mock.store has no way to fail a write.
    const store = new Map<string, unknown>()
    on('store.get', ($, e) => ({ value: store.get(e.key) }))
    on('store.set', ($, e) => {
      if (e.key === 'toasted:seven_day') throw new Error('disk full')
      store.set(e.key, e.value)

      return { value: undefined }
    })
    const { toasts } = engineBeneath(on)

    await measure($, [session(62), week(97)]).catch(() => undefined)

    expect(toasts).toEqual(['session 62% · week 97%'])
  })

  test('tracksSessionAndWeeklyWindowsSeparately', async ($, on) => {
    mock.store(on)
    const { toasts } = engineBeneath(on)

    await measure($, [session(50), week(50)])
    await measure($, [session(75), week(55)])

    expect(toasts).toHaveLength(2)
    expect(toasts[1]).toBe('session 75%')
  })
})
