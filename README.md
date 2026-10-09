# claude-mods

Mods for Claude Code: plugins that change Claude Code's own interface and behaviour, such as bands, panes, toasts and tool-call hooks.

The repo is a plugin marketplace. Each mod lives in its own folder under `plugins/`. Mods in this repo are meant to be general purpose. Project-specific ones belong in their project.

## Install

```
/plugin marketplace add andrej-kolic/claude-mods
/plugin install <mod>@claude-mods
```

Only mods listed in `.claude-plugin/marketplace.json` can be installed.

## Mods

| Mod | What it does | Status |
|---|---|---|
| `usage-band` | Shows context fill, cost and plan usage limits above the prompt, and warns at 50%, 80% and 95% | Planned: [spec](docs/usage-band.md) |

## Develop a mod

Ask Claude Code to build or change a mod. It loads the built-in `plugin-authoring` skill, which has the API types and examples.

Run a session with a mod loaded:

```bash
claude --plugin-dir ./plugins/usage-band
```

To publish a finished mod, add an entry for it to `.claude-plugin/marketplace.json`, with `"source": "./plugins/<mod>"`.

Check it:

```bash
claude plugin validate ./plugins/usage-band
claude plugin test ./plugins/usage-band
claude plugin validate .   # the marketplace file
```
