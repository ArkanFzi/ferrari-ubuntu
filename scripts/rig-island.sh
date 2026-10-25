#!/usr/bin/env bash
# Rig R — verifikasi tiga perbaikan noir-island di shell nyata (Xephyr :11):
#   R1 wake-from-stow menggambar card pada tinggi sebenarnya (ease geometri mati)
#   R2 zona hover membangunkan island di tepi card, bukan hanya di tengah pill
#   R3 klik kolom teks pada card media = jalan balik ke pill
# Wallpaper dicat hijau murni: apa pun yang bukan hijau di bawah panel adalah
# pixel yang benar-benar digambar island.
set -uo pipefail

# Satu rig dalam satu waktu. Semua tahap memakai $RIG dan :11 yang sama, dan
# tahap bersih-bersih di bawah ini MEMATIKAN Xephyr/gnome-shell yang sedang
# berjalan: dua rig paralel bukan bersaing, mereka saling membunuh di tengah
# pengukuran dan yang kalah mengukur puing-puing sesi lain. (Kanvas hitam yang
# dulu dikira akibat paralel ternyata punya sebab sendiri: lihat pin_jendela.)
exec 9>/tmp/noir-rig.lock
flock -n 9 || { echo "ABORT: rig lain masih memegang /tmp/noir-rig.lock"; exit 1; }

RIG=/tmp/noir-rig-r
DISPLAY_NO=:11
RES=1280x800
# Display tempat Xephyr menjalankan jendelanya. Ditangkap sebelum harness
# meng-export DISPLAY=:11 di bawah.
HOST_DISPLAY=${DISPLAY:-:1}
# Root repo diturunkan dari lokasi skrip, bukan dari path absolut: salinan di
# mesin lain (atau worktree) harus mengukur kode yang ada di depannya, bukan
# kode di direktori home user.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=$ROOT/extensions/noir-island@arkan
STUB="${HOME}/.local/share/gnome-shell/extensions/noir-island@arkan/extension.js"
UUID=noir-island@arkan

# ---- bersih-bersih -----------------------------------------------------------
# Sisa gnome-shell --x11 dari run sebelumnya masih memegang :11 sebagai WM:
# shell baru mati dengan "Failed to acquire window manager ownership" dan seluruh
# rig mengukur desktop kosong. Pola ditulis dengan kurung supaya baris perintah
# harness ini sendiri tidak ikut dicocokkan.
for p in $(pgrep -f 'gnome-[s]hell --x11' 2>/dev/null); do kill "$p" 2>/dev/null; done
pkill -x Xephyr 2>/dev/null
sleep 1

rm -rf "$RIG"
RHOME="$RIG/sandbox"
mkdir -p "$RIG"/shots "$RHOME"/{.config/dconf,.cache,Desktop,Templates}
EXTDIR="$RHOME/.local/share/gnome-shell/extensions/$UUID"
BUILD="$RHOME/.local/share/noir-island/builds/build-R"
mkdir -p "$EXTDIR/schemas" "$BUILD"

cp "$REPO/island.js" "$BUILD/island.js"
cp "$REPO/stylesheet.css" "$EXTDIR/"
cp "$REPO/schemas/org.gnome.shell.extensions.noir-island.gschema.xml" "$EXTDIR/schemas/"
cp "$REPO/metadata.json" "$EXTDIR/"
cp "$STUB" "$EXTDIR/extension.js"
printf '%s' "$BUILD" > "$RHOME/.local/share/noir-island/CURRENT"
glib-compile-schemas "$EXTDIR/schemas"
# schema juga masuk path standar rig supaya gsettings CLI bisa menyetel knob
mkdir -p "$RHOME/.local/share/glib-2.0/schemas"
cp "$REPO/schemas/org.gnome.shell.extensions.noir-island.gschema.xml" \
  "$RHOME/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$RHOME/.local/share/glib-2.0/schemas"
node --check "$BUILD/island.js" || { echo "SINTAKS GAGAL"; exit 1; }

# ---- kalender EDS tiruan ----------------------------------------------------
# Rig TIDAK boleh membaca kalender desktop asli: datanya milik user, isinya
# berubah kalau user menambah acara, dan nol acara hari ini (terukur:
# calendar.ics desktop berisi 0 VEVENT) bikin assertion agenda mati tanpa
# sebab. HOME rig sudah dihapus tiap putaran, jadi tanamannya ikut bersih.
#
# Urutan di file sengaja dibalik dari urutan waktu: acara yang sudah lewat
# ditulis lebih dulu, lalu besok, lalu yang terdekat. Kalau island mengambil
# baris pertama, bukan acara pertama yang belum lewat, teks pilnya terbaca
# salah dan assertionnya menangkap itu.
mkdir -p "$RHOME/.config/evolution/sources" \
  "$RHOME/.local/share/evolution/calendar/system"
cat > "$RHOME/.config/evolution/sources/system-calendar.source" <<'SRC'
[Data Source]
DisplayName=Personal
Enabled=true
Parent=local-stub

[Calendar]
BackendName=local
Color=#62a0ea
Selected=true
Order=0

[Offline]
StaySynchronized=true

[Refresh]
Enabled=true
EnabledOnMeteredNetwork=true
IntervalMinutes=30
SRC
LEWAT=$(date -u -d '2 hours ago' +%Y%m%dT%H%M00Z)
LEWAT_A=$(date -u -d '1 hour ago' +%Y%m%dT%H%M00Z)
RAPAT=$(date -u -d '+3 hours' +%Y%m%dT%H%M00Z)
RAPAT_A=$(date -u -d '+4 hours' +%Y%m%dT%H%M00Z)
BESOK=$(date -u -d 'tomorrow 07:00' +%Y%m%dT%H%M00Z)
BESOK_A=$(date -u -d 'tomorrow 08:00' +%Y%m%dT%H%M00Z)
STAMP=$(date -u +%Y%m%dT%H%M00Z)
{
  printf 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//noir-rig//id\n'
  printf 'BEGIN:VEVENT\nUID:rig-lewat@noir\nDTSTAMP:%s\nDTSTART:%s\nDTEND:%s\nSUMMARY:Sudah lewat\nEND:VEVENT\n' "$STAMP" "$LEWAT" "$LEWAT_A"
  printf 'BEGIN:VEVENT\nUID:rig-besok@noir\nDTSTAMP:%s\nDTSTART:%s\nDTEND:%s\nSUMMARY:Kelas besok\nEND:VEVENT\n' "$STAMP" "$BESOK" "$BESOK_A"
  printf 'BEGIN:VEVENT\nUID:rig-rapat@noir\nDTSTAMP:%s\nDTSTART:%s\nDTEND:%s\nSUMMARY:Rapat R7\nEND:VEVENT\n' "$STAMP" "$RAPAT" "$RAPAT_A"
  printf 'END:VCALENDAR\n'
} > "$RHOME/.local/share/evolution/calendar/system/calendar.ics"
R7_JAM=$(date -d '+3 hours' +%H:%M)
echo "R7-TEKS: $R7_JAM Rapat R7"

# ---- penyedia MPRIS palsu ----------------------------------------------------
# mpv di mesin ini TIDAK punya dukungan MPRIS sama sekali (strings pada biner
# /usr/bin/mpv tidak memuat satu pun simbol "mpris"; ListNames di bus bersih tidak
# pernah menampilkan org.mpris.*). Semua tes media karena itu selalu merah tanpa
# ada yang salah di island. Yang dipakai sekarang adalah pemain tiruan yang
# menuruni antarmuka yang benar-benar dibaca island.
cat > "$RIG/fake-player.py" <<'PY'
import sys
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

NAME = 'org.mpris.MediaPlayer2.noirrig'
PATH = '/org/mpris/MediaPlayer2'
PLAYER = 'org.mpris.MediaPlayer2.Player'
ROOT = 'org.mpris.MediaPlayer2'
TRACKS = [
    ('Monza', 'Noir Rig', 'Sesi Latihan', 200),
    ('Maranello', 'Noir Rig', 'Sesi Latihan', 180),
]
LEN_US = TRACKS[0][3] * 1000000
T0 = GLib.get_monotonic_time()
state = {'track': 0}

XML = """
<node>
 <interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/><method name="Quit"/>
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="SupportedUriSchemes" type="as" access="read"/>
  <property name="SupportedMimeTypes" type="as" access="read"/>
  <property name="HasQueue" type="b" access="read"/>
  <property name="CanQuit" type="b" access="read"/>
  <property name="Fullscreen" type="b" access="read"/>
  <property name="CanSetFullscreen" type="b" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
 </interface>
 <interface name="org.mpris.MediaPlayer2.Player">
  <method name="Play"/><method name="Pause"/><method name="Stop"/>
  <method name="Next"/><method name="Previous"/><method name="Restart"/>
  <method name="OpenUri"><arg name="Uri" type="s" direction="in"/></method>
  <method name="Seek"><arg name="Offset" type="x" direction="in"/></method>
  <method name="SetPosition"><arg name="TrackId" type="o" direction="in"/>
   <arg name="Position" type="x" direction="in"/></method>
  <signal name="Seeked"><arg name="TrackId" type="o"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="LoopStatus" type="s" access="read"/>
  <property name="Rate" type="d" access="read"/>
  <property name="Shuffle" type="b" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Volume" type="d" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="MinimumRate" type="d" access="read"/>
  <property name="MaximumRate" type="d" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
 </interface>
</node>"""

