import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'

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

const PERIOD = '2026-10-12T07:00:00Z'
const NEXT_PERIOD = '2026-10-19T07:00:00Z'

const week = (percentUsed: number, resetsAt = PERIOD): SessionRateLimit => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt,
})

// Stands for the engine beneath the plugin: records toasts and answers session.measure.
function recordToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  // The engine's own measure beneath the plugin, echoing what changed.
  on('session.measure', ($, e) => ({ changed: e.changed }))

  return toasts
}

const measure = ($: Engine, rateLimits: SessionRateLimit[], percent = 10, usd = 0) =>
  $.session.measure({
    context: { window: 200_000, percent },
    rateLimits,
    cost: { usd },
    changed: ['context', 'rateLimits', 'cost'],
  })

const session = (percentUsed: number): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt: PERIOD })

// Reset times are local, so a test compares the line with each time masked.
const maskTimes = (text: string | undefined) => text?.replace(/([A-Z][a-z]{2} )?\d\d:\d\d/g, t => (t.length > 5 ? 'Ddd hh:mm' : 'hh:mm'))

async function mountLine($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) {
  const ui = await $.ui.mount({ plugin: 'usage-bar', surface, ...abovePrompt(bodyColumns) })
  const line = (await ui.find({ type: 'Box' }))?.text
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return { line, texts }
}

const lineText = async ($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) =>
  (await mountLine($, surface, bodyColumns)).line

// The colors of the Text that shows this percent and of the Text that shows its bar; 'missing' when no Text shows a bar.
async function limitColors($: Engine, surface: (typeof SURFACES)[number], percent: string) {
  const { texts } = await mountLine($, surface)
  const bar = texts.find(t => /[█░]/.test(t.text))

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

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('showsOnlyCtxAndCost_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [], 3, 0.12)

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('ctx 3% · $0.12')
    }
  })

  // Claude Code's startup quota check: limits arrive before any response reports the context fill.
  test('showsDashForCtx_inTheStartupReading', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [session(3), week(21)],
      cost: { usd: 0 },
      changed: ['rateLimits', 'cost'],
    })

    for (const surface of SURFACES) {
      expect(maskTimes(await lineText($, surface))).toBe(
        'ctx – · $0.00 · session ░░░░░░░░ 3% (resets hh:mm) · week █░░░░░░░ 21% (resets Ddd hh:mm)',
      )
    }
  })

  // Where Claude Code keeps no cost record, a reading has no cost: a dash, not a made-up $0.00.
  test('showsDashForCost_whenReadingHasNoCost', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await $.session.measure({ context: { window: 200_000, percent: 3 }, rateLimits: [], changed: ['context'] })

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('ctx 3% · $–')
    }
  })

  test('roundsPercentsDownAndShowsCostWithTwoDecimals', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(41.9), week(18.6)], 62.7, 1.8)

    for (const surface of SURFACES) {
      expect(maskTimes(await lineText($, surface))).toBe(
        'ctx 62% · $1.80 · session ███░░░░░ 41% (resets hh:mm) · week █░░░░░░░ 18% (resets Ddd hh:mm)',
      )
    }
  })

  // Masked times are as long as real ones, so each line's length is the width it needs.
  test('picksTheWidestLayoutThatFits_byTheLinesActualLength', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(41), week(18)], 62, 1.84)

    const layouts = [
      'ctx 62% · $1.84 · session ███░░░░░ 41% (resets hh:mm) · week █░░░░░░░ 18% (resets Ddd hh:mm)',
      'ctx 62% · $1.84 · s ███░░░░░ 41% ↻ hh:mm · w █░░░░░░░ 18% ↻ Ddd hh:mm',
      'ctx 62% · $1.84 · s 41% ↻ hh:mm · w 18% ↻ Ddd hh:mm',
      'ctx 62% · $1.84 · s 41% · w 18%',
    ]
    for (const surface of SURFACES) {
      for (const [i, line] of layouts.entries()) {
        expect(maskTimes(await lineText($, surface, line.length))).toBe(line)
        expect(maskTimes(await lineText($, surface, line.length - 1))).toBe(layouts[i + 1] ?? line)
      }
    }
  })

  test('fitsItsWidth_downToTheNarrowestLayout', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(100), week(100)], 100, 123.45)

    for (const surface of SURFACES) {
      for (let columns = 40; columns <= 110; columns++) {
        expect((await lineText($, surface, columns))?.length).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('fillsBarRoundedDown_soItNeverLooksFullerThanItIs', async ($, on) => {
    mock.store(on)
    recordToasts(on)

    for (const [percent, shown] of [[12.4, '░░░░░░░░ 12%'], [99, '███████░ 99%'], [100, '████████ 100%']] as const) {
      await measure($, [week(percent)])
      for (const surface of SURFACES) {
        expect(await lineText($, surface)).toContain(shown)
      }
    }
  })

  test('colorsPercentOnly_warningFrom50AndErrorFrom95', async ($, on) => {
    mock.store(on)
    recordToasts(on)

    for (const [percent, color] of [[49.9, undefined], [50, 'warning'], [94, 'warning'], [95, 'error']] as const) {
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
    const toasts = recordToasts(on)

    for (const percent of [49.9, 50, 51, 80, 95]) {
      await measure($, [week(percent)])
    }

    expect(toasts.map(t => t.match(/(\d+)%/)?.[1])).toEqual(['50', '80', '95'])
    expect(toasts[0]).toBe('week 50%')
  })

  test('toastsOnlyTheHighest_whenOneReadingCrossesSeveral', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [week(40)])
    await measure($, [week(96)])
    await measure($, [week(97)])

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toBe('week 96%')
  })

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('neverToasts_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [], 96, 5)

    expect(toasts).toEqual([])
  })

  test('doesNotRepeat_whenStayingAboveAThreshold', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    for (const percent of [55, 60, 70]) {
      await measure($, [week(percent)])
    }

    expect(toasts).toHaveLength(1)
  })

  // A reload, or a new session in any project, starts with an empty module and the same user-global store.
  test('doesNotRepeat_afterReloadOrNewSession', async ($, on) => {
    mock.store(on, { 'toasted:seven_day': { resetsAt: PERIOD, thresholds: [50] } })
    const toasts = recordToasts(on)

    await measure($, [week(60)])

    expect(toasts).toEqual([])
  })

  test('reArmsAllThresholds_whenResetsAtChanges', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [week(96)])
    await measure($, [week(2, NEXT_PERIOD)])
    await measure($, [week(50, NEXT_PERIOD)])
    await measure($, [week(80, NEXT_PERIOD)])

    expect(toasts.map(t => t.match(/(\d+)%/)?.[1])).toEqual(['96', '50', '80'])
  })

  // The desktop app shows one toast per plugin at a time and drops the next, so a second toast from one reading would be lost.
  test('showsOneToastNamingBoth_whenOneReadingCrossesBothWindows', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

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
    const toasts = recordToasts(on)

    await measure($, [session(62), week(97)]).catch(() => undefined)

    expect(toasts).toEqual(['session 62% · week 97%'])
  })

  test('tracksSessionAndWeeklyWindowsSeparately', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [session(50), week(50)])
    await measure($, [session(80), week(55)])

    expect(toasts).toHaveLength(2)
    expect(toasts[1]).toBe('session 80%')
  })
})
