# usage-bar

One line above the prompt with the session's context fill and cost, plus the plan usage limits that claude.ai shows under Settings → Usage. Toasts warn as a limit fills up.

## Behaviour

1. **Line.** One line above the prompt, at its right edge, away from where replies are read and prompts typed: this conversation's figures, then the account's limits:

   ```
                   context 62% · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)
   ```

   - `context` (`ctx` in the narrower layouts): how full the context window is, as a whole percent rounded down; `–` while no response has reported it.
   - `$`: what the session has cost so far, in US dollars with two decimals; `$–` where Claude Code keeps no cost record.
   - `session` and `week` (`s` and `w` in the narrower layouts): whole percent used of the session window (`five_hour`) and the weekly window (`seven_day`), rounded down, with the time left until each resets in brackets after `↻`, so it reads as part of its limit: `3d2h` from a day, `2h10m` from an hour, `45m` below, in whole minutes rounded up, a zero part dropped (`4h`, `3d`). Once the reset has passed with no new reading, `now`: the percent shown is the old period's until the next reading. A timer redraws the line every minute, since readings come only with turns and an idle line would go stale. `session` matches claude.ai's "Current session" and doesn't depend on the window's length.
   - Until the first reading, show `usage: no data yet`, dimmed and at the right edge too, so the line doesn't look missing. Not logged in, no reading comes, so it stays until `/login`. After `/clear`, the new session has no reading until its first turn ends, so draw the limits Claude Code still holds from the last response (`$.session.usage()`), with context `–`.
   - Off a subscription (an API key), readings carry no limits: show context and `$` only.
   - Each window's bar has 8 cells, each 12.5%, filled rounded down: `⣿` used, `⣀` left. Braille looks the same in Warp, iTerm2 and the desktop app and stays light; `█`/`░` draws as a dotted texture in iTerm2 and the desktop app.
   - Each window's percent is coloured by the theme from 75%: `warning`, and `error` from 90%, the cutoffs claude.ai's Settings → Usage meters use when the server sends no severity of its own. Everything else, percents below 75% and bars included, is dimmed: full colour on a bar distracts.
   - No part of the line wraps; one that doesn't fit is cut short with `…`. While a desktop window is resized, a frame can draw the layout chosen for the previous width, and a wrapped part would make the row jump to two lines.
   - The line shows the widest of these layouts that fits its available width (`bodyColumns`), so it shortens only when the actual figures don't fit. The narrowest shows even where it doesn't fit. Lengths are for the example and at most, with `100%` in both windows, a cost like `$123.45` and the longest countdowns, `4h59m` and `23h59m`. Each ` · ` is a dot drawn with a one-column gap either side, not typed spaces, because the desktop app's spaces are narrower than a column; it counts as 3 columns:

     | Layout | Line | Length | At most |
     |---|---|---|---|
     | Full | `context 62% · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)` | 81 | 88 |
     | Short, bars | `ctx 62% · $1.84 · s ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 2h10m) · w ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d2h)` | 68 | 75 |
     | Short | `ctx 62% · $1.84 · s 41% (↻ 2h10m) · w 18% (↻ 3d2h)` | 50 | 57 |
     | Tiny | `ctx 62% · $1.84 · s 41% · w 18%` | 31 | 36 |

2. **Toasts.** When the session or weekly window first crosses 50%, 75% or 90%, show one toast with just the window and number, named as in the line's full layout: `week 75%`. 50% is an early heads-up; 75% and 90% match the line's colours. The time to the reset is on the line, except in the tiny layout, where nothing shows it.
   - A window has crossed a threshold when `percentUsed` is greater than or equal to it, so exactly 50 counts.
   - If one reading crosses several thresholds (40% → 96%), show one toast and mark them all as shown.
   - If one reading crosses thresholds in both windows, show one toast naming both: `session 62% · week 97%`. It fits one line of the desktop app's toast. The desktop app shows one toast per plugin at a time and drops the next.
   - The toast names the current percent, rounded down like the line: `week 96%`, not `week 90%`.
   - Each threshold toasts once per window period. After a reset, the window's new `resetsAt` starts a new period.
   - A reload or a new session must not repeat a toast already shown for the same period.
   - A threshold counts as shown when one at least as high was shown this period, so a record 0.1.0 saved (it alerted at 80% and 95%) doesn't make 75% or 90% toast again after the update.

## API pointers

Checked against Claude Code 2.1.295's mod API. Grep the types file the `plugin-authoring` skill names for these:

1. The `session.measure` event fires after each main-thread turn, and whenever a limit window moves a whole point. Its first firing comes from Claude Code's own quota check at startup, with limit readings but no context fill yet; it never fires while not logged in. See Observed behaviour. Use it for redraws and threshold checks instead of polling; the only timer is the countdowns' (item 6).
   - Its input carries `context` (`percent` once a response reports it), `cost` (`usd`) and `rateLimits`.
   - `rateLimits` is a list of `SessionRateLimit`: `kind` (`five_hour`, `seven_day`), `percentUsed` (0–100), `resetsAt` (ISO 8601). It is empty off a subscription.
