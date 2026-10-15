#!/usr/bin/env bash
# Bagian sistem (butuh sudo): tema GDM/layar login + splash Plymouth.
#
# Script ini SENGAJA tidak menjalankan sudo secara diam-diam. Semua perintah
# yang menyentuh /etc, /usr/share, atau initramfs dicetak lebih dulu dan
# diminta konfirmasi satu per satu.
#
#   install-system.sh            tanya lalu jalankan langkah yang disetujui
#   install-system.sh --print    cetak perintah saja, tidak menjalankan
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=ask
[ "${1:-}" = --print ] && MODE=print

say() { printf '%s\n' "$*"; }

gate() {
  local hint="$1"; shift
  if [ "$MODE" = print ]; then
    say "  [print] $*"
    return
  fi
  say "  perlu sudo ($hint)"
  say "    \$ $*"
  printf '  jalankan? [y/N] '
  read -r jawab
  case "$jawab" in
    y|Y) "$@" ;;
    *)   say "  dilewati" ;;
  esac
}

STAMP="$(date +%Y%m%d-%H%M%S)"
BAKROOT="$HOME/.local/share/ferrari-ubuntu-backup/$STAMP-system"
[ "$MODE" = ask ] && mkdir -p "$BAKROOT"

say "== GDM: gresource tema shell (pita tricolore + wallpaper login noir)"
GRESOURCE="/usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource"
say "  file target: $GRESOURCE"
say "  sumber     : assets/gdm/gnome-shell-theme.gresource (Yaru + CSS Noir, LGPL-2.1, lihat LICENSE)"
if [ "$MODE" = ask ]; then
  gate "backup gresource asal" cp -a "$GRESOURCE" "$BAKROOT/gnome-shell-theme.gresource" \
    || say "  (backup gagal: $GRESOURCE tidak terbaca — lanjut setelah kamu backup manual)"
fi
gate "pasang gresource" sudo cp "$ROOT/assets/gdm/gnome-shell-theme.gresource" "$GRESOURCE"
gate "pastikan alternatif tema menunjuk ke Yaru" sudo update-alternatives --set gdm-theme.gresource "$GRESOURCE"

say "== Plymouth: splash noir-rosso"
PLY="/usr/share/plymouth/themes/noir-rosso"
say "  tema noir-rosso turunan tema 'spinner' bawaan Ubuntu; file kami menimpa yang perlu."
gate "buat folder tema" sudo mkdir -p "$PLY"
gate "salin basis dari tema spinner" sudo cp -a /usr/share/plymouth/themes/spinner/. "$PLY/"
gate "timpa dengan aset noir" sudo cp -a "$ROOT/assets/plymouth/noir-rosso/." "$PLY/"
say "  ATURAN: update-initramfs (-R) hanya jalan kalau kamu izinkan sendiri."
gate "pilih tema + rebuild initramfs (sekali, setelah semua file benar)" \
  sudo plymouth-set-default-theme -R noir-rosso

say
say "Verifikasi setelah reboot:"
say "  plymouth-set-default-theme          -> noir-rosso"
say "  readlink -f /etc/alternatives/gdm-theme.gresource -> $GRESOURCE"
say "Rollback: scripts/revert.sh $BAKROOT"
