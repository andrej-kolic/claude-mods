# usage-bar

One line above the prompt with the session's context fill and cost, plus the plan usage limits that claude.ai shows under Settings → Usage. Toasts warn as a limit fills up.

## Behaviour

1. **Line.** One line above the prompt:

   ```
   ctx 62% · $1.84 · session ███░░░░░ 41% (resets 15:20) · week █░░░░░░░ 18% (resets Mon 09:00)
   ```

   - `ctx`: how full the context window is, as a whole percent rounded down; `–` while no response has reported it.
   - `$`: what the session has cost so far, in US dollars with two decimals; `$–` where Claude Code keeps no cost record.
   - `session` and `week`: whole percent used of the session window (`five_hour`) and the weekly window (`seven_day`), rounded down, with local reset times. `session` matches claude.ai's "Current session" and doesn't depend on the window's length.
   - Until the first reading, show `usage: no data yet`, dimmed, so the line doesn't look missing. Not logged in, no reading comes, so it stays until `/login`.
   - Off a subscription (an API key), readings carry no limits: show `ctx` and `$` only.
   - Each window's bar has 8 cells, each 12.5%, filled rounded down.
   - Each window's percent is coloured by the theme: `warning` from 50%, `error` from 95%, matching the toasts. The rest, bars included, is dimmed: full colour on a bar distracts.
   - The layout follows the line's available width (`bodyColumns`); each width's maximum length assumes `100%` in both windows and a cost like `$123.45`:

     | Width | Line | Max |
     |---|---|---|
     | ≥ 100 | `ctx 62% · $1.84 · session ███░░░░░ 41% (resets 15:20) · week █░░░░░░░ 18% (resets Mon 09:00)` | 97 |
     | 76–99 | `ctx 62% · $1.84 · s ███░░░░░ 41% ↻ 15:20 · w █░░░░░░░ 18% ↻ Mon 09:00` | 74 |
     | 56–75 | `ctx 62% · $1.84 · s 41% ↻ 15:20 · w 18% ↻ Mon 09:00` | 56 |
     | < 56 | `ctx 62% · $1.84 · s 41% · w 18%` | 36 |

2. **Toasts.** When the session or weekly window first crosses 50%, 80% or 95%, show one toast, for example `Weekly limit 80% used — resets Mon 09:00`.
   - A window has crossed a threshold when `percentUsed` is greater than or equal to it, so exactly 50 counts.
   - If one reading crosses several thresholds (40% → 96%), show one toast and mark them all as shown.
   - The toast names the current percent, rounded down like the line: `Weekly limit 96% used`, not `95%`.
   - Each threshold toasts once per window period. After a reset, the window's new `resetsAt` starts a new period.
   - A reload or a new session must not repeat a toast already shown for the same period.

## API pointers

Checked against Claude Code 2.1.295's mod API. Grep the types file the `plugin-authoring` skill names for these:

1. The `session.measure` event fires after each main-thread turn, and whenever a limit window moves a whole point. Its first firing comes from Claude Code's own quota check at startup, with limit readings but no context fill yet; it never fires while not logged in. See Observed behaviour. Use it for redraws and threshold checks instead of polling.
   - Its input carries `context` (`percent` once a response reports it), `cost` (`usd`) and `rateLimits`.
   - `rateLimits` is a list of `SessionRateLimit`: `kind` (`five_hour`, `seven_day`), `percentUsed` (0–100), `resetsAt` (ISO 8601). It is empty off a subscription.
2. Keep the latest reading in `$.state`, which survives a reload within the session. `$.session.usage()` returns the same figures, but nothing redraws the line when they change.
3. The line is drawn by a `ui.render` hook on `{ component: 'AbovePrompt' }`, Claude Code's row above the prompt. See the skill's `band.tsx` example.
4. Toasts: `$.ui.toast(text)`.
5. Remember thresholds already toasted in `$.store`, which persists across sessions: one key per window kind (`toasted:seven_day`), holding the period's `resetsAt` and the thresholds toasted in it. A new `resetsAt` replaces the entry, so the store stays small. The key is user-global, not per project: limits are account-wide, so a session in another project must not repeat the toast. The module's own variables reset on every reload.

## Observed behaviour

Seen in Claude Code 2.1.295 and 2.1.296 on 2026-10-09, in `tmux` with `--plugin-dir` and the debug log (`--debug-file`).

Signed in with a subscription:

1. **Startup, 0–2 s:** the line shows `usage: no data yet`.
2. **About 2 s:** Claude Code sends its own `/v1/messages` request, `source=quota_check` in the debug log, before any `SessionStart` hook finishes. Its response carries the limits, so `session.measure` fires: `ctx – · $0.00 · session ░░░░░░░░ 3% (resets 01:10) · week █░░░░░░░ 21% (resets Sat 21:00)`.
3. **First reply:** the response reports the context used, everything loaded at startup included: `ctx 4% · $0.14 · …`.
4. **Each later turn:** `session.measure` fires with new figures; a crossed threshold toasts.

Not signed in: the footer shows `Not logged in · Run /login` and the line stays on `usage: no data yet`, since no request succeeds. After `/login`, the signed-in sequence continues from the next request.

In a terminal 11 rows tall or less, Claude Code doesn't show its row above the prompt at all, so the line is hidden; at 12 rows it shows.

API key, no subscription: not observed. Per the API docs, `rateLimits` stays empty, so the line shows only `ctx` and `$` and never toasts.

## Limits

- Limit figures come from Claude's latest API response, not from claude.ai. They refresh only while this session makes requests, so usage from other sessions shows up here only after this session's next request.

## Tests

Use `claude plugin test`. Cover at least:

1. Before the first reading, the line shows `usage: no data yet`; after one with empty `rateLimits`, only `ctx` and `$`.
2. Crossing 50%, 80% and 95% each toasts once, and exactly 50% counts as crossed.
3. A jump from 40% to 96% shows one toast, `Weekly limit 96% used`, and no later toast for 50% or 80%.
4. Staying above a threshold, reloading, or starting a session in another project does not repeat the toast.
5. A new `resetsAt` re-arms all thresholds.
6. The line rounds `ctx` and window percents down, and shows `$` with two decimals, or `$–` for a reading with no cost.
7. The startup reading, limits but no context fill yet, shows `ctx – · $0.00` and both limits.
8. Empty `rateLimits` never toast.
9. Each width picks its layout at the 100, 76 and 56 column breakpoints, and the widest line fits its width.
10. Bars fill rounded down and stay dimmed; the percent turns `warning` at 50% and `error` at 95%.
