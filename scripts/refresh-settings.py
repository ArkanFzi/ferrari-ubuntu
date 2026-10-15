#!/usr/bin/env python3
"""Ambil setelan UI noir dari mesin ini menjadi settings/noir.dconf.

Whitelist ketat: hanya path yang memang bagian tata letak UI. Jejak pribadi
(daftar aplikasi terpasang, akun, UUID profil terminal/koneksi, riwayat
Control Center) tidak ikut terbawa. Path rumah ditulis __HOME__ supaya
apply-settings.sh merendernya ke $HOME mesin tujuan.
"""
import os
import re
import subprocess
import sys

HOME = os.path.expanduser('~')

ROOTS = [
    '/org/gnome/desktop/interface/',
    '/org/gnome/desktop/background/',
    '/org/gnome/desktop/screensaver/',
    '/org/gnome/desktop/session/',
    '/org/gnome/desktop/sound/',
    '/org/gnome/desktop/search-providers/',
    '/org/gnome/desktop/peripherals/keyboard/',
    '/org/gnome/desktop/wm/keybindings/',
    '/org/gnome/desktop/wm/preferences/',
    '/org/gnome/desktop/notifications/',
    '/org/gnome/mutter/',
    '/org/gnome/settings-daemon/plugins/color/',
    '/org/gnome/shell/',
    '/org/gnome/terminal/legacy/',
]

# Anak /org/gnome/shell/ yang boleh ikut, selain kunci di level yang sama.
SHELL_SUB_ALLOW = ('world-clocks', 'clock-options')
SHELL_TOP_ALLOW = ('enabled-extensions', 'disabled-extensions',
                   'disable-user-extensions', 'favorite-apps')

# Direktori extension yang setelannya bagian dari desain.
EXT_ALLOW = [
    'user-theme', 'just-perfection', 'blur-my-shell', 'dash-to-dock',
    'appindicator', 'ding', 'compiz-alike-magic-lamp-effect', 'x11gestures',
    'noir-rail', 'noir-clock', 'noir-cluster', 'noir-startlights',
    'noir-telemetry',
]

# Kunci berisi kondisi runtime mesin, bukan desain UI.
DENY_KEYS = {
    'application-children', 'disabled', 'sources', 'xkb-options',
    'last-version-installed', 'overridden-settings', 'settings-version',
    'rounded-blur-found', 'default-profile', 'tool-accessibility',
    'command-history', 'development-tools', 'last-selected-power-profile',
    'welcome-dialog-last-shown-version',
}

# Nilai yang sengaja distandarkan supaya dock tidak memetakan aplikasi
# milik mesin asal.
PINNED = {
    'favorite-apps': "['firefox_firefox.desktop', 'org.gnome.Nautilus.desktop', "
                     "'org.gnome.Settings.desktop', 'org.gnome.Terminal.desktop']",
}

# Pola yang tidak boleh lolos ke file yang akan dipublik. Identitas mesin
# dibaca dari DMI saat runtime, jadi tidak ada model hardware yang tertulis
# di file ini.
DMI_WORDS = {'by', 'hp', 'dell', 'lenovo', 'asus', 'acer', 'msi', 'apple',
             'microsoft', 'system', 'product', 'name', 'vendor', 'family',
             'series', 'model', 'laptop', 'notebook', 'computer', 'gaming',
             'desktop', 'pro', 'max', 'ultra', 'base', 'board', 'maker',
             'bios', 'version'}


def dmi_patterns():
    out = []
    for field in ('product_name', 'product_family', 'board_name'):
        try:
            with open(f'/sys/class/dmi/id/{field}') as fh:
                raw = fh.read().lower()
        except OSError:
            continue
        for tok in re.split(r'[^a-z0-9]+', raw):
            if len(tok) >= 5 and not tok.isdigit() and tok not in DMI_WORDS:
                out.append(re.escape(tok))
    return sorted(set(out))


FORBIDDEN = [
    r'/home/[A-Za-z0-9._-]+',
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    r'@gmail|@outlook|@yahoo',
    r'sk-[A-Za-z0-9]{20,}',
    r'password',
    r'serial',
    re.escape(os.uname().nodename),
] + dmi_patterns()


def dump(root):
    out = subprocess.run(['dconf', 'dump', root], capture_output=True, text=True)
    base = '/' + root.strip('/')
    rows, section = [], ''
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].rstrip('=').strip('/')
            continue
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        path = f'{base}/{section}/{key.strip()}'.replace('//', '/')
        rows.append((re.sub(r'/+', '/', path), value.strip()))
    return rows


def allowed(path):
    if 'profiles:' in path or '/application/' in path:
        return False
    if path.startswith('/org/gnome/shell/extensions/'):
        # nama schema bisa tersimpan berjenjang (ncom/github/hermes83/...)
        seg = path.split('/')
        return any(s in EXT_ALLOW for s in seg)
    if path.startswith('/org/gnome/shell/'):
        rest = path[len('/org/gnome/shell/'):]
        if '/' not in rest:
            return rest in SHELL_TOP_ALLOW
        return rest.split('/')[0] in SHELL_SUB_ALLOW
    return True


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    seen, rows = set(), []
    for base in ROOTS:
        for path, value in dump(base):
            leaf = path.rsplit('/', 1)[-1]
            if leaf in DENY_KEYS or not allowed(path) or path in seen:
                continue
            seen.add(path)
            value = PINNED.get(leaf, value)
            rows.append((path, value.replace(HOME, '__HOME__')))

    lines = ['# Setelan UI noir. Format: <path dconf> <nilai GVariant>',
             '# __HOME__ dirender ke $HOME oleh scripts/apply-settings.sh.',
             '# Diisi ulang dari mesin asal: python3 scripts/refresh-settings.py']
    lines += [f'{p} {v}' for p, v in rows]
    body = '\n'.join(lines) + '\n'

    for pat in FORBIDDEN:
        hit = re.search(pat, body, re.I)
        if hit:
            print(f'GERBANG GAGAL: pola {pat} -> {hit.group(0)}', file=sys.stderr)
            return 1

    dst = os.path.join(root, 'settings', 'noir.dconf')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w') as f:
        f.write(body)
    print(f'{dst}  {len(rows)} kunci')
    return 0


if __name__ == '__main__':
    sys.exit(main())
