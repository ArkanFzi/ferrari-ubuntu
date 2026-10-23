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
(TIER 0): titik hidup, batang progres, rel kiri kartu notifikasi, kicker yang
berdarah, lingkaran play, dan pil Buka. Tombol Tutup tetap ghost — rosso hanya
muncul saat disorot, supaya "membuka" tidak terlihat sama dengan "membuang".

Enam hal yang tidak bisa ditebak dan hanya ketahuan dari rig:

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
- **Antrean harus tersortir urgensi, bukan urutan datang.** Semula notifikasi
  masuk lewat `push()` dan `_surface()` mengambil `shift()`, sementara yang
  digeser masuk lewat `unshift()`. Akibatnya critical yang baru datang justru
  berdiri di belakang notifikasi biasa yang baru saja ia singkirkan: rig
  mencatat `surf Normal u=1` dua kali dan `surf Kritis` tidak pernah muncul —
  pesan "tekanan ban rendah" menunggu satu hold penuh. Enum shell
  `LOW:0 NORMAL:1 HIGH:2 CRITICAL:3` (dibongkar lewat tambatan log, bukan dari
  spesifikasi freedesktop yang nomornya berbeda), dan `_enqueue()` menyisip di
  depan item berurgensi lebih rendah dengan `<` ketat, jadi sesama urgensi
  tetap FIFO dan antrean yang penuh membuang ekor = yang paling tidak penting.
- **`disable()` tidak teruji sampai extension benar-benar dimatikan.** Selama
  satu sesi ia hanya sekali dipanggil saat shell tutup. Menyalakan ulang lewat
  `gnome-extensions disable/enable` di sesi live memunculkan `TypeError` di
  `for (const [n, id] of this._hooked.values())`: Map itu memeta notifikasi ke
  **id sinyal** (angka), jadi `.values()` mengeluarkan satu angka yang tidak
  bisa dibongkar menjadi pasangan. Throw di tengah `disable()` lebih berbahaya
  daripada error-nya sendiri — `removeChrome`, `destroy()` actor, dan
  `run_dispose()` proxy MPRIS ada di bawah baris itu dan tidak pernah jalan,
  sehingga island lama bocor dan shell menandai extension `state: ERROR` yang
  hanya pulih setelah logout/login.

Dua keputusan bentuk:

- **Click-through hanya saat diam.** Input region chrome ditentukan saat actor
  dipasang, jadi island direbut-klik dengan `removeChrome` →
  `addChrome({affectsInputRegion})` saat melebar, bukan dengan mengubah
  properti.
- **Ambang yang bisa dipakai tanpa logout masuk gschema.** Yang dulu konstanta
  di puncak file dan benar-benar sering diputar sekarang delapan kunci di
  `schemas/org.gnome.shell.extensions.noir-island.gschema.xml`
  (`persistent-pill`, `show-when-paused`, `hold-normal-ms` 15 s, `hold-high-ms`
  20 s, `hold-critical-ms` 45 s, `hold-hover-extra-ms` 30 s, `peek-ms` 3 s,
  `idle-hide-ms` 6 s),
  dibaca lewat `getSettings()` dan di-cache di `this._opt` oleh `_syncOpts()`
  yang dipanggil ulang tiap `changed::` — jadi nilainya berubah pada shell yang
  sedang jalan, terbukti dari rig (`D-MATIKAN-PILL`, `D-PAUSED-MATIBERPERILAKU`).
  Yang tinggal konstanta adalah yang tidak pernah perlu ditebak-tebak: geometri
  (`PILL_W`/`MEDIA_W`/`NOTIF_H`, …), `ANIM_MS`/`FADE_MS`/`DWELL_MS`, poll
  (`TICK_MS`, `SCAN_TICKS`, `HOVER_*`), `QUEUE_MAX`, dan `BLIND_RETRY_MAX`.
  Catatan lama "menambah kunci baru butuh logout" ternyata hanya berlaku untuk
  schema yang **tidak** ikut diperbarui: `hot-island.sh` kini mengopi `.xml` dan
  menjalankan `glib-compile-schemas` ke folder terpasang sebelum disable/enable,
  dan kunci `idle-hide-ms` yang baru lahir terbaca oleh shell yang sama tanpa
  logout. Dari terminal, schema extension ini tetap lokal, jadi pakai
  `GSETTINGS_SCHEMA_DIR=~/.local/share/gnome-shell/extensions/noir-island@arkan/schemas`
  (pola yang sama dengan noir-cluster di Troubleshooting §6).
- **Island tidur, bukan mengecil.** `idle-hide-ms` dulu hanya menutup card; yang
  dipakai sekarang adalah satu jam `_wakeUntil` yang dijaga `_wake()`/`_awake()`:
  jatuh tempo berarti `_levelFor()` mengembalikan `null` untuk media, jadi pill
  ikut `stow` — island hilang total, bukan menyusut. Yang memutar jam: pointer
  masuk/keluar (`_pollHover`), klik transport/seek/expand/aksi, notifikasi baru
  (`_onNotify`), dan **isi baru** (cabang `isi !== this._isi` di `_render`).
  Clause terakhir dulu tidak ada dan itu salah: island yang terlanjur tidur tidak
  pernah bangun lagi untuk trek berikutnya. Yang tidak memutar jam: waktu yang
  berlalu dan perubahan posisi progres (posisinya sengaja tidak masuk
  `_signature`, kalau tidak island tidak akan pernah tidur saat lagu jalan).
  Nol = perilaku lama, pill menempel terus.
