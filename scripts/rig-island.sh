#!/usr/bin/env bash
# Rig R — verifikasi tiga perbaikan noir-island di shell nyata (Xephyr :11):
#   R1 wake-from-stow menggambar card pada tinggi sebenarnya (ease geometri mati)
#   R2 zona hover membangunkan island di tepi card, bukan hanya di tengah pill
#   R3 klik kolom teks pada card media = jalan balik ke pill
# Wallpaper dicat hijau murni: apa pun yang bukan hijau di bawah panel adalah
# pixel yang benar-benar digambar island.
set -uo pipefail

RIG=/tmp/noir-rig-r
DISPLAY_NO=:11
RES=1280x800
REPO=/home/arkan/ferrari-ubuntu/extensions/noir-island@arkan
STUB=/home/arkan/.local/share/gnome-shell/extensions/noir-island@arkan/extension.js
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
mkdir -p "$RIG"/{shots,home/.config/dconf,home/.cache,home/Desktop,home/Templates}
EXTDIR="$RIG/home/.local/share/gnome-shell/extensions/$UUID"
BUILD="$RIG/home/.local/share/noir-island/builds/build-R"
mkdir -p "$EXTDIR/schemas" "$BUILD"

cp "$REPO/island.js" "$BUILD/island.js"
cp "$REPO/stylesheet.css" "$EXTDIR/"
cp "$REPO/schemas/org.gnome.shell.extensions.noir-island.gschema.xml" "$EXTDIR/schemas/"
cp "$REPO/metadata.json" "$EXTDIR/"
cp "$STUB" "$EXTDIR/extension.js"
printf '%s' "$BUILD" > "$RIG/home/.local/share/noir-island/CURRENT"
glib-compile-schemas "$EXTDIR/schemas"
# schema juga masuk path standar rig supaya gsettings CLI bisa menyetel knob
mkdir -p "$RIG/home/.local/share/glib-2.0/schemas"
cp "$REPO/schemas/org.gnome.shell.extensions.noir-island.gschema.xml" \
  "$RIG/home/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$RIG/home/.local/share/glib-2.0/schemas"
node --check "$BUILD/island.js" || { echo "SINTAKS GAGAL"; exit 1; }

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
dconf dump /
SEED
HOME=$RIG/home XDG_CONFIG_HOME=$RIG/home/.config XDG_DATA_HOME=$RIG/home/.local/share \
XDG_CACHE_HOME=$RIG/home/.cache \
dbus-run-session -- bash "$RIG/seed.sh" > "$RIG/seed.out" 2> "$RIG/seed.err"
echo "== seed:"; cat "$RIG/seed.out"
echo "== seed.err:"; head -3 "$RIG/seed.err"
[ -f "$RIG/home/.config/dconf/user" ] && echo "SEED-FILE: ADA" || echo "SEED-FILE: HILANG"

cat > "$RIG/run.sh" <<EOF
export HOME=$RIG/home
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
# Harness HARUS menggerakkan pointer di dalam Xephyr, bukan di sesi nyata user.
export DISPLAY=$DISPLAY_NO
sleep 2
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
  # Layar rig bisa HITAM PEKAT: shell minta DPMS ke Xephyr yang tidak punya
  # ekstensi itu ("Xlib: extension DPMS missing on display :11"), dan tanpa
  # systemd (idle hint gagal) layar dianggap idle. Sekaligus keluar dari
  # overview: klik pada wallpaper menutupnya.
  xset -display "$DISPLAY_NO" dpms 0 0 0 2>/dev/null
  xset -display "$DISPLAY_NO" s off 2>/dev/null
  xset -display "$DISPLAY_NO" dpms force on 2>/dev/null
  xset -display "$DISPLAY_NO" s reset 2>/dev/null
  xdotool key Escape; sleep 0.4
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
# Hanya error dari jalur noir-island yang dihitung: DING mengeluh soal ~/Desktop
# yang memang tidak ada di HOME rig, dan itu bukan regresi island.
JS=$(grep -a "noir-island" "$RIG/shell.out" | grep -ac "JS ERROR\|TypeError\|SyntaxError")
[ "$JS" = 0 ] && check R9-TANPA-JS-ERROR OK || check R9-TANPA-JS-ERROR GAGAL "$(grep -a 'noir-island' "$RIG/shell.out" | grep -a 'JS ERROR\|TypeError\|SyntaxError' | head -2)"
OTHER=$(grep -ac "JS ERROR" "$RIG/shell.out")
[ "$OTHER" -gt "$JS" ] && say "catatan: $((OTHER - JS)) JS ERROR di luar noir-island (DING/portal)"
echo "== lolos=$ok gagal=$gagal jserr=$JS"
echo "== log island:"
grep -a "noir-island" "$RIG/shell.out" | tail -22 | sed 's/^/  /'

kill $XP 2>/dev/null
for p in $(pgrep -f 'gnome-[s]hell --x11' 2>/dev/null); do kill "$p" 2>/dev/null; done
pkill -x Xephyr 2>/dev/null
exit 0
