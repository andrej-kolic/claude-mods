"""Render a `tmux capture-pane -e` dump as an SVG terminal screenshot.

usage: ansi2svg.py IN.ansi OUT.svg [FIRST_ROW LAST_ROW]
Handles SGR foreground/background (16, 256 and true colour), bold, dim and inverse.
"""
import html, re, sys

BG, FG = (0x1e, 0x1f, 0x26), (0xd4, 0xd4, 0xd8)
CW, CH, PAD, FONT = 8.4, 18, 14, 14
BASE16 = [(0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16), (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
          (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67), (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255)]


FULL = [(0, 0), (1, 0), (0, 1), (1, 1)]
BLOCKS = {'█': FULL, '▀': [(0, 0), (1, 0)], '▄': [(0, 1), (1, 1)], '▌': [(0, 0), (0, 1)], '▐': [(1, 0), (1, 1)],
          '▘': [(0, 0)], '▝': [(1, 0)], '▖': [(0, 1)], '▗': [(1, 1)],
          '▛': [(0, 0), (1, 0), (0, 1)], '▜': [(0, 0), (1, 0), (1, 1)], '▙': [(0, 0), (0, 1), (1, 1)], '▟': [(1, 0), (0, 1), (1, 1)],
          '▚': [(0, 0), (1, 1)], '▞': [(1, 0), (0, 1)]}


def color256(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return steps[n // 36], steps[(n // 6) % 6], steps[n % 6]
    v = 8 + (n - 232) * 10
    return v, v, v


def parse(line):
    """Yield (text, style) runs for one captured line."""
    style = {'fg': None, 'bg': None, 'bold': False, 'dim': False, 'inv': False}
    for part in re.split(r'(\x1b\[[0-9;]*m)', line):
        if not part.startswith('\x1b['):
            if part:
                yield part, dict(style)
            continue
        codes = [int(c) if c else 0 for c in part[2:-1].split(';')]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                style = {'fg': None, 'bg': None, 'bold': False, 'dim': False, 'inv': False}
            elif c == 1: style['bold'] = True
            elif c == 2: style['dim'] = True
            elif c == 22: style['bold'] = style['dim'] = False
            elif c == 7: style['inv'] = True
            elif c == 27: style['inv'] = False
            elif c in (38, 48):
                key = 'fg' if c == 38 else 'bg'
                if codes[i + 1] == 5:
                    style[key] = color256(codes[i + 2]); i += 2
                elif codes[i + 1] == 2:
                    style[key] = tuple(codes[i + 2:i + 5]); i += 4
            elif c == 39: style['fg'] = None
            elif c == 49: style['bg'] = None
            elif 30 <= c <= 37: style['fg'] = BASE16[c - 30]
            elif 90 <= c <= 97: style['fg'] = BASE16[c - 90 + 8]
            elif 40 <= c <= 47: style['bg'] = BASE16[c - 40]
            elif 100 <= c <= 107: style['bg'] = BASE16[c - 100 + 8]
            i += 1


def hexc(rgb):
    return '#%02x%02x%02x' % rgb


def main():
    raw = open(sys.argv[1], encoding='utf-8').read()
    # Keep only colour (SGR) codes: drop link markers (OSC 8) and any other escape sequence.
    raw = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', raw)
    raw = re.sub(r'\x1b\[[0-9;?]*[A-Za-ln-z]', '', raw)
    lines = raw.split('\n')
    if len(sys.argv) > 4:
        lines = lines[int(sys.argv[3]):int(sys.argv[4]) + 1]
    while lines and not re.sub(r'\x1b\[[0-9;]*m', '', lines[-1]).strip():
        lines.pop()
    cols = max(len(re.sub(r'\x1b\[[0-9;]*m', '', l)) for l in lines)
    w, h = cols * CW + 2 * PAD, len(lines) * CH + 2 * PAD
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" viewBox="0 0 {w:.0f} {h:.0f}">',
           f'<rect width="100%" height="100%" rx="8" fill="{hexc(BG)}"/>',
           f'<g shape-rendering="crispEdges" font-family="Menlo, Monaco, monospace" font-size="{FONT}" xml:space="preserve">']
    for row, line in enumerate(lines):
        col = 0
        y = PAD + row * CH
        for text, s in parse(line):
            fg, bg = s['fg'] or FG, s['bg']
            if s['inv']:
                fg, bg = (bg or BG), fg
            if s['dim']:
                fg = tuple(int(a * 0.55 + b * 0.45) for a, b in zip(fg, BG))
            for k, ch in enumerate(text):
                x = PAD + (col + k) * CW
                if bg:
                    out.append(f'<rect x="{x:.1f}" y="{y}" width="{CW:.2f}" height="{CH}" fill="{hexc(bg)}"/>')
                if ch in BLOCKS:
                    # Block elements as shapes: quadrants (x0, y0) in halves of the cell, so logos and bars stay crisp.
                    for qx, qy in BLOCKS[ch]:
                        out.append(f'<rect x="{x + qx * CW / 2:.2f}" y="{y + qy * CH / 2:.2f}" width="{CW / 2 + 0.6:.2f}" height="{CH / 2 + 0.6:.2f}" fill="{hexc(fg)}"/>')
                elif ch.strip():
                    weight = ' font-weight="bold"' if s['bold'] else ''
                    out.append(f'<text x="{x + CW / 2:.2f}" y="{y + CH * 0.75:.1f}" text-anchor="middle" fill="{hexc(fg)}"{weight}>{html.escape(ch)}</text>')
            col += len(text)
    out += ['</g>', '</svg>']
    open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(out))


main()
