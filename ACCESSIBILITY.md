# Accessibility

Mods here draw text inside Claude Code, so they should be readable by anyone who can use Claude Code itself: without relying on colour, in a narrow terminal, and through a screen reader.

## Supported environments

Claude Code's terminal and the desktop app's Code tab, tested on macOS. The VS Code extension's chat panel doesn't show mods' rows yet.

## Known barriers

1. **Colour:** usage-bar colours a limit's percent yellow and red, and `cache cold` red. The number or word is always shown too, so colour is never the only signal.
2. **Symbols:** in narrow layouts usage-bar uses Braille-pattern bars (`⣿⣀`), `↻` for a reset countdown and `❆` for a cold cache. A screen reader may read these as their Unicode names, and Windows 10's older console shows them as empty boxes.
3. **Alerts:** limit alerts are short toasts at the top right, which disappear after a few seconds.

## Report a barrier

Open an [issue](https://github.com/andrej-kolic/claude-mods/issues/new/choose) and say which mod, your setup (terminal, screen reader, desktop app) and what you couldn't read or reach.
