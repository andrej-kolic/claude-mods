import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const band = (bodyColumns = 120) =>
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

async function mountBand($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) {
  const ui = await $.ui.mount({ plugin: 'usage-bar', surface, ...band(bodyColumns) })
  const line = (await ui.find({ type: 'Box' }))?.text
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return { line, texts }
}

const bandText = async ($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) =>
  (await mountBand($, surface, bodyColumns)).line

// The color of the Text that shows this percent.
async function percentColor($: Engine, surface: (typeof SURFACES)[number], percent: string) {
  const { texts } = await mountBand($, surface)

  return texts.find(t => t.text.endsWith(` ${percent}`))?.props.color
}

describe('band', () => {
  // Not logged in, or before Claude Code's first request: no reading has arrived yet.
  test('showsWaitingPlaceholder_beforeTheFirstReading', async ($, on) => {
    mock.store(on)

    for (const surface of SURFACES) {
      expect(await bandText($, surface)).toBe('usage: waiting for the first reply')
    }
  })

  // An API-key user, off a subscription, gets readings with no rate limits.
  test('showsOnlyCtxAndCost_whenRateLimitsAreEmpty', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [], 3, 0.12)

    for (const surface of SURFACES) {
      expect(await bandText($, surface)).toBe('ctx 3% · $0.12')
    }
  })

  test('roundsPercentsDownAndShowsCostWithTwoDecimals', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(41.9), week(18.6)], 62.7, 1.8)

    for (const surface of SURFACES) {
      expect(maskTimes(await bandText($, surface))).toBe(
        'ctx 62% · $1.80 · session ███░░░░░ 41% (resets hh:mm) · week █░░░░░░░ 18% (resets Ddd hh:mm)',
      )
    }
  })

  test('picksLayoutByWidth_atThe100And76And56ColumnBreakpoints', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(41), week(18)], 62, 1.84)

    const expected: [number, string][] = [
      [100, 'ctx 62% · $1.84 · session ███░░░░░ 41% (resets hh:mm) · week █░░░░░░░ 18% (resets Ddd hh:mm)'],
      [99, 'ctx 62% · $1.84 · s ███░░░░░ 41% ↻ hh:mm · w █░░░░░░░ 18% ↻ Ddd hh:mm'],
      [76, 'ctx 62% · $1.84 · s ███░░░░░ 41% ↻ hh:mm · w █░░░░░░░ 18% ↻ Ddd hh:mm'],
      [75, 'ctx 62% · $1.84 · s 41% ↻ hh:mm · w 18% ↻ Ddd hh:mm'],
      [56, 'ctx 62% · $1.84 · s 41% ↻ hh:mm · w 18% ↻ Ddd hh:mm'],
      [55, 'ctx 62% · $1.84 · s 41% · w 18%'],
    ]
    for (const surface of SURFACES) {
      for (const [columns, line] of expected) {
        expect(maskTimes(await bandText($, surface, columns))).toBe(line)
      }
    }
  })

  test('fitsItsWidth_withTheLongestFigures', async ($, on) => {
    mock.store(on)
    recordToasts(on)
    await measure($, [session(100), week(100)], 100, 123.45)

    for (const surface of SURFACES) {
      for (const columns of [100, 76, 56]) {
        expect((await bandText($, surface, columns))?.length).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('fillsBarRoundedDown_soItNeverLooksFullerThanItIs', async ($, on) => {
    mock.store(on)
    recordToasts(on)

    for (const [percent, shown] of [[12.4, '░░░░░░░░ 12%'], [99, '███████░ 99%'], [100, '████████ 100%']] as const) {
      await measure($, [week(percent)])
      for (const surface of SURFACES) {
        expect(await bandText($, surface)).toContain(shown)
      }
    }
  })

  test('colorsBarAndPercent_warningFrom50AndErrorFrom95', async ($, on) => {
    mock.store(on)
    recordToasts(on)

    for (const [percent, color] of [[49.9, undefined], [50, 'warning'], [94, 'warning'], [95, 'error']] as const) {
      await measure($, [week(percent)])
      for (const surface of SURFACES) {
        expect(await percentColor($, surface, `${Math.floor(percent)}%`)).toBe(color)
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

    expect(toasts.map(t => t.match(/limit (\d+)%/)?.[1])).toEqual(['50', '80', '95'])
    expect(toasts[0]).toMatch(/^Weekly limit 50% used — resets [A-Z][a-z]{2} \d\d:\d\d$/)
  })

  test('toastsOnlyTheHighest_whenOneReadingCrossesSeveral', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [week(40)])
    await measure($, [week(96)])
    await measure($, [week(97)])

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/^Weekly limit 96% used/)
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

    expect(toasts.map(t => t.match(/limit (\d+)%/)?.[1])).toEqual(['96', '50', '80'])
  })

  test('tracksSessionAndWeeklyWindowsSeparately', async ($, on) => {
    mock.store(on)
    const toasts = recordToasts(on)

    await measure($, [session(50), week(50)])

    expect(toasts.map(t => t.split(' ')[0])).toEqual(['Session', 'Weekly'])
  })
})