- **Tombol notifikasi diambil dari notifikasinya sendiri.** Shell memasang
  "Show in Files" pada screenshot lewat `Notification.addAction`, dan tombol itu
  lahir di `_actions` milik objek Notification — bukan sesuatu yang bisa
  dikarang island. `_fillActions()` membaca `n.actions` (maks `ACT_MAX` 2, label
  dipangkas `_oneLine` ke `ACT_LABEL_MAX` 18 karakter), `_invokeAction()` memanggil
  `action.activate()`, dan `_hook()` ikut menyambung `action-added`/
  `action-removed` karena tombol bisa muncul setelah notifikasinya. `_btnOpen`
  ("Buka", rosso) mundur saat ada tombol sendiri: satu kartu satu CTA. Jalur ini
  tidak khusus screenshot — `notificationDaemon.js:221` memetakan setiap aksi
  client (kecuali `default`, yang tetap jadi klik-kartu) ke `addAction` yang
  sama, jadi tombol kiriman aplikasi pihak ketiga muncul dengan sendernya.
- **Island dipecah jadi stub + isi supaya UI bisa diganti tanpa logout.**
  Awalnya "perlu logout" dianggap harga yang dibayar untuk GJS; ternyata harga
  itu cuma berlaku untuk *satu path yang di-cache selamanya*. Shell 46 menutup
  `ReloadExtension` (`ui/shellDBus.js:468`), tetapi memuat modul dari **path
  lain** terbukti mengeksekusi ulang (query-string `?v=2` tidak — cache tetap
  mengembalikan modul lama). Jadi `extension.js` yang terpasang kini hanya
  pemuat: dia membaca `~/.local/share/noir-island/CURRENT`, meng-import
  `<build>/island.js`, dan meneruskan dirinya sebagai konteks (`getSettings()`
  tetap di-resolve dari folder terpasang, karena `this.dir` milik stub). TanpaCURRENT, fallback-nya `island.js` di folder terpasang — pilihan yang diambil
  supaya `install.sh` biasa tidak pernah menghasilkan island yang mati.
  Konsekuensi yang diterima: tiap build yang dimuat dalam satu sesi tertinggal
  di registri modul shell (memori naik sedikit, hilang saat logout), dan
  disable/enable cepat bisa menumpuk dua promise — dilindungi token urutan di
  stub sehingga hanya permintaan terakhir yang boleh membangun island.

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

### Menyendiri: island tidur saat tidak ada yang dikatakan

Notch yang selalu terpasang ternyata sama saja dengan ornamen: ia menempel
tanpa mengatakan apa pun. Sekarang island mulai dari keadaan **tersimpan**
(`_stowed`, actor `visible=false` sejak `enable()`) dan hanya keluar kalau ada
isisnya. Aturan isinya sekarang dua knob gsettings, bukan satu baris kode: trek
yang **sedang berbunyi** (`Playing`) selalu isi, trek **paused** boleh jadi isi
kalau `show-when-paused` aktif, dan pill media tidak lagi butuh hover selama
`persistent-pill` aktif. Notifikasi yang tampil / masih mengantre tetap isi.
(revisi 23/10 membalas revisi 22/10: aturan "paused pun ikut" lalu "paused bukan
isi" sama-sama kalah karena keduanya ditulis di kode. Yang benar adalah *pill
paused boleh menempel* — justru di saat jeda orang mencari tombol play — tapi
keputusannya pindah ke `persistent-pill` / `show-when-paused` plus tiga
`hold-*-ms` dan `peek-ms`, sehingga bisa diubah hidup lewat `gsettings set`
tanpa logout. Ketemu di rig: `D-MATIKAN-PILL` dan `D-PAUSED-MATIBERPERILAKU`
mengubah perilaku pada shell yang sedang jalan.)

- **Pemain yang lahir buta pernah dikira bug "island hilang sebentar".**
  `_players` menyimpan nama begitu player terlihat di bus, jadi kalau `GetAll`
  pertama tidak menghasilkan metadata tidak ada yang bertanya lagi — island duduk
  `idle` selamanya meski treknya ada. `_scan()` kini mengulang pembacaan untuk
  entri tanpa metadata, dibatasi `BLIND_RETRY_MAX` (10 × 2 dtk) supaya nama yang
  memang bukan player tidak ditanya seumur hidup. Catatan jujur: kegagalan
  berantai di run 2–5 rig ternyata bukan ini, melainkan dconf terisolasi yang
  dipakai ulang antar-run — nilai `show-when-paused=false` dari uji D di run
  sebelumnya masih terbaca saat run berikutnya boot. Retri-nya tetap ditinggalkan
  karena lubangnya nyata.

- **Grace 4 dtk sebelum mundur.** Trek terakhir habis, trek berikutnya menyusul
  1 dtk kemudian: tanpa jeda itu island kedip masuk-keluar di setiap pergantian
  lagu. Jam mundurnya di `_tick()`, dan di-reset tiap kali ada isi.
- **Masuk: unfold dari bezel.** `_unstash()` menaruh card di anchor dengan
  tinggi 0 lalu `_animateTo()` biasa yang membukanya — isi baru dinyalakan
  setelah card hampir penuh, sama seperti morph antar state. **Keluar:** tinggi
  dan opacity ditarik bersamaan (`EASE_IN_QUART` 220 ms, lebih cepat dari morph
  supaya terasa sebagai keputusan), row-row dimatikan lebih dulu karena Clutter
  tidak memotong anak, lalu `visible=false` dan input region dilepas.
- **Dua jalur yang mudah terlewat di `_render()`.** Kalau masih tersimpan dan
  tidak ada isi, render berhenti (tidak ada yang perlu diukur); dan morph tetap
  dipaksa walau state-nya sama (`state !== this._state || this._stowed`) — trek
  berhenti lalu trek lain berhenti menghasilkan state `idle` yang identik, tanpa
  paksaan itu card tetap setinggi 0.
