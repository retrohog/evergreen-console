#!/usr/bin/env python3
"""Generate the console's image assets with the standard library only.

    python3 scripts/make-assets.py

Writes into assets/:
  holo-foil.png   iridescent foil texture (holo card overlay)
  grain.png       tiling grain for the liquid-glass frost
  scan.gif        animated scanline sweep (GIF89a, hand-encoded LZW)
  mask.svg        glitch-mask mark (original vector, hacker-terminal vibe)
  grid.svg        isometric circuit grid tile

Every encoder below is self-checked: the PNG is re-decoded via zlib and the GIF
is re-decoded with a matching LZW decoder, so a corrupt asset fails loudly here
instead of silently breaking the page.
"""
from __future__ import annotations

import math
import random
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)


# ------------------------------------------------------------------ PNG
def png_write(path: Path, w: int, h: int, rows: list[bytes]) -> None:
    """rows: h byte strings of RGB triples (w*3 bytes each)."""
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    blob = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(blob)


def png_verify(path: Path, w: int, h: int) -> bytes:
    """Re-decode our own PNG (IHDR/IDAT/IEND + zlib) and return the raw scanlines."""
    blob = path.read_bytes()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", "bad signature"
    i, idat, got = 8, b"", (0, 0)
    while i < len(blob):
        ln = struct.unpack(">I", blob[i:i + 4])[0]
        tag = blob[i + 4:i + 8]
        data = blob[i + 8:i + 8 + ln]
        crc = struct.unpack(">I", blob[i + 8 + ln:i + 12 + ln])[0]
        assert crc == (zlib.crc32(tag + data) & 0xFFFFFFFF), f"crc fail on {tag}"
        if tag == b"IHDR":
            got = (struct.unpack(">II", data[:8])[0], struct.unpack(">II", data[:8])[1])
        if tag == b"IDAT":
            idat += data
        i += 12 + ln
    assert got == (w, h), f"size mismatch {got} != {(w, h)}"
    return zlib.decompress(idat)


def hsl(h: float, s: float, l: float) -> tuple[int, int, int]:
    """Standard HSL→RGB (h in [0,1))."""
    h = h % 1.0
    a = s * min(l, 1 - l)

    def channel(n: int) -> int:
        k = (n + h * 12) % 12
        return int(255 * min(1, max(0, l - a * max(-1, min(k - 3, 9 - k)))))

    return (channel(0), channel(8), channel(4))


