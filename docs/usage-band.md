# usage-band

A band above the prompt with the session's context fill and cost, plus the plan usage limits that claude.ai shows under Settings → Usage. Toasts warn as a limit fills up.

## Behaviour

1. **Band.** One line above the prompt:

   ```
   ctx 62% · $1.84 · session 41% (resets 15:20) · week 18% (resets Mon 09:00)
   ```

   - `ctx`: how full the context window is, as a whole percent rounded down.
   - `$`: what the session has cost so far, in US dollars with two decimals.
   - `session` and `week`: whole percent used of the session window (`five_hour`) and the weekly window (`seven_day`), rounded down, with local reset times. `session` matches claude.ai's "Current session" and doesn't depend on the window's length.
   - Before the first reply there are no limit readings yet: show `ctx` and `$` only.

2. **Toasts.** When the session or weekly window first crosses 50%, 80% or 95%, show one toast, for example `Weekly limit 80% used — resets Mon 09:00`.
   - A window has crossed a threshold when `percentUsed` is greater than or equal to it, so exactly 50 counts.
   - If one reading crosses several thresholds (40% → 96%), show one toast for the highest and mark the lower ones as shown.
   - Each threshold toasts once per window period. After a reset, the window's new `resetsAt` starts a new period.
   - A reload or a new session must not repeat a toast already shown for the same period.

## API pointers

Checked against Claude Code 2.1.295's mod API. Grep the types file the `plugin-authoring` skill names for these:

1. `$.session.usage()` returns `{ startedAt, context, rateLimits, cost }` and costs nothing to call.
   - `rateLimits` is a list of `SessionRateLimit`: `kind` (`five_hour`, `seven_day`), `percentUsed` (0–100), `resetsAt` (ISO 8601).
2. The `session.measure` event fires after each main-thread turn, and whenever a limit window moves a whole point. Use it for redraws and threshold checks instead of polling.
3. The band is a `ui.render` hook on `{ component: 'AbovePrompt' }`. See the skill's `band.tsx` example.
4. Toasts: `$.ui.toast(text)`.
5. Remember thresholds already toasted in `$.store`, which persists across sessions, keyed by window kind + `resetsAt` + threshold. The key is user-global, not per project: limits are account-wide, so a session in another project must not repeat the toast. The module's own variables reset on every reload.

## Limits

- Limit figures come from Claude's latest API response, not from claude.ai. They refresh only while this session makes requests, so usage from other sessions shows up here only after this session's next request.

## Tests

Use `claude plugin test`. Cover at least:

1. The band shows only `ctx` and `$` when `rateLimits` is empty.
2. Crossing 50%, 80% and 95% each toasts once, and exactly 50% counts as crossed.
3. A jump from 40% to 96% shows one toast, for 95%, and no later toast for 50% or 80%.
4. Staying above a threshold, reloading, or starting a session in another project does not repeat the toast.
5. A new `resetsAt` re-arms all thresholds.
6. The band rounds `ctx` and window percents down, and shows `$` with two decimals.