def meta():
    t, a, al, secs = TRACKS[state['track']]
    return GLib.Variant('a{sv}', {
        'mpris:trackid': GLib.Variant('o', '/org/mpris/MediaPlayer2/TrackList/Track%d' % state['track']),
        'mpris:length': GLib.Variant('x', secs * 1000000),
        'xesam:title': GLib.Variant('s', t),
        'xesam:artist': GLib.Variant('as', [a]),
        'xesam:album': GLib.Variant('s', al),
    })

def pos_us():
    secs = TRACKS[state['track']][3]
    return int(min(secs, (GLib.get_monotonic_time() - T0) / 1e6) * 1000000)

PROPS = {
    ROOT: {
        'Identity': GLib.Variant('s', 'NoirRig'),
        'DesktopEntry': GLib.Variant('s', 'noirrig'),
        'SupportedUriSchemes': GLib.Variant('as', ['file']),
        'SupportedMimeTypes': GLib.Variant('as', ['audio/mpeg']),
        'HasQueue': GLib.Variant('b', False),
        'CanQuit': GLib.Variant('b', True),
        'Fullscreen': GLib.Variant('b', False),
        'CanSetFullscreen': GLib.Variant('b', False),
        'CanRaise': GLib.Variant('b', True),
    },
    PLAYER: {
        'PlaybackStatus': GLib.Variant('s', 'Playing'),
        'LoopStatus': GLib.Variant('s', 'None'),
        'Rate': GLib.Variant('d', 1.0),
        'Shuffle': GLib.Variant('b', False),
        'Volume': GLib.Variant('d', 1.0),
        'MinimumRate': GLib.Variant('d', 1.0),
        'MaximumRate': GLib.Variant('d', 1.0),
        'CanGoNext': GLib.Variant('b', True),
        'CanGoPrevious': GLib.Variant('b', True),
        'CanPlay': GLib.Variant('b', True),
        'CanPause': GLib.Variant('b', True),
        'CanSeek': GLib.Variant('b', True),
        'CanControl': GLib.Variant('b', True),
    },
}

def on_call(conn, sender, path, iface, method, params, invocation, data):
    if method == 'Quit':
        GLib.idle_add(lambda: (loop.quit(), False)[1])
    invocation.return_value(None)

def on_get(conn, sender, path, iface, prop):
    if prop == 'Metadata':
        return meta()
    if prop == 'Position':
        return GLib.Variant('x', pos_us())
    return PROPS[iface][prop]

def on_set(conn, sender, path, iface, prop, value):
    pass

info = Gio.DBusNodeInfo.new_for_xml(XML)
conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
for node in info.interfaces:
    conn.register_object(PATH, node, on_call, on_get, on_set)
Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE, None, None, None)

def next_track():
    state['track'] = (state['track'] + 1) % len(TRACKS)
    conn.emit_signal(None, PATH, PLAYER, 'PropertiesChanged',
                     GLib.Variant('(sa{sv}as)', ['Metadata', {'Metadata': meta()}, []]))
    return True
GLib.timeout_add_seconds(12, next_track)

loop = GLib.MainLoop()
print('noirrig: siap di', NAME, flush=True)
loop.run()
PY

# ---- seed dconf di SESI TERPISAH yang berhenti rapi -------------------------
# dconf-service menampung tulisannya di memori dan baru menetes ke
# ~/.config/dconf/user saat sesi bus ditutup. Kalau tulisannya dilakukan di
# dalam dbus-run-session yang menghidupkan gnome-shell (sesi itu dimatikan dengan
# SIGTERM), file-nya tidak pernah muncul dan shell membaca DEFAULT skema Ubuntu
# (ding + dock) — persis kegagalan rig: enabled-extensions tetap kosong, noir
# tidak pernah naik, dock ikut tergambar sehingga baseline hijau rusak.
cat > "$RIG/seed.sh" <<SEED
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/enabled-extensions "['$UUID']"
gsettings set org.gnome.desktop.background picture-options none
gsettings set org.gnome.desktop.background picture-uri ""
gsettings set org.gnome.desktop.background picture-uri-dark ""
gsettings set org.gnome.desktop.background primary-color "#00ff00"
gsettings set org.gnome.desktop.interface enable-animations true
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.shell.extensions.noir-island idle-hide-ms 6000
gsettings set org.gnome.shell.extensions.noir-island persistent-pill true
gsettings set org.gnome.shell.extensions.noir-island hold-normal-ms 2500
gsettings set org.gnome.shell.extensions.noir-island peek-ms 1500
# Agenda DIMATIKAN di seed walau kalender rig sudah berisi tiga acara: R2C
# menguji pil idle yang memang kosong, dan itu tetap berarti selama provider
# lain punya data tapi sakelarnya mati. R7 yang menyalakannya lewat rigctl.
gsettings set org.gnome.shell.extensions.noir-island ambient-agenda false
# AMBIEN=1 menyalakan provider jam. Rig harus bisa membuktikan kedua sisi
# sakelar, bukan hanya sisi mati: tanpa ini "ambient=clock" cuma klaim di log.
echo "AMBIEN=${AMBIEN:-0}"
[ "${AMBIEN:-0}" = "1" ] && gsettings set org.gnome.shell.extensions.noir-island ambient-clock true
dconf dump /
SEED
HOME=$RHOME XDG_CONFIG_HOME=$RHOME/.config XDG_DATA_HOME=$RHOME/.local/share \
XDG_CACHE_HOME=$RHOME/.cache \
dbus-run-session -- bash "$RIG/seed.sh" > "$RIG/seed.out" 2> "$RIG/seed.err"
echo "== seed:"; cat "$RIG/seed.out"
echo "== seed.err:"; head -3 "$RIG/seed.err"
[ -f "$RHOME/.config/dconf/user" ] && echo "SEED-FILE: ADA" || echo "SEED-FILE: HILANG"

cat > "$RIG/run.sh" <<EOF
export HOME=$RHOME
export XDG_CONFIG_HOME=\$HOME/.config
export XDG_DATA_HOME=\$HOME/.local/share
export XDG_CACHE_HOME=\$HOME/.cache
export DISPLAY=$DISPLAY_NO
export NO_AT_BRIDGE=1
export GTK_A11Y=none
export MUTTER_DEBUG_DUMMY_MODE_SPECS=${RES}
export GALLIUM_DRIVER=llvmpipe
export LIBGL_ALWAYS_SOFTWARE=1
export GNOME_SHELL_SESSION_MODE=ubuntu
export GDMSESSION=ubuntu-wayland

# Semua knob sudah ditetaskan ke \$XDG_CONFIG_HOME/dconf/user oleh tahap seed di
# atas. Menulis dconf lagi di dalam sesi ini percuma: nilainya tidak pernah
# mendarat di file dan shell sempat membaca default sebelum tulisannya tiba.
echo "SEED-BACA: \$(dconf read /org/gnome/shell/enabled-extensions)"
echo "SEED-BACA: disable-user-ext=\$(dconf read /org/gnome/shell/disable-user-extensions)"
# Bus rig HARUS dipakai oleh harness juga: notify-send dan pemain MPRIS tiruan
# yang lolos ke bus asli user mengirim notifikasi ke desktop sungguhan, sementara
# shell di dalam Xephyr tidak pernah melihatnya sama sekali.
echo "\$DBUS_SESSION_BUS_ADDRESS" > $RIG/bus

# Saluran kontrol. Tulisan dconf dari luar sesi ini TIDAK sampai ke shell, dan
# itu terukur dua kali: harness menulis show-banners=false, shell menerima sinyal
# perubahannya tapi tetap membaca true (baris "dnd off" untuk kedua tulisan), dan
# di sesi uji terisolasi tulisan itu bahkan mendarat di dconf desktop asli
# (dconf-service di-aktifkan oleh dbus-daemon dengan HOME warisan, bukan HOME
# klien). Ditulis dari DALAM sesi, service yang dipakai sama dengan yang dipakai
# shell, dan satu-satunya bukti yang dibaca adalah baris log island sendiri.
mkfifo $RIG/ctl 2>/dev/null
exec 8<> $RIG/ctl
( while read -r PERINTAH <&8; do eval "\$PERINTAH"; done ) &

# stderr shell DIWARISI dari sesi ini (tidak dialihkan ke file kedua): log() GJS
# keluar di sana, dan dua penulis dengan offset terpisah pada shell.out akan
# saling menimpa.
gnome-shell --x11 &
GS=\$!
# Eval dibuang di 46 (menjawab false tanpa error), jadi yang ditunggu adalah
# baris log island itu sendiri. log() GJS keluar lewat stderr proses shell —
# mengalihkannya ke /dev/null membuat seluruh assertion berbasis log buta.
for i in \$(seq 60); do
  grep -qa "noir-island: aktif" $RIG/shell.out && break
  sleep 0.5
done
sleep 2
echo "RIG-SIAP"
wait \$GS
EOF

Xephyr $DISPLAY_NO -screen $RES -no-host-grab >/dev/null 2>&1 &
XP=$!