2. Keep the latest reading in `$.state`, which survives a reload within the session. `$.session.usage()` returns the same figures, but nothing redraws the line when they change.
3. The line is drawn by a `ui.render` hook on `{ component: 'AbovePrompt' }`, Claude Code's row above the prompt. See the skill's `band.tsx` example.
4. Toasts: `$.ui.toast(text)`.
5. Remember thresholds already toasted in `$.store`, which persists across sessions: one key per window kind (`toasted:seven_day`), holding the period's `resetsAt` and the thresholds toasted in it. A new `resetsAt` replaces the entry, so the store stays small. The key is user-global, not per project: limits are account-wide, so a session in another project must not repeat the toast. The module's own variables reset on every reload.
6. Countdowns: `$.clock.every(60_000, fn)` from `session.start`, bumping a `$.state` value the render reads, so the line redraws while idle. `session.start` fires again on each reload, which drops the old timer; cancel the previous one first, in case it fires again otherwise.

## Observed behaviour

Seen in Claude Code 2.1.295 and 2.1.296 on 2026-10-09, in `tmux` with `--plugin-dir` and the debug log (`--debug-file`).

Signed in with a subscription:

1. **Startup, 0–2 s:** the line shows `usage: no data yet`.
2. **About 2 s:** Claude Code sends its own `/v1/messages` request, `source=quota_check` in the debug log, before any `SessionStart` hook finishes. Its response carries the limits, so `session.measure` fires (the line's format then): `ctx – · $0.00 · session ░░░░░░░░ 3% (resets 01:10) · week █░░░░░░░ 21% (resets Sat 21:00)`.
3. **First reply:** the response reports the context used, everything loaded at startup included: `ctx 4% · $0.14 · …`.
4. **Each later turn:** `session.measure` fires with new figures; a crossed threshold toasts.

Not signed in: the footer shows `Not logged in · Run /login` and the line stays on `usage: no data yet`, since no request succeeds. After `/login`, the signed-in sequence continues from the next request.

In a terminal 11 rows tall or less, Claude Code doesn't show its row above the prompt at all, so the line is hidden; at 12 rows it shows.

`--continue` (2.1.296, 2026-10-10, tmux): a new process, so the startup reading and its toasts arrive as on a fresh start, within about 1 s. The line shows the resumed conversation's `ctx` and `$` at once, not `ctx –`. A second `--continue` repeats no toast.

`/clear` and `/resume` (2.1.296, 2026-10-10, tmux): each starts a session with no stored reading and no `session.start`, and no `session.measure` until the next turn. The line shows the limits `$.session.usage()` still holds from the last response, with `context –` until the next reply; the minute timer keeps counting down.

A toast's text is one line: a `\n` in it draws as `�` in the terminal.

Desktop app (2.31226.0, 2026-10-10, a local Code tab session with `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`):

1. The line draws above the prompt in the theme's colours, and the layouts switch with the window's width. `bodyColumns` follows the window: 78 narrow, 95 at its widest. A desktop column is a little wider than the font's average character, so a line that fits `bodyColumns` never overflows. Under the old fixed breakpoints (full from 100) a wide window never got the full layout.
2. While the window is resized, a frame can briefly draw the layout chosen for the previous width; parts that wrapped made the row jump to two lines, hence no wrapping.
3. A toast shows as `<plugin>: <text>` at the top right. One plugin's toasts show one at a time, and a second raised while the first shows is dropped, not queued: hence one toast per reading.

API key, no subscription: not observed. Per the API docs, `rateLimits` stays empty, so the line shows only the context and `$` and never toasts.

## Limits

- Limit figures come from Claude's latest API response, not from claude.ai. They refresh only while this session makes requests, so usage from other sessions shows up here only after this session's next request.

## Tests

Use `claude plugin test`. Cover at least:

1. Before the first reading, the line shows `usage: no data yet`; after one with empty `rateLimits`, only context and `$`. After `/clear`, before any turn, the limits Claude Code still holds.
2. Crossing 50%, 75% and 90% each toasts once, and exactly 50% counts as crossed.
3. A jump from 40% to 96% shows one toast, `week 96%`, and no later toast for 50%, 75% or 90%.
4. Staying above a threshold, reloading, or starting a session in another project does not repeat the toast. Nor does a 0.1.0 record of 80% for a reading of 82%.
5. A new `resetsAt` re-arms all thresholds.
6. The line rounds the context and window percents down, and shows `$` with two decimals, or `$–` for a reading with no cost.
7. The startup reading, limits but no context fill yet, shows `context – · $0.00` and both limits.
8. Empty `rateLimits` never toast.
9. Each width shows the widest layout that fits it, the whole line, `usage: no data yet` included, at the right edge, and the line fits every width the tiny layout fits.
10. Bars fill rounded down and stay dimmed; the percent turns `warning` at 75% and `error` at 90%.
11. A reading that crosses thresholds in both windows shows one toast naming both; each window's thresholds are still tracked on their own.
12. Each reset counts down in days and hours, hours and minutes, or minutes, rounded up, a zero part dropped and `now` once passed, and the countdown moves on each minute without a new reading.
13. While a survey shows, the line leaves the row to it.

Then check live what the tests can't reach: Claude Code's own events and a real terminal. Run `claude` in `tmux` with `--debug-file`, with `CLAUDE_CODE_PLUGIN_DIRS` unset unless it names this folder: another copy of the plugin loads in its place. Check that the debug log says `hooks module usage-bar@claude-mods loaded`, then:

1. Startup: `usage: no data yet`, then the limits within about 2 s.
2. After a reply: `context` shows a percent.
3. `/clear`, twice in a row, and `/resume`: the limits stay, `context –` until the next reply.
4. Left for a minute after `/clear`: the countdown moves on.
5. `tmux resize-window` from 160 columns down to 30: each layout in turn, then cut short with `…`.
6. A terminal 11 rows tall: the line is hidden; 12 rows: it shows.
