# Contributing

Mods here are meant to be general purpose. A mod that only makes sense for one project belongs in that project.

## Report a bug or propose a mod

Open an [issue](https://github.com/andrej-kolic/claude-mods/issues/new/choose). For a bug, include your Claude Code version, the mod and its version, and where it runs: terminal, desktop app or VS Code.

## Develop a mod

Ask Claude Code to build or change a mod. It loads the built-in `plugin-authoring` skill, which has the API types and examples.

Run a session with a mod loaded:

```bash
claude --plugin-dir ./plugins/usage-bar
```

Load a mod this way once before editing it. Loading writes the API types to `.claude-plugin/types/`, which git ignores and the mod's `tsconfig.json` extends, so your editor and `tsc -p ./plugins/<mod>` find them.

To publish a finished mod, add an entry for it to `.claude-plugin/marketplace.json`, with `"source": "./plugins/<mod>"`.

## Check your change

```bash
claude plugin validate ./plugins/usage-bar
claude plugin test ./plugins/usage-bar
claude plugin validate .   # the marketplace file
```

Or check the marketplace file and every mod at once with `pnpm validate` and `pnpm test`.

Format, lint and type-check every mod with `pnpm format`, `pnpm lint` and `pnpm typecheck`.

## Commits and pull requests

1. Commit messages follow `type(scope): summary`, one logical change per commit, with its tests and docs in the same commit.
2. Open the PR against `main` and fill in the template. Link the issue it closes.
3. Say how you verified the change: which checks pass, and where you saw it working.

By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
