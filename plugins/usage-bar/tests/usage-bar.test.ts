import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, SessionMessage, SessionRateLimit } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { cacheLength, isCold, type CacheInputs, type ColdInputs } from '../hooks/cache'

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
function engineBeneath(on: On, env: Record<string, string> = {}): { toasts: string[]; clock: MockClock } {
  const clock = mock.clock(on, { now: NOW })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  // The engine's own measure beneath the plugin, echoing what changed.
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // What the cache-length rule reads: a Haiku session with no settings, in the environment given.
  mock.env(on, env)
  on('settings.read', () => ({ value: {} }))
  on('session.model', () => ({ value: MODEL }))

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

  // The CLI always keeps a cost ledger, so before the startup quota check the engine holds only `$0.00`.
  test('showsNoDataPlaceholder_whenTheEngineHoldsOnlyTheZeroCostLedger', async ($, on) => {
    mock.store(on)
    engineUsage(on, { usd: 0 })

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('usage: no data yet')
    }
  })

  // A survey takes the row above the prompt: the line leaves it to what draws beneath.
  test('leavesTheRowToTheSurvey_whileOneShows', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    // h is typed loosely (any node, null or undefined); given a component it makes an element.
    on('ui.render', ($, e) => h($.ui.resolve(e).Text, null, 'survey') as RenderElement)
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

// The model every stand-in in this file runs: the session's, and the one each reply names.
const MODEL = 'claude-haiku-5-5'

// Usage as input / cache read / cache write / output tokens, as the API reports a request's.
const usage = (input: number, cacheRead: number, cacheWrite: number, output: number, model = MODEL) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
  model,
})

// Stands for the model beneath the plugin: each request answers with the next usage given, null for none.
function modelBeneath(on: On, usages: (ReturnType<typeof usage> | null)[]) {
  let next = 0
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usages[next++] ?? null }
  })
}

async function step($: Engine, index = 0, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index, model: MODEL, messageCount: 1, ...(agentId && { agentId }) })
  for await (const _ of stream);
  return stream.result
}

// The plugin's state as it last wrote it, by key; a key never written is absent.
function stateWrites(on: On): Record<string, unknown> {
  const written: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    written[e.key] = e.value
    return next(e)
  })

  return written
}

describe('last request', () => {
  test('savesTheTimeAndTheWholeContext_ofAMainConversationRequest', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 23_410, 15_245, 300)])

    await step($)

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_957 })
  })

  // A tool turn makes several requests; each carries the whole context, so summing them would count it twice.
  test('keepsTheLatestRequestsSize_notTheTurnsSum', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 27_298, 11_405, 100), usage(2, 38_703, 155, 50)])

    await step($, 0)
    await clock.advance(2_000)
    await step($, 1)

    expect(state.lastRequest).toEqual({ at: NOW + 2_000, tokens: 38_910 })
  })

  test('ignoresASubagentsRequest', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 38_000, 100, 50), usage(0, 0, 0, 10)])

    await step($)
    await step($, 0, 'agent-1')

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_152 })
    expect(state.cacheSeen).toEqual({ model: MODEL, cached: true })
  })

  test('keepsThePreviousRequest_whenAResponseCarriesNoUsage', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 38_000, 100, 50), null])

    await step($)
    await step($, 1)

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_152 })
  })

  test('seesNoCaching_whenARequestReadsAndWritesNoCache', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(38_663, 0, 0, 5)])

    await step($)

    expect(state.cacheSeen).toEqual({ model: MODEL, cached: false })
  })

  // The first request of a session writes the cache and reads none; that is caching at work.
  test('seesCaching_whenARequestOnlyWritesTheCache', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 0, 38_787, 5)])

    await step($)

    expect(state.cacheSeen).toEqual({ model: MODEL, cached: true })
  })

  // The latest reply counts: caching can come back on, as after a /model change away from a switched-off model.
  test('keepsWhatTheLatestReplyShowed', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(38_663, 0, 0, 5), usage(2, 0, 38_787, 5, 'claude-opus-5-5')])

    await step($)
    await step($)

    expect(state.cacheSeen).toEqual({ model: 'claude-opus-5-5', cached: true })
  })
})

