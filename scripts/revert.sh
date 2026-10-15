#!/usr/bin/env bash
# Kembalikan konfigurasi dari hasil backup scripts/install.sh.
#   revert.sh                  pulihkan backup paling baru
#   revert.sh <folder-backup>  pulihkan backup tertentu
set -uo pipefail

BAKROOT="$HOME/.local/share/ferrari-ubuntu-backup"
SRC="${1:-$(ls -1d "$BAKROOT"/[0-9]* 2>/dev/null | tail -1)}"

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "tidak ada backup di $BAKROOT"; exit 1
fi

echo "memulihkan dari: $SRC"
echo "ini menimpa extension, wallpaper, suara, dan setelan dconf yang ada sekarang."
printf 'lanjut? [y/N] '
read -r jawab
case "$jawab" in y|Y) ;; *) echo "batal"; exit 0 ;; esac

EXTDIR="$HOME/.local/share/gnome-shell/extensions"
[ -d "$SRC/extensions" ] && rm -rf "${EXTDIR:?}/noir-"* && cp -a "$SRC/extensions/." "$EXTDIR/" && echo "  extension dipulihkan"
[ -d "$SRC/backgrounds" ] && cp -a "$SRC/backgrounds/." "$HOME/.local/share/backgrounds/" && echo "  wallpaper dipulihkan"
[ -d "$SRC/stereo" ] && cp -a "$SRC/stereo/." "$HOME/.local/share/sounds/Yaru/stereo/" && echo "  suara dipulihkan"
[ -f "$SRC/WhiteSur-gnome-shell.css" ] && cp -a "$SRC/WhiteSur-gnome-shell.css" "$HOME/.themes/WhiteSur-Dark-orange/gnome-shell/gnome-shell.css" && echo "  gnome-shell.css dipulihkan"

if [ -f "$SRC/dconf.txt" ]; then
  echo "  setelan dconf TIDAK dipulihkan otomatis (berisiko menimpa di luar UI)."
  echo "  bandingkan manual dengan: diff <(dconf dump /) $SRC/dconf.txt"
fi

echo "selesai. Logout/login supaya shell memuat versi lama."