# Xephyr cuma jendela di HOST_DISPLAY. Kalau WM inangnya menaruh jendela itu di
# luar layar (terukur: -1480,75 di host 1920x1080 = seluruhnya terpotong),
# mutter --x11 melihat stage-nya tidak terlihat dan BERHENTI MELUKIS: shell dan
# extension tetap hidup, log tetap jalan, tapi x11grab membaca hitam pekat dan
# seluruh assertion pixel mati tanpa suara. Diperbaiki dengan memaksa jendela
# kembali ke 0,0, bukan dengan menyalakan DPMS (percobaan yang sudah dilalui).
pin_jendela() {
  local wid desk
  for i in $(seq 20); do
    wid=$(DISPLAY=$HOST_DISPLAY xdotool search --class Xephyr 2>/dev/null | tail -1)
    [ -n "$wid" ] && break
    sleep 0.2
  done
  [ -z "$wid" ] && { echo "  pin: jendela Xephyr tidak ketemu"; return 1; }
  desk=$(DISPLAY=$HOST_DISPLAY xprop -root _NET_CURRENT_DESKTOP 2>/dev/null \
         | sed -n 's/.*# \([0-9]*\)/\1/p')
  DISPLAY=$HOST_DISPLAY wmctrl -ir "$wid" -b remove,hidden,minimized 2>/dev/null
  DISPLAY=$HOST_DISPLAY xdotool set_desktop_for_window "$wid" "${desk:-0}" 2>/dev/null
  DISPLAY=$HOST_DISPLAY xdotool windowmap windowraise "$wid" 2>/dev/null
  DISPLAY=$HOST_DISPLAY xdotool windowmove "$wid" 0 0 2>/dev/null
  echo "  pin wid=$wid $(DISPLAY=$HOST_DISPLAY xwininfo -id "$wid" -stats 2>/dev/null \
    | tr -s ' \n' ' ' | sed -n 's/.*Absolute upper-left X: \([0-9-]*\).*Absolute upper-left Y: \([0-9-]*\).*Map State: \([A-Za-z]*\).*/x=\1 y=\2 \3/p')"
}
pin_jendela
# Dipakai di jalur ABORT juga: keluar tanpa membersihkan meninggalkan Xephyr +
# gnome-shell --x11 yang memegang :11, dan run berikutnya mengukur puing-puing.
bersih() {
  kill $XP 2>/dev/null
  for p in $(pgrep -f 'gnome-[s]hell --x11' 2>/dev/null); do kill "$p" 2>/dev/null; done
  pkill -x Xephyr 2>/dev/null
  # run.sh bisa tertahan (wait $GS tidak selalu kembali saat shell-nya dibunuh
  # dari luar) dan tetap memegang fd 9 = flock-nya, sehingga run berikutnya
  # langsung ABORT padahal tidak ada rig yang hidup.
  for p in $(pgrep -f "bash $RIG/run[.]sh" 2>/dev/null); do kill "$p" 2>/dev/null; done
}
# Harness HARUS menggerakkan pointer di dalam Xephyr, bukan di sesi nyata user.
export DISPLAY=$DISPLAY_NO
sleep 2
# HOME/HOME-XDG WAJIB sudah benar SEBELUM dbus-daemon lahir, bukan hanya di dalam
# run.sh: service yang diaktifkan dbus-run-session (ca.desrt.dconf) mewarisi
# environment DAEMON-nya, bukan environment klien. Tanpa prefix ini dconf-service
# berjalan dengan HOME=$HOME, jadi setiap tulisan settings dari dalam rig
# mendarat di dconf desktop sungguhan (efek samping yang sudah sempat terjadi),
# sementara gnome-shell di dalam rig membaca berkas db milik HOME-nya sendiri yang
# tidak pernah berubah. Hasil terukur: sinyal changed::show-banners tiba, nilainya
# tetap lama, dan baris 'dnd on' tidak pernah ada.
HOME=$RHOME XDG_CONFIG_HOME=$RHOME/.config XDG_DATA_HOME=$RHOME/.local/share \
XDG_CACHE_HOME=$RHOME/.cache \
dbus-run-session -- bash "$RIG/run.sh" > "$RIG/shell.out" 2>&1 &
RB=$!

shot() { ffmpeg -loglevel error -y -f x11grab -video_size $RES -i "$DISPLAY_NO+0,0" -frames:v 1 "$1"; }

# non-hijau di dalam suatu kotak = pixel yang digambar island
hit() { python3 - "$@" <<'PY'
import sys
from PIL import Image
f, x1, y1, x2, y2 = sys.argv[1], *[int(v) for v in sys.argv[2:6]]
im = Image.open(f).convert('RGB')
n = 0
for y in range(y1, y2):
    for x in range(x1, x2):
        r, g, b = im.getpixel((x, y))
        if not (g > 150 and r < 120 and b < 120):
            n += 1
print(n)
PY
}

ok=0; gagal=0
check() { if [ "$2" = OK ]; then echo "$1: OK"; ok=$((ok+1)); else echo "$1: GAGAL ($3)"; gagal=$((gagal+1)); fi; }

# pixel TERANG (teks/ikon) di dalam suatu kotak. Yang dihitung adalah luminans
# netral, bukan "apa pun yang bukan hijau": body card hitam pekat 460x72 sudah
# 100% non-hijau, jadi hit() tidak pernah bisa membedakan card berisi dari card
# kosong — persis lubang yang membuat regresi opacity bulan ini lolos tiga
# putaran tes. Terukur di rig: card notif 392 px, card media 493 px, pill 161
# px, sementara desktop bersih dan island tidur sama-sama 0.
terang() { python3 - "$@" <<'TERANGPY'
import sys
from PIL import Image
f, x1, y1, x2, y2 = sys.argv[1], *[int(v) for v in sys.argv[2:6]]
im = Image.open(f).convert('RGB')
n = 0
for y in range(y1, y2):
    for x in range(x1, x2):
        r, g, b = im.getpixel((x, y))
        if r > 105 and g > 105 and b > 105:
            n += 1
print(n)
TERANGPY
}

say() { echo "### $*"; }

pix() { python3 - "$@" <<'PIXPY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
print(sys.argv[2] + ',' + sys.argv[3], im.getpixel((int(sys.argv[2]), int(sys.argv[3]))))
PIXPY
}

tunggu_log() { for i in $(seq 30); do grep -qa "$1" "$RIG/shell.out" && return 0; sleep 0.5; done; return 1; }

# Shell X11 kadang NAIK DALAM OVERVIEW (dash favorit + "Type to search"
# menutupi kanvas): setiap pengukuran pixel jadi palsu dan baseline hijau
# terbaca 26.880 px. Escape sampai tiga sudut yang biasa tertutup dash benar
# -benar hijau lagi.
kanvas_hijau() {
  shot "$RIG/shots/probe.png"
  python3 - "$RIG/shots/probe.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
# Titik uji menghindari lajur x<170: shell Ubuntu menggambar strip dash di kiri
# yang tetap ada di desktop dan tidak pernah menutupi zona island.
sys.exit(0 if all(im.getpixel(p) == (0, 255, 0)
                  for p in ((760, 60), (640, 120), (1100, 500), (300, 400))) else 1)
PY
}
bangunkan() {
  # Lihat pin_jendela: jendela yang terdorong keluar layar membuat shell berhenti
  # melukis, dan itu tidak bisa disembuhkan dari dalam :11.
  pin_jendela
  # Layar rig bisa HITAM PEKAT: shell minta DPMS ke Xephyr yang tidak punya
  # ekstensi itu ("Xlib: extension DPMS missing on display :11"), dan tanpa
  # systemd (idle hint gagal) layar dianggap idle. Sekaligus keluar dari
  # overview: klik pada wallpaper menutupnya.
  xset -display "$DISPLAY_NO" dpms 0 0 0 2>/dev/null
  xset -display "$DISPLAY_NO" s off 2>/dev/null
  xset -display "$DISPLAY_NO" dpms force on 2>/dev/null
  xset -display "$DISPLAY_NO" s reset 2>/dev/null
  xdotool key Escape; sleep 0.4
  # Damage yang SUNGGUHAN. Shell X11 tidak melukis satu frame pun sampai ada
  # yang mengubah panggungnya: pointer-warps dan klik di wallpaper tidak mengubah
  # apa pun secara visual, jadi kanvas tetap hitam pekat walau shell dan island
  # hidup dan mencatat log. Terukur pada sesi yang sama, hitam sepanjang 25 dtk:
  # Super+Escape -> 0 px non-hitam; satu jendela sementara dipeta lalu dibunuh
  # -> 921.888 px hijau + panel. Jendela kecil di sudut kanan-bawah (di luar
  # semua titik uji) adalah alarm satu-satunya yang terbukti.
  xeyes -geometry 64x48+1180+740 >/dev/null 2>&1 &
  local sw=$!
  sleep 1.2
  kill $sw 2>/dev/null
  # Klik jauh di kanan bawah: wallpaper kosong di sana, dan klik pada
  # kanvas adalah satu-satunya cara menutup overview tanpa Eval.
  xdotool mousemove 1150 620 click 1; sleep 0.6
  # Parkir pointer di sudut yang tidak dipotret: sprite kursor ikut
  # tertangkap x11grab dan satu titik uji yang tertutup kursor terbaca putih.
  xdotool mousemove 1250 770
}
keluar_overview() {
  for i in $(seq 8); do
    kanvas_hijau && return 0
    bangunkan
  done
  return 1
}