// Stands for the engine's turns beneath the plugin.
function turnsBeneath(on: On) {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
}

const startTurn = ($: Engine) => $.turn.start({ text: 'hi', turnId: 't1' })

const completeTurn = ($: Engine, reason: 'answer' | 'aborted' | 'error' = 'answer', agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1_000, isAborted: reason === 'aborted', turnId: 't1', reason, ...(agentId && { agentId }) })

describe('working', () => {
  test('isWorking_fromTurnStartUntilTurnComplete', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    turnsBeneath(on)
    const state = stateWrites(on)

    await startTurn($)
    expect(state.working).toBe(true)
    await completeTurn($)
    expect(state.working).toBe(false)
  })

  test('stopsWorking_whenTheTurnIsInterruptedOrFails', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    turnsBeneath(on)
    const state = stateWrites(on)

    for (const reason of ['aborted', 'error'] as const) {
      await startTurn($)
      await completeTurn($, reason)
      expect(state.working).toBe(false)
    }
  })

  test('staysWorking_whenASubagentsRunCompletesMidTurn', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    turnsBeneath(on)
    const state = stateWrites(on)

    await startTurn($)
    await completeTurn($, 'answer', 'agent-1')

    expect(state.working).toBe(true)
  })
})

// A compaction's transcript and what it leaves: a summary message.
const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'Summary of the conversation so far.', toolUses: [] }]

// Stands for the engine's session events beneath the plugin; a compaction is vetoed when `veto` is given.
function sessionEventsBeneath(on: On, veto?: string) {
  on('classic.SessionStart', () => ({}))
  on('session.compact', () => (veto ? { skip: veto } : { messages: SUMMARY }))
}

// What Claude Code reported in the live probe's `--continue` after 461 s (plan A7).
const resume = ($: Engine, source: 'resume' | 'fork' = 'resume') =>
  $.classic.SessionStart({
    source,
    seconds_since_last_response: 461,
    context_tokens: 38_863,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 0.3109,
  })

const compact = ($: Engine, trigger: 'manual' | 'auto' | 'precompute' = 'manual', agentId?: string) =>
  $.session.compact({ trigger, messages: SUMMARY, ...(agentId && { agentId }) })

describe('session changes', () => {
  test('takesTheLastRequestAndCacheVerdict_fromAResumeOrFork', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const state = stateWrites(on)

    for (const source of ['resume', 'fork'] as const) {
      await resume($, source)

      expect(state.lastRequest).toEqual({ at: NOW - 461_000, tokens: 38_863 })
      expect(state.resumed).toEqual({ cacheLikelyExpired: true })
    }
  })

  // Claude Code's verdict was about the pause before the resume; the first request answers it.
  test('dropsTheResumeVerdict_onTheFirstRequest', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const state = stateWrites(on)
    modelBeneath(on, [usage(2, 0, 39_026, 5)])

    await resume($)
    await step($)

    expect(state.resumed).toBeNull()
    expect(state.lastRequest).toEqual({ at: NOW, tokens: 39_033 })
  })

  test('forgetsTheLastRequest_afterClear', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const state = stateWrites(on)

    await resume($)
    await $.classic.SessionStart({ source: 'clear' })

    expect(state.lastRequest).toBeNull()
    expect(state.resumed).toBeNull()
  })

  test('leavesTheLastRequestAlone_atStartup', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const state = stateWrites(on)

    await $.classic.SessionStart({ source: 'startup' })

    expect('lastRequest' in state).toBe(false)
  })

  // 400k tokens compacted to a 30k summary: a warning about re-reading 400k would be wrong.
  test('forgetsTheSizeAndResumeVerdict_afterAManualOrAutoCompaction', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const state = stateWrites(on)

    for (const trigger of ['manual', 'auto'] as const) {
      await resume($)
      await compact($, trigger)

      expect(state.lastRequest).toBeNull()
      expect(state.resumed).toBeNull()
    }
  })

  test('keepsTheSize_whenACompactionIsPrecomputedForASubagentOrVetoed', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on, 'blocked by a PreCompact hook')
    const state = stateWrites(on)

    await resume($)
    await compact($, 'precompute')
    await compact($, 'manual', 'agent-1')
    await compact($, 'manual')

    expect(state.lastRequest).toEqual({ at: NOW - 461_000, tokens: 38_863 })
    expect(state.resumed).toEqual({ cacheLikelyExpired: true })
  })
})

