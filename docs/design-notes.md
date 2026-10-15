# Catatan desain

Peta keputusan, urut dari yang paling menentukan bentuk layar. Angka "TIER"
dipakai di pesan commit dan nama tugas supaya keputusan lama tidak diulang.

## TIER 0 — palet

Merah hanya untuk hal yang berarti. Aksen Rosso Corsa `#da291c` dipakai di:
kursor & highlight terminal, hint tiling, garis indikator baterai di dropdown
Quick Settings, titik aksen panel, gear "N" cluster, dan sapuan livery wallpaper.
Kuning `#FFEA00` sengaja dipertahankan untuk warning aplikasi — mengganti semua
kuning jadi rosso membuat peringatan hilang artinya.

## TIER 1–4 — signatur shell

- Livery wallpaper per mode berkendara (WET dipudar, SPORT netral, RACE sapuan rosso).
- Traffic light macOS untuk tombol jendela (merah/kuning/hijau).
- Panel: tinggi 26 px, ikon ukuran 0 (hanya teks/jam + cluster), padding 8 px.
- Tipografi dua level: Inter untuk teks UI, Titillium Web khusus angka, Hack
  untuk monospace. Hierarki datang dari ukuran & bobot, bukan warna.

## TIER 5 — sesi dini (login & boot)

- `assets/gdm/gnome-shell-theme.gresource`: turunan CSS Yaru dengan pita
  tricolore hijau-putih-merah mengikuti lengkung perisai, dan input kata sandi
  yang tidak bertabrakan dengan wallpaper.
- Wallpaper dinamis tiga fasa (siang/sore/malam, satu hari = 86400 s) —
  malam dibuat hitam-putih penuh.
- Plymouth `noir-rosso`: turunan tema `spinner` bawaan, tanpa logo pabrikan,
  spinner kecil. Perubahan tema Plymouth menyentuh initramfs, jadi selalu
  lewat persetujuan eksplisit per perintah.

## TIER 9/16 — jam & rail

- `noir-clock@arkan`: jam analog noir + layar ambient saat idle. Veil hanya naik
  kalau sesi memang menjadwalkan blank (`idle-delay` > ambang dua menit), jadi
  "jangan sleep saat adaptor terpasang" juga mematikan jam ambient. Pegang
  inhibitor suspend/idle selama pemutaran media aktif supaya YouTube tidak
  membuat laptop tertidur. X11-only untuk bagian xwinwrap-nya.
- `noir-rail@arkan`: rel sub-panel di sisi dock, toggle lewat ikon dock.
  Bentrok dengan Just Perfection kalau keduanya memangkas panel — pilih satu.

## TIER 20–22 — permukaan

Popup, Quick Settings, dan kartu notifikasi memakai permukaan gelap dengan
blur dan radius seragam (dialog 16, menu 14, notifikasi/OSD 12, panel 0).
Panel tetap datang tanpa kaca supaya tinggi 26 px konsisten.

## TIER 23–24 — suara & cluster

- Event suara diselesaikan lewat sound theme Yaru milik user
  (`~/.local/share/sounds/Yaru/stereo/<id>.oga`). Tema tidak punya section
  `[EventSounds]`, jadi libcanberra jatuh ke pola `<event>.oga`; versi user
  mengalahkan versi sistem. Id baru tidak perlu daftar apa pun.
- `noir-cluster@arkan`: cluster F1 di panel atas (gear, rev-light 10 LED,
  kecepatan), pit-lane launch timer, dan team radio (kabel masuk/lepas,
  baterai 20 %, pengisian penuh). Cluster dan papan pesan occupies **slot yang
  sama** di panel supaya indikator tidak bergeser saat pesan muncul.

## Yang sengaja tidak diubah

Dock tetap full-height dan fixed (permintaan eksplisit). Thumbnail workspace di
app grid tetap ada. Spinner boot sudah bagus. Palet kuning bawaan untuk warning.
