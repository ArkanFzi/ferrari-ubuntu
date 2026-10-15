#!/usr/bin/env python3
"""Generate tiga sound "team radio" untuk noir-cluster, ditulis sebagai .oga
(libvorbis, 44.1 kHz stereo) ke folder sound theme Yaru milik user."""
import numpy as np
import os
import subprocess
import sys

SR = 44100
# RADIO_OUT dipakai untuk dry-run ke folder sementara sebelum menyentuh sound
# theme milik user; tanpa env, tujuan tetap folder Yaru user.
OUT = os.environ.get('RADIO_OUT') or os.path.expanduser('~/.local/share/sounds/Yaru/stereo')
PEAK = 0.22


def env(n, attack=0.004, decay=1.0):
    a = max(1, int(n * attack))
    e = np.exp(-np.linspace(0, 8 * decay, n))
    w = np.ones(n)
    w[:a] = np.linspace(0, 1, a)
    return w * e


def ping(f0, dur, amp=1.0, slide=0.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = f0 * (2.0 ** (slide * t / dur))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.28 * np.sin(2 * ph)
    return amp * y * env(n, decay=1.0)


def noise(dur, amp=1.0, lp=0.25):
    n = int(SR * dur)
    rng = np.random.default_rng(7)
    y = rng.standard_normal(n)
    # lowpass ordo-1: cukup untuk membuat desis radio, bukan white noise keras
    out = np.empty(n)
    acc = 0.0
    k = lp
    for i in range(n):
        acc += k * (y[i] - acc)
        out[i] = acc
    return amp * out * env(n, attack=0.002, decay=1.4)


def place(buf, y, at):
    i = int(at * SR)
    j = min(len(buf), i + len(y))
    buf[i:j] += y[:j - i]


def render(segs, total):
    buf = np.zeros(int(SR * total))
    for at, y in segs:
        place(buf, y, at)
    buf = np.tanh(buf * 1.6)
    buf /= max(1e-9, np.abs(buf).max())
    buf *= PEAK
    edge = int(SR * 0.003)
    buf[:edge] *= np.linspace(0, 1, edge)
    buf[-edge:] *= np.linspace(1, 0, edge)
    pcm = (buf * 32767).astype('<i2')
    st = np.column_stack([pcm, pcm])
    return st.tobytes()


def write(name, data):
    wav = f'/tmp/{name}.wav'
    with open(wav, 'wb') as f:
        f.write(b'RIFF')
        f.write((36 + len(data)).to_bytes(4, 'little'))
        f.write(b'WAVEfmt ')
        f.write((16).to_bytes(4, 'little'))
        f.write((1).to_bytes(2, 'little'))
        f.write((2).to_bytes(2, 'little'))
        f.write((SR).to_bytes(4, 'little'))
        f.write((SR * 4).to_bytes(4, 'little'))
        f.write((4).to_bytes(2, 'little'))
        f.write((16).to_bytes(2, 'little'))
        f.write(b'data')
        f.write((len(data)).to_bytes(4, 'little'))
        f.write(data)
    dst = os.path.join(OUT, f'{name}.oga')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', dst], check=True)
    print(f'{dst}  {os.path.getsize(dst)} byte')


# box, box: desis radio membuka kanal lalu dua pasang ping rendah
box = [(0.00, noise(0.07, 0.30)),
       (0.06, ping(740, 0.10)), (0.19, ping(740, 0.10)),
       (0.52, ping(700, 0.10)), (0.65, ping(700, 0.13, 0.9))]
render_box = render(box, 0.95)

# lights out: lima lampu menyala berurutan lalu satu nada panjang
lights = [(i * 0.085, ping(520 + i * 105, 0.055, 0.75)) for i in range(5)]
lights.append((0.52, ping(1040, 0.26, 1.0)))
render_lights = render(lights, 0.90)

# unplug: klik kontak lalu sapuan turun (kabel lepas)
unplug = [(0.00, noise(0.02, 0.45)),
          (0.01, ping(900, 0.28, 1.0, slide=-1.5)),
          (0.16, ping(430, 0.20, 0.5, slide=-0.8))]
render_unplug = render(unplug, 0.50)

# plug: cermin unplug — klik kontak lalu sapuan naik (kabel masuk, pengisian mulai)
plug = [(0.00, noise(0.02, 0.45)),
        (0.01, ping(560, 0.28, 1.0, slide=1.5)),
        (0.16, ping(1040, 0.20, 0.5, slide=0.8))]
render_plug = render(plug, 0.50)

# Nama di argv = render sebagian (mis. `gen-radio.py radio-plug`); tanpa arg = semua.
pilih = sys.argv[1:]
os.makedirs(OUT, exist_ok=True)
for nama, data in (('radio-box', render_box), ('radio-lights', render_lights),
                   ('radio-unplug', render_unplug), ('radio-plug', render_plug)):
    if not pilih or nama in pilih:
        write(nama, data)
