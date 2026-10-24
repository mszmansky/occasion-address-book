#!/usr/bin/env python3
# Draws the app icon (red tile, white envelope, yellow wax seal on the flap) and writes every size
# the app uses into frontend/. Needs: pip install cairosvg pillow
import math, io, os
import cairosvg
from PIL import Image

def blob(cx, cy, r):
    # Wax: a few soft, uneven lobes rather than regular teeth.
    pts = []
    N = 240
    for i in range(N):
        t = 2 * math.pi * i / N
        rr = r + 1.25 * math.cos(7 * t + 0.4) + 1.1 * math.sin(3 * t + 1.1) + 0.7 * math.cos(5 * t + 2.3) + 0.5 * math.sin(2 * t)
        pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in pts) + ' Z'

def svg(square=False):
    bg = '<rect width="192" height="192" fill="#9f1239"/>' if square else '<rect width="192" height="192" rx="42" fill="#9f1239"/>'
    cx, cy = 96, 104
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  {bg}
  <rect x="35" y="58" width="122" height="84" rx="12" fill="#ffffff"/>
  <path d="M43 67 L96 103 L149 67" fill="none" stroke="#9f1239" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{blob(cx + 0.6, cy + 1.8, 20)}" fill="#7c2d12" opacity="0.16"/>
  <path d="{blob(cx, cy, 20)}" fill="#fbbf24"/>
  <circle cx="{cx}" cy="{cy}" r="12.5" fill="#f59e0b"/>
  <circle cx="{cx}" cy="{cy}" r="12.5" fill="none" stroke="#d97706" stroke-width="1.6"/>
  <path d="M{cx - 9.2} {cy + 8.3} A12.4 12.4 0 0 0 {cx + 11.6} {cy + 4.4}" fill="none" stroke="#fde68a" stroke-width="1.8" stroke-linecap="round" opacity="0.9"/>
  <path d="M{cx - 13} {cy - 10.5} A17.5 17.5 0 0 1 {cx + 3} {cy - 17.2}" fill="none" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round" opacity="0.75"/>
</svg>'''

def png(svg_text, size):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg_text.encode(), output_width=size, output_height=size))).convert('RGBA')

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg())
big = png(svg(), 1024)
big.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'icon-192.png'))
big.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, 'favicon-32.png'))
png(svg(True), 1024).convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, 'apple-touch-icon.png'))