# ------------------------------------------------------------------ mulai uji
for i in $(seq 140); do grep -qa "RIG-SIAP" "$RIG/shell.out" && break; sleep 0.5; done
# Pindahkan harness ke bus sesi rig SEBELUM perintah apa pun yang bicara D-Bus.
BUS=$(head -1 "$RIG/bus" 2>/dev/null)
if [ -n "$BUS" ] && [ "$BUS" != '$DBUS_SESSION_BUS_ADDRESS' ]; then
  export DBUS_SESSION_BUS_ADDRESS="$BUS"
  echo "BUS-RIG: $BUS"
else
  echo "BUS-RIG: GAGAL (harness bicara di bus user asli)"
fi
sleep 4
grep -qa "noir-island: aktif" "$RIG/shell.out" && check R0-ISLAND-HIDUP OK || check R0-ISLAND-HIDUP GAGAL "tidak ada 'aktif'"
timeout 5 gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.ListExtensions 2>/dev/null \
  | tr ',' '\n' | grep -a "noir\|'state'\|'enabled'\|dock\|ding" | head -12
if keluar_overview; then check R0B-KANVAS-DESKTOP OK
else
  check R0B-KANVAS-DESKTOP GAGAL "kanvas tidak hijau"
  echo "ABORT: kanvas bukan hijau murni - semua pengukuran non-hijau di bawah ini tidak berarti."
  # Rig dibiarkan HIDUP: timeline 20 dtk di bawah ini adalah satu-satunya cara
  # melihat apa yang dilakukan shell setelah boot (shield? fade? blank?).
  for i in $(seq 10); do
    shot "$RIG/shots/t$i.png"
    echo "  t$i $(pix "$RIG/shots/t$i.png" 640 400) $(pix "$RIG/shots/t$i.png" 1100 620)"
    sleep 2
  done
  echo "  shell.out:"; tail -12 "$RIG/shell.out" | sed "s/^/    /"
  bersih
  exit 1
fi

# ------------------------------------------------------------------ helper uji
# Semua pengukuran disinkronkan ke baris log island, bukan ke sleep buta: card
# notifikasi yang masih tertinggal di layar membuat tes hover berikutnya
# mengukur benda yang salah (dan tetap "lulus" karena yang diukur bukan hijau).
baris_terakhir() { grep -a "noir-island: " "$RIG/shell.out" | tail -1; }
parkir() { xdotool mousemove 1250 770; }
tidur_island() {
  for i in $(seq 40); do
    parkir; sleep 0.5
    case "$(baris_terakhir)" in *": stow") return 0;; esac
  done
  return 1
}
# "w h x y panel" dari baris state terakhir. Geometri dibaca dari log island
# sendiri karena shell di Xephyr melaporkan monitor 1600 px pada layar 1280:
# kartu 460 px mendarat di @570 -> pusat 800, jadi asumsi "tengah layar" meleset
# 160 px dan mengukur pixel yang salah.
geo() {
  grep -a 'noir-island: .* [0-9]*x[0-9]* @[-0-9]*,[-0-9]* panel=[0-9]*' "$RIG/shell.out" | tail -1 \
    | sed -n 's/.* \([0-9]*\)x\([0-9]*\) @\(-\?[0-9]*\),\(-\?[0-9]*\) panel=\([0-9]*\).*/\1 \2 \3 \4 \5/p'
}

# Badge yang benar-benar dilukis, dibaca dari island sendiri: angka di screenshot
# harus dikenali bentuknya, dan "+3" bisa tertukar dengan judul lagu.
antre_terakhir() { baris_terakhir | sed -n 's/.*antre=\([0-9]*\).*/\1/p'; }
titik() { wc -l < "$RIG/shell.out"; }
# tunggu_log memindai SELURUH berkas, jadi pola yang sudah pernah muncul lolos
# tanpa ada kejadian baru. Yang dibutuhkan tes badge adalah baris baru.
tunggu_baru() {
  for i in $(seq ${3:-30}); do
    tail -n +$((${2} + 1)) "$RIG/shell.out" | grep -qa "$1" && return 0
    sleep 0.5
  done
  return 1
}
# Tulis settings lewat saluran kontrol di dalam sesi rig (lihat run.sh). Nilai
# balik gsettings tidak bisa dipercaya di lingkungan ini, jadi tiap rigctl
# disambut tunggu_baru pada baris log island: log itu yang jadi buktinya.
#
# Pembaca FIFO menjalankan eval, jadi nilai yang membawa kutip harus ditulis
# DENGAN kutipnya di dalam satu argumen: rigctl 'gsettings set ... key "nilai"'.
# Bentuk rigctl gsettings set ... key "nilai" kehilangan kutipnya di pemanggil
# (printf "$*") dan gsettings menerima -6.2,106.8 apa adanya — terukur nilai itu
# mendarat sebagai "6", bukan sebagai koordinat.
rigctl() { printf '%s\n' "$*" > "$RIG/ctl"; }
# Badge yang sedang dilukis, diukur dengan membangunkan pil tanpa mengirim apa
# pun. Yang dipakai tes adalah SELISIHnya: record yang tidak pernah tampil (DND,
# aktor dibunuh) tidak pernah terbayar dan tetap ikut menghitung, jadi angka
# absolut tidak bisa diharapkan sama di dua percobaan.
badge_diam() {
  local t=$(titik)
  xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
  tunggu_baru ' pill ' $t || return 1
  antre_terakhir
}
# notify-send TIDAK memberi id lewat -r: itu REPLACE-id, dan daemon 46 menerima id
# yang belum pernah ada tanpa membunuh apa pun, jadi CloseNotification di R5C lama
# menjawab sukses sementara kartunya tetap naik 2,5 dtk kemudian dan membayar
# tagihannya. -p/--print-id mengembalikan id yang benar-benar diberikan daemon.
notif_id() {
  notify-send -p -u "${3:-normal}" -a "${4:-noir-rig}" --expire-time=60000 "$1" "$2" \
    2>/dev/null | tr -dc '0-9'
}
notif_close() {
  gdbus call --session --dest org.freedesktop.Notifications \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.CloseNotification "$1" >/dev/null 2>&1
}

CUT=640; POKOK=32
say "bootstrap: panel=$POKOK"

# ------------------------------------------------- R1 notif card (paling awal)
# Sekaligus memberi geometri nyata untuk seluruh tes di bawah.
timeout 5 notify-send -u normal --expire-time=2500 "Rig R1" "kartu uji tinggi" \
  || echo "  (notify-send rc=$?)"
tunggu_log "notif <- " || echo "  (tidak ada baris notif di log)"
sleep 0.8
read -r GW GH GX GY GP <<<"$(geo)"
if [ -n "${GW:-}" ]; then CUT=$((GX + GW / 2)); POKOK=$GP; fi
say "pusat=$CUT panel=$POKOK kartu=${GW}x${GH} @${GX},${GY}"
shot "$RIG/shots/kartu.png"
PIX=$(hit "$RIG/shots/kartu.png" $GX $((GY + 2)) $((GX + GW)) $((GY + GH)))
PCT=$((PIX * 100 / (GW * GH)))
[ "$PCT" -gt 60 ] && check R1-CARD-PENUH OK || check R1-CARD-PENUH GAGAL "hanya $PCT% dari ${GW}x${GH} ($PIX px)"

# R1B: rel rosso card notifikasi. Bar-nya 3 px di tepi KIRI card dan sebagian
# tertutup tile ikon di tengah, jadi yang dihitung adalah baris merah, bukan
# pixel merah.
RAIL=$(python3 - "$RIG/shots/kartu.png" "$GX" "$GY" "$GH" <<'RAILPY'
import sys
from PIL import Image
f, x0, y0, h = sys.argv[1], *[int(v) for v in sys.argv[2:5]]
im = Image.open(f).convert('RGB')
rows = sum(1 for y in range(y0 + 2, y0 + h - 2)
           if any(im.getpixel((x, y))[0] > 110 and im.getpixel((x, y))[1] < 80
                  and im.getpixel((x, y))[2] < 80 for x in range(x0, x0 + 8)))
print(rows)
RAILPY
)
[ "${RAIL:-0}" -ge 25 ] && check R1B-RAIL-ROSSO OK || check R1B-RAIL-ROSSO GAGAL "$RAIL baris merah di tepi kiri card notif"

# R1C: card notifikasi HARUS membawa teks. R1/R1B membuktikan permukaannya ada
# dan rel-nya menyala; keduanya tetap hijau pada card yang seluruh isinya hitam.
# Kotak 64..330, bukan selebar card: terukur di kartu rig, kolom terang duduk di
# 37-52 (ikon), 74-142 (title+body), 351-435 (Tutup/Buka). Ikon dan tombol harus
# dihindari — keduanya tetap terang waktu teksnya hilang, dan probe membuktikan
# kotak selebar card lolos (307 px) dengan kicker+title+body dikosongkan.
TN=$(terang "$RIG/shots/kartu.png" $((GX + 64)) $((GY + 6)) $((GX + 330)) $((GY + GH - 2)))
[ "${TN:-0}" -ge 60 ] && check R1C-TEKS-NOTIF OK || check R1C-TEKS-NOTIF GAGAL "hanya $TN px terang di body ${GW}x${GH}"

