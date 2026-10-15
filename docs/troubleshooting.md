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
suspend selama media Playing. Kalau masih tertidur, cek inhibitor masih dipegang
(`systemd-inhibit --list | grep -i noir`).

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

## 11. Verifikasi tanpa merusak sesi

Untuk uji tata letak dipakai Xephyr (:9) dengan shell sendiri, sehingga sesi
live tidak ikut menerima input sintetis. Screenshot di Xephyr butuh gerakan
mouse terus-menerus (pixmap root basi tanpa input) dan `ffmpeg -f x11grab`.
