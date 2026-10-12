import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, Timer } from 'claude-code'

import type { LimitReading, Reading } from '../types'
import { cacheLength, isCold, type CacheInputs } from './cache'

const reading = atom({ plugin: 'usage-bar', key: 'reading' } as const, null)
// Bumped each minute so the countdowns redraw while no reading arrives.
const minute = atom({ plugin: 'usage-bar', key: 'minute' } as const, 0)
const lastRequest = atom({ plugin: 'usage-bar', key: 'lastRequest' } as const, null)
// What the latest main-conversation reply showed about the cache; see CacheSeen.
const cacheSeen = atom({ plugin: 'usage-bar', key: 'cacheSeen' } as const, null)
// True while a main-conversation turn runs: the cache is being used, so it is never cold then.
const working = atom({ plugin: 'usage-bar', key: 'working' } as const, false)
const resumed = atom({ plugin: 'usage-bar', key: 'resumed' } as const, null)

// Alerts at 50%, then claude.ai's own warning (75%) and critical (90%) colours on Settings → Usage.
const THRESHOLDS = [50, 75, 90]

type Window = { label: string; letter: string }

// The two windows the line shows; any other kind (a gateway's spend_limit) is ignored.
const WINDOWS: Record<string, Window> = {
  five_hour: { label: 'session', letter: 's' },
  seven_day: { label: 'week', letter: 'w' },
}

// The line's layouts, widest first: the line uses the first whose text fits bodyColumns (see docs/usage-bar.md).
type Layout = 'full' | 'short-bars' | 'short' | 'tiny'
const LAYOUTS: Layout[] = ['full', 'short-bars', 'short', 'tiny']

const BAR_CELLS = 8

// A run of the line; a colored one shows a window's percent.
type Segment = { text: string; color?: 'warning' | 'error' }

// What $.store holds per window kind: the period's resetsAt and the thresholds already toasted in it.
type Toasted = { resetsAt: string; thresholds: number[] }

// Time left until resetsAt, in whole minutes rounded up: `3d2h`, `2h10m`, `45m`; a zero part is dropped, `4h`.
// `now` once it has passed: the limit has reset, and the next reading brings the new period's percent.
function countdown(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((new Date(resetsAt).getTime() - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  const part = (n: number, unit: string) => (n > 0 ? `${n}${unit}` : '')

  return days > 0 ? `${days}d${part(hours, 'h')}` : hours > 0 ? `${hours}h${part(minutes % 60, 'm')}` : minutes > 0 ? `${minutes}m` : 'now'
}

function bar(percent: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.floor((percent / 100) * BAR_CELLS)))

  // Braille: a full cell against a low baseline looks the same in every terminal and the desktop app, and stays light.
  return '⣿'.repeat(filled) + '⣀'.repeat(BAR_CELLS - filled)
}

const levelColor = (percent: number): Segment['color'] =>
  percent >= 90 ? 'error' : percent >= 75 ? 'warning' : undefined

function windowSegments(limit: LimitReading, layout: Layout, now: number): Segment[] | undefined {
  const window = WINDOWS[limit.kind]
  if (!window) return undefined

  const label = layout === 'full' ? window.label : window.letter
  const percent = `${Math.floor(limit.percentUsed)}%`
  const barText = layout === 'full' || layout === 'short-bars' ? `${bar(limit.percentUsed)} ` : ''
  const time = limit.resetsAt && layout !== 'tiny' ? countdown(limit.resetsAt, now) : undefined
  const resets = time === undefined ? '' : ` (↻ ${time})`

  return [{ text: `${label} ${barText}` }, { text: percent, color: levelColor(limit.percentUsed) }, { text: resets }]
}

// The line's items at the right edge: this conversation's figures, then the account's limits.
// Items are drawn apart with a dot between and a one-column gap either side of it, not a typed ` · `: the
// desktop app's spaces are narrower than a column.
type Item = Segment[]
const SEPARATOR = 3

const lineLength = (items: Item[]) =>
  items.reduce((n, item) => n + item.reduce((m, s) => m + s.text.length, 0), 0) +
  Math.max(0, items.length - 1) * SEPARATOR

function lineItems(r: Reading, columns: number, now: number, cold: boolean): Item[] {
  const fits = (items: Item[]) => lineLength(items) <= columns

  // The narrowest layout shows even where nothing fits.
  return LAYOUTS.map(layout => layoutItems(r, layout, now, cold)).find(fits) ?? layoutItems(r, 'tiny', now, cold)
}

