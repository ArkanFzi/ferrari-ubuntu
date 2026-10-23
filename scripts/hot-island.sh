#!/usr/bin/env bash
# Publikasikan ulang isi noir-island ke shell yang SEDANG berjalan — tanpa logout.
#
#   hot-island.sh             build dari repo -> publish -> reload
#   hot-island.sh --status    build aktif + riwayat pendek
#   hot-island.sh --rollback  kembali ke build sebelumnya, reload
#   hot-island.sh --dry-run   cetak rencana, tidak menulis apa pun
#
# Cara kerjanya: extension.js yang terpasang hanyalah stub yang memuat island.js
# dari path di ~/.local/share/noir-island/CURRENT. GJS menyimpan modul per URI,
# jadi yang diganti adalah path-nya, bukan isinya. CSS tidak lewat jalur ini:
# shell membacanya dari folder extension setiap enable, jadi stylesheet.css ikut
# disalin ke folder terpasang.
set -uo pipefail

MODE=publish
case "${1:-}" in
  --status)   MODE=status ;;
  --rollback) MODE=rollback ;;
  --dry-run)  MODE=dry ;;
  "")         ;;
  *) echo "modus tidak dikenal: $1"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=noir-island@arkan
EXTSRC="$ROOT/extensions/$UUID"
EXTDST="$HOME/.local/share/gnome-shell/extensions/$UUID"
LIVE="$HOME/.local/share/noir-island"
BUILDS="$LIVE/builds"
CURRENT="$LIVE/CURRENT"
KEEP=8

say() { printf '%s\n' "$*"; }
run() { if [ "$MODE" = dry ]; then say "  DRY $*"; else "$@"; fi; }

need() {
  command -v "$1" >/dev/null 2>&1 || { say "HILANG: $1 — $2"; exit 1; }
}

show_status() {
  local cur
  cur=$(cat "$CURRENT" 2>/dev/null || echo "(tidak ada — island dimuat dari folder terpasang)")
  say "CURRENT: $cur"
  say "build tersimpan:"
  ls -1dt "$BUILDS"/build-* 2>/dev/null | head -"$KEEP" | sed 's/^/  /'
  say "stub terpasang: $([ -f "$EXTDST/extension.js" ] && echo ada || echo HILANG)"
}

publish() {
  need node "pasang nodejs untuk gerbang sintaks"
  need gnome-extensions "pasang gnome-shell-extension-tools"
  [ -d "$EXTDST" ] || { say "HILANG: $EXTDST — jalankan scripts/install.sh dulu"; exit 1; }

  say "== gerbang sintaks"
  for f in extension.js island.js; do
    node --check "$EXTSRC/$f" || { say "DIBATALKAN: $f tidak lolos sintaks"; exit 1; }
  done
  say "  extension.js + island.js lolos node --check"

  local prev build
  prev=$(cat "$CURRENT" 2>/dev/null || true)
  build="$BUILDS/build-$(date +%Y%m%d-%H%M%S)"
  [ -n "$prev" ] && say "  build sebelumnya: $prev"

  run mkdir -p "$build"
  run cp "$EXTSRC/island.js" "$build/island.js"
  run cp "$EXTSRC/stylesheet.css" "$EXTDST/stylesheet.css"
  if [ "$MODE" = dry ]; then
    say "  DRY tulis $build ke $CURRENT (CSS: $EXTDST/stylesheet.css)"
  else
    mkdir -p "$BUILDS"
    printf '%s' "$build" > "$CURRENT"
    say "  publish $build (CSS: $EXTDST/stylesheet.css)"
  fi

  if [ "$MODE" = dry ]; then
    say "  DRY gnome-extensions disable+enable $UUID"
    return
  fi
  say "== reload"
  gnome-extensions disable "$UUID" 2>&1 | sed 's/^/  /'
  sleep 0.5
  gnome-extensions enable "$UUID" 2>&1 | sed 's/^/  /'
  sleep 2

  local logbaris
  logbaris=$(journalctl --user --no-pager --since "-40 seconds" 2>/dev/null |
    grep -a "noir-island:" | tail -6)
  if [ -n "$logbaris" ]; then
    say "  log shell:"
    printf '%s\n' "$logbaris" | sed 's/^/    /'
  else
    say "  CATATAN: tidak ada baris noir-island di journal user — cek Looking Glass."
  fi

  say "== pangkas build lama"
  local lama
  lama=$(ls -1dt "$BUILDS"/build-* 2>/dev/null | tail -n +$((KEEP + 1)))
  if [ -n "$lama" ]; then
    printf '%s\n' "$lama" | while read -r d; do
      case "$d" in
        "$BUILDS"/build-*) rm -rf "$d" && say "  buang $d" ;;
        *) say "  DILEWAT (path tidak dikenal): $d" ;;
      esac
    done
  else
    say "  tidak ada"
  fi
}

rollback() {
  need gnome-extensions "pasang gnome-shell-extension-tools"
  local now prev
  now=$(cat "$CURRENT" 2>/dev/null || true)
  prev=$(ls -1dt "$BUILDS"/build-* 2>/dev/null | sed -n 2p)
  if [ -z "$now" ] || [ -z "$prev" ]; then
    say "tidak ada build kedua untuk kembali (CURRENT='$now')"
    exit 1
  fi
  say "CURRENT: $now -> $prev"
  printf '%s' "$prev" > "$CURRENT"
  gnome-extensions disable "$UUID" 2>&1 | sed 's/^/  /'
  sleep 0.5
  gnome-extensions enable "$UUID" 2>&1 | sed 's/^/  /'
  sleep 2
  journalctl --user --no-pager --since "-20 seconds" 2>/dev/null |
    grep -a "noir-island:" | tail -4 | sed 's/^/  /'
}

case "$MODE" in
  status)   show_status ;;
  rollback) rollback ;;
  dry)      publish ;;
  publish)  publish ;;
esac