def make_foil() -> None:
    """Iridescent foil: hue sweeps diagonally, saturation banded, fine noise grain.

    Quantised to steps of 4 and kept small — smooth gradients compress well, noise
    does not, and this ships in the repo."""
    w, h = 256, 160
    rnd = random.Random(11)
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            u = (x / w) + (y / h) * 0.6
            band = math.sin(u * math.tau * 3.1) * 0.5 + 0.5
            hue = 0.42 + u * 0.55 + band * 0.06            # cyan → green → violet
            sat = 0.35 + band * 0.45
            lig = 0.42 + band * 0.30 + math.sin(u * math.tau * 11) * 0.03
            r, g, b = hsl(hue, sat, lig)
            n = rnd.randint(-3, 3)
            q = lambda v: max(0, min(255, (v + n) // 4 * 4))
            row += bytes((q(r), q(g), q(b)))
        rows.append(bytes(row))
    p = OUT / "holo-foil.png"
    png_write(p, w, h, rows)
    dec = png_verify(p, w, h)
    assert len(dec) == h * (1 + w * 3) and dec[:1] == b"\x00", "foil round-trip mismatch"
    print(f"  holo-foil.png  {w}x{h}  {p.stat().st_size // 1024}kB  (decoded {len(dec)}B ok)")


def make_grain() -> None:
    w, h = 128, 128
    rnd = random.Random(5)
    rows = []
    for _ in range(h):
        row = bytearray()
        for _ in range(w):
            v = max(0, min(255, int(rnd.gauss(128, 34)) // 4 * 4))
            row += bytes((v, v, v))
        rows.append(bytes(row))
    p = OUT / "grain.png"
    png_write(p, w, h, rows)
    dec = png_verify(p, w, h)
    assert len(dec) == h * (1 + w * 3), "grain round-trip mismatch"
    print(f"  grain.png      {w}x{h}  {p.stat().st_size // 1024}kB  (decoded {len(dec)}B ok)")


# ------------------------------------------------------------------ GIF89a
class Bits:
    def __init__(self) -> None:
        self.buf: list[int] = []
        self.acc = 0
        self.n = 0

    def write(self, code: int, size: int) -> None:
        self.acc |= code << self.n
        self.n += size
        while self.n >= 8:
            self.buf.append(self.acc & 0xFF)
            self.acc >>= 8
            self.n -= 8

    def flush(self) -> bytes:
        if self.n:
            self.buf.append(self.acc & 0xFF)
            self.acc = self.n = 0
        return bytes(self.buf)


def lzw_encode(idx: list[int], min_size: int = 8, reset_every: int = 190) -> bytes:
    """GIF LZW with a *fixed* code size.

    Code-size growth is the one genuinely ambiguous corner of GIF LZW (decoder
    tables lag the encoder's by one entry, and implementations disagree on where
    to step up). Rather than pick a side, this encoder pins the code size by
    emitting a clear code before the dictionary can reach it — so both sides stay
    at min_size+1 bits for the whole image and the output is read identically by
    every decoder. Verified against an independent decoder (WebKit canvas) as well
    as the round-trip below.
    """
    clear, end = 1 << min_size, (1 << min_size) + 1
    size = min_size + 1
    table = {(i,): i for i in range(clear)}
    nxt, emitted = end + 1, 0
    bits = Bits()
    bits.write(clear, size)
    buf: tuple[int, ...] = ()
    for k in idx:
        cand = buf + (k,)
        if cand in table:
            buf = cand
            continue
        bits.write(table[buf], size)
        emitted += 1
        table[cand] = nxt
        nxt += 1
        buf = (k,)
        if emitted >= reset_every:          # buf is a bare literal here → safe to clear
            bits.write(clear, size)
            table = {(i,): i for i in range(clear)}
            nxt, emitted = end + 1, 0
    if buf:
        bits.write(table[buf], size)
    bits.write(end, size)
    return bits.flush()


def lzw_decode(data: bytes, min_size: int = 8) -> list[int]:
    """Decoder for the fixed-code-size stream above (no size growth by construction)."""
    clear, end = 1 << min_size, (1 << min_size) + 1
    size = min_size + 1
    table: dict[int, tuple[int, ...]] = {i: (i,) for i in range(clear)}
    nxt = end + 1
    out: list[int] = []
    acc = n = 0
    prev: tuple[int, ...] | None = None
    for byte in data:
        acc |= byte << n
        n += 8
        while n >= size:
            code = acc & ((1 << size) - 1)
            acc >>= size
            n -= size
            if code == clear:
                table = {i: (i,) for i in range(clear)}
                nxt, prev = end + 1, None
                continue
            if code == end:
                return out
            if code in table:
                entry = table[code]
            elif prev is not None:
                entry = prev + (prev[0],)
            else:
                raise ValueError(f"bad first code {code}")
            out.extend(entry)
            if prev is not None and nxt < (1 << size):
                table[nxt] = prev + (entry[0],)
                nxt += 1
            prev = entry
    return out


def gif_write(path: Path, frames: list[list[int]], w: int, h: int, palette: list[tuple[int, int, int]],
              delay_cs: int = 7, lzw_min: int = 8, reset_every: int = 190) -> None:
    """GIF89a with a 2**lzw_min-entry global colour table (lzw_min=8 → 9-bit codes)."""
    gct_n = 1 << lzw_min
    assert len(palette) <= gct_n, "palette larger than the global colour table"
    bits = lzw_min
    gct = b"".join(bytes(c) for c in palette) + bytes(3 * (gct_n - len(palette)))
    out = bytearray(b"GIF89a")
    out += struct.pack("<HHBBB", w, h, 0xF0 | (bits - 1), 0, 0)          # GCT present, size bits
    out += gct
    out += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"                # loop forever
    for f in frames:
        out += b"\x21\xf9\x04\x04" + struct.pack("<H", delay_cs) + b"\x00\x00"   # GCE: dispose=1, delay
        out += b"\x2c" + struct.pack("<HHHHB", 0, 0, w, h, 0)                  # image descriptor
        out += bytes((bits,))
        data = lzw_encode(f, bits, reset_every)
        for i in range(0, len(data), 255):
            blk = data[i:i + 255]
            out += bytes((len(blk),)) + blk
        out += b"\x00"
    out += b"\x3b"
    path.write_bytes(bytes(out))


def gif_scan() -> None:
    """Animated scan sweep — a subtle terminal-scan overlay.

    The band sweeps *inside* the frame (every frame carries a visible band, so a
    decoder that shows only frame 1 — ImageIO, thumbnails, `sips` — still shows
    the real thing) over a faint 3px grid so the dark areas are not dead flat.
    """
    w, h, frames = 240, 90, 8
    palette = [(4, 8, 10), (7, 20, 18), (10, 46, 38), (14, 84, 66), (24, 128, 96), (52, 190, 138), (140, 255, 200)]
    band_rows = [round(h * (f + 0.5) / frames) for f in range(frames)]
    imgs = []
    for band in band_rows:
        idx = []
        for y in range(h):
            d = abs(y - band)
            lit = max(0.0, 1 - d / 16)
            grid = 1 if y % 3 == 0 else 0
            for x in range(w):
                gridx = 1 if x % 4 == 0 else 0
                vig = 1 - abs(x - w / 2) / (w / 1.2)
                k = round(lit * vig * 6) + (1 if (grid or gridx) else 0)
                idx.append(max(0, min(6, k)))
        imgs.append(idx)
    # round-trip proof
    for f in imgs:
        assert lzw_decode(lzw_encode(f, 8), 8) == f, "GIF LZW round-trip failed"
    p = OUT / "scan.gif"
    gif_write(p, imgs, w, h, palette, delay_cs=6, lzw_min=8)
    head = p.read_bytes()[:6]
    print(f"  scan.gif       {w}x{h} {frames}f  {p.stat().st_size // 1024}kB  bands@{band_rows}  (LZW round-trip ok, {head!r})")


# ------------------------------------------------------------------ SVG
MASK = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00FF9C"/><stop offset=".55" stop-color="#22D3EE"/>
      <stop offset="1" stop-color="#FF2D95"/>
    </linearGradient>
    <filter id="gb"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <g fill="none" stroke="url(#g)" stroke-width="6" stroke-linejoin="round">
    <path d="M52 96c0-34 30-58 68-58s68 24 68 58c0 30-14 44-26 56-8 8-10 18-10 30v18H88v-18c0-12-2-22-10-30-12-12-26-26-26-56z"/>
    <path d="M92 104c0-12 10-20 22-20M148 104c0-12-10-20-22-20"/>
    <path d="M120 112v34m-14 0h28"/>
    <path d="M96 178c14 10 34 10 48 0"/>
  </g>
  <g opacity=".55" filter="url(#gb)" fill="url(#g)">
    <rect x="60" y="120" width="120" height="4"/><rect x="66" y="136" width="108" height="3"/>
    <rect x="74" y="152" width="92" height="3"/>
  </g>
</svg>
"""

GRID = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
  <g fill="none" stroke="#00FF9C" stroke-opacity=".22" stroke-width="1">
    <path d="M0 40h80M40 0v80M20 20l60 60M-20 20l60 60M20 -20l60 60"/>
    <path d="M0 40l14-8 14 8-14 8zM40 0l14-8 14 8-14 8zM40 80l14-8 14 8-14 8z" stroke-opacity=".3"/>
  </g>
</svg>
"""


def main() -> None:
    print(f"assets -> {OUT}")
    make_foil()
    make_grain()
    gif_scan()
    (OUT / "mask.svg").write_text(MASK)
    (OUT / "grid.svg").write_text(GRID)
    for n in ("mask.svg", "grid.svg"):
        assert (OUT / n).read_text().lstrip().startswith("<svg"), f"{n} not svg"
    print(f"  mask.svg / grid.svg  written (+{(OUT / 'mask.svg').stat().st_size}B / {(OUT / 'grid.svg').stat().st_size}B)")
    total = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"total {total // 1024}kB · all encoders self-verified")


if __name__ == "__main__":
    main()