- **Animasi mikro yang menyertainya.** Batang progres di-`ease()` LINEAR
  sepanjang satu tick 500 ms — di-`set_size()` mentah ia jadi anak tangga.
  Pergantian trek di-cross-fade 120 ms (teks lama ke opacity 0, diisi, dinaikkan)
  supaya tidak ada frame yang mencampur dua lagu. Rel rosso tumbuh dari tepi atas
  lewat `scale_y` 0→1 dengan pivot di atas, **bukan** tinggi: anak dari
  `St.BoxLayout` dialokasi ulang tiap frame, jadi animasi tingginya akan ditimpa
  layout.
- **Alat ukurnya juga harus diuji.** `pindah()` di rig mengklik pusat tombol dari
  `get_transformed_position()` + `get_transformed_size()`, dan yang kedua
  mengembalikan NaN untuk actor yang tidak punya request ukuran eksplisit —
  hasilnya semua klik `NaN,NaN` dan enam fase "gagal" padahal produknya benar
  (diagnostik menunjukkan actor mapped dan teralokasi). Pusat klik diambil dari
  `get_allocation_box()`. Probe tombol juga harus mencetak alasan `continue`-nya:
  sampled 400 ms setelah morph, ia bisa mengambil saat state sudah berganti
  (baris media memang `mapped=false` di state `idle`) dan produk yang hijau
  terbaca merah.

### Island yang hidup tapi tidak terlihat: diagnosis sesi live

Laporan "sudah play Spotify, tidak muncul apa-apa" tidak bisa dijawab dari log
state saja, dan Ubuntu memblokir dua jalur pintas: `org.gnome.Shell.Eval`
(session mode `ubuntu` → `false, ""`) dan `org.gnome.Shell.Screenshot`
(Access denied untuk caller tanpa app id). Yang tersisa dan ternyata cukup:

- **Pohon aksesibilitas.** `gsettings set org.gnome.desktop.interface
  toolkit-accessibility true` membuat shell membangun AtkObject untuk semua
  actor, dan `Atspi` (python3-gi) bisa membacanya dari luar: extents per actor,
  dan state `VISIBLE`/`SHOWING`. Hasilnya: island live **teralokasi benar**
  (`734,28 452x67`, tombol Buka/Tutup `SHOWING`) — jadi bukan geometry, bukan
  chrome layer, bukan tumpukan uiGroup. Ganti `false` lagi setelah selesai.
- **Rig cermin.** Menyalin `~/.config/dconf/user` + seluruh direktori extension
  user ke sesi Xephyr terpisah membuktikan tema WhiteSur, blur-my-shell, DING,
  dan noir-clock/telemetry tidak mengganggu: card tergambar utuh di screenshot.
- **Penyebab sebenarnya ada di log, bukan di pixel.** `until: Infinity` untuk
  notifikasi **critical** (urgency 3 tidak punya timeout dari pengirim) membuat
  satu kartu mem-*pin* state `notif` selamanya: media dan notif berikutnya tidak
  pernah tampil lagi, dan karena statenya tidak berubah, **tidak ada satu baris
  log pun** — island yang hidup tapi diam terlihat persis seperti island yang
  hilang. Critical sekarang dibatasi `hold-critical-ms` 45 dtk (dulu konstanta
  `HOLD_CRITICAL_MS`, kini kunci gsettings — lihat bagian Menyendiri);
  terverifikasi di rig (lepas setelah 45,3 dtk, media kembali tampil).
- **Antrean yang tersangkut membuat island tidak pernah tidur.** `_surface()`
  berhenti kalau DND aktif; item yang sudah terlanjur mengantre tetap dihitung
  `_hasContent()` sehingga jam mundur `stow` tidak pernah mulai. Sekarang
  `_surface()` membuang antrean saat DND aktif — notif tetap ada di message
  list shell, hanya tidak ditahan island.
- **`remove_all_transitions()` saat bangun.** Sisa `ease()` milik `_stow()`
  masih menggenggam `opacity` dan `height` actor; `_unstash()` yang hanya
  memanggil `set_opacity(255)` akan kalah oleh transisi yang masih berjalan —
  hasilnya actor mapped, terbaca SHOWING, tapi 0% terlihat. Geometri sekarang
  ikut dicetak di setiap baris state (`... 452x67 @574,32 panel=32`) supaya
  sesi live bisa dihakimi dari journal saja.

### Card setinggi 0: `ease()` tidak meng-commit nilainya kalau dibuat pada frame morph

Kelanjutan laporan yang sama, kali ini dengan pointer yang benar-benar diarahkan
ke island: pill melebar jadi card 460 px, `visible=true`, `opacity=255`, dan
**nol pixel tergambar**. Dua sampel berjarak 1 dtk (`+1,9 s` dan `+2,9 s` sesudah
kartu notifikasi terakhir) membuktikan ini bukan snapshot di tengah transisi —
`get_preferred_height()` membisu di `0..0` sampai selamanya.

A/B pada actor yang sama di sesi live yang sedang berjalan, tanpa menyentuh repo:

- `island.ease({height: 72, ...})` → `prefH` tetap `0..0` setelah 1500 ms.
- `island.set_size(460, 72)` pada actor yang sama → langsung `alloc=460x72`.
- `island.ease({opacity: 0})` → **jalan** (fade `_stow()` mendarat dan
  `onComplete`-nya fires).

Simpulannya waktu itu *salah sebagian*, dan bagian yang salah itu yang membuat
bug kedua lolos satu putaran lagi. Aturan yang benar, dari A/B kedua di sesi live
yang sama (`build-PROBE`, satu notifikasi, barisnya diukur sendiri):