tidur_island || echo "  (island tidak masuk liang: $(baris_terakhir))"

# ------------------------------------------------------- R1A baseline saat tidur
shot "$RIG/shots/base.png"
BASE=$(hit "$RIG/shots/base.png" $((CUT - 240)) $((POKOK + 2)) $((CUT + 240)) $((POKOK + 72)))
[ "$BASE" -lt 400 ] && check R1A-BASELINE-TIDUR OK || check R1A-BASELINE-TIDUR GAGAL "$BASE px tergambar saat tidur"

# ------------------------------------------- R2 hover di tepi card -> pill bangun
N0=$(grep -ac "noir-island: unhide" "$RIG/shell.out")
xdotool mousemove $((CUT - 200)) $((POKOK + 20)); sleep 0.3
tunggu_log "idle pill" && sleep 0.5 || echo "  (tidak ada baris 'idle pill')"
shot "$RIG/shots/hover-tepi.png"
read -r PW PH PX PY _ <<<"$(geo)"
HT=$(hit "$RIG/shots/hover-tepi.png" $PX $((PY + 2)) $((PX + PW)) $((PY + PH)))
HPCT=$((HT * 100 / (PW * PH)))
[ "$HPCT" -gt 55 ] && check R2-HOVER-TEPI OK || check R2-HOVER-TEPI GAGAL "pill di x=-200 tidak bangun ($HPCT% dari ${PW}x${PH}, geometri ${PX},${PY})"

# R2C: default slot ambient. Yang diuji di sini justru kekosongannya. Sebelum
# registry ini ada, pil idle selalu membawa "17:36 | Fri 23 Oct" — angka yang
# sama persis dengan yang duduk 30 px di atasnya, dan tidak ada satu pun notch
# app yang dirilis memakai jam sebagai konten idle. Dua arah kegagalan yang
# harus dibedakan: ambient bukan '-' (sakelarnya default nyala) atau ambient
# '-' tapi pil tetap membawa pixel terang (masih ada jalur yang melukis jam).
AK=$(grep -a 'noir-island: idle pill' "$RIG/shell.out" | tail -1 \
  | sed -n 's/.*ambient=\([^ ]*\).*/\1/p')
TC=$(terang "$RIG/shots/hover-tepi.png" $((PX + 8)) $((PY + 4)) $((PX + PW - 8)) $((PY + PH - 2)))
if [ "${AMBIEN:-0}" = "1" ]; then
  # Sisi hidup sakelar: pil idle HARUS bawa teks provider, dan buktinya pixel,
  # bukan cuma log — log "ambient=clock" tetap hijau kalau _fillPill lupa
  # memanggil nilai().
  if [ "$AK" != "clock" ]; then
    check R2C-AMBIENT-JAM GAGAL "ambient=$AK, harusnya clock"
  elif [ "${TC:-0}" -lt 40 ]; then
    check R2C-AMBIENT-JAM GAGAL "ambient=clock tapi pil idle cuma $TC px terang"
  else
    check R2C-AMBIENT-JAM OK
  fi
elif [ "$AK" != '-' ]; then
  check R2C-AMBIENT-KOSONG GAGAL "ambient=$AK, default harus kosong"
elif [ "${TC:-0}" -ge 20 ]; then
  check R2C-AMBIENT-KOSONG GAGAL "ambient=- tapi pill idle $TC px terang"
else
  check R2C-AMBIENT-KOSONG OK
fi

# ------------------------------ R2B titik di luar zona (x=-300) tidak membangunkan
tidur_island || echo "  (sebelum R2B island belum tidur: $(baris_terakhir))"
N1=$(grep -ac "noir-island: unhide" "$RIG/shell.out")
xdotool mousemove $((CUT - 300)) $((POKOK + 20)); sleep 1.5
N2=$(grep -ac "noir-island: unhide" "$RIG/shell.out")
POS=$(xdotool getmouselocation --shell 2>/dev/null | tr '\n' ' ')
shot "$RIG/shots/hover-luar.png"
HL=$(hit "$RIG/shots/hover-luar.png" $((CUT - 125)) $((POKOK + 2)) $((CUT + 125)) $((POKOK + 40)))
if [ "$N2" -gt "$N1" ]; then
  check R2B-TEPI-LUAR GAGAL "bangun $((N2 - N1))x di x=-300 ($POS)"
elif [ "$HL" -gt 1500 ]; then
  check R2B-TEPI-LUAR GAGAL "pill tergambar $HL px di x=-300 ($POS)"
else
  check R2B-TEPI-LUAR OK
fi

# ---------------------------------- R3 player -> pill -> klik -> card media penuh
python3 "$RIG/fake-player.py" > "$RIG/player.out" 2>&1 &
PLAYER=$!
tunggu_log "+ player" || { echo "  (player: $(head -2 "$RIG/player.out"))"; }
xdotool mousemove $CUT $((POKOK + 20)); sleep 0.3
tunggu_log "media .* pill" && sleep 0.5 || echo "  (pill media tidak muncul: $(baris_terakhir))"
read -r QW QH QX QY _ <<<"$(geo)"
shot "$RIG/shots/media-pill.png"
QP=$(terang "$RIG/shots/media-pill.png" $((QX + 8)) $((QY + 4)) $((QX + QW - 8)) $((QY + QH - 2)))
[ "${QP:-0}" -ge 40 ] && check R3-TEKS-PILL OK || check R3-TEKS-PILL GAGAL "pill media hanya $QP px terang dari ${QW}x${QH}"
xdotool mousemove $((QX + QW / 2)) $((QY + QH / 2)); sleep 0.3
xdotool click 1; sleep 0.5
tunggu_log "media .* card" || echo "  (klik pill tidak membuka card: $(baris_terakhir))"
read -r MW MH MX MY _ <<<"$(grep -a 'noir-island: media .* card' "$RIG/shell.out" | tail -1 \
  | sed -n 's/.* \([0-9]*\)x\([0-9]*\) @\(-\?[0-9]*\),\(-\?[0-9]*\) panel=.*/\1 \2 \3 \4/p')"
MW=${MW:-420}; MH=${MH:-76}; MX=$((CUT - MW / 2)); MY=$((POKOK + 2))
shot "$RIG/shots/media-card.png"
MC=$(hit "$RIG/shots/media-card.png" $MX $MY $((MX + MW)) $((MY + MH)))
MCPCT=$((MC * 100 / (MW * MH)))
[ "$MCPCT" -gt 55 ] && check R3A-MEDIA-CARD OK || check R3A-MEDIA-CARD GAGAL "card media $MCPCT% dari ${MW}x${MH} ($MC px)"
TM=$(terang "$RIG/shots/media-card.png" $((MX + 10)) $((MY + 4)) $((MX + MW - 10)) $((MY + MH - 16)))
[ "${TM:-0}" -ge 60 ] && check R3A-TEKS-MEDIA OK || check R3A-TEKS-MEDIA GAGAL "card media hanya $TM px terang"

# ------------- R4 jalur seek: fill merah harus ADA dan harus BERTAMBAH
# Rel progress ada di media card (PROGRESS_H 12 px di dasar card), sementara
# rail rosso milik card notifikasi (lihat R1B). Fill diukur dua kali dengan
# jeda 8 dtk: pemain tiruan berjalan 1 dtk per dtk, jadi trek 200 dtk harus
# bertambah ~4% (16 px) — bukti posisi benar-benar disampel, bukan diam.
isi_bar() {
  python3 - "$1" "$2" "$3" "$4" "$5" <<'FILLPY'
import sys
from PIL import Image
f, x0, y0, w, h = sys.argv[1], *[int(v) for v in sys.argv[2:6]]
im = Image.open(f).convert('RGB')
n = sum(1 for y in range(y0 + h - 12, y0 + h - 1)
        for x in range(x0, x0 + w)
        if im.getpixel((x, y))[0] > 110 and im.getpixel((x, y))[1] < 80
        and im.getpixel((x, y))[2] < 80)
# Lebar kolom merah paling kanan = panjang fill, bukan jumlah pixel (bar 3 px
# tinggi membuat jumlah pixel 3x lebih besar dari panjang sebenarnya).
last = 0
for y in range(y0 + h - 12, y0 + h - 1):
    for x in range(x0, x0 + w):
        r, g, b = im.getpixel((x, y))
        if r > 110 and g < 80 and b < 80:
            last = max(last, x)
print(n, last - x0)
FILLPY
}
read -r F0A F0B <<<"$(isi_bar "$RIG/shots/media-card.png" $MX $MY $MW $MH)"
sleep 8
shot "$RIG/shots/media-2.png"
read -r F1A F1B <<<"$(isi_bar "$RIG/shots/media-2.png" $MX $MY $MW $MH)"
[ "${F0B:-0}" -ge 4 ] && check R4-PROGRESS-AKTIF OK || check R4-PROGRESS-AKTIF GAGAL "fill hanya $F0B px di dasar card"
[ "${F1B:-0}" -gt "${F0B:-0}" ] && check R4-PROGRESS-BERTAMBAH OK \
  || check R4-PROGRESS-BERTAMBAH GAGAL "fill $F0B px -> $F1B px dalam 8 dtk"

