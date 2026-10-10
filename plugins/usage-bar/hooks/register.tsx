import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LimitReading, Reading } from '../types'

const reading = atom({ plugin: 'usage-bar', key: 'reading' } as const, null)

const THRESHOLDS = [50, 80, 95]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Window = { label: string; letter: string; showsDay: boolean }

// The two windows the line shows; any other kind (a gateway's spend_limit) is ignored.
const WINDOWS: Record<string, Window> = {
  five_hour: { label: 'session', letter: 's', showsDay: false },
  seven_day: { label: 'week', letter: 'w', showsDay: true },
}

// The line's layouts, widest first: the line uses the first whose text fits bodyColumns (see docs/usage-bar.md).
type Layout = 'full' | 'short-bars' | 'short' | 'tiny'
const LAYOUTS: Layout[] = ['full', 'short-bars', 'short', 'tiny']

const BAR_CELLS = 8

// A run of the line; a colored one shows a window's percent.
type Segment = { text: string; color?: 'warning' | 'error' }

// What $.store holds per window kind: the period's resetsAt and the thresholds already toasted in it.
type Toasted = { resetsAt: string; thresholds: number[] }

const pad = (n: number) => String(n).padStart(2, '0')

function resetTime(resetsAt: string, showsDay: boolean): string {
  const date = new Date(resetsAt)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  return showsDay ? `${DAYS[date.getDay()]} ${time}` : time
}

function bar(percent: number): string {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.floor((percent / 100) * BAR_CELLS)))

  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

const levelColor = (percent: number): Segment['color'] =>
  percent >= 95 ? 'error' : percent >= 50 ? 'warning' : undefined

function windowSegments(limit: LimitReading, layout: Layout): Segment[] | undefined {
  const window = WINDOWS[limit.kind]
  if (!window) return undefined

  const label = layout === 'full' ? window.label : window.letter
  const percent = `${Math.floor(limit.percentUsed)}%`
  const barText = layout === 'full' || layout === 'short-bars' ? `${bar(limit.percentUsed)} ` : ''
  const time = limit.resetsAt && layout !== 'tiny' ? resetTime(limit.resetsAt, window.showsDay) : undefined
  const resets = time === undefined ? '' : layout === 'full' ? ` (resets ${time})` : ` ↻ ${time}`

  return [{ text: `${label} ${barText}` }, { text: percent, color: levelColor(limit.percentUsed) }, { text: resets }]
}

function lineSegments(r: Reading, columns: number): Segment[] {
  const fits = (segments: Segment[]) => segments.reduce((n, s) => n + s.text.length, 0) <= columns

  // The narrowest layout shows even where nothing fits.
  return LAYOUTS.map(layout => layoutSegments(r, layout)).find(fits) ?? layoutSegments(r, 'tiny')
}

function layoutSegments(r: Reading, layout: Layout): Segment[] {
  // A figure the reading lacks is a dash, not a made-up 0: the fill before any response
  // reports it, the cost where Claude Code keeps no cost record.
  const ctx = r.contextPercent === undefined ? '–' : `${Math.floor(r.contextPercent)}%`
  const usd = r.usd === undefined ? '–' : r.usd.toFixed(2)
  const segments: Segment[] = [{ text: `ctx ${ctx} · $${usd}` }]

  for (const limit of r.rateLimits) {
    const window = windowSegments(limit, layout)
    if (window) segments.push({ text: ' · ' }, ...window)
  }

  return segments.filter(segment => segment.text !== '')
}

// The record to save when the window crossed a threshold not yet toasted this period, else undefined.
// It marks every crossed threshold, so a lower one never toasts later in this period.
async function freshRecord($: EngineInterface, limit: LimitReading): Promise<Toasted | undefined> {
  const period = limit.resetsAt ?? ''
  const stored = (await $.store.get(`toasted:${limit.kind}`)) as Toasted | undefined
  const shown = stored?.resetsAt === period ? stored.thresholds : []

  const crossed = THRESHOLDS.filter(t => limit.percentUsed >= t)
  if (crossed.every(t => shown.includes(t))) return undefined

  return { resetsAt: period, thresholds: crossed }
}

// Just the windows and numbers, named as in the line's full layout: `week 97%`, or `session 62% · week 97%`.
const toastText = (limits: { limit: LimitReading; window: Window }[]): string =>
  limits.map(({ limit, window }) => `${window.label} ${Math.floor(limit.percentUsed)}%`).join(' · ')

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    const r: Reading = {
      contextPercent: e.context.percent,
      usd: e.cost?.usd,
      rateLimits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    }
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
    const r = await read($, reading)
    const { Box, Text } = $.ui.resolve(e)

    if (r === null) {
      return (
        <Box>
          <Text dimColor>usage: no data yet</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        {lineSegments(r, e.props.bodyColumns).map(({ text, color }) =>
          color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>,
        )}
      </Box>
    )
  })
}
