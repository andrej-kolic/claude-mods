import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LimitReading, Reading } from '../types'

const reading = atom({ plugin: 'usage-band', key: 'reading' } as const, null)

const THRESHOLDS = [50, 80, 95]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The two windows the band shows; any other kind (a gateway's spend_limit) is ignored.
const WINDOWS: Record<string, { label: string; letter: string; name: string; showsDay: boolean }> = {
  five_hour: { label: 'session', letter: 's', name: 'Session', showsDay: false },
  seven_day: { label: 'week', letter: 'w', name: 'Weekly', showsDay: true },
}

// The band's layouts, widest first, each used from its minimum bodyColumns (see docs/usage-band.md).
type Layout = 'full' | 'short-bars' | 'short' | 'tiny'
const LAYOUTS: [minColumns: number, layout: Layout][] = [
  [100, 'full'],
  [76, 'short-bars'],
  [56, 'short'],
  [0, 'tiny'],
]

const BAR_CELLS = 8

// A run of the band's line; a colored one shows a window's bar and percent.
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
  const shown = layout === 'full' || layout === 'short-bars' ? `${bar(limit.percentUsed)} ${percent}` : percent
  const time = limit.resetsAt && layout !== 'tiny' ? resetTime(limit.resetsAt, window.showsDay) : undefined
  const resets = time === undefined ? '' : layout === 'full' ? ` (resets ${time})` : ` ↻ ${time}`

  return [{ text: `${label} ` }, { text: shown, color: levelColor(limit.percentUsed) }, { text: resets }]
}

function bandSegments(r: Reading, columns: number): Segment[] {
  const layout = LAYOUTS.find(([min]) => columns >= min)?.[1] ?? 'tiny'
  // A reading can come before any response reports the fill: a dash, not a made-up 0%.
  const ctx = r.contextPercent === undefined ? '–' : `${Math.floor(r.contextPercent)}%`
  const segments: Segment[] = [{ text: `ctx ${ctx} · $${(r.usd ?? 0).toFixed(2)}` }]

  for (const limit of r.rateLimits) {
    const window = windowSegments(limit, layout)
    if (window) segments.push({ text: ' · ' }, ...window)
  }

  return segments.filter(segment => segment.text !== '')
}

async function toastCrossings($: EngineInterface, limit: LimitReading): Promise<void> {
  const window = WINDOWS[limit.kind]
  if (!window) return

  const key = `toasted:${limit.kind}`
  const period = limit.resetsAt ?? ''
  const stored = (await $.store.get(key)) as Toasted | undefined
  const shown = stored?.resetsAt === period ? stored.thresholds : []

  const crossed = THRESHOLDS.filter(t => limit.percentUsed >= t)
  const fresh = crossed.filter(t => !shown.includes(t))
  if (fresh.length === 0) return

  // Mark every crossed threshold before toasting, so a lower one never toasts later in this period.
  await $.store.set(key, { resetsAt: period, thresholds: crossed } satisfies Toasted)

  const resets = limit.resetsAt ? ` — resets ${resetTime(limit.resetsAt, window.showsDay)}` : ''
  $.ui.toast(`${window.name} limit ${Math.floor(limit.percentUsed)}% used${resets}`)
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    const r: Reading = {
      contextPercent: e.context.percent,
      usd: e.cost?.usd,
      rateLimits: e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    }
    await update($, reading, () => r)

    for (const limit of r.rateLimits) {
      await toastCrossings($, limit)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // No reading until Claude Code's first request, and none at all while not logged in: say so, so the band doesn't look missing.
    const r = await read($, reading)
    const { Box, Text } = $.ui.resolve(e)

    if (r === null) {
      return (
        <Box>
          <Text dimColor>usage: waiting for the first reply</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row">
        {bandSegments(r, e.props.bodyColumns).map(({ text, color }) =>
          color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>,
        )}
      </Box>
    )
  })
}
