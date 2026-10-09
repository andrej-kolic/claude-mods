# claude-mods

Mods for Claude Code: plugins that change Claude Code's own interface and behaviour, such as bands, panes, toasts and tool-call hooks.

Each mod lives in its own folder at the repo root. Mods in this repo are meant to be general purpose. Project-specific ones belong in their project.

## Mods

| Mod | What it does | Status |
|---|---|---|
| `usage-band` | Shows context fill, cost and plan usage limits above the prompt, and warns at 50%, 80% and 95% | Planned: [spec](docs/usage-band.md) |

## Develop a mod

Ask Claude Code to build or change a mod. It loads the built-in `plugin-authoring` skill, which has the API types and examples.

Run a session with a mod loaded:

```bash
claude --plugin-dir ./usage-band
```

Check it:

```bash
claude plugin validate ./usage-band
claude plugin test ./usage-band
```
