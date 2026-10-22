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
- Strip cluster berpintu mode, bukan berpintu daya: `WET` tidak pernah
  menampilkannya, tiga mode lain menampilkannya terus. Dulu SPORT/AUTO hanya
  tampil saat kabel dicolok (nilai `'ac'`), dan itu jadi bug yang terasa seperti
  "gear hilang sendiri" tiap kali charger dicabut — padahal pintunya tidak
  menghemat apa pun karena strip hanya membaca delta `/proc/stat`.

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

## TIER 27 — island media + notifikasi

Permintaannya satu permukaan di tengah atas yang menampilkan apa yang sedang
diputar **dan** push notifikasi, dengan prioritas. Dua hal itu bukan satu
sumber data, jadi keduanya diukur lebih dulu sebelum satu baris pun ditulis:

- **Media lewat MPRIS.** Spotify snap mendeklarasikan slot `interface: mpris`
  (`/snap/spotify/current/meta/snap.yaml`), jadi namanya ikut muncul di bus
  sesi host lengkap dengan `xesam:title/artist/album`, `mpris:length`, dan
  `mpris:artUrl` https. Tidak ada pembacaan stream audio: yang dibaca adalah
  status pemainnya.
- **Notifikasi lewat `Main.messageTray`.** `org.freedesktop.Notifications` di
  bus sesi cuma proksi tipis milik proses gjs terpisah; tujuan akhirnya ada di
  dalam shell. Menyambungkan diri ke nama itu berarti merebut notifikasi dari
  shell, jadi yang dipasangi handler adalah tray-nya.

Prioritasnya tetap NOTIF > MEDIA > IDLE, dan island tidak naik selama jendela
fullscreen — kecuali urgensi critical. Rosso hanya untuk yang sedang terjadi
(TIER 0): titik hidup, batang progres, sorot tombol Tutup.

Empat hal yang tidak bisa ditebak dan hanya ketahuan dari rig:

- **Nilai `a{sv}` bersarang.** Variant bertipe `v` membungkus Variant aslinya,
  jadi satu `unpack()` menyisakan objek, dan `PlaybackStatus` tidak pernah
  sama dengan `'Playing'` — kartu media diam-diam tidak pernah muncul.
  Dibuka berlapis sampai bukan Variant.
- **`NameOwnerChanged` tidak sampai.** Proxy bus-driver + `connectSignal()`
  tidak pernah memanggil handler di shell 46 (nol log, nol error). Player baru
  ditemukan dengan poll `ListNames` tiap 2 dtk — pola yang sama sudah dipakai
  noir-telemetry. `PropertiesChanged` tetap sinyal, lewat
  `g-properties-changed` di proxy player.
- **Ukur teks, jangan tebak lebarnya.** `St.Label` tidak punya properti
  `ellipsize`/`ellipsis` di konstruktor (mencobanya = `Error: No property`,
  extension gagal dimuat), dan ClutterText memanggang `ELLIPSIZE_END` sebagai
  bawaan — kicker `DIAM` terpotong jadi `DIA…`. Ellipsize diset lewat
  `get_clutter_text()`, dan lebar tiap state diambil dari lebar natural isinya
  dengan konstanta sebagai batas bawah.
- **Artwork tidak punya jalur langsung.** `Gio.Icon.new_for_pixbuf` tidak ada
  di GJS 1.80, dan `load_contents_finish` mengembalikan `Uint8Array`, bukan
  `GLib.Bytes`. Jalur yang jalan: bytes → `GLib.Bytes.new` → pixbuf diskala →
  simpan PNG ke `$XDG_CACHE_HOME/noir-island/` → `background-image` di CSS.

Dua keputusan bentuk:

- **Click-through hanya saat diam.** Input region chrome ditentukan saat actor
  dipasang, jadi island direbut-klik dengan `removeChrome` →
  `addChrome({affectsInputRegion})` saat melebar, bukan dengan mengubah
  properti.
- **v1 tanpa gschema.** Skema baru baru terdaftar setelah logout/login, jadi
  semua ambang (hold 8 s / 20 s, antrean 8, durasi 240 ms) masih konstanta di
  puncak file. Yang bisa diubah pengguna masuk belakangan.

### Revisi: island menggantung, bukan mengambang

Pil bulat penuh dengan celah di bawah panel ternyata terbaca sebagai toast:
ia datang, memanggil mata, lalu pergi. Yang dipakai sekarang adalah siluet
**notch** — rata di bawah panel, sudut atas kotak, hanya sudut bawah yang
melengkung (`border-radius: 0 0 22px 22px`), sehingga island jadi perpanjangan
bezel dan bukan permukaan baru yang harus ditafsir ulang tiap muncul. Akibat
teknisnya: `TOP_GAP`/`PAD_X` dihapus, posisi y selalu
`monitor.y + panel.height` (`_anchor()`), dan konstanta lebar berubah makna dari
"lebar total" jadi "batas bawah" karena padding horizontal pindah ke CSS
(`.noir-island-pad`) — jadi `_widthFor()` memakai lebar natural apa adanya.
Yang dibatalkan: pil mengambang, sudut atas melengkung, pemusatan isi lewat
padding JS.

Tiga hal yang hanya ketahuan dari rig saat bentuk ini dikerjakan:

- **`border-radius` empat nilai dihormati St**, jadi notch tidak butuh trik.
  `box-shadow` dengan blur 0 juga jalan, dan itu yang dipakai untuk garis rambut
  antar kolom (`.noir-island-hairline`, `width: 1px`) alih-alih border, karena
  border memakan box dan menggeser alignment teks.
- **St tidak punya `clip-path` maupun `mask`, dan anak tidak dipotong oleh radius
  induk.** Batang progres setinggi 3 px yang melebar sampai tepi card akan
  mencuat keluar lengkungan. Lengkungan 22 px pada tinggi 3 px sudah masuk
  11 px dari tepi, maka `PROG_INSET = 11` (JS) dan `margin: 0 11px` (CSS) adalah
  angka yang sama di dua tempat — kalau radius card diubah, keduanya harus ikut.
  Rel kiri kartu notifikasi memakai versi dirinya sendiri: `margin: 14px 0`.
- **Ukuran nyata tiap state** terukur di rig, semuanya di `y=32` (= tinggi
  panel): diam 156×34, `JEDA` 197×34, media 452×67, notifikasi 474×72. Tingginya
  bukan tebakan — media 64 ditambah batang progres 3.

Subjek uji bukan pemutar asli: rhythmbox mengirim notifikasinya sendiri (langsung
merebut keadaan media) dan dua kali SIGSEGV di rig. Yang dipakai adalah service
MPRIS palsu yang punya nama di bus, metadata lengkap, dan mengirim
`PropertiesChanged` saat transport dipanggil — jadi kartu media, tombol
prev/play/next, antrean `+N`, dan Tutup/Buka bisa dites terpisah dari
aplikasi apa pun.

## Yang sengaja tidak diubah

Dock tetap full-height dan fixed (permintaan eksplisit). Thumbnail workspace di
app grid tetap ada. Spinner boot sudah bagus. Palet kuning bawaan untuk warning.