// The cold item's text by layout: its own item after context, so it never reads as the context being cold.
// ❆ (U+2746) is not an emoji, so it takes one column; ❄ (U+2744) can draw two wide.
const COLD_TEXT: Record<Layout, string> = { full: 'cache cold', 'short-bars': 'cold', short: 'cold', tiny: '❆' }

function layoutItems(r: Reading, layout: Layout, now: number, cold: boolean): Item[] {
  // A figure the reading lacks is a dash, not a made-up 0: the fill before any response
  // reports it, the cost where Claude Code keeps no cost record.
  const ctx = r.contextPercent === undefined ? '–' : `${Math.floor(r.contextPercent)}%`
  const usd = r.usd === undefined ? '–' : r.usd.toFixed(2)
  const conversation: Item[] = [
    [{ text: `${layout === 'full' ? 'context' : 'ctx'} ${ctx}` }],
    ...(cold ? [[{ text: COLD_TEXT[layout], color: 'error' as const }]] : []),
    [{ text: `$${usd}` }],
  ]

  const limits: Item[] = []
  for (const limit of r.rateLimits) {
    const window = windowSegments(limit, layout, now)
    if (window) limits.push(window.filter(segment => segment.text !== ''))
  }

  return [...conversation, ...limits]
}

// The record to save when the window crossed a threshold not yet toasted this period, else undefined.
// It marks every crossed threshold, so a lower one never toasts later in this period.
async function freshRecord($: EngineInterface, limit: LimitReading): Promise<Toasted | undefined> {
  const period = limit.resetsAt ?? ''
  const stored = (await $.store.get(`toasted:${limit.kind}`)) as Toasted | undefined
  const shown = stored?.resetsAt === period ? stored.thresholds : []

  // A threshold counts as shown when one at least as high was: 0.1.0 stored 80 and 95, not 75 and 90.
  const crossed = THRESHOLDS.filter(t => limit.percentUsed >= t)
  if (crossed.every(t => shown.some(s => s >= t))) return undefined

  return { resetsAt: period, thresholds: crossed }
}

// Just the windows and numbers, named as in the line's full layout: `week 97%`, or `session 62% · week 97%`.
const toastText = (limits: { limit: LimitReading; window: Window }[]): string =>
  limits.map(({ limit, window }) => `${window.label} ${Math.floor(limit.percentUsed)}%`).join(' · ')

// The figures session.measure and $.session.usage() both carry, as the line keeps them.
const toReading = (u: Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>): Reading => ({
  contextPercent: u.context.percent,
  usd: u.cost?.usd,
  rateLimits: u.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
})

// After /clear the new session holds no reading, and none is measured until the next turn ends; the engine
// still has the last response's limits, so draw those. Null while it has none: before the startup quota check.
// Drawing can't write state, so the next session.measure is what stores a reading.
async function engineReading($: EngineInterface): Promise<Reading | null> {
  const usage = await $.session.usage().catch(() => undefined)

  return usage && usage.rateLimits.length > 0 ? toReading(usage) : null
}

// Read each time the check runs: the limits change, and arrive only with the first reading (A3.5).
// $.env.get takes literal names only.
async function cacheInputs($: EngineInterface): Promise<CacheInputs> {
  const settings = (await $.settings.read().catch(() => ({}))) as { promptCacheTtl?: unknown }
  const r = (await read($, reading)) ?? (await engineReading($))

  return {
    env: {
      DISABLE_PROMPT_CACHING: await $.env.get('DISABLE_PROMPT_CACHING'),
      DISABLE_PROMPT_CACHING_HAIKU: await $.env.get('DISABLE_PROMPT_CACHING_HAIKU'),
      DISABLE_PROMPT_CACHING_SONNET: await $.env.get('DISABLE_PROMPT_CACHING_SONNET'),
      DISABLE_PROMPT_CACHING_OPUS: await $.env.get('DISABLE_PROMPT_CACHING_OPUS'),
      DISABLE_PROMPT_CACHING_FABLE: await $.env.get('DISABLE_PROMPT_CACHING_FABLE'),
      DISABLE_PROMPT_CACHING_MYTHOS: await $.env.get('DISABLE_PROMPT_CACHING_MYTHOS'),
      FORCE_PROMPT_CACHING_5M: await $.env.get('FORCE_PROMPT_CACHING_5M'),
      CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      ENABLE_PROMPT_CACHING_1H: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    },
    setting: settings.promptCacheTtl,
    model: await $.session.model(),
    rateLimits: r?.rateLimits ?? [],
    cacheSeen: await read($, cacheSeen),
  }
}

// The cache warning's settings until /config offers them (plan step 8).
const WARN_COLD = true
const COLD_TOKENS = 100_000

