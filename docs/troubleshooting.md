# Troubleshooting

Semua poin di bawah adalah jebakan yang benar-benar dialami saat meracik setup
ini, bukan daftar umum dari internet.

## 1. "Sudah install tapi tidak ada yang berubah"

JS extension dibaca sekali per proses GNOME Shell. Di Wayland tidak ada
`Alt+F2` + `r`. Solusinya logout/login, bukan restart aplikasi.

## 2. Extension hilang setelah update GNOME

`metadata.json` tiap extension noir mengunci `shell-version: ["46"]`. Kalau
shell naik ke 47/48, extension dinonaktifkan otomatis. Jangan langsung
menyunting metadata: audit API dulu (`St.*`, `Main.panel.addToStatusArea`,
`Main.wm.addKeybinding`, Properties D-Bus).

## 3. Panel kolet / indikator melompat saat pesan muncul

Cluster dan papan pesan (`pit-lane caption`) berbagi satu slot di chip panel:
pesan muncul → cluster disembunyikan, lebar label dikunci ke lebar cluster.
Kalau kamu mengubah urutan atau lebar anak, jaga aturan itu, kalau tidak panel
kanan (wifi/suara/baterai) bergeser tiap pesan.

## 4. GJS API yang tidak tersedia di build ini

`get_natural_width()`, `get_allocated_box()`, dan `get_mapped()` tidak ada.
Pakai `get_preferred_width(-1)` (mengembalikan `[min, nat]`), properti `.mapped`,
dan `get_x/get_y/get_width/get_height`. Kesalahan ini tidak tertangkap
`node --check` — baru kelihatan di log shell:

```bash
journalctl /usr/bin/gnome-shell -b | grep -i "noir\|Gjs-CRITICAL"
```

Yang paling berbahaya bukan API hilang, tapi API yang ada dan berbohong:
`Gio.Subprocess.communicate_utf8_finish()` **SIGSEGV** kalau anak tidak menulis
apa pun ke stdout (buffer NULL). Di dalam gnome-shell itu membunuh seluruh
shell — layar berkedip, semua ekstensi reload, dan sesi terasa error. Panggil
`nvidia-smi` yang dGPU-nya tertidur justru mengembalikan stdout kosong, jadi
bug ini mudah kena. Pakai `communicate_finish()` (versi byte) yang aman dan
mengembalikan `GBytes` berukuran 0:

```js
const [, bytes] = proc.communicate_finish(res);
const text = new TextDecoder().decode(bytes ? bytes.toArray() : new Uint8Array());
```

## 5. D-Bus property: `deep_unpack()` dan `Gio.DBusProxy`

Pakai `DBusProxy` per antarmuka, bukan `Gio.DBusConnection.call` (butuh 10 arg
di GJS). Nilai `Variant` wajib di-`unpack()` sebelum dicek tipenya; `OnBattery`
berupa boolean, `State`/`Percentage` angka — membandingkan tipe yang salah
membuat pemicu radio tidak pernah bunyi.

## 6. Suara radio tidak keluar

- `org.gnome.desktop.sound event-sounds` harus `true`, dan toggle "Team radio"
  di menu chip harus hidup.
- Schema extension bersifat lokal (`schemas/gschemas.compiled`), jadi
  `gsettings get org.gnome.shell.extensions.noir-cluster ...` dari terminal
  gagal "No such schema" kecuali kamu set `GSETTINGS_SCHEMA_DIR`. Ubah lewat
  menu chip.
- Id suara diselesaikan lewat sound theme. Tanpa `[EventSounds]` di
  `index.theme`, canberra cari `<id>.oga` di folder theme; override user di
  `~/.local/share/sounds/Yaru/stereo/` menang atas sistem.
- Bukti pemutaran: `canberra-gtk-play -i radio-plug &` lalu
  `wpctl status | grep -A2 canberra` → harus `[active]`. Berkas pendek
  (0,2–0,5 s) bisa lolos kalau kamu memeriksa terlalu terlambat.

## 7. Start light tidak muncul di layar login

