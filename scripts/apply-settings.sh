#!/usr/bin/env bash
# Terapkan setelan UI noir ke database dconf milik user.
#
#   apply-settings.sh            terapkan
#   apply-settings.sh --check    bandingkan kondisi saat ini, tidak menulis
#   apply-settings.sh --dry-run  cetak perintah tanpa menjalankan
set -uo pipefail

MODE=apply
case "${1:-}" in
  --check)   MODE=check ;;
  --dry-run) MODE=dry ;;
  "")        ;;
  *) echo "modus tidak dikenal: $1"; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

say()  { printf '%s\n' "$*"; }
run()  { if [ "$MODE" = dry ]; then say "  DRY $*"; else "$@"; fi; }
has_word() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac; }

# Satu baris "path nilai" -> nilai ditulis utuh, hanya dipecah pada spasi pertama.
# Nilai yang sengaja distandarkan (bukan cermin mesin asal), jadi beda itu normal.
PINNED_KEYS="favorite-apps"

write_one() {
  local path="$1" value="$2"
  if [ "$MODE" = check ]; then
    local now leaf
    now="$(dconf read "$path" 2>/dev/null)"
    leaf="${path##*/}"
    if [ "$now" = "$value" ]; then
      say "  sama    $path"
    elif has_word "$PINNED_KEYS" "$leaf"; then
      say "  pin     $path (memang distandarkan)"
    else
      say "  BEDA    $path"
      say "          sekarang: ${now:-<kosong>}"
      say "          seharusnya: $value"
      FAIL=1
    fi
    return
  fi
  run dconf write "$path" "$value"
}

apply_file() {
  local file="$1" prefix="${2:-}"
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    local key="${line%% *}"
    local value="${line#* }"
    [ "$key" = "$line" ] && value=''
    [ -z "$value" ] && continue
    write_one "${prefix}${key}" "$value"
  done < <(sed "s#__HOME__#$HOME#g" "$file")
}

say "== setelan umum ($(wc -l < "$ROOT/settings/noir.dconf") baris sumber)"
apply_file "$ROOT/settings/noir.dconf"

# Profil terminal: path dconf-nya mengandung UUID profil, jadi dicari dulu
# (pakai yang ada, kalau tidak ada dibuat baru).
say "== profil terminal"
PROF="$(dconf read /org/gnome/terminal/legacy/default-profile | tr -d "'")"
if [ -z "$PROF" ]; then
  # dconf list mencetak ":<uuid>/" — titik dua dan garis miringnya dibuang.
  PROF="$(dconf list /org/gnome/terminal/legacy/profiles:/ 2>/dev/null | head -1 | tr -d ':/$')"
fi
if [ -z "$PROF" ]; then
  PROF="$(python3 -c 'import uuid; print(uuid.uuid1())')"
  say "  profil baru: $PROF"
  run dconf write /org/gnome/terminal/legacy/default-profile "'$PROF'"
fi
TP="/org/gnome/terminal/legacy/profiles:/:$PROF/"
apply_file "$ROOT/settings/terminal-profile.dconf" "$TP"

# Extension lokal noir membaca schema-nya sendiri; pastikan schema ter-compile
# sesudah extension terpasang supaya togglenya bisa diubah dari menu.
say "== schema extension"
for dir in "$HOME/.local/share/gnome-shell"/extensions/noir-*/schemas; do
  [ -d "$dir" ] || continue
  run glib-compile-schemas "$dir"
done

if [ "$MODE" = check ]; then
  if [ "$FAIL" = 1 ]; then
    say "hasil: ada setelan yang belum cocok (jalankan tanpa --check untuk menerapkan)"
    exit 1
  fi
  say "hasil: semua setelan sudah cocok"
  exit 0
fi

say "selesai. Restart GNOME Shell (Wayland: logout/login) supaya semua setelan terpakai."