# ----------------------- R3B klik kolom teks card = jalan balik ke pill (collapse)
SEBELUM=$(grep -ac "media <- .* \(pill\|peek\)" "$RIG/shell.out")
xdotool mousemove $((MX + 120)) $((MY + 25)); sleep 0.4
xdotool click 1; sleep 0.6
tunggu_log "media <- .* \(pill\|peek\)" >/dev/null 2>&1
SESUDAH=$(grep -ac "media <- .* \(pill\|peek\)" "$RIG/shell.out")
read -r CW CH CX CY _ <<<"$(geo)"
shot "$RIG/shots/media-collapse.png"
CC=$(hit "$RIG/shots/media-collapse.png" $CX $((CY + 2)) $((CX + CW)) $((CY + CH)))
CPPCT=$((CC * 100 / (CW * CH)))
if [ "$SESUDAH" -le "$SEBELUM" ]; then
  check R3B-KLIK-TUTUP GAGAL "tidak ada baris pill/peek baru ($SEBELUM -> $SESUDAH); $(baris_terakhir)"
elif [ "${CW:-9999}" -gt 300 ] || [ "$CPPCT" -lt 50 ]; then
  check R3B-KLIK-TUTUP GAGAL "masih card ${CW}x${CH} ($CPPCT% tergambar)"
else
  check R3B-KLIK-TUTUP OK
fi

kill $PLAYER 2>/dev/null

# --------------- R5 jejak notifikasi: badge dibayar oleh jejak, bukan oleh antrean
# Tiga hal berbeda, dan hanya R5A yang bukan perbaikan:
#  R5A burst — 4 pesan: 1 tampil + 3 antre -> badge naik 3. Perilaku lama,
#              dijaga supaya pemindahan badge ke jejak tidak menggeser angkanya.
#  R5B DND   — show-banners mati: tidak ada satu pun kartu, tapi dua kedatangan
#              tetap meninggalkan jejak di pil. Sebelum jejak ini _onNotify
#              return di depan DND dan pesannya hilang tanpa bekas.
#  R5C aktor — notifikasi yang sedang antre dibunuh dari luar (CloseNotification).
#              _pending membuangnya, record-nya tetap tertagih. Kode lama: badge
#              ikut jatuh padahal pesan itu tidak pernah tampil.
# Semua dibaca dari antre= pada baris log island; R5B mengonfirmasinya sekali lagi
# di pixel, karena "badge=2" di log tetap hijau waktu _fillPill lupa melukisnya.
# Yang diuji SELISIH terhadap badge yang sedang dilukis, bukan angka mutlak:
# record yang tidak pernah tampil tidak pernah terbayar dan tetap ikut menghitung.
tidur_island || echo "  (sebelum R5 island belum tidur: $(baris_terakhir))"
say "R5A burst"
BAS=$(badge_diam || echo 0)
A0=$(titik)
for i in 1 2 3 4; do
  notify-send -u normal -r 500$i --expire-time=60000 "R5A pesan $i" "burst" 2>/dev/null
  sleep 0.3
done
PUNCAK=$(tail -n +$((A0 + 1)) "$RIG/shell.out" | grep -ao 'antre=[0-9]*' \
  | sed 's/antre=//' | sort -n | tail -1)
if [ "$((PUNCAK - BAS))" = "3" ]; then
  check R5A-BURST OK
else
  check R5A-BURST GAGAL "puncak ${PUNCAK:-0} dari baseline $BAS, harusnya +3 (1 tampil + 3 antre)"
fi
# Yang antre harus sempat tampil semua supaya tagihannya lunas; tanpa ini R5B dan
# R5C mengukur di atas sisa tes sebelumnya.
tunggu_baru "antre=$BAS" $A0 || echo "  (antrean R5A tidak tuntas: $(baris_terakhir))"

# ------------------------------------------------------ R5B DND: dicatat, tak tampil
tidur_island || echo "  (sebelum R5B island belum tidur: $(baris_terakhir))"
say "R5B DND"
BAS_B=$(badge_diam || echo 0)
read -r SW SH SX SY _ <<<"$(geo)"
shot "$RIG/shots/r5b-sebelum.png"
B0=$(titik)
rigctl gsettings set org.gnome.desktop.notifications show-banners false
SAMPAI=$(tunggu_baru 'noir-island: dnd on' $B0 && echo ya || echo tidak)
if [ "$SAMPAI" = "ya" ]; then
  check R5B-DND-SAMPAI OK
else
  check R5B-DND-SAMPAI GAGAL "shell tidak pernah melihat perubahannya (tak ada baris 'dnd on' bahkan lewat saluran kontrol di dalam sesi)"
fi
notify-send -u normal -r 5101 --expire-time=60000 "R5B tanpa layar" "dnd" 2>/dev/null
sleep 0.3
notify-send -u normal -r 5102 --expire-time=60000 "R5B tanpa layar" "dnd" 2>/dev/null
sleep 1.0
KARTU=$(tail -n +$((B0 + 1)) "$RIG/shell.out" | grep -ac 'notif <- ')
tunggu_baru "antre=$((BAS_B + 2))" $B0 || echo "  (badge tidak naik: $(baris_terakhir))"
BI=$(antre_terakhir)
shot "$RIG/shots/r5b-sesudah.png"
B1=$(titik)
rigctl gsettings set org.gnome.desktop.notifications show-banners true
tunggu_baru 'noir-island: dnd off' $B1 \
  || say "R5B: restore show-banners=true tidak terbaca di log island"
SA=$(terang "$RIG/shots/r5b-sebelum.png" $((SX + 8)) $((SY + 4)) $((SX + SW - 8)) $((SY + SH - 2)))
SB=$(terang "$RIG/shots/r5b-sesudah.png" $((SX + 8)) $((SY + 4)) $((SX + SW - 8)) $((SY + SH - 2)))
say "R5B pixel: $SA -> $SB terang di pil ${SW}x${SH} @${SX},${SY}"
[ "${KARTU:-0}" = "0" ] && check R5B-DND-TANPA-KARTU OK \
  || check R5B-DND-TANPA-KARTU GAGAL "$KARTU baris card notif tergambar padahal show-banners mati"
[ "${BI:-0}" = "$((BAS_B + 2))" ] && check R5B-DND-JEJAK OK \
  || check R5B-DND-JEJAK GAGAL "badge ${BI:-0} dari baseline $BAS_B, harusnya +2 (dua pesan DND dicatat, judul kembar menyatu)"
if [ "${BI:-0}" = "$((BAS_B + 2))" ]; then
  # Ambang 8, bukan 15: badge "+2" TERUKUR menambah 14 px terang di pil 240x34,
  # dan pil yang angkanya tidak berubah menambah 1 px. Yang diuji adalah "sesuatu
  # benar-benar digambar", bukan bentuk glyph-nya — bentuk itu urusan R5B-JEJAK.
  [ "$((SB - SA))" -ge 8 ] && check R5B-DND-TERLIHAT OK \
    || check R5B-DND-TERLIHAT GAGAL "pil $SA px -> $SB px; badge +2 tidak menambah 8 px pun"
else
  # Dilewati, bukan lulus: angka badge-nya saja sudah salah, jadi membandingkan
  # pixelnya tidak membuktikan apa pun.
  say "R5B-DND-TERLIHAT: DILEWATI (badge salah, $SA px -> $SB px)"
fi

# -------------------------------------------- R5C aktor dibunuh saat masih antre
tidur_island || echo "  (sebelum R5C island belum tidur: $(baris_terakhir))"
say "R5C aktor mati saat antre"
BAS_C=$(badge_diam || echo 0)
parkir
C0=$(titik)
HID=$(notif_id "R5C pemegang" "tampil" normal)
QID=$(notif_id "R5C antrean" "dibunuh" normal)
say "R5C id: pemegang=${HID:-?} antrean=${QID:-?}"
tunggu_baru 'notif <- ' $C0 || echo "  (R5C pemegang tidak tampil: $(baris_terakhir))"
tunggu_baru "antre=$((BAS_C + 1))" $C0 || echo "  (badge tidak naik: $(baris_terakhir))"
SEBELUMMATI=$(antre_terakhir)
# Urutan tutup bukan hiasan: yang antre HARUS mati lebih dulu. Kalau pemegang
# yang ditutup duluan, tick berikutnya menaikkan si antre ke panggung dan
# record-nya terbayar — persis samar yang mau diukur.
notif_close "$QID"
notif_close "$HID"
# Pemegang sengaja ditutup dari luar, bukan dibiarkan kedaluwarsa sendiri
# (hold-normal-ms 2500): setelah keduanya mati island tidur, lalu hover melukis
# pil dan baris itu terjadi SETELAH aktornya mati — angkanya cuma bisa benar
# kalau badge dibaca dari jejak, bukan dari _pending. Pointer sengaja parkir
# sejak baca baseline: hover di atas kartu memperpanjang hold sampai ceiling.
tidur_island || echo "  (sebelum baca R5C island belum tidur: $(baris_terakhir))"
SESUDAHMATI=$(badge_diam || echo -1)
# Tidak ada assertion "berapa kartu yang naik": tiap repaint card notifikasi
# mencetak baris "notif <-" yang sama, jadi jumlahnya bukan bukti siapa yang
# tampil. Yang membuktikan R5C tidak sempat tampil adalah angkanya sendiri —
# record-nya terbayar (_surface menurunkan unread) begitu kartunya naik, jadi
# badge yang tetap +1 berarti tidak ada satu pun kartu untuk si antrean.
# Tutup yang tidak bekerja juga terbaca di sini: si antre sempat naik, kartunya
# menahan pil, dan badge_diam mengembalikan -1 karena tak ada baris pill baru.
if [ "${SEBELUMMATI:-0}" != "$((BAS_C + 1))" ]; then
  check R5C-AKTOR-MATI GAGAL "badge $SEBELUMMATI dari baseline $BAS_C: si antre tidak pernah tertagih, jadi tidak ada yang diuji"