`noir-startlights@arkan` memakai `session-modes: ["user","unlock-dialog"]`.
Greeter GDM adalah proses shell terpisah (user `gdm`, hanya membaca
`/usr/share/gnome-shell/extensions`), jadi extension user tidak bisa jalan di
form login. Yang bisa diubah di sana hanyalah **tema** (gresource GDM).

## 8. Laptop tertidur saat nonton video

`idle-delay 0` mematikan idle detector, dan noir-clock memegang inhibitor
suspend selama media Playing. Kalau masih tertidur, cek inhibitor masih
dipegang:

```bash
gnome-session-inhibit -l          # harus ada "noir-clock@arkan ... (suspend, idle)"
```

`systemd-inhibit --list` tidak membantu di sini — inhibitor gnome-session hidup
di bus sesi dan tidak muncul di sana (terukur: daftarnya kosong untuk noir).
Cara cepat lain: lihat chip PIT (noir-telemetry, lihat #14) — selama nyala karena
media, noir-clock memegang suspend.

## 9. Gesture touchpad hilang

Sesi harus "Ubuntu on Wayland". Kalau masuk lewat "Ubuntu on Xorg", gesture
berbeda jalurnya dan `xwinwrap` (layar ambient) justru bekerja; pilih sesuai
kebutuhan, jangan campur.

## 10. Plymouth

`sudo plymouth-set-default-theme -R noir-rosso` membangun ulang initramfs.
Aturan kerja di setup ini: perintah yang menyentuh initramfs hanya jalan atas
izin eksplisit, satu per satu. Kalau splash masih teks, cek
`plymouth-set-default-theme` dan log debug:
`cat /proc/cmdline` (perlu `plymouth.debug=...`), lalu `journalctl -b | grep -i plymouth`. Drop-in diagnosis ada di `assets/plymouth/10-debug.conf` (jangan dipasang permanen).

## 11. Jam ambient tidak mau hilang saat laptop dicolokkan

Dua hal yang mudah tertukar: blank-nya layar diatur power policy, veil diatur
timer idle milik `noir-clock` sendiri. Karena itu "jangan sleep saat AC" dulu
tidak otomatis menghapus layar ambient. Sejak TIER 22c veil ikut `idle-delay`:
kalau `gsettings get org.gnome.desktop.session idle-delay` bernilai 0, ambient
tidak naik. Rem lain yang menahan veil: media MPRIS Playing, inhibitor pihak
lain, jendela fullscreen — dan veil memang hanya dirancang untuk saat adaptor
terpasang.

## 12. Cluster/gear panel hilang, ekstensi berstatus ERROR

Folder ekstensi hilang dari `~/.local/share/gnome-shell/extensions/` (kalau
`noir-cluster` dan `noir-rail` mendeklarasikan `settings-schema`), `enable()`
lempar `Schema ... could not be found` dan shell menandai state 3 = ERROR.
Ekstensi tanpa schema bisa tetap terlihat hidup dari cache JS file yang sudah
dihapus, jadi "jam masih ada" bukan bukti folder masih ada.

Pasang ulang dari repo: `bash scripts/install.sh` (menyalin extension lalu
`glib-compile-schemas` tiap `schemas/`). Verifikasi tanpa logout:

```
bash scripts/install.sh --check                       # keempatnya "ada"
GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/noir-cluster@arkan/schemas \
  gsettings list-recursively org.gnome.shell.extensions.noir-cluster
```

`gnome-extensions disable` + `enable` TIDAK menyembuhkan state ERROR di sesi
yang sedang jalan: shell menyusun source schema sekali saat startup, jadi
direktori `schemas/` yang baru muncul tidak ikut terbaca. Logout/login.

## 13. Verifikasi tanpa merusak sesi

Untuk uji tata letak dipakai Xephyr (:9) dengan shell sendiri, sehingga sesi
live tidak ikut menerima input sintetis. Screenshot di Xephyr butuh gerakan
mouse terus-menerus (pixmap root basi tanpa input) dan `ffmpeg -f x11grab`.
Di build ini `Xephyr -resize` tidak dikenal dan `xrandr --fb 1920x1080`
ditolak, jadi layarnya nyata-nyata 1600x1200 — rekam dengan ukuran itu
(`-video_size 1600x1200`), bukan ukuran yang kamu harapkan. Xephyr juga butuh
dijalankan dari display Xwayland live:

```bash
DISPLAY=:1 XAUTHORITY=$(ls /run/user/1000/.mutter-Xwaylandauth.*) \
  env -u WAYLAND_DISPLAY Xephyr :9 -screen 1600x1200 &
```

Dua aturan isolasi yang saya pelajari dengan cara keras:

- **`XDG_CONFIG_HOME` harus di-set SEBELUM `dbus-run-session`.** Bentuk
  `dbus-run-session -- env XDG_CONFIG_HOME=… gnome-shell` tidak mengisolasi
  dconf: dbus-daemon dan `dconf-service` yang diaktifkannya mewarisi env
  pemanggil, jadi tiap `gsettings set` dari rig masuk ke db live. Bentuk yang
  benar: `env XDG_CONFIG_HOME=$RIG/config dbus-run-session -- env DISPLAY=:9
  XDG_CONFIG_HOME=$RIG/config gnome-shell --x11 --replace`.
- **PPD ada di bus sistem**, bukan bus sesi. Jadi termostat di rig benar-benar
  mengganti power profile mesin nyata, dan `ActiveProfile` live harus
  dikembalikan setelah selesai (`powerprofilesctl get`, lalu `set` bila perlu).
  Cek juga `/sys/devices/platform/hp-wmi/platform-profile/platform-profile-0/profile`.

## 14. Chip PIT: cara membaca dan kalau tidak muncul

`noir-telemetry@arkan` hanya membaca, tidak menahan apa pun. Nyala berarti salah
satu dari ini benar:

```bash
busctl --user list | grep mpris                    # player dengan PlaybackStatus Playing
gnome-session-inhibit -l                           # siapa pemegang suspend/idle
gdbus call --session --dest org.gnome.SessionManager \
  --object-path /org/gnome/SessionManager \
  --method org.freedesktop.DBus.Properties.Get \
  org.gnome.SessionManager InhibitedActions        # bitmask; chip hanya cek bit 4 dan 8
```

Bit 8 (idle) bisa menyala tanpa ada video berjalan, dan pemegangnya tidak
selalu terlihat dari mata — di mesin ini `mutter: idle-inhibit` dan
`ubuntu-release-upgrader` ikut menahan idle. Jadi PIT nyala bukan tanda ada
yang rusak: artinya "layar memang sengaja ditahan", dan
`gnome-session-inhibit -l` yang menunjuk pelakunya.

Chip tidak muncul sama sekali padahal ada media berjalan: JS baru terbaca saat
shell mulai (lihat #1), dan log-nya bicara sendiri:

```bash
journalctl /usr/bin/gnome-shell -b | grep noir-telemetry
```

Baris `noir-telemetry: aktif, state awal PIT mati` berarti ekstensi hidup tapi
tidak ada penahan; tidak ada baris sama sekali berarti ekstensi tidak termuat.
Catatan untuk rig: `org.gnome.SessionManager` tidak ada di bus privat
`dbus-run-session` (`ServiceUnknown`), jadi jalur inhibitor hanya bisa diuji di
sesi nyata — jalur media tetap bisa diuji dengan player MPRIS palsu.

## 15. "Mode AUTO tidak mengubah rpm kipas" — memang tidak bisa

Ini batas mesin, bukan bug ekstensi. Kecepatan fan di HP Victus diatur BIOS,
dan satu-satunya file yang menyambung ke fan hanya bisa dibaca:

```bash
H=$(grep -l '^hp$' /sys/class/hwmon/*/name | cut -d/ -f5)   # hwmon4
ls /sys/class/hwmon/$H/     # relevan: fan1_input fan2_input pwm1_enable — tidak ada pwm1
stat -c '%A %U' /sys/class/hwmon/$H/pwm1_enable               # -rw-r--r-- root:root
cat /sys/class/hwmon/$H/pwm1_enable                           # 2 = kontrol otomatis BIOS
nvidia-smi --query-gpu=fan_speed --format=csv                  # Field "fan_speed" is not a valid field
```

Yang tidak ada di mesin ini: `pwm1`/`pwm1_target` (fan tertutup), modul `nvcontrol`
untuk fan NVIDIA, dan akses ke profil `cool`. `powerprofilesctl list` hanya
menawarkan `power-saver`/`balanced`/`performance`, padahal OEM punya
`cool quiet balanced performance`:

```bash
cat /sys/devices/platform/hp-wmi/platform-profile/platform-profile-0/choices
stat -c '%A %U' /sys/devices/platform/hp-wmi/platform-profile/platform-profile-0/profile
```

Profil `cool` ada di hardware tapi tidak diekspos PPD, dan `profile` milik
root. Jadi tanpa root tidak ada satu pun tombol yang menulis rpm.

Yang AUTO lakukan: mengganti **power profile** lewat `power-profiles-daemon`,
satu-satunya penulis yang sah (`power-saver`/`balanced`/`performance`). Profil
itu mengubah batas daya & kurva yang dipilih BIOS, dan rpm bergerak sebagai
akibatnya. Karena itu angka `FAN …/… rpm` di menu adalah **bacaan**, bukan
target — dan kalau kamu melihat rpm naik sementara ekstensi tidak menulis apa
pun, itu memang jalur yang benar. Kalau mau tulis rpm langsung, dibutuhkan
root helper + `pwm1_enable=1`; sengaja tidak dibuat (lihat TIER 26 di
`design-notes.md`).

## 16. Mengubah UI island tanpa logout

Dulu setiap sentuhan di `extension.js` baru terbaca setelah logout/login. Dua
penyebab, keduanya terbukti di mesin ini:

- `org.gnome.Shell.Extensions.ReloadExtension` di shell 46 sengaja dimatikan —
  dia menjawab `NOT_SUPPORTED: ReloadExtension is deprecated and does not work`
  (`ui/shellDBus.js:468`).
- GJS 1.80 menyimpan modul ES per URI. Menulis ulang berkas di path yang sama
  tidak pernah dibaca lagi, dan menambah query-string (`…js?v=2`) **tidak**
  melepas cache — yang terbukti melepas hanya **path yang berbeda**.

Jalurnya sekarang: `extension.js` yang terpasang hanyalah stub ±60 baris yang
memuat `island.js` dari path di `~/.local/share/noir-island/CURRENT`. Kalau
penunjuk itu tidak ada (setelah `install.sh` biasa), stub memuat `island.js`
dari folder terpasang — jadi tidak ada kondisi "island mati karena belum di-publish".

```bash
scripts/hot-island.sh             # publish build dari repo + reload (tanpa logout)
scripts/hot-island.sh --status    # build aktif + riwayat
scripts/hot-island.sh --rollback  # kembali ke build sebelumnya
scripts/hot-island.sh --dry-run   # cetak rencana
```

Script itu menolak publish kalau `node --check` gagal, menyalin
`stylesheet.css` dan `schemas/` ke folder terpasang (keduanya dibaca shell dari
`extension.dir` setiap enable — `extensionSystem.js:126-143`; schema dikompilasi
ulang dengan `glib-compile-schemas`), lalu
`gnome-extensions disable` + `enable`. Build lama dipangkas, 8 terakhir disimpan.

Bukti di rig Xephyr (shell yang sama, tanpa restart):

```
sebelum swap: media <- RigTest pill 240x34 @680,32
sesudah swap: media <- RigTest pill 300x34 @650,32
B-SHELL-TIDAK-RESTART: OK (pid 880462 masih hidup)
C-NOTIF-MASIH-HIDUP:  OK (notif <- notify-send card 460x72 @570,32)
```

Yang **tetap** butuh logout: perubahan pada stub `extension.js` itu sendiri (dia
satu-satunya berkas yang di-cache selamanya oleh shell). Menambah kunci gsettings
baru ternyata **tidak** — keyakinan lama itu dibantah `idle-hide-ms`: `.xml`
dikopi + dikompilasi ke folder terpasang, disable/enable, dan shell yang sama
langsung membaca kunci baru itu (island tidur 6 dtk setelah dibiarkan).
Kalau setelah reload island terlihat aneh, `--rollback` lebih dulu, baru logout.