// Whether the cache is cold now, from the plugin's state and the engine; read where the line or a toast needs it.
async function coldNow($: EngineInterface): Promise<boolean> {
  return isCold({
    warnCold: WARN_COLD,
    coldTokens: COLD_TOKENS,
    working: await read($, working),
    lastRequest: await read($, lastRequest),
    resumed: await read($, resumed),
    cacheLength: cacheLength(await cacheInputs($)),
    now: await $.clock.now(),
  })
}

export const register: Register = on => {
  // One timer per module: session.start can fire again without a reload, and a reload drops the old timer itself.
  let tick: Timer | undefined

  on('session.start', async ($, e, next) => {
    tick?.cancel()
    tick = $.clock.every(60_000, () => void update($, minute, n => n + 1))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = toReading(e)
    await update($, reading, () => r)

    // One toast per reading: the desktop app shows one toast per plugin at a time and drops the next.
    // Toast before saving the records: a failed save repeats a toast later rather than losing it.
    const crossed: { limit: LimitReading; window: Window; record: Toasted }[] = []
    for (const limit of r.rateLimits) {
      const window = WINDOWS[limit.kind]
      const record = window && (await freshRecord($, limit))
      if (window && record) crossed.push({ limit, window, record })
    }
    if (crossed.length > 0) $.ui.toast(toastText(crossed))
    for (const { limit, record } of crossed) {
      await $.store.set(`toasted:${limit.kind}`, record)
    }

    return next(e)
  })

  // $.state starts empty after /clear, /resume and /branch, and no request has told the plugin anything yet.
  // A resume or fork reports the transcript's last response, so the bar knows the pause before the first message.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await update($, lastRequest, () => null)
      await update($, resumed, () => null)
    }
    if ((e.source === 'resume' || e.source === 'fork') && e.seconds_since_last_response !== undefined && e.context_tokens !== undefined) {
      const { seconds_since_last_response: gapSeconds, context_tokens: tokens } = e
      const at = (await $.clock.now()) - gapSeconds * 1000
      await update($, lastRequest, () => ({ at, tokens }))
      await update($, resumed, () => ({
        cacheLikelyExpired: e.prompt_cache_likely_expired ?? false,
        gapSeconds,
        cacheWriteUsd: e.estimated_cache_write_usd,
      }))
    }

    return next(e)
  })

  // A compaction replaces the conversation with a summary, so the last size and a resume's verdict on it no
  // longer hold; the next request reports the new size. A precompute installs nothing, a vetoed one changes
  // nothing, a subagent's isn't ours.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await update($, lastRequest, () => null)
      await update($, resumed, () => null)
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    await update($, working, () => true)

    return next(e)
  })

  // Every way a turn ends completes it: answered, interrupted, refused or failed. A subagent's run completes
  // with its agentId while the main turn still runs; it raises no turn.start.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, working, () => false)

    return next(e)
  })

  // Subagents' requests (agentId set) run on their own cache, so only the main conversation's count.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (e.agentId !== undefined || usage === null) return result

    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = usage
    const tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens
    const at = await $.clock.now()
    await update($, lastRequest, () => ({ at, tokens }))
    await update($, resumed, () => null)
    const cached = cache_read_input_tokens > 0 || cache_creation_input_tokens > 0
    await update($, cacheSeen, () => ({ model: usage.model, cached }))

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // No reading until Claude Code's startup quota check, and none at all while not logged in: say so, so the line doesn't look missing.
    const r = (await read($, reading)) ?? (await engineReading($))
    const { Box, Text } = $.ui.resolve(e)

    if (r === null) {
      return (
        <Box flexDirection="row" justifyContent="flex-end" width="100%">
          <Text dimColor>usage: no data yet</Text>
        </Box>
      )
    }

    await read($, minute)
    const items = lineItems(r, e.props.bodyColumns, await $.clock.now(), await coldNow($))

    // Never wrap: while a desktop window is resized, a frame can draw the layout chosen for the previous width,
    // and a wrapped piece would make the row jump to two lines. Cut it short instead.
    return (
      <Box flexDirection="row" justifyContent="flex-end" columnGap={1} width="100%">
        {items.flatMap((item, i) => [
          ...(i > 0 ? [<Text dimColor wrap="truncate-end">·</Text>] : []),
          <Box key={`item:${i}`} flexDirection="row">
            {item.map(({ text, color }) =>
              color ? (
                <Text color={color} wrap="truncate-end">
                  {text}
                </Text>
              ) : (
                <Text dimColor wrap="truncate-end">
                  {text}
                </Text>
              ),
            )}
          </Box>,
        ])}
      </Box>
    )
  })
}