elif [ "${SESUDAHMATI:-0}" != "$((BAS_C + 1))" ]; then
  check R5C-AKTOR-MATI GAGAL "badge $SEBELUMMATI -> ${SESUDAHMATI:-0} dari baseline $BAS_C setelah aktornya dibunuh, harusnya tetap +1"
else
  check R5C-AKTOR-MATI OK
fi
parkir

# ------------------------------------------- R6 tenant privacy: mic lewat Gvc
# Tiga hal yang terbedakan dari log island, dan tidak bisa dibaca dari pixel:
#  BANGUN        — pil muncul tanpa satu pun gerakan pointer (pointer diparkir).
#  TIDAK-BERKEDIP— dua stream tumpang tindih tidak boleh menghasilkan dua unhide.
#  SAKELAR       — ambient-mic=false memutus jalurnya sampai habis.
# Efek samping yang disadari: PipeWire itu per-user, bukan per-sesi, jadi rekaman
# tiruan di sini juga menyalakan dot privacy di desktop asli beberapa detik.
say "R6 mic tenant"
parkir
tidur_island || echo "  (sebelum R6 island belum tidur: $(baris_terakhir))"
R6A=$(titik)
pw-record --rate 8000 --channels 1 /dev/null >/dev/null 2>&1 &
M1=$!
if tunggu_baru 'ambient=mic' $R6A 12; then
  BARIS=$(baris_terakhir)
  case "$BARIS" in
    *' pill '*MIK*) check R6-MIC-BANGUN OK ;;
    *) check R6-MIC-BANGUN GAGAL "bangun, tapi bukan pil berlabel MIK: $BARIS" ;;
  esac
else
  check R6-MIC-BANGUN GAGAL "tak ada baris ambient=mic selama 6 dtk rekaman, padahal pointer diparkir: $(baris_terakhir)"
fi
sleep 1.0
pw-record --rate 8000 --channels 1 /dev/null >/dev/null 2>&1 &
M2=$!
sleep 2.5
UNHIDE=$(tail -n +$((R6A + 1)) "$RIG/shell.out" | grep -ac 'noir-island: unhide')
STOW=$(tail -n +$((R6A + 1)) "$RIG/shell.out" | grep -ac 'noir-island: stow')
if [ "$UNHIDE" = "1" ] && [ "$STOW" = "0" ]; then
  check R6-MIC-TIDAK-BERKEDIP OK
else
  check R6-MIC-TIDAK-BERKEDIP GAGAL "$UNHIDE unhide dan $STOW stow selama dua stream tumpang tindih, harusnya 1 dan 0"
fi
kill $M1 $M2 2>/dev/null
R6B=$(titik)
if tunggu_baru 'noir-island: stow' $R6B 20; then
  check R6-MIC-LEPAS OK
else
  check R6-MIC-LEPAS GAGAL "rekaman sudah mati tapi island tidak tidur (idle-hide-ms 6000): $(baris_terakhir)"
fi
S0=$(titik)
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-mic false
sleep 1.0
pw-record --rate 8000 --channels 1 /dev/null >/dev/null 2>&1 &
M3=$!
sleep 3.0
kill $M3 2>/dev/null
if tail -n +$((S0 + 1)) "$RIG/shell.out" | grep -qa 'ambient=mic'; then
  check R6-MIC-SAKELAR GAGAL "ambient-mic=false masih melukis mic: $(baris_terakhir)"
else
  check R6-MIC-SAKELAR OK
fi
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-mic true

# ---------------------------------------------- R7 tenant agenda lewat CalendarServer
# Sakelar agenda dinyalakan di sini, bukan di seed. Kalender rig sudah berisi
# tiga acara sejak shell naik, jadi R2C (pil idle harus kosong) otomatis menguji
# sisi yang lebih sulit: provider PUNYA data, sakelarnya mati.
say "R7 agenda tenant"
A0=$(titik)
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-agenda true
sleep 1.0
xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
if tunggu_baru 'ambient=agenda' $A0 16; then
  BARIS=$(grep -a "noir-island: idle pill" "$RIG/shell.out" | tail -1)
  # Yang diuji adalah PEMILIHAN, bukan hanya pengiriman: tiga acara ditanam
  # dalam urutan acak dan satu sudah lewat, jadi teks yang benar ("Rapat R7",
  # jam +3 jam) hanya keluar kalau acara terdekat-yang-belum-lewat yang diambil.
  case "$BARIS" in
    *"$R7_JAM Rapat R7"*) check R7-AGENDA-TEKS OK ;;
    *) check R7-AGENDA-TEKS GAGAL "bukan acara terdekat: $BARIS" ;;
  esac
  shot "$RIG/shots/agenda.png"
  read -r PW PH PX PY _ <<<"$(geo)"
  AC=$(terang "$RIG/shots/agenda.png" $((PX + 8)) $((PY + 4)) $((PX + PW - 8)) $((PY + PH - 2)))
  if [ "${AC:-0}" -ge 40 ]; then
    check R7-AGENDA-TERANG OK
  else
    check R7-AGENDA-TERANG GAGAL "pil agenda hanya ${AC:-0} px terang di ${PX},${PY} ${PW}x${PH}"
  fi
else
  check R7-AGENDA-TEKS GAGAL "tak ada ambient=agenda setelah hover; kalender rig berisi 3 acara; $(baris_terakhir)"
  check R7-AGENDA-TERANG GAGAL "ikut mati bersama R7-AGENDA-TEKS"
fi

# kalender mana yang lebih dulu — yang lebih DEKAT.
#
# Sumber kedua ditambahkan SELAGI sesi berjalan dan itu satu-satunya jalur push
# yang terbukti hidup: mengubah calendar.ics dari luar TIDAK pernah dibaca ulang
# oleh factory (terukur: 30 dtk menunggu = nol sinyal, force_reload=true pun
# hanya mengirim acara lama), sedangkan menaruh satu file .source baru memicu
# EventsAddedOrUpdated dengan prefiks uid sumber baru dalam hitungan detik.
parkir
tidur_island || echo "  (sebelum R7B island belum tidur: $(baris_terakhir))"
SRC2="$RHOME/.config/evolution/sources/kedua.source"
ICS2="$RHOME/.local/share/evolution/calendar/kedua/calendar.ics"
mkdir -p "$(dirname "$ICS2")"
cat > "$SRC2" <<SRC
[Data Source]
DisplayName=Kedua
Enabled=true
Parent=local-stub

[Calendar]
BackendName=local
Color=#e01b24
Selected=true
Order=1
SRC
python3 - "$ICS2" <<'PY'
import sys, datetime
f = sys.argv[1]
utc = datetime.timezone.utc
cap = datetime.datetime.now(utc).strftime('%Y%m%dT%H%M%SZ')
def jam(d):
    return (datetime.datetime.now(utc) + datetime.timedelta(hours=d)).strftime('%Y%m%dT%H%M%SZ')
s = ("BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//noir-rig//id\n"
     f"BEGIN:VEVENT\nUID:rig-r7b@noir\nDTSTAMP:{cap}\nDTSTART:{jam(1)}\n"
     f"DTEND:{jam(2)}\nSUMMARY:Rapat R7B\nEND:VEVENT\nEND:VCALENDAR\n")
open(f, 'w').write(s)
PY
R7B=$(titik)
R7B_JAM=$(date -d '+1 hour' +%H:%M)
# Delapan detik tanpa satu pun gerakan pointer: waktu bagi registry melihat
# file baru, factory membukanya, dan server mengirimnya ke island.
sleep 8.0
UNH=$(tail -n +$((R7B + 1)) "$RIG/shell.out" | grep -ac 'noir-island: unhide')
if [ "$UNH" = "0" ]; then
  check R7B-TIDAK-BANGUN OK
else
  check R7B-TIDAK-BANGUN GAGAL "$UNH unhide karena kalender baru, harusnya 0"
fi
# Sekarang baru boleh bangun, dan itu pun oleh pointer rig sendiri.
KETEMU=0
for i in $(seq 10); do
  T0=$(titik)
  xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
  tunggu_baru ' idle pill ' $T0 8 || true
  case "$(baris_terakhir)" in
    *"$R7B_JAM Rapat R7B"*) KETEMU=1; break ;;
  esac
  parkir; sleep 0.7
done
if [ "$KETEMU" = "1" ]; then
  check R7B-DATA OK
else
  check R7B-DATA GAGAL "kalender kedua tidak pernah sampai (~$((i * 6)) dtk): $(baris_terakhir)"
fi

