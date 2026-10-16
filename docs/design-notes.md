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

## TIER 25 — chip PIT

`noir-telemetry@arkan` menjawab satu pertanyaan yang selama ini cuma bisa
dicek lewat terminal: "kenapa layar tidak mati / kenapa ambient tidak naik?".
Satu chip rosso berlabel `PIT` menyala selama salah satu dari dua sinyal publik
terpenuhi:

- ada nama `org.mpris.MediaPlayer2.*` dengan `PlaybackStatus` = `Playing`;
- `InhibitedActions` gnome-session punya bit suspend (4) atau idle (8).

Dua keputusan yang bikin chip ini bisa dipercaya:

- **Angka flag diukur, bukan ditebak.** Enum D-Bus gnome-session adalah
  logout 1, switch-user 2, suspend 4, idle 8 — bukan urutan bebas. Delta
  `InhibitedActions` diukur per panggilan `gnome-session-inhibit` untuk
  memastikan. Bit selain suspend/idle selalu menyala di sesi sehat (dasar
  sesi ini 10), jadi kalau semuanya dihitung, chip tidak pernah mati.
- **Hanya sinyal publik.** Tidak ada state shell privat yang dibaca, jadi chip
  tidak ikut pecah saat gnome-shell naik versi. Status area menerima actor
  biasa? Tidak — `addToStatusArea` menolak selain `PanelMenu.Button` (terukur),
  jadi chip dibungkus Button dengan `reactive = false` supaya tidak ada popup
  kosong saat diklik.

Chip tidak memegang inhibitor sendiri: dia hanya pembaca.

## TIER 26 — AUTO: termostat suhu di cluster

Permintaannya "atur kecepatan fan dari suhu CPU dan GPU". Yang bisa ditulis di
mesin ini bukan kecepatan fan:

- `hp_wmi` (hwmon `name=hp`) memberi `fan1_input`/`fan2_input` **dibaca**
  (3406/2917 rpm), `pwm1_enable` = 2 milik root, dan **`pwm1` tidak ada** —
  tidak ada jalur tulis untuk rpm;
- `nvidia-smi` menolak field `fan_speed`, modul `nvcontrol` tidak terpasang;
- satu-satunya knob yang bisa dijangkau tanpa root adalah profil daya:
  power-profiles-daemon menulis ke `platform-profile` OEM. Terukur
  `power-saver → quiet`, `balanced → balanced`, `performance → performance`;
  pilihan OEM `cool` tidak diekspos PPD, jadi tidak dijangkau tanpa root.

AUTO karena itu mengatur **batas daya**, dan EC/thermald yang memutar fan dari
sana. Telemetri suhu + rpm kipas yang asli dipasang sebagai pembacaan murni.

Keputusan yang tidak bisa ditebak dari perasaan:

- **Satu penulis profil.** Cluster sudah memiliki profil daya (WET/SPORT/RACE).
  Menaruh termostat di extension kedua berarti dua penulis yang saling
  membalik, jadi AUTO masuk ke cluster yang sama, bukan extension baru.
- **Ambang diturunkan dari distribusi yang diukur, bukan angka bulat cantik.**
  60 sampel coretemp saat idle: min 52, p50 58, p90 75, max 89 °C —
  3 % di atas 85 °C walau tidak ada apa-apa. Dengan ambang turun yang dibaca
  dari angka sesaat, dwell 90 s tidak pernah selesai (teramati di rig: suhu
  berganti 66/93 dari tick ke tick). Karena itu **naik memakai rata-rata 15 s,
  turun memakai rata-rata 60 s**, dan turun hanya boleh kalau jendela 15 s tidak
  sedang ≥ 75 °C — rata-rata panjang selalu atras, tanpanya AUTO melonggarkan
  profil tepat saat beban mulai naik.
- **Turun satu tingkat per langkah** (2→1→0), naik boleh langsung dua, dan
  dwell naik 15 s / turun 90 s.
- **Tiga rem.** Baterai memotong ke balanced (performa puncak tidak membuat
  apa pun lebih dingin di baterai); GPU ≥ 88 °C mengunci keputusan turun;
  `PerformanceInhibited`/`PerformanceDegraded` berarti thermald/PPD sedang
  pegang kendali, AUTO hanya boleh ikut turun.
- **AUTO mulai dari profil yang sedang berlaku**, bukan dari asumsi. Quick
  Settings tetap boleh menimpa; perubahan profil dari luar hanya menggeser
  tingkat awal termostat.
- **Nomor hwmon tidak stabil antar boot**, jadi sensor dikenali dari isi
  `name` (`hp`, `coretemp`, `acpitz_0`), dan cache-nya diverifikasi ulang tiap
  baca.
- **Telemetri tinggal di menu dan tooltip**, bukan di panel — TIER 3 (panel
  sunyi) tidak dilanggar demi angka.

`communicate_utf8_finish()` GJS membuat **SIGSEGV** kalau anak tidak menulis
apa pun ke stdout (terjadi saat `nvidia-smi` gagal karena dGPU tertidur). Di
luar shell itu cuma skrip mati; di dalam shell seluruh gnome-shell ikut mati.
Versi byte (`communicate_finish`) aman — buffer kosong jadi `GBytes` ukuran 0.

## Yang sengaja tidak diubah

Dock tetap full-height dan fixed (permintaan eksplisit). Thumbnail workspace di
app grid tetap ada. Spinner boot sudah bagus. Palet kuning bawaan untuk warning.