```
noir-AB awal                    trans=true          <- transisinya dibuat
noir-AB t400-dengan-delay       op=0    trans=false <- selesai, nilai akhir TIDAK mendarat
noir-AB t550-setelah-set128     op=128              <- tulis langsung selalu mendarat
noir-AB t950-easeTANPA-delay    op=255              <- ease pada actor yang sudah tenang: jalan
noir-AB t1450-easeDENGAN-delay  op=255              <- dengan delay pun jalan
```

Jadi penyebabnya bukan "Wayland membunuh transisi geometri" dan bukan pula
"opacity boleh dianimasikan". Penyebabnya: **`ease()` yang dibuat pada frame yang
sama dengan perubahan ukuran actor hilang tanpa meng-commit nilai akhirnya** —
properti apa pun, delay atau tidak. Dan morph island *selalu* mengubah ukuran di
frame itu, jadi setiap transisi yang lahir dari `_animateTo()`/`_fillNotif()`
dijanjikan di mesin user. `_stow()` lolos karena dia tidak mengubah ukuran lebih
dulu, itu sebabnya island masih bisa menghilang dan kesannya "transisi jalan".

Rig hijau bukan karena X11 lebih baik: `_fadeTo()` yang rusak pun tidak akan
terlihat, karena assertion R1/R2 hanya menghitung pixel **non-hijau** di dalam
kotak geometri — badan card yang gelap sudah memenuhi ambang 60%/55% walau teksnya
nol pixel. Buta pada kelas bug persis di titik ini.

Yang diubah:

- **`_animateTo()` menulis ukuran akhir lewat `set_size()` + `set_position()`**,
  bukan `ease({width, height, x, y})`.
- **Fade dan rel rosso tidak lagi lewat `ease()` sama sekali**: `_rampTo()`
  merakit transisinya sendiri dari `GLib.timeout_add(16 ms)` — satu-satunya jam
  yang terbukti berdetak di sini (lihat `_tick`) — dan memanggil `set_opacity` /
  `set_scale` mentah yang selalu mendarat. `_fadeTo()`, `_fillMedia()` (ganti trek
  saat card terbuka) dan `_fillNotif()` (rel rosso) sekarang lewat jalur itu.
  Yang masih `ease()`: `_stow()` (actor tenang, terbukti mendarat) dan
  `_progressFill` (dikoreksi tick 500 ms berikutnya, jadi nilai yang meleset cuma
  satu tick).
- **`_unstash()` ikut mematok geometri** (`remove_all_transitions()` lalu
  `set_size`/`set_position`/`set_opacity(255)`/`visible`) supaya bangun dari
  bezel tidak lagi bergantung pada transisi yang sama.
- **Zona hover diukur dari card terlebar, bukan dari pill.** `HOVER_IN_Y`
  44 → 100 dan `HOVER_IN_X` 120 → 250: yang dicari pointer adalah bentuk yang
  baru saja dilihatnya (card notif 460 px = 230 px dari sumbu, card tertinggi
  72 px di bawah panel), sementara pill yang tersisa hanya 240x34. Dead band
  keluar dibiarkan 24 px/50 px lebih longgar supaya ambangnya tidak berkedip.
- **Jalan pulang dari card media = klik kolom teksnya.** Bukan tombol ✕ baru dan
  bukan outside-click: `_armOutside()` bergantung pada `captured-event` di stage
  yang di Wayland tidak terkirim, jadi satu-satunya affordance yang terbukti
  bekerja adalah klik pada isi card itu sendiri. Kolom judul/artis/album dibungkus
  `St.Button` (`_mediaCollapse`) yang memanggil `_collapse()`, simetris dengan
  klik pill yang membuka card.

`St.Button` di shell 46 **tidak punya properti `x_fill`** — menulisnya di
konstruktor membuat seluruh extension mati saat dimuat
(`gagal memuat .../island.js: No property x_fill on StButton`), dan rig
menangkapnya dalam hitungan detik. Pengisi lebar di 46 adalah
`x_align: Clutter.ActorAlign.FILL` (+ `x_expand`).

### Rig R: apa yang harus disetel dulu supaya Xephyr bisa menghakimi

Rig R (Xephyr `:11`, 1280x800, kanvas hijau murni) sempat hijau-palsu lima
putaran karena alat ukurnya sendiri, bukan karena produknya. Hasil akhirnya
12/12 terhadap build yang sama dengan yang dipakai laporan user:

```
R1-CARD-PENUH          OK  notif 460x72 -> 96% pixel (dulu 0 px di Wayland)
R1B-RAIL-ROSSO         OK  44 baris merah di tepi kiri card notif
R1A-BASELINE-TIDUR     OK  0 px saat tidur
R2-HOVER-TEPI          OK  pill bangun di x=-200 dari sumbu
R2B-TEPI-LUAR          OK  tidak bangun di x=-300 (0 unhide baru)
R3A-MEDIA-CARD         OK  klik pill -> card 420x76 tergambar penuh
R4-PROGRESS-AKTIF      OK  fill rosso 18 px di dasar card
R4-PROGRESS-BERTAMBAH  OK  18 px -> 26 px dalam 8 dtk, posisi benar disampel
R3B-KLIK-TUTUP         OK  klik kolom teks -> pill 240x34 kembali
```

Yang harus disetel supaya Xephyr bisa menghakimi:

- **dconf harus ditetaskan di sesi yang berhenti rapi.** `dconf-service`
  menampung tulisan di memori dan baru menetes ke `~/.config/dconf/user` saat
  bus ditutup; write di dalam `dbus-run-session` yang menghidupkan gnome-shell
  (sesi ini dimatikan SIGTERM) tidak pernah mendarat, shell membaca default
  skema Ubuntu, dan dock/DING ikut tergambar di atas kanvas hijau.
