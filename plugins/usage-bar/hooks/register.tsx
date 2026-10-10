import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, Timer } from 'claude-code'

import type { LimitReading, Reading } from '../types'

const reading = atom({ plugin: 'usage-bar', key: 'reading' } as const, null)
// Bumped each minute so the countdowns redraw while no reading arrives.
const minute = atom({ plugin: 'usage-bar', key: 'minute' } as const, 0)

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

function lineItems(r: Reading, columns: number, now: number): Item[] {
  const fits = (items: Item[]) => lineLength(items) <= columns

  // The narrowest layout shows even where nothing fits.
  return LAYOUTS.map(layout => layoutItems(r, layout, now)).find(fits) ?? layoutItems(r, 'tiny', now)
}

function layoutItems(r: Reading, layout: Layout, now: number): Item[] {
  // A figure the reading lacks is a dash, not a made-up 0: the fill before any response
  // reports it, the cost where Claude Code keeps no cost record.
  const ctx = r.contextPercent === undefined ? '–' : `${Math.floor(r.contextPercent)}%`
  const usd = r.usd === undefined ? '–' : r.usd.toFixed(2)
  const conversation: Item[] = [[{ text: `${layout === 'full' ? 'context' : 'ctx'} ${ctx}` }], [{ text: `$${usd}` }]]

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
    const items = lineItems(r, e.props.bodyColumns, await $.clock.now())

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
