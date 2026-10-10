#!/bin/bash
# Retakes usage-bar's README screenshots: plugins/usage-bar/images/{normal,yellow,red}.png.
# usage: scripts/usage-bar-shots/shoot.sh [normal|yellow|red ...]   (all three by default)
#
# Runs Claude Code in tmux with a copy of usage-bar whose readings fixture.ts swaps for fixed figures,
# then draws the captured screen as an SVG and renders it to PNG with headless Chrome.
# Needs tmux, python3, Google Chrome and a signed-in Claude Code; sends no prompt.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
WORK=${TMPDIR:-/tmp}/usage-bar-shots
# Loaded with --plugin-dir, the copy shares the store of every such copy (usage-bar_inline-*.json in
# ~/.claude/plugins/store), never the installed plugin's, so the shots don't touch your real alert records.
COPY=$WORK/usage-bar
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
TMUX_=(tmux -L usage-bar-shots -f "$HERE/tmux.conf")
# However the script ends, Ctrl-C included, stop the session it left running.
trap '"${TMUX_[@]}" kill-server 2>/dev/null || true' EXIT

# What shows once the shot is ready: the line's figures, or the alert the scenario raises.
ready_text() {
  case $1 in
    normal) echo 'context 62%' ;;
    yellow) echo 'session 78%' ;;
    red) echo 'week 96%' ;;
    *) echo "unknown scenario: $1" >&2; exit 1 ;;
  esac
}

# Replaces one whole line of FILE, or stops: register.tsx changed, and the patch must follow it.
patch_line() {
  local file=$1 from=$2 to=$3
  FROM=$from TO=$to python3 -I -c '
import os, sys
p = sys.argv[1]; lines = open(p).read().split("\n")
if lines.count(os.environ["FROM"]) != 1: sys.exit(p + ": no line " + repr(os.environ["FROM"]) + "; update shoot.sh")
open(p, "w").write("\n".join(os.environ["TO"] if l == os.environ["FROM"] else l for l in lines))
' "$file"
}

shoot() {
  local name=$1 ready
  ready=$(ready_text "$name")

  rm -rf "$COPY" && mkdir -p "$WORK" && cp -R "$REPO/plugins/usage-bar" "$COPY"
  # Route each reading through the fixture, appended to register.tsx since the engine follows $ only within one
  # file, and keep the startup alert up until Claude Code's startup hint under the line clears (about 11 s).
  local hooks=$COPY/hooks/register.tsx
  patch_line "$hooks" '    const r = toReading(e)' '    const r = toReading(await fixture($, e))'
  patch_line "$hooks" '    if (crossed.length > 0) $.ui.toast(toastText(crossed))' \
    '    if (crossed.length > 0) $.ui.toast(toastText(crossed), { timeoutMs: 30_000 })'
  sed -e '/^import /d' -e 's/^export async function/async function/' \
    -e "s/^const SCENARIO = 'normal'/const SCENARIO = '$name'/" "$HERE/fixture.ts" >> "$hooks"

  "${TMUX_[@]}" kill-server 2>/dev/null || true
  # Unset any plugin folders this shell carries, so only the copy loads in place of the installed usage-bar.
  "${TMUX_[@]}" new-session -d -x 110 -y 12 -c "$REPO" \
    "env -u CLAUDE_CODE_PLUGIN_DIRS -u CLAUDE_CODE_PLUGIN_DIR_WATCH claude --plugin-dir '$COPY'"

  local screen=''
  for _ in $(seq 60); do
    sleep 0.5
    screen=$("${TMUX_[@]}" capture-pane -p)
    if grep -q "$ready" <<<"$screen" && grep -q 'context 62%' <<<"$screen" && ! grep -q '/effort' <<<"$screen"; then break; fi
    screen=''
  done
  sleep 0.3
  "${TMUX_[@]}" capture-pane -e -p > "$WORK/$name.ansi"
  "${TMUX_[@]}" kill-server

  if [ -z "$screen" ]; then echo "$name: '$ready' never showed on a screen without the startup hint" >&2; exit 1; fi

  python3 -I "$HERE/ansi2svg.py" "$WORK/$name.ansi" "$WORK/$name.svg"
  local w h
  w=$(grep -o 'width="[0-9]*"' "$WORK/$name.svg" | head -1 | tr -dc 0-9)
  h=$(grep -o 'height="[0-9]*"' "$WORK/$name.svg" | head -1 | tr -dc 0-9)
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=00000000 --window-size="$w,$h" \
    --screenshot="$REPO/plugins/usage-bar/images/$name.png" "file://$WORK/$name.svg" 2>/dev/null
  echo "$name: plugins/usage-bar/images/$name.png"
}

for name in "${@:-normal yellow red}"; do
  for n in $name; do shoot "$n"; done
done