- **Ubuntu 46 memakai whitelist `enabled-extensions`**, bukan cuma
  `disabled-extensions`: tanpa daftar itu extension user melaporkan
  `state: 6, enabled: false, error: ''` — gagal tanpa pesan.
- **`log()` GJS keluar lewat stderr shell.** `gnome-shell --x11 >/dev/null 2>&1`
  membuat seluruh assertion berbasis log buta dan boot loop mengira rig siap.
- **`notify-send -A` itu blocking** sampai notifikasinya ditutup — rig menggantung
  persis di langkah kartu notifikasi. Tanpa aksi, atau pakai `timeout`.
- **Satu WM per display.** Sisa `gnome-shell --x11` dari run sebelumnya membuat
  shell baru mati dengan `Failed to acquire window manager ownership`, dan rig
  mengukur desktop kosong tanpa bilang begitu.
- **Shell di Xephyr melaporkan monitor lebih lebar dari layarnya** (kartu 460 px
  mendarat di `@570,32` pada layar 1280 → pusat 800, bukan 640). Semua kotak ukur
  sekarang dibaca dari geometri di baris log island, bukan diasumsikan tengah.
- **Shell X11 kadang naik dalam overview** (dash + "Type to search" menutup
  kanvas); Escape sampai titik-titik uji benar-benar hijau, dan titik uji
  menghindari lajur x<170 milik strip dash.

### Jam kartu media: posisi harus ditanya, bukan dihitung

Kartu media live menampilkan **"44:17 / 4:04"** sementara `Position` di bus
adalah 1:38. Bukan salah Spotify: `_updateProgress()` menghitung
`pos + rate * (now - posAt)`, dan `pos`/`posAt` hanya diperbarui saat
`PropertiesChanged` membawa `Position` — yang **tidak pernah dikirim** player
mana pun (posisi bukan properti yang diumumkan, MPRIS menyuruh pemakai
menanyakannya). Jadi `posAt` membeku sejak player pertama ditemukan dan jam
dinding — termasuk seluruh waktu paused — ikut dihitung sebagai waktu play.

- **Sampel per tick, lewat `Get` async.** `_samplePosition()` memanggil
  `org.freedesktop.DBus.Properties.Get` untuk `Position` hanya saat state
  `media` dan status `Playing`; guard `entry.posQuery` menahan antrean kalau
  player lambat, dan jalur async membuat satu tick 500 dtk tidak pernah
  memblokir loop shell (jalur `call_sync` yang sudah ada tetap 400 dtk).
- **Resume wajib menulis ulang titik acuan.** Perubahan `PlaybackStatus`
  langsung set `posAt = monoMs()` lalu men-sampel, supaya jeda 20 dtk tidak
  pernah muncul sebagai 20 dtk waktu play setelah lanjut.
- **Clamp ke panjang trek.** Dead reckoning boleh meleset satu tick, tapi
  kartu tidak boleh mengklaim sudah lewat akhir lagu.
- **Alat ukurnya: teks label, bukan pixel.** `timelabel.py` membaca teks label
  waktu island lewat AT-SPI di dalam rig, lalu harness membandingkannya dengan
  `Position` asli di bus: 66 dtk vs 66 dtk setelah jeda 20 dtk, dan bertambah
  11 dtk dalam 10 dtk berikutnya. Player palsu di rig ikut diubah jadi benar-
  benar berjalan (`posNow()`), karena dengan posisi statis tes ini tidak bisa
  membedakan sampel nyata dari hitungan dinding.
- **Label mana yang dibaca.** Pola pencocokan harus menuntut `m:ss / m:ss`;
  tanpa bagian total, probe menjemput label `0:00` milik shell lain dan
  menyimpulkan kartu yang benar jadi salah.

### Layer hitam setelah pause: morph yang batal tanpa suara

Sesi live, 16:17: trek dipause, island pindah ke state `idle` (baris log-nya
ada), tapi ukuran card tetap **452x67** — geometri media — dengan baris pill
meregang 452 px dan baris media dimatikan. Hasilnya kotak hitam kosong, persis
"island-nya hilang, tinggal layer hitam". Diukur lewat AT-SPI, bukan dilihat:
`panel 734,28 452x67 SHOWING` + `label "Adam" 802,29 370x18`.

Dua percobaan gagal mereproduksinya: rig polos (hanya noir-island) dan **rig
cermin** (dconf live + seluruh extension user + tema WhiteSur, 1600x1200) sama-
sama memberi `idle 197x34 @702,32` dengan `alloc=197x34`. Jadi bukan salah
ekstensi lain, bukan tema, bukan ukuran monitor.

Yang tersisa dan cocok dengan seluruh data adalah satu jalur senyap di
`_animateTo()`: `if (!mon) return;`. `_render()` memanggil `_animateTo()`
**sebelum** mencetak baris state, jadi `idle` di log tidak pernah membuktikan
morph benar-benar jalan. Yang dilakukan sekarang:

- **Geometri monitor di-cache** (`_monitor()`). `primaryMonitor` bisa kosong
  sesaat (konfigurasi display berubah, layar blank); fallback tetap memakai
  geometri terakhir dan **mencetak log**, tidak lagi batal diam-diam.
- **Lebar non-finite ditolak.** `get_preferred_width()` yang mengembalikan NaN
  membuat `ease({width: NaN, ...})` gugur seluruhnya — satu properti rusak
  membatalkan morph tinggi dan posisi sekaligus. `_widthFor()` sekarang jatuh
  kembali ke `base`.
- **Jendela gejalanya menyempit.** Dengan paused yang tidak lagi dihitung isi,
  card yang tertinggal di ukuran media paling lama terlihat 4 dtk (grace)
  sebelum island mundur total. (revisi 23/10: clause pertamanya sudah tidak
  berlaku — `show-when-paused` default true, jadi jendela ini lagi-lagi cuma
  berlaku untuk trek yang benar-benar `Stopped`.)
