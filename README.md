# claude-mods

Mods for Claude Code: plugins that change Claude Code's own interface and behaviour, such as bands, panes, toasts and tool-call hooks.

The repo is a plugin marketplace. Each mod lives in its own folder under `plugins/`. Mods in this repo are meant to be general purpose. Project-specific ones belong in their project.

## Install

Install a mod in one step (Claude Code 2.1.275 or later):

```
/plugin install usage-bar --marketplace andrej-kolic/claude-mods
```

On older versions, add the marketplace first:

```
/plugin marketplace add andrej-kolic/claude-mods
/plugin install <mod>@claude-mods
```

Only mods listed in `.claude-plugin/marketplace.json` can be installed.

## Mods

| | Mod | What it does | Status |
|---|---|---|---|
| <img src="plugins/usage-bar/.claude-plugin/icon.svg" width="32" alt=""> | `usage-bar` | Usage limits, context and cost above the prompt; keeps your status line | Ready: [spec](docs/usage-bar.md) |

## Develop a mod

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, check and publish a mod, and how to open an issue or PR.
