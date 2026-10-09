# usage-bar

Your plan's usage limits, context and cost on one dimmed line above the prompt, with alerts before you run out.

![The bar above Claude Code's prompt: ctx 62% · $1.84 · session 41% (resets 15:20) · week 18% (resets Mon 09:00)](images/normal.png)

- `ctx`: how full the context window is.
- `$`: what this session has cost.
- `session` and `week`: how much of your 5-hour and weekly limits you've used, and when each resets, in your local time.

## Alerts

A limit's percent turns yellow at 50% and red at 95%; the bars stay grey. An alert appears at the top right at 50%, 80% and 95%:

![The session limit at 55% in yellow, with the alert "Session limit 55% used — resets 15:20"](images/yellow.png)

![The weekly limit at 96% in red, with the alert "Weekly limit 96% used — resets Mon 09:00"](images/red.png)

Each alert shows once per limit period, even across restarts and projects. When a limit resets, its alerts start over.

## On narrow terminals

The line at the top is the full layout, for 100 columns or more. On narrower terminals it shortens instead of wrapping.

76–99 columns:

```
ctx 62% · $1.84 · s ███░░░░░ 41% ↻ 15:20 · w █░░░░░░░ 18% ↻ Mon 09:00
```

56–75 columns:

```
ctx 62% · $1.84 · s 41% ↻ 15:20 · w 18% ↻ Mon 09:00
```

Under 56 columns:

```
ctx 62% · $1.84 · s 41% · w 18%
```

## Before the first reading

For a few seconds after startup, and for as long as you're not logged in, the line reads:

```
usage: no data yet
```

`ctx` shows `–` until your first reply, because Claude Code measures the context only when it answers.

## What it is not

- **Not a status line.** It sits above the prompt and leaves your status line alone.
- **Not a usage history.** It shows the current figures and nothing over time.

## Install

In Claude Code:

```
/plugin install usage-bar --marketplace andrej-kolic/claude-mods
```

- **Claude Code:** 2.1.275 or later for this one-step install. Tested on 2.1.295 and 2.1.296, in the terminal.
- **Plan:** usage limits need a Claude subscription. With an API key, the line shows only `ctx` and `$`, and no alerts.
- **Context cost:** about 0 tokens. It adds nothing to what Claude reads.
- **Where it shows:** Claude Code's terminal and the desktop app's Code tab. It does nothing on claude.ai or in Cowork.

## More

The screenshots use sample readings. The yellow and red follow your Claude Code theme.

The [spec](https://github.com/andrej-kolic/claude-mods/blob/main/docs/usage-bar.md) has every rule: rounding, colours, widths, and when alerts repeat.
