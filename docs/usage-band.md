# usage-band

A band above the prompt with the session's context fill and cost, plus the plan usage limits that claude.ai shows under Settings → Usage. Toasts warn as a limit fills up.

## Behaviour

1. **Band.** One line above the prompt:

   ```
   ctx 62% · $1.84 · session ███░░░░░ 41% (resets 15:20) · week █░░░░░░░ 18% (resets Mon 09:00)
   ```

   - `ctx`: how full the context window is, as a whole percent rounded down; `–` while no response has reported it.
   - `$`: what the session has cost so far, in US dollars with two decimals.
   - `session` and `week`: whole percent used of the session window (`five_hour`) and the weekly window (`seven_day`), rounded down, with local reset times. `session` matches claude.ai's "Current session" and doesn't depend on the window's length.
   - Until the first reading, show `usage: waiting for the first reply`, dimmed, so the band doesn't look missing. Not logged in, it stays until `/login`.
   - Off a subscription (an API key), readings carry no limits: show `ctx` and `$` only.
   - Each window's bar has 8 cells, each 12.5%, filled rounded down.
   - Each window's bar and percent are coloured by the theme: `warning` from 50%, `error` from 95%, matching the toasts. The rest is dimmed.
   - The layout follows the band's width (`bodyColumns`); each width's maximum length assumes `100%` in both windows and a cost like `$123.45`:

     | Width | Line | Max |
     |---|---|---|
     | ≥ 100 | `ctx 62% · $1.84 · session ███░░░░░ 41% (resets 15:20) · week █░░░░░░░ 18% (resets Mon 09:00)` | 97 |
     | 76–99 | `ctx 62% · $1.84 · s ███░░░░░ 41% ↻ 15:20 · w █░░░░░░░ 18% ↻ Mon 09:00` | 74 |
     | 56–75 | `ctx 62% · $1.84 · s 41% ↻ 15:20 · w 18% ↻ Mon 09:00` | 56 |
     | < 56 | `ctx 62% · $1.84 · s 41% · w 18%` | 36 |

2. **Toasts.** When the session or weekly window first crosses 50%, 80% or 95%, show one toast, for example `Weekly limit 80% used — resets Mon 09:00`.
   - A window has crossed a threshold when `percentUsed` is greater than or equal to it, so exactly 50 counts.
   - If one reading crosses several thresholds (40% → 96%), show one toast and mark them all as shown.
   - The toast names the current percent, rounded down like the band: `Weekly limit 96% used`, not `95%`.
   - Each threshold toasts once per window period. After a reset, the window's new `resetsAt` starts a new period.
   - A reload or a new session must not repeat a toast already shown for the same period.

## API pointers

Checked against Claude Code 2.1.295's mod API. Grep the types file the `plugin-authoring` skill names for these:

1. The `session.measure` event fires after each main-thread turn, and whenever a limit window moves a whole point. It can fire before the first reply, with limit readings but no context fill or cost yet; it never fires while not logged in. Use it for redraws and threshold checks instead of polling.
   - Its input carries `context` (`percent` once a response reports it), `cost` (`usd`) and `rateLimits`.
   - `rateLimits` is a list of `SessionRateLimit`: `kind` (`five_hour`, `seven_day`), `percentUsed` (0–100), `resetsAt` (ISO 8601). It is empty off a subscription.
2. Keep the latest reading in `$.state`, which survives a reload within the session. `$.session.usage()` returns the same figures, but nothing redraws the band when they change.
3. The band is a `ui.render` hook on `{ component: 'AbovePrompt' }`. See the skill's `band.tsx` example.
4. Toasts: `$.ui.toast(text)`.
5. Remember thresholds already toasted in `$.store`, which persists across sessions: one key per window kind (`toasted:seven_day`), holding the period's `resetsAt` and the thresholds toasted in it. A new `resetsAt` replaces the entry, so the store stays small. The key is user-global, not per project: limits are account-wide, so a session in another project must not repeat the toast. The module's own variables reset on every reload.

## Limits

- Limit figures come from Claude's latest API response, not from claude.ai. They refresh only while this session makes requests, so usage from other sessions shows up here only after this session's next request.

## Tests

Use `claude plugin test`. Cover at least:

1. Before the first reading, the band shows `usage: waiting for the first reply`; after one with empty `rateLimits`, only `ctx` and `$`.
2. Crossing 50%, 80% and 95% each toasts once, and exactly 50% counts as crossed.
3. A jump from 40% to 96% shows one toast, `Weekly limit 96% used`, and no later toast for 50% or 80%.
4. Staying above a threshold, reloading, or starting a session in another project does not repeat the toast.
5. A new `resetsAt` re-arms all thresholds.
6. The band rounds `ctx` and window percents down, and shows `$` with two decimals.
7. Empty `rateLimits` never toast.
8. Each width picks its layout at the 100, 76 and 56 column breakpoints, and the widest line fits its width.
9. Bars fill rounded down, and colour turns `warning` at 50% and `error` at 95%.