// A Pro subscriber within the plan's included usage, on Haiku, nothing set: the default 1 hour (plan A2).
const inputs = (over: Partial<CacheInputs> = {}): CacheInputs => ({
  env: {},
  setting: undefined,
  model: MODEL,
  rateLimits: [session(25), week(10)],
  cacheSeen: null,
  written: null,
  ...over,
})

describe('cache length', () => {
  test('isOneHour_forASubscriberWithinIncludedUsage', () => {
    expect(cacheLength(inputs())).toBe('1h')
  })

  test('isFiveMinutes_onUsageCredits_whenAWindowIsAt100', () => {
    expect(cacheLength(inputs({ rateLimits: [session(100), week(40)] }))).toBe('5m')
  })

  // An API key or a cloud provider reports no limit windows; so does a gateway's spend_limit alone.
  test('isFiveMinutes_withoutLimitWindows', () => {
    expect(cacheLength(inputs({ rateLimits: [] }))).toBe('5m')
    expect(cacheLength(inputs({ rateLimits: [{ kind: 'spend_limit', percentUsed: 10 }] }))).toBe('5m')
  })

  test('takesTheEnvOverTheSetting_andTheSettingOverTheDefault', () => {
    expect(cacheLength(inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } }))).toBe('5m')
    expect(cacheLength(inputs({ setting: '5m' }))).toBe('5m')
    expect(cacheLength(inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, setting: '5m' }))).toBe('1h')
    expect(cacheLength(inputs({ rateLimits: [], setting: '1h' }))).toBe('1h')
  })

  test('forcesFiveMinutes_overTheEnvAndSetting', () => {
    expect(cacheLength(inputs({ env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, setting: '1h' }))).toBe('5m')
  })

  // Claude Code reads 1, true, yes and on as on; FORCE_PROMPT_CACHING_5M=true forced 5 minutes, =0 did not (A12).
  test('readsAnOnOffVariable_asClaudeCodeDoes', () => {
    for (const value of ['1', 'true', 'YES', ' on ']) {
      expect(cacheLength(inputs({ env: { FORCE_PROMPT_CACHING_5M: value } }))).toBe('5m')
    }
    for (const value of ['0', 'false', '']) {
      expect(cacheLength(inputs({ env: { FORCE_PROMPT_CACHING_5M: value } }))).toBe('1h')
    }
  })

  test('isOneHour_withEnable1h_whenNoLimitWindowsShow', () => {
    expect(cacheLength(inputs({ rateLimits: [], env: { ENABLE_PROMPT_CACHING_1H: '1' } }))).toBe('1h')
  })

  test('ignoresAnUnknownLengthValue', () => {
    expect(cacheLength(inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '10m' }, setting: 5 }))).toBe('1h')
  })

  test('isOff_whenCachingIsDisabled_whateverElseIsSet', () => {
    expect(cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING: '1', FORCE_PROMPT_CACHING_5M: '1' } }))).toBe('off')
  })

  test('isOff_onlyForTheSessionsModelsSwitch', () => {
    expect(cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING_HAIKU: '1' } }))).toBe('off')
    expect(cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING_OPUS: '1' } }))).toBe('1h')
    expect(cacheLength(inputs({ model: 'claude-opus-5-5', env: { DISABLE_PROMPT_CACHING_OPUS: '1' } }))).toBe('off')
  })

  test('isOff_whenTheLatestReplyOnThisModelUsedNoCache', () => {
    expect(cacheLength(inputs({ cacheSeen: { model: MODEL, cached: false } }))).toBe('off')
  })

  test('matchesFableAndMythos_byName', () => {
    expect(cacheLength(inputs({ model: 'claude-fable-5-1', env: { DISABLE_PROMPT_CACHING_FABLE: '1' } }))).toBe('off')
    expect(cacheLength(inputs({ model: 'claude-mythos-1', env: { DISABLE_PROMPT_CACHING_MYTHOS: '1' } }))).toBe('off')
    expect(cacheLength(inputs({ model: 'claude-fable-5-1', env: { DISABLE_PROMPT_CACHING_MYTHOS: '1' } }))).toBe('1h')
  })

  // Live, claude-haiku-4-5 with DISABLE_PROMPT_CACHING_HAIKU=1 still read 23,750 tokens from the cache: Claude
  // Code's switch covers only the family's default model (A15). The reply corrects the family-name guess.
  test('trustsTheReply_overAPerModelSwitch_onTheSameModel', () => {
    const old = { model: 'claude-haiku-4-5', env: { DISABLE_PROMPT_CACHING_HAIKU: '1' } }
    expect(cacheLength(inputs(old))).toBe('off')
    expect(cacheLength(inputs({ ...old, cacheSeen: { model: 'claude-haiku-4-5-20251001', cached: true } }))).toBe('1h')
  })

  test('ignoresAReplyFromAnotherModel', () => {
    const switched = { model: 'claude-opus-5-5', env: { DISABLE_PROMPT_CACHING_OPUS: '1' } }
    expect(cacheLength(inputs({ ...switched, cacheSeen: { model: MODEL, cached: true } }))).toBe('off')
    expect(cacheLength(inputs({ cacheSeen: { model: 'claude-opus-5-5', cached: false } }))).toBe('1h')
  })

  test('takesAModelWithAContextSuffix_asTheSameModel', () => {
    expect(cacheLength(inputs({ model: 'claude-opus-5-5[1m]', cacheSeen: { model: 'claude-opus-5-5', cached: false } }))).toBe('off')
  })

  // The length the latest reply's cache was written with (A18) is what the rules only guess at.
  test('takesTheWrittenLength_overTheRules', () => {
    expect(cacheLength(inputs({ rateLimits: [], written: '1h' }))).toBe('1h')
    expect(cacheLength(inputs({ written: '5m' }))).toBe('5m')
    expect(cacheLength(inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }, written: '1h' }))).toBe('1h')
  })

  test('isOff_whateverWasWritten_whenCachingIsDisabled', () => {
    expect(cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING: '1' }, written: '1h' }))).toBe('off')
    expect(cacheLength(inputs({ cacheSeen: { model: MODEL, cached: false }, written: '1h' }))).toBe('off')
  })
})

