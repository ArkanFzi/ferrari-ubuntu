#!/usr/bin/env bash
# Gerbang sanitasi sebelum repo dijadikan publik.
# Memeriksa isi file, nama file, metadata binary, dan identitas commit.
# Keluar 0 = bersih dari pola yang diperiksa, 1 = ada temuan.
#
#   sanitize-check.sh            periksa seluruh repo
#   sanitize-check.sh --verbose  tampilkan tiap pemeriksaan
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERBOSE=0
[ "${1:-}" = --verbose ] && VERBOSE=1

FAIL=0
REPORT=""

# Daftar file kerja (tanpa .git, hasil unduhan .deps, dan dua alat pemeriksa
# yang memang berisi pola mentah).
LIST() {
  find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.deps" -prune -o \
    -path "$ROOT/backup" -prune -o -type f \
    ! -name 'sanitize-check.sh' ! -name 'refresh-settings.py' -print
}

scan() {
  local label="$1" pattern="$2" only_bin="${3:-0}"
  local found="" f
  while IFS= read -r f; do
    case "$f" in
      *.png|*.oga|*.bmp|*.gresource|*.jpg|*.jpeg) [ "$only_bin" = 0 ] && continue ;;
      *) [ "$only_bin" = 1 ] && continue ;;
    esac
    if [ "$only_bin" = 1 ]; then
      found+=$(strings -a "$f" 2>/dev/null | grep -iE "$pattern" | sed "s|^|$(basename "$f"): |")
    else
      found+=$(grep -InE "$pattern" "$f" 2>/dev/null | sed "s|^|${f#"$ROOT"/}: |")
    fi
    found+=$'\n'
  done < <(LIST)
  found="$(printf '%s' "$found" | grep -v '^$' || true)"
  if [ -n "$found" ]; then
    FAIL=1
    REPORT+="### $label"$'\n'"$found"$'\n\n'
    [ "$VERBOSE" = 1 ] && echo "TEMUAN : $label"
  else
    [ "$VERBOSE" = 1 ] && echo "bersih : $label"
  fi
}

cd "$ROOT" || exit 1

USER_NAME="$(id -un)"
HOST_FQ="$(hostname -f 2>/dev/null || hostname)"

# Identitas mesin diambil runtime dari DMI, bukan ditulis sebagai teks di repo.
# Dengan begitu alat ini memblokir hardware siapa pun yang menjalankannya, dan
# file yang dikirim ke publik tidak pernah menyebut model satu mesin pun.
DMI_RAW="$(for f in product_name product_family board_name bios_version; do
  [ -r "/sys/class/dmi/id/$f" ] && tr 'A-Z' 'a-z' < "/sys/class/dmi/id/$f" && echo
done 2>/dev/null)"
DMI_PATTERN="$(printf '%s\n' "$DMI_RAW" | tr -cs 'a-z0-9' '\n' | sort -u |
  grep -vE '^(by|the|and|for|with|hp|dell|lenovo|asus|acer|msi|apple|microsoft|system|product|name|vendor|family|series|model|laptop|notebook|computer|gaming|desktop|pro|max|ultra|base|board|maker|bios|version)$' |
  awk 'length($0) >= 5 && $0 !~ /^[0-9]+$/')"
DMI_PATTERN="$(printf '%s' "$DMI_PATTERN" | paste -sd'|' -)"
[ -n "$DMI_PATTERN" ] && DMI_PATTERN="${DMI_PATTERN//./\\.}"

scan "path rumah absolut"            '/home/[A-Za-z0-9._-]+'
scan "nama user di teks non-UUID"    "(^|[^@a-z])${USER_NAME}([^a-z0-9_]|$)"
scan "hostname"                       "${HOST_FQ//./\\.}"
[ -n "$DMI_PATTERN" ] && scan "model hardware" "$DMI_PATTERN"
scan "UUID perangkat / serial"        '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|serial[:= ]|SN[:=]'
scan "machine-id / guid 32 hex"      '[0-9a-f]{32}'
scan "alamat MAC"                    '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}'
scan "email pribadi"                 '@(gmail|outlook|yahoo|hotmail|icloud)\.'
scan "token / kunci rahasia"         'sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-|BEGIN [A-Z ]*PRIVATE KEY|password[[:space:]]*[:=]'
BIN_PATTERN="/home/|${USER_NAME}|@(gmail|outlook)\\."
[ -n "$DMI_PATTERN" ] && BIN_PATTERN+="|${DMI_PATTERN}"
scan "jejak di aset biner"           "$BIN_PATTERN" 1

# UUID extension memakai handle pemelihara: bukan data hardware, tapi ikut
# terlihat begitu repo publik. Dikeluhkan sebagai INFO, bukan kegagalan.
HANDLES="$(grep -rhoE 'noir-[a-z]+@[A-Za-z0-9._-]+' --include='*.json' --include='*.js' . 2>/dev/null | sed 's/.*@//' | sort -u | tr '\n' ' ')"
[ -n "$HANDLES" ] && echo "INFO: UUID extension memuat handle: $HANDLES (putuskan sendiri apakah ini boleh publik)"

if [ -d .git ]; then
  BADMAIL="$(git log --format='%ae %ce' 2>/dev/null | tr ' ' '\n' | grep -v '^$' | grep -vE '@users\.noreply\.github\.com$' | sort -u)"
  if [ -n "$BADMAIL" ]; then
    FAIL=1
    REPORT+="### email penulis commit (ganti ke noreply GitHub sebelum publik)"$'\n'"$BADMAIL"$'\n\n'
  fi
fi

if [ -n "$REPORT" ]; then
  printf '%s\n' "$REPORT"
fi

if [ "$FAIL" = 1 ]; then
  echo "HASIL: BELUM AMAN untuk publik — selesaikan temuan di atas."
  exit 1
fi
echo "HASIL: bersih dari pola yang diperiksa."
echo "CATATAN: pemeriksaan pola bukan jaminan total. Baca docs/publication-checklist.md sebelum ganti visibility."