- **Jujur: penyebab `primaryMonitor` kosong di sesi live belum tertangkap.**
  Shell live tidak bisa di-inject (Eval dan Screenshot diblokir), jadi bukti
  terakhirnya baru bisa datang dari journal setelah reload — baris state sekarang
  membawa `@x,y` dan `panel=`, dan fallback di atas mencetak satu baris sendiri.
- **Harness A–I sendiri yang paling sering salah**: fase C gagal 2 dari 4 run
  terakhir karena satu klik `xdotool` tidak sampai ke tombol (tidak ada
  `PlayPause` di log player), lalu semua fase sesudahnya ikut melenceng. Run
  ulang selalu HIJAU; yang perlu diperbaiki adalah harness-nya (retry per klik),
  bukan produknya.

### Isi punya dua definisi: fullscreen menahan island tanpa pernah menampilkannya

Gejala di sesi live: trek Playing (YouTube lewat MPRIS Chrome) membuat island
bangun **2 m 21 s** sebagai pill idle — `idle 375x34` 19:29:50.989, dan `stow`
baru muncul 19:32:12, tepat saat treknya di-pause. Island tidak menampilkan
apa pun yang berhak ditampilkan, tapi juga tidak mau tidur.

Akar: `_render()` dan `_hasContent()` masing-masing punya daftar syarat sendiri.
`_render()` menolak state `media` selama `_fullscreen` (kartu memang sengaja
kalah oleh video), `_hasContent()` hanya bertanya `status === 'Playing'`. Jadi
di bawah fullscreen jawabannya bertolak belakang: tidak ada yang boleh tampil,
tetap dihitung "ada isi" → `_stowAt` di-reset tiap tick dan jam mundur tidak
pernah mulai. Rantai inferensinya tertutup rapat: state `idle` terdokumentasi
sambil player dilaporkan `Playing` cuma bisa dijelaskan oleh `_fullscreen`, dan
DND tersingkir karena `show-banners=true`.

Perbaikannya satu bentuk: keputusan state dipindah ke `_decideState(player)`
dan `_hasContent()` didefinisikan darinya — `!== 'idle' || _pending.length`
(usantre tetap dihitung karena pill `+N` memang menahan jejaknya). Sekarang
tidak ada lagi cara untuk menambahkan pengecualian di satu sisi dan lupa di
sisi lain.

Bukti, rig Xephyr `:9` dengan pemain MPRIS palsu + jendela `xclock` yang
dijadikan fullscreen lewat `wmctrl -b add,fullscreen`:

- kode lama (`5bdc02a`): `idle` 19:46:28.132, **tidak ada `stow` sampai
  fullscreen dilepas** 19:46:41.288 → `HASIL=MERAH`.
- kode baru: `idle` 19:46:01.810 → `stow` 19:46:06.121 (4,3 dtk = grace + tick),
  lalu `unhide` + `media <- Uji MPRIS` begitu fullscreen lepas, dan jalur
  pause→stow / play→unhide tetap hijau → `HASIL=HIJAU`, `error: 0`.

Alat ukurnya hampir menelan korban: `dconf write` **tidak** diisolasi oleh
`XDG_CONFIG_HOME` karena tulisan diedarkan lewat service `ca.desrt.dconf` di
session bus yang sedang jalan — seed rig sempat menimpa `enabled-extensions`
milik sesi live dan seluruh extension lain ikut dimatikan. Daftarnya dipulihkan
dari jejak di journal (`ubuntu-dock` tercatat lewat `_callExtensionDisable`)
dan dari kunci extension yang sudah dimodifikasi (`just-perfection/panel-size`,
`tiling-assistant/active-window-hint-color` merah Ferrari, `appindicator/icon-size`).
Harness sekarang menulis seed di dalam `dbus-run-session` sendiri.

## TIER 28 — island: geometri dipatok, level jadi sumbu sendiri, jam panel diambil-alih

User menilai island "tidak stabil sama sekali dan sangat kurang dalam design UI
dan UX". Akar tunggalnya satu baris: `_widthFor()` memakai `get_preferred_width()`
baris sebagai lebar kartu. Panjang judul ikut menentukan bentuk island, jadi
lebar melompat 156 → 664 px antar trek, `_ellipsize()` tidak pernah bekerja
(actor selalu selebar teksnya sendiri), dan tombol transport terdorong keluar.
Satu properti rusak juga membatalkan `ease({width, height, x, y})` seluruhnya —
gejala yang sama dengan "layer hitam" di TIER 27.

**Geometri adalah fungsi dari (level, content), tidak pernah dari isinya.**
`PILL_W 240`, `PEEK_W 340`, `MEDIA_W 420`, `NOTIF_W 460`, di-clamp 60% lebar
monitor. `get_preferred_width()` turun jabatan jadi pengukur label individual.

**Level adalah sumbu orthogonal, bukan state baru.** `_decideState()` tetap satu-
satunya sumber kebenaran "isi" (NOTIF > MEDIA > IDLE + aturan fullscreen tidak
disentuh); di atasnya ada `_level ∈ hidden|pill|peek|card` yang hanya digerakkan
pointer/klik/timer. Hover dibaca lewat polling `global.get_pointer()` 120 ms,
bukan `captured-event` MOTION (di X11 tidak terkirim ke stage saat klien memegang
pointer grab — hover mati persis di atas video fullscreen) dan bukan `track-input`
(Wayland). Dead band 44/64 px dan 2 poll masuk / 3 poll keluar: 20 sapuan pointer
bolak-balik menghasilkan 20 `unhide` + 20 `stow`, bukan strobo.

