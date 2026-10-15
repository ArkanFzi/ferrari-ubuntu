#!/usr/bin/env bash
# Siapkan dependensi pihak ketiga yang TIDAK ikut di repo ini (lisensi/ukuran).
# Script ini hanya memeriksa dan mengunduh dari sumber resmi; bagian yang tidak
# bisa otomatis dicetak sebagai langkah manual.
#
#   fetch-deps.sh            periksa + unduh/pasang yang bisa
#   fetch-deps.sh --check    periksa saja
set -uo pipefail

MODE=apply
[ "${1:-}" = --check ] && MODE=check
[ "${1:-}" = "--dry-run" ] && MODE=dry

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.deps"
say() { printf '%s\n' "$*"; }
have() { [ -d "$1" ] || [ -e "$1" ]; }

MISSING=0

# 1. Tema GTK/shell WhiteSur (varian dark + aksen orange).
if have "$HOME/.themes/WhiteSur-Dark-orange"; then
  say "ada   WhiteSur-Dark-orange"
else
  MISSING=1
  say "hilang WhiteSur-gtk-theme -> https://github.com/vinceliuice/WhiteSur-gtk-theme"
  if [ "$MODE" != check ]; then
    say "        ./install.sh -t Dark -o orange -d (clone lalu jalankan installer upstream)"
    if [ "$MODE" = apply ]; then
      mkdir -p "$SRC"
      [ -d "$SRC/WhiteSur-gtk-theme" ] || git clone --depth 1 \
        https://github.com/vinceliuice/WhiteSur-gtk-theme "$SRC/WhiteSur-gtk-theme"
      say "        lanjutkan manual: cd $SRC/WhiteSur-gtk-theme && ./install.sh -t Dark -o orange"
    fi
  fi
fi

# 2. Set ikon Mkos-Big-Sur (fork Mojave CT icons) — distribusi lewat gnome-look,
#    tidak ada remote git resmi, jadi manual.
if have "$HOME/.local/share/icons/Mkos-Big-Sur-Night" || have "$HOME/.icons/Mkos-Big-Sur-Night"; then
  say "ada   Mkos-Big-Sur-Night"
else
  MISSING=1
  say "hilang Mkos-Big-Sur -> unduh dari https://www.gnome-look.org/p/1400021"
  say "        ekstrak ke ~/.local/share/icons/Mkos-Big-Sur-Night"
fi

# 3. Kursor DMZ (punya repo Ubuntu, jadi apt).
if have /usr/share/icons/DMZ-White; then
  say "ada   DMZ-White"
else
  MISSING=1
  if [ "$MODE" = apply ]; then
    say "kursor DMZ butuh sudo: sudo apt install dmz-cursor-theme"
  else
    say "hilang dmz-cursor-theme (paket Ubuntu)"
  fi
fi

# 4. Font: Inter (teks UI), Titillium Web (angka cluster/jam), Hack (monospace).
for pair in "Inter:fonts-inter" "Hack:fonts-hack"; do
  name="${pair%%:*}"; pkg="${pair##*:}"
  if fc-list 2>/dev/null | grep -qi "$name"; then
    say "ada   font $name"
  else
    MISSING=1
    say "hilang font $name -> coba: sudo apt install $pkg"
  fi
done
if fc-list 2>/dev/null | grep -qi "Titillium"; then
  say "ada   font Titillium"
else
  MISSING=1
  say "hilang font Titillium Web -> https://fonts.google.com/specimen/Titillium+Web"
  say "        ekstrak TTF ke ~/.local/share/fonts/Titillium lalu fc-cache -f"
fi

# 5. Extension GNOME pihak ketiga yang dipakai desain ini.
for ext in blur-my-shell@aunetx just-perfection-desktop@just-perfection \
           compiz-alike-magic-lamp-effect@hermes83.github.com \
           user-theme@gnome-shell-extensions.gcampax.github.com \
           ding@rastersoft.com; do
  if have "$HOME/.local/share/gnome-shell/extensions/$ext" || \
     have "/usr/share/gnome-shell/extensions/$ext"; then
    say "ada   $ext"
  else
    MISSING=1
    say "hilang $ext -> pasang dari https://extensions.gnome.org (versi untuk GNOME 46)"
  fi
done

say
if [ "$MISSING" = 1 ]; then
  say "Ada dependensi yang belum lengkap (lihat daftar hilang di atas)."
  say "Setelah lengkap: scripts/install.sh lalu scripts/install-system.sh"
else
  say "Semua dependensi siap. Lanjut: scripts/install.sh"
fi