# Sumber kedua dicabut. Yang diuji adalah pembersihannya: id event dari server
# adalah `uid_sumber\nuid_event\n`, jadi hilangnya satu sumber harus membuang
# SELURUH acaranya sekaligus dan pil harus jatuh kembali ke acara kalender pertama.
rm -f "$SRC2"
D0=$(titik)
KEMBALI=0
for i in $(seq 8); do
  T0=$(titik)
  xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
  tunggu_baru ' idle pill ' $T0 8 || true
  case "$(baris_terakhir)" in
    *"$R7_JAM Rapat R7 "*) KEMBALI=1; break ;;
  esac
  parkir; sleep 0.7
done
if [ "$KEMBALI" = "1" ]; then
  check R7C-SUMBER-LEPAS OK
else
  check R7C-SUMBER-LEPAS GAGAL "sumber kedua dihapus tapi pil tidak kembali ke '$R7_JAM Rapat R7': $(baris_terakhir)"
fi

parkir
tidur_island || echo "  (sebelum R7C island belum tidur: $(baris_terakhir))"
C1=$(titik)
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-agenda false
sleep 1.0
xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
if tunggu_baru ' idle pill ' $C1 16; then
  BARIS=$(baris_terakhir)
  case "$BARIS" in
    *ambient=agenda*) check R7D-SAKELAR GAGAL "ambient-agenda=false masih melukis agenda: $BARIS" ;;
    *) check R7D-SAKELAR OK ;;
  esac
else
  check R7D-SAKELAR GAGAL "tidak ada baris idle pill untuk diperiksa: $(baris_terakhir)"
fi

# -------------------------------------------------------------------- R8 cuaca
# Satu-satunya tenant yang keluar mesin, jadi bagian yang tidak butuh jaringan
# dipisah dari bagian yang-butuh.
#
# R8A menguji GERBANGNYA dan itu tidak menyentuh met.no sama sekali: dengan
# weather-location bawaan kosong, tenant tidak boleh dibangun. Yang dituntut
# adalah keadaan log yang tidak mungkin muncul dari jalur lain — nol "cuaca
# kota=", nol data, dan minimal satu "cuaca tanpa lokasi" dari enable(). R2C
# sudah menjaga sisi lukisnya: slot ambient tetap '-' padahal sakelar cuaca
# defaultnya nyala.
say "R8 cuaca tenant"
WAKOTA=$(grep -ac 'noir-island: cuaca kota=' "$RIG/shell.out")
WADATA=$(grep -ac 'noir-island: cuaca ->' "$RIG/shell.out")
WATANPA=$(grep -ac 'noir-island: cuaca tanpa lokasi' "$RIG/shell.out")
if [ "$WAKOTA" = 0 ] && [ "$WADATA" = 0 ] && [ "$WATANPA" -ge 1 ]; then
  check R8A-TANPA-LOKASI OK
else
  check R8A-TANPA-LOKASI GAGAL "lokasi kosong tapi tenant jalan: kota=$WAKOTA data=$WADATA tanpaLokasi=$WATANPA"
fi

# Lokasi diisi lewat jalur perubahan setting, bukan lewat boot. Kalau perubahannya
# tidak membangunkan tenant, tidak ada satu pun baris "cuaca kota=" dan seluruh
# tes di bawah ikut merah dengan sebab yang terbaca.
parkir
tidur_island || echo "  (sebelum R8B island belum tidur: $(baris_terakhir))"
WB=$(titik)
rigctl 'gsettings set org.gnome.shell.extensions.noir-island weather-location "-6.2,106.8"'
if tunggu_baru 'noir-island: cuaca kota=' $WB 16; then
  check R8B-MULAI OK
else
  check R8B-MULAI GAGAL "ganti lokasi tidak membangun tenant: $(baris_terakhir)"
fi

# Satu permintaan nyata. Fetch dingin ke met.no terukur 0.8-1.3 dtk di mesin
# ini; 40 dtk memberi tempat untuk DNS/TLS yang lambat tanpa menutupi kabel
# yang benar-benar putus.
if tunggu_baru 'noir-island: cuaca ->' $WB 80; then
  WLABEL=$(grep -a 'noir-island: cuaca ->' "$RIG/shell.out" | tail -1 \
    | sed -n 's/.*cuaca -> "\(.*\)".*/\1/p')
  KETEMU=0
  for i in $(seq 6); do
    T0=$(titik)
    xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
    tunggu_baru ' idle pill ' $T0 8 || true
    case "$(baris_terakhir)" in
      *"ambient=weather:$WLABEL"*) KETEMU=1; break ;;
    esac
    parkir; sleep 0.7
  done
  if [ "$KETEMU" = "1" ]; then
    check R8C-TEKS OK
    shot "$RIG/shots/cuaca.png"
    read -r PW PH PX PY _ <<<"$(geo)"
    AC=$(terang "$RIG/shots/cuaca.png" $((PX + 8)) $((PY + 4)) $((PX + PW - 8)) $((PY + PH - 2)))
    if [ "${AC:-0}" -ge 40 ]; then
      check R8C-TERANG OK
    else
      check R8C-TERANG GAGAL "pil cuaca hanya ${AC:-0} px terang di ${PX},${PY} ${PW}x${PH}"
    fi
  else
    check R8C-TEKS GAGAL "data mendarat (label \"$WLABEL\") tapi pil tidak melukisnya: $(baris_terakhir)"
    check R8C-TERANG GAGAL "ikut mati bersama R8C-TEKS"
  fi
else
  WGAGAL=$(grep -a 'noir-island: cuaca gagal' "$RIG/shell.out" | tail -1)
  check R8C-TEKS GAGAL "met.no tidak menjawab dalam 40 dtk; ${WGAGAL:-tidak ada baris gagal sama sekali}"
  check R8C-TERANG GAGAL "ikut mati bersama R8C-TEKS"
fi

# Sakelar mati dengan DATA yang masih di tangan: Info-nya valid, lokasinya masih
# terisi, jadi yang diuji benar-benar keputusan _providers()/enabled(), bukan
# kosongnya sumber.
parkir
tidur_island || echo "  (sebelum R8D island belum tidur: $(baris_terakhir))"
WC1=$(titik)
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-weather false
sleep 1.0
xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
if tunggu_baru ' idle pill ' $WC1 16; then
  BARIS=$(baris_terakhir)
  case "$BARIS" in
    *ambient=weather*) check R8D-SAKELAR GAGAL "ambient-weather=false masih melukis cuaca: $BARIS" ;;
    *) check R8D-SAKELAR OK ;;
  esac
else
  check R8D-SAKELAR GAGAL "tidak ada baris idle pill untuk diperiksa: $(baris_terakhir)"
fi

# Sakelar dinyalakan lagi, lalu lokasi DIBUANG. R8A menguji keadaan kosong dari
# boot; yang di sini adalah PERPINDAHAN ke keadaan itu: Info lama harus dibuang
# dan labelnya ikut turun, tidak boleh mengendap di pil sampai refresh berikutnya.
rigctl gsettings set org.gnome.shell.extensions.noir-island ambient-weather true
sleep 1.0
WD1=$(titik)
rigctl 'gsettings set org.gnome.shell.extensions.noir-island weather-location ""'
if tunggu_baru 'noir-island: cuaca tanpa lokasi' $WD1 16; then
  check R8E-LOKASI-DIBUANG OK
else
  check R8E-LOKASI-DIBUANG GAGAL "lokasi dikosongkan tapi tenant tidak pindah: $(baris_terakhir)"
fi
parkir
tidur_island || echo "  (sebelum R8F island belum tidur: $(baris_terakhir))"
WF=$(titik)
xdotool mousemove $CUT $((POKOK + 20)); sleep 0.6
if tunggu_baru ' idle pill ' $WF 16; then
  BARIS=$(baris_terakhir)
  case "$BARIS" in
    *ambient=weather*) check R8F-TIDAK-MENGENDAP GAGAL "label cuaca lama masih menempel setelah lokasi dibuang: $BARIS" ;;
    *) check R8F-TIDAK-MENGENDAP OK ;;
  esac
else
  check R8F-TIDAK-MENGENDAP GAGAL "tidak ada baris idle pill untuk diperiksa: $(baris_terakhir)"
fi

# Hanya error dari jalur noir-island yang dihitung: DING mengeluh soal ~/Desktop
# yang memang tidak ada di HOME rig, dan itu bukan regresi island.
JS=$(grep -a "noir-island" "$RIG/shell.out" | grep -ac "JS ERROR\|TypeError\|SyntaxError")
[ "$JS" = 0 ] && check R9-TANPA-JS-ERROR OK || check R9-TANPA-JS-ERROR GAGAL "$(grep -a 'noir-island' "$RIG/shell.out" | grep -a 'JS ERROR\|TypeError\|SyntaxError' | head -2)"
OTHER=$(grep -ac "JS ERROR" "$RIG/shell.out")
[ "$OTHER" -gt "$JS" ] && say "catatan: $((OTHER - JS)) JS ERROR di luar noir-island (DING/portal)"
echo "== lolos=$ok gagal=$gagal jserr=$JS"
echo "== log island:"
grep -a "noir-island" "$RIG/shell.out" | tail -22 | sed 's/^/  /'

bersih
exit 0