const at = (hhmm: string) => Date.parse(`2026-10-09T${hhmm}:00Z`)

// The plan's step 5 setting: 150k tokens, 1-hour cache, last reply 13:10, now 14:20, idle, default settings.
const coldInputs = (over: Partial<ColdInputs> = {}): ColdInputs => ({
  warnCold: true,
  coldTokens: 100_000,
  working: false,
  lastRequest: { at: at('13:10'), tokens: 150_000 },
  resumed: null,
  cacheLength: '1h',
  lengthFromFile: false,
  now: at('14:20'),
  ...over,
})

describe('cold check', () => {
  test('isCold_whenTheLastReplyIsOlderThanTheCache', () => {
    expect(isCold(coldInputs())).toBe(true)
  })

  test('isNotCold_withinTheCacheLength', () => {
    expect(isCold(coldInputs({ lastRequest: { at: at('13:40'), tokens: 150_000 } }))).toBe(false)
    expect(isCold(coldInputs({ now: at('14:10') }))).toBe(false)
  })

  test('isColdAfterFiveMinutes_withAFiveMinuteCache', () => {
    expect(isCold(coldInputs({ cacheLength: '5m', now: at('13:15') }))).toBe(false)
    expect(isCold(coldInputs({ cacheLength: '5m', now: at('13:16') }))).toBe(true)
  })

  test('isNotCold_underColdTokens', () => {
    expect(isCold(coldInputs({ lastRequest: { at: at('11:00'), tokens: 60_000 } }))).toBe(false)
    expect(isCold(coldInputs({ lastRequest: { at: at('11:00'), tokens: 60_000 }, coldTokens: 50_000 }))).toBe(true)
  })

  test('isNotCold_whileATurnRuns', () => {
    expect(isCold(coldInputs({ working: true }))).toBe(false)
  })

  test('isNotCold_whenCachingIsOffOrWarningIsOff', () => {
    expect(isCold(coldInputs({ cacheLength: 'off' }))).toBe(false)
    expect(isCold(coldInputs({ warnCold: false }))).toBe(false)
  })

  // After /clear or a compaction the size is unknown until the next reply.
  test('isNotCold_withoutALastRequest', () => {
    expect(isCold(coldInputs({ lastRequest: null }))).toBe(false)
  })

  // With no length from the file, Claude Code's verdict counts right after a resume.
  test('takesClaudeCodesVerdict_rightAfterAResume_whenTheFileGaveNoLength', () => {
    const resumed = { cacheLikelyExpired: true }
    expect(isCold(coldInputs({ resumed, lastRequest: { at: at('14:13'), tokens: 150_000 } }))).toBe(true)
  })

  // Claude Code judges by the last reply's split alone, or its rules when that is empty; the file's older write knows.
  test('goesByTheFileLength_overClaudeCodesVerdict_rightAfterAResume', () => {
    const resumed = { cacheLikelyExpired: true }
    const inputs = { resumed, lengthFromFile: true, lastRequest: { at: at('14:00'), tokens: 150_000 } }
    expect(isCold(coldInputs(inputs))).toBe(false)
    expect(isCold(coldInputs({ ...inputs, now: at('15:01') }))).toBe(true)
  })

  test('turnsColdByTime_afterAResumeWhoseCacheWasStillWarm', () => {
    const resumed = { cacheLikelyExpired: false }
    expect(isCold(coldInputs({ resumed, lastRequest: { at: at('14:10'), tokens: 150_000 } }))).toBe(false)
    expect(isCold(coldInputs({ resumed, lastRequest: { at: at('14:10'), tokens: 150_000 }, now: at('15:11') }))).toBe(true)
  })
})