**Satu penyimpangan dari rencana, disengaja.** Trek baru diumumkan sebagai peek
3 dtk lalu island **tidur**, bukan bertahan sebagai pill persisten; card penuh
hanya lewat hover → klik. Kalau pill persisten yang dipilih, island mencaplok
klik tengah-atas permanen dan memakan jam panel selamanya (risiko #2 di rencana).
Yang tetap seperti rencana: notifikasi selalu membuka card, dan jam panel kembali
saat island tidur.

**Jam panel dimakan oleh LEVEL, bukan oleh "island sedang tampil".** `_setActive()`
menggantikan `_setInput()` + toggle `--live`: input region, reaktivitas, dan opacity
di satu tempat. `_setClock(show)` dijaga `_clockHiddenByUs` supaya island tidak
pernah memaksa tampil jam yang memang dimatikan Just Perfection, dan
`_setActive(false)` + `_setClock(true)` adalah statement awal `disable()`.

Versi pertama mengikat jam ke `_setActive` — begitu island bangun sebagai pill, jam
panel hilang. Di sesi live itu terbukti salah: pill menggantung di `y=26` (di
bawah panel) dan jamnya ditulis dengan gaya label sekunder 9 px/0.40, sementara
yang dia hapus adalah jam panel 142×26 px putih penuh — tengah panel terbaca
kosong, persis keluhan user. Sekarang jam hanya dimakan mulai `peek`/`card`
(`_animateTo` → `_setClock(level === 'pill')`), dan slot jam pill punya gayanya
sendiri `.noir-island-pilltime` 15 px/600/0.92 — setara jam panel, karena di
peek/card dialah penggantinya.

**Yang mengalah pada teks panjang adalah baris sekunder, bukan jam.** Versi
pertama `_fitText()` mengorbankan label waktu begitu judul tidak muat; di rig
hasilnya kartu tanpa "0:12 / 3:30" padahal judul tetap terpotong — bayarnya
nyata, manfaatnya nol. Sekarang album didrop lebih dulu, lalu artis, judul selalu
tinggal dan memotong dirinya. `MEDIA_CHROME_W 251` menyisakan 169 px kolom teks
pada card 420 px.

**Dua bug yang hanya bisa kelihatan di rig, bukan di baca-kode:**
- `_seekAt()` memakai `get_allocation_box()` (koordinat orang tua) bersama
  `event.get_coords()` (koordinat panggung). Klik di tengah rail dihitung sebagai
  ujunya sendiri: `seek 0:12 -> 3:30`, bus 212 dtk dari trek 210 dtk. Setelah pindah ke
  `get_transformed_position()`: 12,0 s → 107,1 s, target 105 s.
- Seek juga butuh `CanControl`/`CanSeek` yang selama ini dibaca dari bus lalu
  dibuang; rail sekarang `reactive` hanya kalau player memang bisa di-seret.

**Bukti run `S12fit`** (rig Xephyr `:9` 1600x1200 + pemain MPRIS palsu,
`error: 0`, `HASIL=HIJAU`): peek `340x34 @630,32` lalu tidur 3429 ms; hover
membangunkan pill 230 ms; pointer pergi menyusut 343 ms; klik → card `420x76
@590,32` dalam 9 ms; klik-luar melepas card dan hover berikutnya masih hidup
(bukti tidak ada grab tertinggal); notif `460x72`; trek 77 karakter → judul
SHOWING 169 px ter-elipsis, artis (natural 312 px) DI-DROP, album tetap, waktu
tetap, 0 node di luar rect card. Jam panel terukur pixel — 31 kolom gelap saat
island tidur, 0 saat pill/card/notif, dan kembali (34) setelah
`gnome-extensions disable` di tengah pill yang sedang tampil.

**Alat ukur yang gagal dan kenapa.** Probe jam lewat *nama* aksesibel tidak
bekerja: dateMenu build ini menghasilkan 0 node bernama jam, padahal pixel crop
jelas menampilkan "Oct 22 22:24". Ganti ke penghitung kolom piksel gelap. Dua
jebakan sekaligus: x11grab membulatkan tinggi grab (baris 32-33 ikut tertangkap,
dan di situlah pill island mulai digambar — strip dipotong ke `PB-2`), dan jam
Ubuntu duduk di **tengah** panel, persis di bawah island, jadi wilayah ukur 660-
940 bukan kanan atas. Assertion juga pindah dari `grep -c` kumulatif ke **nomor
baris** log: probe AT-SPI memakan beberapa detik dan baseline kumulatif sempat
menelan kejadian yang sedang ditunggu (seek dilaporkan GAGAL padahal log-nya ada).

### Satu wajah untuk satu notifikasi

Gejalanya bukan bug geometri: notifikasi yang sama keluar dua kali — banner shell
dan kartu island. Island adalah wajah yang dipilih, jadi banner shell diblok lewat
knob resmi milik shell sendiri, `MessageTray.bannerBlocked` (setter publik,
messageTray.js:828; pemakai preseden panel.js:972), bukan dengan menyembunyikan
actor diam-diam.

- **Kapan diblok.** Selama island sanggup jadi wajah: bukan fullscreen dan bukan
  DND (`_dndOff()` membaca `org.gnome.desktop.notifications show-banners`).
  `_syncBannerBlock()` dipanggil di puncak `_render()` **dan** `_tick()` (500 ms),
  karena panel.js menulis flag yang sama secara buta saat menu searah banner
  dibuka/ditutup — tanpa poll, blok bisa hilang tanpa ada kejadian yang memberi
  tahu island. Poll kalah cepatnya tidak masalah; tick berikutnya membereskan.
- **Suara ikut pindah.** `playSound()` hanya dipanggil di messageTray.js:1147, di
  dalam `_updateShowingNotification()`; begitu banner diblok jalur itu tidak pernah
  jalan lagi. Island yang mengambil alih tampilnya notifikasi mengambil alih
  suaranya (`item.n.playSound()` di `_surface`). Yang terbukti dipanggil; belum
  didengar dengan telinga.
- **Antrean bisa memutar ulang.** Notif yang datang saat diblok tetap masuk
  `_notificationQueue` (maks 3) dan banner-nya muncul begitu blok dilepas.

**Bug jalur-lepas, dan akar yang hanya kelihatan kalau di-trace.** `disable()`
melepas blok (statement ke-2, supaya throw di tengah-tengah tidak meninggalkan
shell dalam keadaan diblok). Tapi setter itu sendiri sinkron masuk kembali ke
shell: `bannerBlocked=false` → `_updateState()` → `_showNotification()` untuk notif
antrean → `Source.count` naik → handler `notify::count` kita (extension.js:1461)
masih terhubung dan `_island` belum null → `_render()` → `_syncBannerBlock()` →
**blokir lagi**, 27 ms sesudah release, dan sejak itu flag tidak punya pemilik
sampai logout. Rig membuktikannya dengan stack, bukan dengan pixel:

```
PROBE SET blocked=false  stack=_blockBanner@:585 <= disable@:207 <= _callExtensionDisable@extensionSystem.js:218
PROBE SET blocked=true   stack=_blockBanner@:585 <= _syncBannerBlock@:578 <= _render@:895
                              <= _watch/ids<@:1461 <= countUpdated@messageTray.js:537
```

Fix-nya satu sakel: `_dead` di `enable()` = false, statement **pertama** `disable()`
= true, diperiksa di `_syncBannerBlock()` dan di gerbang `_render()`. Jadi urutan
lama (lepas sedini mungkin) tetap tahan-throw, dan tidak ada jalur — termasuk
re-entri dari shell — yang bisa menulis `blocked=true` sesudah island mati.

**Cara ukurnya, karena pixel saja menipu.** Kontrol pertama: rig tanpa extension
apa pun benar-benar menampilkan banner (47197 piksel terang vs baseline 2093), jadi
angka HILANG di uji-lepas bukan butanya probe. Lalu probe rig-only
`noir-probe@rig` yang membungkus `_onNotificationRequestBanner` /
`_showNotification` dan men-trace *setter* `bannerBlocked` beserta stack — handler
palsu memanggil yang asli **terlebih dulu**, supaya probe tidak mengubah jalur
yang diukurnya. Sesudah fix: satu `SET blocked=false` saat disable, **nol**
`SET blocked=true` sesudahnya, tray berakhir `visible=true`, dan
`BANNER-sesudah-normal: ADA (47486)` / `BANNER-sesudah-kritis: ADA (47486)`;
`BANNER-saat-island` tetap HILANG (2378). Tiga jebakan probe yang ketemu di
jalan: `import Main from 'resource:///...ui/main.js'` melempar
*ambiguous indirect export* (harus `import * as Main`), `global.log` tidak ada di
shell 46 (pakai `log()` global GJS), dan `gnome-extensions disable` baru menyentuh
shell ~10 dtk sesudah dipanggil karena service `org.gnome.Shell.Extensions`
diaktivasi lewat D-Bus — jangan menuduh race kalau timestamp terlihat aneh.

### Sumbu island: rata ke seksi tanggal, bukan ke tengah monitor

Island selama ini digambar pada `mon.x + (mon.width - w) / 2` — rata monitor.
Di panel Ubuntu itu bukan rata jam: seksi tanggal duduk di `center box` yang
lebarnya ditentukan isi kiri dan kanan panel, jadi island terbaca geser dari
angka yang digantikannya. Terukur di screenshot user (1920 px): tengah card 960
vs tengah teks jam 997 — **37 px di kiri**. `_anchor()` sekarang memakai
`_clockCenter()`, dan `_pollHover()` ikut sumbu yang sama; kalau tidak, zona
bangun tetap di tengah monitor sementara islandnya sudah pindah, dan pointer
harus mengejar bentuk yang tidak lagi ada di sana.

Dua hal yang bikin pembacaan posisi jam tidak sesederhana terlihat:

- **Alokasi actor dihitung dari orang tua.** `dateMenu.container` anak dari box
  panel, jadi `get_allocation_box().x1` adalah offset di dalam panel, bukan
  koordinat panggung yang dipakai geometri island. Yang dibaca adalah
  `get_transformed_position()` + lebar alokasi — pelajaran yang sama dengan
  `_seekAt()` (lihat "posisi harus ditanya, bukan dihitung").
- **Yang diukur sedang kita sembunyikan.** `_setClock()` mengambil alih jam
  panel mulai level peek/card, dan actor tersembunyi tidak meninggalkan alokasi.
  Nilainya karenanya di-cache di `_axis` dan dibaca ulang sepanjang morph;
  cache dibuang kalau `primaryMonitor` pindah atau berganti resolusi, dan jatuh
  kembali ke tengah monitor kalau dateMenu tidak ada.

Rig membuktikan bagiannya: `sumbu=846` konstan di pill/peek/card/notif sementara
kartu 460 px bergeser dari `@570` ke `@616`, dan R2/R2B (hover di tepi, mati di
x=-300) tetap lolos dengan sumbu baru. Live: `card 460x72 @767,28 panel=28
sumbu=997`, 0 JS ERROR.

## Yang sengaja tidak diubah

Dock tetap full-height dan fixed (permintaan eksplisit). Thumbnail workspace di
app grid tetap ada. Spinner boot sudah bagus. Palet kuning bawaan untuk warning.
