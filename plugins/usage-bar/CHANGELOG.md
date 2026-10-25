# Changelog

Each version names the Claude Code release it was built and tested on. Its **Workarounds** list what the mod works out itself because Claude Code doesn't give a mod the answer; [Active workarounds](#active-workarounds) at the end lists those still in place. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - unreleased

Built on Claude Code 2.1.299.

### Changed

- The README's Privacy section lists what the mod reads, stores and starts, and what its hooks change.

## [0.2.0] - 2026-10-14

Built on Claude Code 2.1.296.

### Added

- `cache cold` on the line once the prompt cache has expired. It warns that your next message will re-send the whole conversation at full price. Turn it off with **Show cache cold** in `/config`.
- The icon for the directory listing.

### Changed

- The whole line sits at the right edge, with context and cost beside the limits.
- Percents turn colour, and toasts fire, at claude.ai's thresholds: 50%, 75% and 90%.

### Fixed

- The limits show right after `/clear`.
- The placeholder stays until the first reading arrives.
- Rows other mods draw above the prompt stay visible.

### Workarounds

- **Cache length and state:** Claude Code computes the prompt cache's state for the status line (its `prompt_cache` object, 2.1.251+), but a mod doesn't receive it. So `hooks/register.tsx` (`readWritten`) reads the last 256 KB of the conversation file with `tail` for the length the latest reply was cached with, and `hooks/cache.ts` (`cacheLength`) copies Claude Code's own rules for the time before the first reply. A cache broken early, by `/model` or a changed tools list, stays invisible. Replace both with Claude Code's value once mods get it.

## [0.1.0] - 2026-10-09

Built on Claude Code 2.1.295.

### Added

- A line above the prompt with the context fill, the session's cost, and the 5-hour and weekly limits with their reset countdowns.
- A coloured percent per limit, and one short toast per reading when a limit crosses a threshold.
- Layouts that shorten the line, instead of wrapping it, when the terminal is narrow.

## Active workarounds

After a Claude Code update, check whether each one can go.

- [Cache length and state](#020---2026-10-14) (0.2.0)

[0.3.0]: https://github.com/andrej-kolic/claude-mods/compare/8e8a80f...release/0.3.0
[0.2.0]: https://github.com/andrej-kolic/claude-mods/compare/975f41b...8e8a80f
[0.1.0]: https://github.com/andrej-kolic/claude-mods/commit/86e282a