// A 150k-token reply at NOW (the test's modelBeneath answers it), on a subscriber's 1-hour cache, then `idle` minutes.
async function replyThenIdle($: Engine, clock: MockClock, idle: number) {
  await measure($, [session(41), week(18)], 62, 1.84)
  await step($)
  await clock.advance(idle * 60_000)
}

describe('cold line', () => {
  test('showsCacheColdInRed_afterItsOwnContextItem_onceTheCacheExpires', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    for (const surface of SURFACES) {
      const { line, texts } = await mountLine($, surface)
      expect(line).toBe('context 62% · cache cold · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)')
      expect(texts.find(t => t.text === 'cache cold')?.props.color).toBe('error')
    }
  })

  test('showsNoColdItem_withinTheCacheLength', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await replyThenIdle($, clock, 59)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  test('namesItColdOrSnowflake_inTheNarrowerLayouts', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    const layouts = [
      'context 62% · cache cold · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)',
      'ctx 62% · cold · $1.84 · s ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · w ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)',
      'ctx 62% · cold · $1.84 · s 41% (↻ 1h9m) · w 18% (↻ 3d)',
      'ctx 62% · ❆ · $1.84 · s 41% · w 18%',
    ]
    for (const surface of SURFACES) {
      for (const [i, line] of layouts.entries()) {
        expect(await lineText($, surface, line.length)).toBe(line)
        expect(await lineText($, surface, line.length - 1)).toBe(layouts[i + 1] ?? line)
      }
    }
  })

  // The docs' "At most" widths: both windows at 100%, $123.45, and the longest countdowns.
  test('needsAtMost101_82_64_40Columns_withTheColdItem', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await step($)
    await clock.advance(61 * 60_000)
    const longest = (minutes: number) => new Date(NOW + 61 * 60_000 + minutes * 60_000).toISOString()
    await measure($, [session(100, longest(4 * 60 + 59)), week(100, longest(23 * 60 + 59))], 100, 123.45)

    const widths = [101, 82, 64, 40]
    for (const [i, width] of widths.entries()) {
      const line = await lineText($, 'terminal', width)
      expect(line?.length).toBe(width)
      // The narrowest layout shows even where it doesn't fit.
      if (i < 3) expect(await lineText($, 'terminal', width - 1)).not.toBe(line)
      else expect(line).toContain('❆')
    }
  })

  test('turnsCold_onTheMinuteTimer_withoutANewReading', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await replyThenIdle($, clock, 59)

    const ui = await $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', ...abovePrompt() })
    const coldItem = async () => (await ui.findAll({ type: 'Box' })).find(box => box.key === 'item:1')?.text
    expect(await coldItem()).toBe('$1.84')
    await clock.advance(2 * 60_000)
    expect(await coldItem()).toBe('cache cold')
    await ui.unmount()
  })

  test('hidesTheColdItem_whileAReplyRuns', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    await startTurn($)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  test('showsNoColdItem_whenCachingIsDisabled', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on, { DISABLE_PROMPT_CACHING: '1' })
    // With caching off a reply reads and writes no cache, its whole context uncached (A2).
    modelBeneath(on, [usage(150_000, 0, 0, 0)])
    await replyThenIdle($, clock, 61)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  test('showsNoColdItem_whenWarnColdIsOffInConfig', { options: { warnCold: false } }, async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  // The default 100k leaves a 60k conversation alone; a lower coldTokens in /config warns about it.
  test('warnsAboutASmallerConversation_whenColdTokensIsLowered', { options: { coldTokens: 50_000 } }, async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 60_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    expect(await lineText($, 'terminal')).toContain('cache cold')
  })

  test('leavesASmallerConversationAlone_withTheDefaultColdTokens', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    modelBeneath(on, [usage(2, 60_000, 0, 0)])
    await replyThenIdle($, clock, 61)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })
})

