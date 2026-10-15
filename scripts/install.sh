#!/usr/bin/env bash
# Pasang konfigurasi UI noir tingkat user: extension, wallpaper, suara,
# tambalan tema, lalu setelan dconf. Tidak menyentuh sistem (sudo) — bagian
# GDM/Plymouth ada di scripts/install-system.sh.
#
#   install.sh            pasang
#   install.sh --dry-run  cetak rencana, tidak menulis
#   install.sh --check    laporkan apa yang belum cocok
set -uo pipefail

MODE=apply
case "${1:-}" in
  --dry-run) MODE=dry ;;
  --check)   MODE=check ;;
  "")        ;;
  *) echo "modus tidak dikenal: $1"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTDIR="$HOME/.local/share/gnome-shell/extensions"
BGDIR="$HOME/.local/share/backgrounds"
SNDDIR="$HOME/.local/share/sounds/Yaru/stereo"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAK="$HOME/.local/share/ferrari-ubuntu-backup/$STAMP"

say() { printf '%s\n' "$*"; }
run() { if [ "$MODE" = dry ]; then say "  DRY $*"; else "$@"; fi; }

need() {
  command -v "$1" >/dev/null 2>&1 || { say "HILANG: $1 — $2"; exit 1; }
}

need gnome-shell "pasang gnome-shell"
need dconf "pasang dconf-cli"
GSVER="$(gnome-shell --version | sed 's/[^0-9.]//g')"
say "gnome-shell $GSVER (dirancang dan diuji pada 46.x)"
case "$GSVER" in
  46.*) ;;
  *) say "CATATAN: shell $GSVER bukan 46.x — extension noir perlu audit API sebelum dipakai." ;;
esac

if [ "$MODE" = apply ]; then
  mkdir -p "$BAK"
  say "backup ke $BAK"
  for item in "$EXTDIR" "$SNDDIR" "$BGDIR"; do
    [ -e "$item" ] && run cp -a "$item" "$BAK/$(basename "$item")"
  done
  dconf dump / > "$BAK/dconf.txt" 2>/dev/null || true
fi

say "== extension"
run mkdir -p "$EXTDIR"
for ext in "$ROOT"/extensions/noir-*; do
  uuid="$(basename "$ext")"
  if [ "$MODE" = check ]; then
    [ -d "$EXTDIR/$uuid" ] && say "  ada   $uuid" || say "  HILANG $uuid"
    continue
  fi
  rm -rf "${EXTDIR:?}/$uuid"
  run cp -a "$ext" "$EXTDIR/"
  say "  pasang $uuid"
done
if [ "$MODE" = apply ]; then
  for s in "$EXTDIR"/noir-*/schemas; do
    [ -d "$s" ] && glib-compile-schemas "$s" && say "  schema $s"
  done
fi

say "== wallpaper"
run mkdir -p "$BGDIR"
for f in "$ROOT"/assets/wallpapers/*; do
  base="$(basename "$f")"
  case "$base" in
    *.xml)
      if [ "$MODE" = check ]; then
        [ -f "$BGDIR/$base" ] && say "  ada   $base" || say "  HILANG $base"
        continue
      fi
      # XML wallpaper dinamis memakai path absolut; render ke $HOME mesin ini.
      if [ "$MODE" = apply ]; then
        sed "s#__HOME__#$HOME#g" "$f" > "$BGDIR/$base"
      else
        say "  DRY render $base -> $BGDIR/$base"
      fi
      say "  render $base"
      ;;
    *)
      [ "$MODE" = check ] && { [ -f "$BGDIR/$base" ] && say "  ada   $base" || say "  HILANG $base"; continue; }
      run cp -a "$f" "$BGDIR/"
      say "  pasang $base"
      ;;
  esac
done

say "== suara tim radio"
run mkdir -p "$SNDDIR"
for f in "$ROOT"/assets/sounds/*.oga; do
  base="$(basename "$f")"
  [ "$MODE" = check ] && { [ -f "$SNDDIR/$base" ] && say "  ada   $base" || say "  HILANG $base"; continue; }
  run cp -a "$f" "$SNDDIR/"
  say "  pasang $base"
done

say "== tambalan tema shell (rosso pada WhiteSur)"
SRC="$HOME/.themes/WhiteSur-Dark-orange/gnome-shell/gnome-shell.css"
if [ -d "$HOME/.themes/WhiteSur-Dark-orange" ]; then
  if [ "$MODE" = check ]; then
    grep -q da291c "$SRC" 2>/dev/null && say "  ada   aksen rosso di gnome-shell.css" || say "  HILANG tambalan di $SRC"
  else
    [ -f "$SRC" ] && run cp -a "$SRC" "$BAK/WhiteSur-gnome-shell.css"
    run cp -a "$ROOT/theme/overrides/gnome-shell/gnome-shell.css" "$SRC"
    say "  pasang gnome-shell.css"
  fi
else
  say "  LEWAT: ~/.themes/WhiteSur-Dark-orange belum ada. Jalankan scripts/fetch-deps.sh dulu."
fi

say "== setelan"
case "$MODE" in
  dry)   run bash "$ROOT/scripts/apply-settings.sh" --dry-run ;;
  check) bash "$ROOT/scripts/apply-settings.sh" --check || true ;;
  *)     bash "$ROOT/scripts/apply-settings.sh" ;;
esac

say
if [ "$MODE" = apply ]; then
  say "Selesai level user. JS extension dibacanya sekali per proses shell:"
  say "logout lalu login lagi (Wayland tidak bisa Alt+F2 r)."
  say "Lanjut untuk GDM + Plymouth (butuh sudo): scripts/install-system.sh"
else
  say "Mode $MODE: tidak ada yang ditulis."
fi