// Where Claude Code keeps this session's conversation file, as classic.SessionStart names it.
const TRANSCRIPT = '/Users/u/.claude/projects/p/s.jsonl'

// One reply's row in the conversation file, as Claude Code writes it: the cache write split by length (A18).
const row = (oneHour: number, fiveMinutes: number) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      model: MODEL,
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: oneHour + fiveMinutes,
        cache_read_input_tokens: 150_000,
        output_tokens: 5,
        cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMinutes },
      },
    },
  })

// Stands for the conversation file beneath the plugin: each command run reads `rows`, oldest first, or fails
// as a missing file when they are null. Records each command, so a test can tell when the file was read.
function fileBeneath(on: On, rows: string[] | null) {
  const file = { rows, reads: [] as (readonly string[])[] }
  on('process.run', ($, e) => {
    file.reads.push(e.argv)
    const result = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

    return {
      value:
        file.rows === null
          ? { ...result, exitCode: 1, stdout: '', stderr: `tail: ${TRANSCRIPT}: No such file or directory` }
          : { ...result, exitCode: 0, stdout: file.rows.map(r => `${r}\n`).join('') },
    }
  })

  return file
}

// A new session whose conversation file is TRANSCRIPT; a 150k-token turn at NOW with these limit windows,
// then `idle` minutes. The file's rows are whatever fileBeneath holds when the plugin reads it.
async function fileReplyThenIdle($: Engine, clock: MockClock, rateLimits: SessionRateLimit[], idle: number) {
  await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
  await measure($, rateLimits, 62, 1.84)
  await startTurn($)
  await step($)
  await completeTurn($)
  await clock.advance(idle * 60_000)
}

// After /resume no reading comes until the next reply (A7.3); the engine still has the conversation's figures.
const engineUsage = (on: On, usage: { percent?: number; usd?: number }) =>
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200_000, ...(usage.percent !== undefined && { percent: usage.percent }) },
      rateLimits: [],
      ...(usage.usd !== undefined && { cost: { usd: usage.usd } }),
    },
  }))

// A resume of TRANSCRIPT: 150k tokens, the last reply `secondsAgo` before NOW, Claude Code's verdict on the cache.
const resumeFile = ($: Engine, secondsAgo: number, cacheLikelyExpired: boolean, source: 'resume' | 'fork' = 'resume') =>
  $.classic.SessionStart({
    source,
    transcript_path: TRANSCRIPT,
    seconds_since_last_response: secondsAgo,
    context_tokens: 150_000,
    prompt_cache_likely_expired: cacheLikelyExpired,
  })

describe('cache length from the conversation file', () => {
  // An API key reports no limit windows, so the rules say 5 minutes; the reply's own write says 1 hour.
  test('staysWarmPastFiveMinutes_whenTheFileShowsAOneHourWrite_withoutLimitWindows', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, [row(15_798, 0)])

    await fileReplyThenIdle($, clock, [], 6)
    expect(await lineText($, 'terminal')).toBe('context 62% · $1.84')
    await clock.advance(55 * 60_000)
    expect(await lineText($, 'terminal')).toBe('context 62% · cache cold · $1.84')
  })

  // Usage credits or a server switch can give a subscriber 5 minutes; only the reply shows it (Still open 1).
  test('turnsColdAfterFiveMinutes_whenTheFileShowsAFiveMinuteWrite_forASubscriber', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, [row(0, 11_237)])

    await fileReplyThenIdle($, clock, [session(41), week(18)], 6)

    expect(await lineText($, 'terminal')).toContain('cache cold')
  })

  // The review of 2026-10-12: with no windows the rules said 5 minutes, and a warm 1-hour cache showed cold early.
  test('staysWarmFor59Minutes_afterAWarmResumeOfAOneHourCache_withoutLimitWindows', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    engineUsage(on, { percent: 75, usd: 3.2 })
    fileBeneath(on, [row(15_798, 0)])

    await resumeFile($, 60, false)
    await clock.advance(58 * 60_000)
    expect(await lineText($, 'terminal')).toBe('context 75% · $3.20')
    await clock.advance(2 * 60_000)
    expect(await lineText($, 'terminal')).toBe('context 75% · cache cold · $3.20')
  })

  // A reply that only read the cache has both split fields 0: it says nothing about the length.
  test('skipsARowThatOnlyReadTheCache_forAnOlderWrite', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, [row(15_798, 0), row(0, 0)])

    await fileReplyThenIdle($, clock, [], 6)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  // Resumed 20 minutes after a reply that only read the cache, on an API key: Claude Code's verdict goes by the
  // 5-minute rule, the file's older write says 1 hour (review of 2026-10-12).
  test('staysWarmAfterAResume_whenTheLastReplyOnlyReadAOneHourCache_withoutLimitWindows', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    engineUsage(on, { percent: 75, usd: 3.2 })
    fileBeneath(on, [row(15_798, 0), row(0, 0)])

    await resumeFile($, 20 * 60, true)

    expect(await lineText($, 'terminal')).toBe('context 75% · $3.20')
  })

  // Reading the file's last bytes starts mid-row; that row is no reason to give up on the rest.
  test('readsTheRowsAfterOneTheReadCutInHalf', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, ['input_tokens":0}}}}', row(15_798, 0)])

    await fileReplyThenIdle($, clock, [], 6)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  // Without windows the rules say 5 minutes: cold after 6.
  test('fallsBackToTheRules_whenNoRowWroteTheCache', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, [row(0, 0)])

    await fileReplyThenIdle($, clock, [], 6)

    expect(await lineText($, 'terminal')).toContain('cache cold')
  })

  test('fallsBackToTheRules_whenTheFileCantBeRead', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    fileBeneath(on, null)

    await fileReplyThenIdle($, clock, [], 6)

    expect(await lineText($, 'terminal')).toContain('cache cold')
  })

  test('keepsTheLastKnownLength_whenALaterReadFails', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0), usage(2, 150_000, 0, 0)])
    const file = fileBeneath(on, [row(15_798, 0)])

    await fileReplyThenIdle($, clock, [], 1)
    file.rows = null
    await startTurn($)
    await step($)
    await completeTurn($)
    await clock.advance(6 * 60_000)

    expect(await lineText($, 'terminal')).not.toContain('cold')
  })

  // The reply reaches the file 300–600 ms after the request returns (A18); read sooner, the newest row is the
  // previous reply's.
  test('readsTheFileOneSecondAfterAMainTurn_whenItsReplyHasLanded', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    modelBeneath(on, [usage(2, 150_000, 0, 0)])
    const file = fileBeneath(on, [row(15_798, 0)])

    await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
    await measure($, [session(41), week(18)], 62, 1.84)
    await startTurn($)
    await step($)
    await completeTurn($)
    expect(file.reads).toEqual([])
    await clock.advance(500)
    file.rows = [row(15_798, 0), row(0, 11_237)]
    await clock.advance(499)
    expect(file.reads).toEqual([])
    await clock.advance(1)
    expect(file.reads).toHaveLength(1)
    expect(file.reads[0]?.at(-1)).toBe(TRANSCRIPT)

    await clock.advance(6 * 60_000)
    expect(await lineText($, 'terminal')).toContain('cache cold')
  })

  // A subagent's run ends mid-turn; its replies go to a file of its own.
  test('doesNotReadTheFile_whenASubagentsRunCompletes', async ($, on) => {
    mock.store(on)
    const { clock } = engineBeneath(on)
    sessionEventsBeneath(on)
    turnsBeneath(on)
    const file = fileBeneath(on, [row(15_798, 0)])

    await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
    await startTurn($)
    await completeTurn($, 'answer', 'agent-1')
    await clock.advance(2_000)

    expect(file.reads).toEqual([])
  })

  // On resume or fork the last reply's row is already in the file (A18 reading 2).
  test('readsTheFileAtOnce_onAResumeOrFork', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    const file = fileBeneath(on, [row(15_798, 0)])

    await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
    expect(file.reads).toEqual([])
    await resumeFile($, 60, false)
    expect(file.reads).toHaveLength(1)
    await resumeFile($, 60, false, 'fork')
    expect(file.reads).toHaveLength(2)
  })

  // An API key reports no windows; the line used to wait for the next reply's reading (review of 2026-10-12).
  test('showsContextCostAndColdAfterAResume_withoutLimitWindows', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    engineUsage(on, { percent: 75, usd: 3.2 })
    fileBeneath(on, [row(15_798, 0)])

    await resumeFile($, 2 * 3_600, true)

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe('context 75% · cache cold · $3.20')
    }
  })

  test('showsNoDataPlaceholder_afterAResume_whenTheEngineHasNoContextNorLimits', async ($, on) => {
    mock.store(on)
    engineBeneath(on)
    sessionEventsBeneath(on)
    engineUsage(on, {})
    fileBeneath(on, [row(15_798, 0)])

    await resumeFile($, 2 * 3_600, true)

    expect(await lineText($, 'terminal')).toBe('usage: no data yet')
  })
})
