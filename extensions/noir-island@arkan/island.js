// noir-island@arkan — isi island: satu permukaan, tiga keadaan, satu antrean
// prioritas NOTIF > MEDIA > IDLE. File ini dimuat oleh extension.js (stub), dari
// path yang bisa diganti tanpa logout; lihat catatan di stub.

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import GWeather from 'gi://GWeather';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

const DBUS_IFACE = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_ROOT = 'org.mpris.MediaPlayer2';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
// Satu-satunya jalan masuk agenda di Ubuntu 24.04: tidak ada typelib ECal/Gcal
// di mesin ini (girepository-1.0 hanya berisi Gvc-1.0, Shell-14, St-14), jadi
// libecal tidak bisa dipakai dari extension. Server ini pula yang mengurusi
// menu tanggal shell — island ikut di bawah payung yang sama.
const CAL_NAME = 'org.gnome.Shell.CalendarServer';
const CAL_PATH = '/org/gnome/Shell/CalendarServer';
const CAL_IFACE = 'org.gnome.Shell.CalendarServer';
// Since/Until adalah state GLOBAL server yang dibagi dengan menu tanggal
// (terukur: klien kedua yang memasang rentang sempit mengubah properti yang
// dibaca klien pertama). Island karenanya hanya melebar, tidak pernah
// menyempitkan, dan tidak pernah mengulang.
const CAL_BEHIND_S = 3600;
const CAL_AHEAD_S = 35 * 86400;
// Panggilan pertama bisa memicu aktivasi service (fork + buka kalender), jadi
// timeout MPRIS 400 dtk terlalu ketat: gagal di sini cuma berarti dicoba lagi
// lewat celah menit berikutnya.
const CAL_ASK_TIMEOUT_MS = 2000;

// Cuaca lewat GWeather 4 — pustaka yang sama yang dipakai menu tanggal shell
// (gnome-shell Depends: gir1.2-gweather-4.0), jadi typelibnya pasti ada di
// dalam proses. Mana yang benar-benar menjawab di mesin ini terukur, bukan
// ditebak: MET_NO = data (Jakarta, 1.06 dtk, 26.1 C), OWM = "401 Unauthorized"
// (butuh API key), METAR untuk lokasi kota = "Retrieval failed". Karena itu
// hanya MET_NO yang diaktifkan; dua provider mati itu hanya menambah 600-900 dtk
// per siklus tanpa pernah ikut berkontribusi.
const WEATHER_PROVIDERS = GWeather.Provider.MET_NO;
// Ambang umur DATA, bukan umur panggilan (10 menit, mengikuti weather.js shell).
// Respons met.no membawa `expires` ±31 menit, jadi di bawah ambang ini update()
// dijawab cache dalam proses: terukur 4-250 ms dan NOL koneksi TLS untuk tiga
// panggilan beruntun.
const WEATHER_STALE_S = 600;
const WEATHER_TICKS = 120;

// Island menggantung rata di bawah panel: tanpa celah, sudut atas kotak, jadi
// ia dibaca sebagai bagian dari bezel, bukan sebagai toast. Padding horizontal
// hidup di CSS (.noir-island-pad), kecuali PROG_INSET yang dipakai lagi di JS.
//
// Lebar DIPATOK per state, bukan diukur dari isinya. Dulu _widthFor() memakai
// natural width barisnya: judul trek yang panjang menggeser card 156 -> 489 px
// (terbukti di run baseline rig), ellipsis tidak pernah bekerja karena actor
// selalu selebar teksnya, dan tombol transport terdorong keluar.
const PILL_W = 240;
const PEEK_W = 340;
// Tinggi pill dan peek: satu baris. Card punya tingginya sendiri (CARD_H).
const PILL_H = 34;
const MEDIA_W = 580;
const MEDIA_H = 64;
const NOTIF_W = 460;
const NOTIF_H = 72;
// Band tempat rel progres hidup: 12 px untuk pointer, 3 px untuk mata. Bar
// dipajang di dasar band supaya siluet card tidak berubah dari sebelumnya.
const PROGRESS_H = 12;
const PROG_BAR_H = 3;
// Sudut bawah card melengkung 22 px; pada tinggi 3 px lengkungan itu sudah
// masuk 11 px dari tepi, jadi rel progres berhenti di situ supaya tidak
// mencuat keluar siluet (St tidak punya clip-path/mask).
const PROG_INSET = 11;
const COVER_PX = 44;

const ANIM_MS = 260;
const FADE_MS = 120;
// Anak tangga ramp manual (lihat _rampTo): 16 ms ~ 60 fps, cukup halus untuk
// fade 120 ms. Pembulatan jadi urusan penulisnya, karena scale_y float.
const RAMP_MS = 16;
const TULIS_OPACITY = (a, v) => a.set_opacity(Math.round(v));
const TULIS_SCALE_Y = (a, v) => a.set_scale(1, v);
const TULIS_TRANSLATION_Y = (a, v) => a.set_translation(0, v, 0);
// State baru harus bertahan sejenak sebelum diterima. Angka di bawah ambang
// kedip mata tapi di atas flapping player yang paling umum.
const DWELL_MS = 1200;
// Pengumuman isi (trek baru) melebar sebentar lalu mundur sendiri. Lamanya, dan
// seluruh masa tampil notifikasi, bukan lagi konstanta: dia hidup di schema
// (org.gnome.shell.extensions.noir-island) supaya bisa diputar dengan gsettings
// tanpa logout. Yang di sini hanya nama kunci dan field tujuannya.
const OPT = {
  'persistent-pill': 'persistentPill',
  'show-when-paused': 'showPaused',
  'hold-normal-ms': 'holdNormal',
  'hold-high-ms': 'holdHigh',
  'hold-critical-ms': 'holdCritical',
  'hold-hover-extra-ms': 'holdHoverExtra',
  'peek-ms': 'peekMs',
  'idle-hide-ms': 'idleHide',
  'ambient-clock': 'ambientClock',
  'ambient-mic': 'ambientMic',
  'ambient-agenda': 'ambientAgenda',
  'ambient-weather': 'ambientWeather',
};
// Hover dibaca lewat polling global.get_pointer(), bukan captured-event MOTION
// (di X11 tidak terkirim ke stage saat klien memegang pointer grab, jadi mati
// persis di atas video fullscreen) dan bukan track-input (Wayland). 8 query per
// detik saat island tertidur adalah harga tombol yang bisa diklik.
const HOVER_POLL_MS = 120;
// Dead band antara masuk dan keluar: tanpa itu pill yang persis seukuran
// region masuk akan nyala-mati tiap frame saat pointer berdiri di ambangnya.
// Zona masuk harus menutupi card TERLEBAR (NOTIF_W 460 -> setengahnya 230) dan
// card tertinggi (72 px di bawah panel): yang dicari pointer adalah bentuk yang
// baru saja dilihatnya, bukan pill yang tersisa di dalam panel.
const HOVER_IN_Y = 100;
const HOVER_OUT_Y = 124;
const HOVER_IN_X = 250;
const HOVER_OUT_X = 300;
// Dua poll (240 ms) untuk bangun, tiga (360 ms) untuk tidur: masuk harus terasa
// instan, keluar harus yakin.
const HOVER_IN_POLLS = 2;
const HOVER_OUT_POLLS = 3;
// Tarik-mundur ke bezel lebih cepat dari morph antar state: keluar harus terasa
// sebagai keputusan, bukan sebagai transisi yang sedang berlangsung.
const STOW_MS = 220;
const STOW_GRACE_MS = 4000;
const RAIL_MS = 200;
const TICK_MS = 500;
const DBUS_TIMEOUT_MS = 400;
const QUEUE_MAX = 8;
// Jejak notifikasi. Yang disimpan angka dan string biasa, tanpa referensi objek
// shell, jadi aktor yang sudah destroy tidak pernah ikut tertahan. TTL dipakai
// karena satu hal tidak bisa dibedakan dari sini: belum pernah tampil, atau
// matinya karena kedaluwarsa di tray.
const LOG_MAX = 20;
const LOG_TTL_MS = 5 * 60 * 1000;
// Pemain yang lahir tanpa metadata ditanya ulang tiap scan (2 dtk), tapi cuma
// sampai ambang ini: nama MPRIS yang memang bukan player jangan dipoll seumur
// hidup.
const BLIND_RETRY_MAX = 10;
const BODY_MAX = 160;
// Aksi bawaan notifikasi ikut dijadikan tombol (screenshot mengirim
// "Show in Files"), dibatasi dua supaya baris tombol tidak menggeser kolom
// teks, dan labelnya dipotong pada 18 karakter.
const ACT_MAX = 2;
const ACT_LABEL_MAX = 18;
const SCAN_TICKS = 4;
// Agenda dihitung ulang per menit, bukan per tick. Angka HH:MM di label tidak
// berganti sampai jam melewatinya, jadi satu menit cukup untuk memindahkan
// pil ke acara berikutnya tanpa membawa Map kalender tiap 500 dtk.
const AGENDA_TICKS = 120;
// Di bawah angka ini card tidak bisa memuat apa pun yang terbaca.
const MIN_W = 200;
// Seluruh isi card selain kolom judul pada state media: padding kiri-kanan
// (2x14), thumb (44), dua gap baris (2x10) dan kelompok kontrol lengkap
// (waktu + hairline + tiga tombol). Diukur di rig: card 420 px menyisakan
// 169 px untuk kolom teks.
const MEDIA_CHROME_W = 310;

// Geometri adalah fungsi dari (level, content), tidak pernah dari isinya. Pill
// dan peek cuma beda lebar; card mengambil angka per konten.
const CARD_W = {
  media: MEDIA_W,
  notif: NOTIF_W,
  weather: MEDIA_W,
  telemetry: MEDIA_W,
  timer: MEDIA_W,
  drop: MEDIA_W,
  clip: MEDIA_W,
  cmd: MEDIA_W,
  radio: MEDIA_W,
  radar: MEDIA_W,
  ignition: MEDIA_W,
};

const CARD_H = {
  media: MEDIA_H + PROGRESS_H,
  notif: NOTIF_H,
  weather: MEDIA_H + PROGRESS_H,
  telemetry: MEDIA_H + PROGRESS_H,
  timer: MEDIA_H + PROGRESS_H,
  drop: MEDIA_H + PROGRESS_H,
  clip: MEDIA_H + PROGRESS_H,
  cmd: MEDIA_H + PROGRESS_H,
  radio: MEDIA_H + PROGRESS_H,
  radar: MEDIA_H + PROGRESS_H,
  ignition: MEDIA_H + PROGRESS_H,
};

const LEVEL_W = {
  pill: PILL_W,
  peek: PEEK_W,
};

function monoMs() {
  return GLib.get_monotonic_time() / 1000;
}

function mmss(sec) {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Island {
  enable(context) {
    // Sakel mati. Hanya disable() yang menaikkannya, dan begitu naik, tidak ada
    // jalur lagi — termasuk re-entri dari shell — yang boleh menulis bannerBlocked.
    this._dead = false;
    this._players = new Map();
    this._pending = [];
    this._log = [];
    this._showing = null;
    this._watched = new Map();
    this._hooked = new Map();
    this._pairs = [];
    this._state = null;
    this._coverKey = null;
    this._progW = PILL_W - 2 * PROG_INSET;
    // Awal mula: tersimpan di dalam panel. Island tidak pernah "hidup" tanpa
    // isi; yang pertama membangunkannya adalah trek, notifikasi, atau pointer
    // yang datang dekat panel.
    this._stowed = true;
    this._stowAt = 0;
    // Signature isi terakhir yang benar-benar digambar; null paksa render penuh.
    this._sig = null;
    this._isi = null;
    this._wantState = null;
    this._wantAt = 0;
    this._forced = false;
    this._dwellId = 0;
    this._geo = '';
    this._mon = null;
    this._axis = null;
    this._ambientId = '-';
    this._ambientNilai = '';
    this._providerList = null;
    this._micOn = false;
    this._micLabel = '';
    this._mixer = null;
    // Peta agenda ikut dibuang saat disable(): id event bertahan lintasan
    // enable, dan label yang sudah basi tidak boleh ikut naik.
    this._agenda = new Map();
    this._agendaLabel = '';
    this._agendaProxy = null;
    this._agendaAsked = false;
    this._agendaEvery = 0;
    // Info cuaca ikut dilepas saat disable(): dia satu-satunya tenant yang
    // memegang koneksi keluar, dan labelnya tidak boleh naik ke sesi berikutnya.
    this._weatherInfo = null;
    this._weatherLabel = '';
    this._weatherCityName = null;
    this._weatherEvery = 0;
    this._soupSession = new Soup.Session();
    this._lyricsCache = new Map();
    this._currentLyrics = null;
    this._lyricsKey = null;
    this._lyricsFetching = null;
    this._lyricTimerId = 0;
    this._lyricSlidingText = null;
    this._bloomTimerId = 0;
    this._shownKey = null;
    this._shownNotif = null;
    this._fullscreen = false;
    this._tickId = null;
    this._scanEvery = 0;
    // Level adalah sumbu kedua: content menjawab "apa yang boleh tampil", level
    // menjawab "seberapa lebar". Keduanya independen, dan hanya pointer/klik/
    // timer yang menggerakkan level.
    this._level = null;
    this._shape = '';
    this._hoverOn = false;
    this._hoverIn = 0;
    this._hoverOut = 0;
    this._hoverId = 0;
    this._peekUntil = 0;
    // Batas "masih ada yang terjadi": selama jam ini hidup, pill media boleh
    // menempel; setelahnya island tidur walau trek masih berputar.
    this._wakeUntil = 0;
    this._cardOpen = false;
    this._cardMode = null;
    this._cpuUsage = 0;
    this._lastCpuIdle = 0;
    this._lastCpuTotal = 0;
    this._memUsedText = '';
    this._memTotalText = '';
    this._memPct = 0;
    this._lastNetRx = 0;
    this._lastNetTx = 0;
    this._lastNetSample = 0;
    this._netRxText = '';
    this._netTxText = '';
    this._timerRunning = false;
    this._timerStart = 0;
    this._timerAccum = 0;
    this._timerMode = 'pomodoro';
    this._droppedFiles = [];
    this._clipStack = [];
    this._lastClipText = '';
    this._cmdOutput = 'READY · PIT WALL V6';
    this._radioDuration = 0;
    this._radioStartTime = 0;
    this._gForceX = 0;
    this._gForceY = 0;
    this._lastPointerX = 0;
    this._lastPointerY = 0;
    this._lastPointerTime = 0;
    this._turboActive = false;
    this._igniteState = 'READY';
    this._outsideId = 0;
    this._active = null;
    this._clockHiddenByUs = false;

    this._settings = context.getSettings();
    this._opt = {};
    for (const key of Object.keys(OPT))
      this._on(this._settings, `changed::${key}`, () => this._syncOpts());
    // Lokasi cuaca bukan opsi render, tapi tombol mulai ulang tenant: string
    // "lat,lon" yang berubah berarti Info lama harus dibuang dan yang baru
    // dibangun, bukan sekadar dibaca ulang di lukisan berikutnya.
    this._on(this._settings, 'changed::weather-location',
      () => this._startWeather());
    this._syncOpts();

    this._notifSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.notifications',
    });

    this._buildIsland();
    Main.layoutManager.addChrome(this._island, {affectsInputRegion: false});
    this._active = false;
    this._island.visible = false;
    this._place();

    this._on(global.display, 'in-fullscreen-changed', () => {
      this._fullscreen = !!Main.layoutManager.primaryMonitor?.inFullscreen;
      this._render();
    });
    this._on(Main.layoutManager, 'monitors-changed', () => this._relayout());
    this._on(Main.panel, 'notify::height', () => this._relayout());
    this._on(this._notifSettings, 'changed::show-banners', () => {
      // Dicetak di sini supaya rig bisa membedakan "DND tidak dicatat" dari
      // "perubahannya tidak pernah sampai ke shell" — keduanya terbaca sama di
      // layar, dan yang kedua bukan bug island.
      log(`noir-island: dnd ${this._dndOff() ? 'on' : 'off'}`);
      if (this._dndOff())
        this._showing = null;
      this._render();
    });

    this._startTray();
    this._startMpris();
    this._startMic();
    this._startAgenda();
    this._startWeather();
    this._fullscreen = !!Main.layoutManager.primaryMonitor?.inFullscreen;
    this._tickId = GLib.timeout_add(GLib.PRIORITY_LOW, TICK_MS, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
    this._hoverId = GLib.timeout_add(GLib.PRIORITY_LOW, HOVER_POLL_MS, () => {
      this._pollHover();
      return GLib.SOURCE_CONTINUE;
    });
    this._render();
    log('noir-island: aktif');
  }

  disable() {
    // Sakel mati lebih dulu dari apa pun. Melepas blok di bawah bisa masuk
    // kembali ke shell: setter bannerBlocked memicu _updateState, yang langsung
    // menampilkan notif antrean, yang menaikkan Source.count, yang memanggil
    // handler kita, yang menggambar ulang — dan blokir lagi. Terbukti di rig:
    // 27 dtk sesudah release flag sudah true kembali dan tidak ada pemiliknya
    // lagi sampai logout.
    this._dead = true;
    // Statement berikutnya, sebelum apa pun yang bisa melempar: satu-satunya
    // jaminan jam panel kembali kalau island sedang memakannya. _setActive tidak
    // lagi menyentuh jam (level yang memutuskannya), jadi dia diminta eksplisit.
    this._setActive(false);
    this._setClock(true);
    // Sama untuk banner: jangan pernah meninggalkan shell dalam keadaan diblok.
    this._blockBanner(false);
    this._armOutside(false);
    if (this._tickId)
      GLib.source_remove(this._tickId);
    this._tickId = null;
    if (this._hoverId)
      GLib.source_remove(this._hoverId);
    this._hoverId = 0;
    if (this._dwellId)
      GLib.source_remove(this._dwellId);
    this._dwellId = 0;
    if (this._rampId)
      GLib.source_remove(this._rampId);
    this._rampId = 0;
    this._ramps?.clear();

    for (const [obj, id] of this._pairs)
      obj.disconnect(id);
    this._pairs = [];

    for (const {src, ids} of this._watched.values())
      ids.forEach(id => src.disconnect(id));
    this._watched.clear();

    // Handler di atas menempel pada notifikasi milik shell, jadi ikut dilepas
    // supaya tidak memanggil _render() setelah extension mati. Yang diiterasi
    // adalah pasangan [notifikasi, daftar-id] milik Map itu sendiri —
    // .values() hanya mengeluarkan daftar id, dan menghancurkan sisa disable()
    // di bawahnya.
    for (const [n, ids] of this._hooked)
      ids.forEach(id => n.disconnect(id));
    this._hooked.clear();

    this._pending = [];
    this._log = [];
    this._showing = null;

    for (const e of this._players.values())
      e.proxy.run_dispose();
    this._players.clear();

    // Stream Gvc adalah objek milik mixer; melepas koneksi ke server suara harus
    // terjadi sebelum referensinya dibuang, kalau tidak stream terakhir tertahan
    // dan _micOn masih bisa dibaca hidup sesudah island mati.
    if (this._mixer) {
      this._mixer.close();
      this._mixer = null;
    }
    this._micOn = false;

    // Proxy agenda dilepas lewat jalur yang sama dengan player MPRIS: sinyal
    // terpasang lewat _on() (sudah diputus di atas), objeknya lewat
    // run_dispose(). Datanya ikut dikosongkan supaya enable() berikutnya mulai
    // dari nol, bukan dari acara yang sudah lewat.
    if (this._agendaProxy) {
      this._agendaProxy.run_dispose();
      this._agendaProxy = null;
    }
    this._agenda.clear();
    this._agendaLabel = '';
    this._agendaAsked = false;

    // Info cuaca dihentikan sebelum dilepas: abort() memutuskan permintaan yang
    // masih di udara, run_dispose() menutup Soup.Session milik objek itu. Tanpa
    // abort() island bisa meninggalkan satu request met.no yang baru selesai
    // sesudah disable dan memanggil _syncWeather() di atas objek yang sudah
    // tidak dipakai lagi.
    if (this._weatherInfo) {
      this._weatherInfo.abort();
      this._weatherInfo.run_dispose();
      this._weatherInfo = null;
    }
    this._weatherLabel = '';
    this._weatherCityName = null;

    if (this._soupSession) {
      this._soupSession.abort();
      this._soupSession = null;
    }
    this._lyricsCache.clear();
    this._currentLyrics = null;
    this._lyricsKey = null;
    this._lyricsFetching = null;
    if (this._lyricTimerId) {
      GLib.source_remove(this._lyricTimerId);
      this._lyricTimerId = 0;
    }
    this._lyricSlidingText = null;
    if (this._bloomTimerId) {
      GLib.source_remove(this._bloomTimerId);
      this._bloomTimerId = 0;
    }

    if (this._island) {
      Main.layoutManager.removeChrome(this._island);
      this._island.destroy();
      this._island = null;
    }
    this._state = null;
    this._level = null;
    this._shape = '';
    this._hoverOn = false;
    this._cardOpen = false;
    this._peekUntil = 0;
  }

  _on(obj, signal, handler) {
    this._pairs.push([obj, obj.connect(signal, handler)]);
  }

  // Nilai disalin sekali per perubahan, bukan dibaca per pemakaian: delapan
  // getter GVariant di setiap jalur render adalah cara termudah membuat island
  // terbaca lambat. get_value().unpack() ikut jenis kuncinya, jadi boolean dan
  // integer tidak perlu dua jalur.
  _syncOpts() {
    for (const [key, field] of Object.entries(OPT))
      this._opt[field] = this._settings.get_value(key).unpack();
    // Hold yang baru saja dipangkas boleh menjatuhkan kartu lebih awal; itu
    // pekerjaan _tick(), yang sudah berlari setiap 500 dtk.
    this._render();
  }

  // ---------------------------------------------------------------- permukaan

  _buildIsland() {
    const island = new St.BoxLayout({
      style_class: 'noir-island',
      vertical: true,
      reactive: true,
    });
    island.set_size(PILL_W, PILL_H);
    island.set_clip_to_allocation(true);
    this._island = island;
    island.connect('scroll-event', (actor, event) => {
      const dir = event.get_scroll_direction();
      let step = 0;
      if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
        step = -1;
      else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
        step = 1;
      else if (dir === Clutter.ScrollDirection.SMOOTH) {
        const [, dy] = event.get_scroll_delta();
        if (dy < -0.1) step = -1;
        else if (dy > 0.1) step = 1;
      }
      if (step !== 0) {
        this._stepNavMode(step);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    // Pill: keadaan diam, dan keadaan jeda (track terakhir masih terbaca di bus).
    // y_expand membuat baris mengambil seluruh tinggi card. Tanpa itu BoxLayout
    // vertikal meletakkan barisnya di tepi atas dan menyisakan 20 px hitam di
    // bawah konten (baseline rig: card 67 px, isi 44 px).
    // Pill dibungkus satu St.Button: klik di mana pun pada pill membuka card,
    // tanpa plumbing event sendiri — idioma yang sama dengan lima tombol lain.
    // noir-island-pillbtn hanya menetralkan gaya `button` global tema; isinya
    // tetap BoxLayout biasa supaya geometri pill tidak berubah sedikit pun.
    this._pillRow = new St.Button({
      style_class: 'noir-island-pillbtn',
      y_expand: true,
      can_focus: false,
    });
    this._pillRow.connect('clicked', () => this._expand());
    const pill = new St.BoxLayout({style_class: 'noir-island-pad'});
    this._pillRow.set_child(pill);
    this._dot = new St.Widget({
      style_class: 'noir-island-dot',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._pillKicker = new St.Label({
      // Bukan .noir-island-kicker: yang itu label sekunder 9 px/0.40 milik kicker
      // kartu. Di pill slot ini diisi jam, yang mulai peek/card menggantikan jam
      // panel ~15 px putih penuh — dipakai gaya sekunder membuat tengah panel
      // terbaca kosong.
      style_class: 'noir-island-pilltime',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._pillKicker);
    this._pillText = this._label('noir-island-line');
    this._pillBadge = new St.Label({
      style_class: 'noir-island-badge',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    this._pillEq = new St.BoxLayout({
      style_class: 'noir-island-eq',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    this._eqBars = [];
    for (let b = 0; b < 4; b++) {
      const bar = new St.Widget({
        style_class: 'noir-island-eq-bar',
        y_align: Clutter.ActorAlign.CENTER,
      });
      bar.set_height(4);
      this._eqBars.push(bar);
      this._pillEq.add_child(bar);
    }
    pill.add_child(this._dot);
    pill.add_child(this._pillKicker);
    pill.add_child(this._hairline());
    pill.add_child(this._pillText);
    pill.add_child(this._pillEq);
    pill.add_child(this._pillBadge);
    island.add_child(this._pillRow);

    // Media: artwork, tiga baris teks (judul/artis/album), transport.
    this._mediaRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._mediaRow.set_clip_to_allocation(true);
    this._cover = new St.Bin({
      style_class: 'noir-island-cover',
      x_align: Clutter.ActorAlign.FILL,
      // CENTER, bukan FILL: tinggi 44 px di CSS hanya batas bawah, jadi Bin yang
      // fill ikut meregang setinggi barisnya (thumb jadi persegi panjang).
      y_align: Clutter.ActorAlign.CENTER,
      reactive: true,
      track_hover: true,
    });
    this._cover.connect('scroll-event', (actor, event) => {
      const dir = event.get_scroll_direction();
      const player = this._pick();
      if (!player) return Clutter.EVENT_PROPAGATE;
      if (dir === Clutter.ScrollDirection.UP) {
        this._changeVolume(player, 0.05);
        return Clutter.EVENT_STOP;
      } else if (dir === Clutter.ScrollDirection.DOWN) {
        this._changeVolume(player, -0.05);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
    this._cover.connect('button-press-event', () => {
      const player = this._pick();
      if (player) {
        this._raisePlayer(player);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
    // Tile artwork dibiarkan berisi ikon sampai ada art sungguhan, supaya card
    // tidak pernah membuka dengan kotak kosong.
    this._coverIcon = new St.Icon({
      icon_name: 'audio-x-generic-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
    });
    this._cover.add_child(this._coverIcon);
    const col = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._revBox = new St.BoxLayout({
      style_class: 'noir-island-rev-box',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._revLeds = [];
    for (let i = 0; i < 10; i++) {
      const ledType = i < 3 ? 'green' : i < 7 ? 'red' : 'blue';
      const led = new St.Widget({
        style_class: `noir-island-rev-led noir-island-rev-led--${ledType}`,
      });
      led.set_opacity(40);
      this._revLeds.push({led, type: ledType});
      this._revBox.add_child(led);
    }
    col.add_child(this._revBox);
    this._mTitle = this._label('noir-island-title');
    this._mArtist = this._label('noir-island-line');
    this._mAlbum = this._label('noir-island-faint');
    this._mLyric = new St.Label({
      style_class: 'noir-island-lyric-active',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._mLyric.clutter_text.line_wrap = false;
    this._mLyric.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    this._mLyric.visible = false;
    col.add_child(this._mTitle);
    col.add_child(this._mArtist);
    col.add_child(this._mAlbum);
    col.add_child(this._mLyric);

    this._time = new St.Label({
      style_class: 'noir-island-time',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._time);
    this._btnPrev = this._iconButton('media-skip-backward-symbolic',
      () => this._transport('Previous'), 'noir-island-btn--round');
    this._btnPlay = this._iconButton('media-playback-pause-symbolic',
      () => this._transport('PlayPause'),
      'noir-island-btn--round noir-island-btn--play');
    this._btnNext = this._iconButton('media-skip-forward-symbolic',
      () => this._transport('Next'), 'noir-island-btn--round');
    const ctl = new St.BoxLayout({style_class: 'noir-island-ctl'});
    ctl.add_child(this._hairline());
    ctl.add_child(this._time);
    ctl.add_child(this._btnPrev);
    ctl.add_child(this._btnPlay);
    ctl.add_child(this._btnNext);
    ctl.add_child(this._hairline());
    ctl.add_child(this._navBox('media'));

    this._mediaRow.add_child(this._cover);
    // Kolom teks dibungkus St.Button: klik di judul/artis/album adalah jalan
    // pulang dari card, simetris dengan klik pill yang membukanya. Bukan tombol
    // ✕ baru, dan bukan outside-click: _armOutside bergantung pada captured-event
    // stage yang di Wayland tidak terkirim, jadi satu-satunya affordance yang
    // terbukti bekerja adalah klik pada isi card itu sendiri. Kelasnya pakai
    // milik pill supaya tidak ada chrome tambahan sama sekali.
    this._mediaCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._mediaCollapse.set_child(col);
    this._mediaCollapse.connect('clicked', () => this._collapse());
    this._mediaRow.add_child(this._mediaCollapse);
    this._mediaRow.add_child(ctl);
    island.add_child(this._mediaRow);

    this._progress = new St.Widget({
      style_class: 'noir-island-prog',
      visible: false,
      // Band setinggi 12 px, bar terlihat tetap 3 px di dasarnya: target pointer
      // 3 px tidak pernah bisa dipanggil, dan rail inilah satu-satunya jalur seek
      // di card.
      reactive: true,
      track_hover: true,
    });
    this._progress.connect('button-press-event', (a, e) => this._seekAt(e));
    this._progress.connect('notify::hover', () => {
      if (!this._progress.hover) {
        const player = this._pick();
        if (player) this._updateProgress(player);
      }
    });
    this._progress.connect('motion-event', (a, e) => {
      const player = this._pick();
      if (!player || !player.meta?.length) return Clutter.EVENT_PROPAGATE;
      const [ax] = this._progress.get_transformed_position();
      const lebar = this._progress.get_allocation_box().get_width();
      if (lebar <= 0) return Clutter.EVENT_PROPAGATE;
      const [x] = e.get_coords();
      const ratio = Math.min(1, Math.max(0, (x - ax) / lebar));
      const targetSec = ratio * player.meta.length;
      this._time.set_text(`${mmss(targetSec)} / ${mmss(player.meta.length)}`);
      return Clutter.EVENT_PROPAGATE;
    });
    this._progressFill = new St.Widget({style_class: 'noir-island-progfill'});
    // _progress tidak punya layout manager (anaknya dulu dialokasi 5x0 karena
    // itu), jadi posisi bar dituliskan tangan: mendarat di dasar band.
    this._progressFill.set_position(0, PROGRESS_H - PROG_BAR_H);
    this._progress.add_child(this._progressFill);
    island.add_child(this._progress);

    // Notifikasi: rail rosso, ikon sumber dalam tile, tiga baris teks, tombol.
    // Baris ini sengaja tidak memakai noir-island-pad supaya rail dan tile
    // menyentuh tepi card; gantinya tile dan tombol membawa margin sendiri.
    this._notifRow = new St.BoxLayout({
      style_class: 'noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._rail = new St.Widget({style_class: 'noir-island-rail'});
    this._iconBin = new St.Bin({
      style_class: 'noir-island-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const ncol = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._nKicker = new St.Label({style_class: 'noir-island-kicker'});
    this._noEllipsis(this._nKicker);
    this._nTitle = this._label('noir-island-title');
    this._nBody = this._label('noir-island-line');
    ncol.add_child(this._nKicker);
    ncol.add_child(this._nTitle);
    ncol.add_child(this._nBody);

    this._badge = new St.Label({
      style_class: 'noir-island-badge',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    this._btnClose = this._textButton('Tutup', () => this._dismiss(),
      'noir-island-btn--stop');
    this._btnOpen = this._textButton('Buka', () => this._openTarget(),
      'noir-island-btn--go');
    // Tombol kiriman notifikasi sendiri ("Show in Files" pada screenshot),
    // disisip di antara Tutup dan Buka supaya kolom aksi tetap satu baris.
    this._actBox = new St.BoxLayout({
      style_class: 'noir-island-acts',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    const btns = new St.BoxLayout({style_class: 'noir-island-actions'});
    btns.add_child(this._badge);
    btns.add_child(this._btnClose);
    btns.add_child(this._actBox);
    btns.add_child(this._btnOpen);

    this._notifRow.add_child(this._rail);
    this._notifRow.add_child(this._iconBin);
    this._notifRow.add_child(ncol);
    this._notifRow.add_child(btns);
    island.add_child(this._notifRow);

    // Weather Card (Maranello GT): icon tile, city + cond, temp + range, hairline, 4 hourly slots
    this._weatherRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._weatherTile = new St.Bin({
      style_class: 'noir-island-weather-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._wIcon = new St.Icon({
      icon_name: 'weather-clear-symbolic',
      icon_size: 24,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._weatherTile.set_child(this._wIcon);

    const wcol = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._wCity = this._label('noir-island-title');
    this._wCond = this._label('noir-island-line');
    wcol.add_child(this._wCity);
    wcol.add_child(this._wCond);

    const wtempBox = new St.BoxLayout({
      vertical: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._wTemp = new St.Label({
      style_class: 'noir-island-wtemp',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._wRange = new St.Label({
      style_class: 'noir-island-wrange',
      y_align: Clutter.ActorAlign.CENTER,
    });
    wtempBox.add_child(this._wTemp);
    wtempBox.add_child(this._wRange);

    this._weatherCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    const wInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    wInfoBox.add_child(this._weatherTile);
    wInfoBox.add_child(wcol);
    wInfoBox.add_child(wtempBox);
    this._weatherCollapse.set_child(wInfoBox);
    this._weatherCollapse.connect('clicked', () => this._collapse());

    this._wHourlyBox = new St.BoxLayout({
      style_class: 'noir-island-hourly',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._wSlots = [];
    for (let s = 0; s < 4; s++) {
      const sbox = new St.BoxLayout({
        vertical: true,
        style_class: 'noir-island-hslot',
        y_align: Clutter.ActorAlign.CENTER,
      });
      const sjam = new St.Label({
        style_class: 'noir-island-hslot-jam',
        x_align: Clutter.ActorAlign.CENTER,
      });
      const sicon = new St.Icon({
        icon_name: 'weather-clear-symbolic',
        icon_size: 16,
        x_align: Clutter.ActorAlign.CENTER,
        style_class: 'noir-island-hslot-icon',
      });
      const stemp = new St.Label({
        style_class: 'noir-island-hslot-temp',
        x_align: Clutter.ActorAlign.CENTER,
      });
      sbox.add_child(sjam);
      sbox.add_child(sicon);
      sbox.add_child(stemp);
      this._wHourlyBox.add_child(sbox);
      this._wSlots.push({box: sbox, jam: sjam, icon: sicon, temp: stemp});
    }

    this._weatherRow.add_child(this._weatherCollapse);
    this._weatherRow.add_child(this._hairline());
    this._weatherRow.add_child(this._wHourlyBox);
    this._weatherRow.add_child(this._hairline());
    this._weatherRow.add_child(this._navBox('weather'));
    island.add_child(this._weatherRow);

    // --------------------------------------------------- Telemetry Card (F1 HUD)
    this._telemetryRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._telemCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._telemCollapse.connect('clicked', () => this._collapse());

    this._telemTile = new St.Widget({
      style_class: 'noir-island-gforce-box',
      y_align: Clutter.ActorAlign.CENTER,
      layout_manager: new Clutter.BinLayout(),
    });
    this._gForceRing = new St.Widget({
      style_class: 'noir-island-gforce-ring',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._gForceDot = new St.Widget({
      style_class: 'noir-island-gforce-dot',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._telemTile.add_child(this._gForceRing);
    this._telemTile.add_child(this._gForceDot);

    const telemCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'noir-island-telem-col',
    });
    this._telemCpuTitle = this._label('noir-island-title');
    this._telemCpuSub = this._label('noir-island-line');
    telemCol1.add_child(this._telemCpuTitle);
    telemCol1.add_child(this._telemCpuSub);

    const telemInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    telemInfoBox.add_child(this._telemTile);
    telemInfoBox.add_child(telemCol1);
    this._telemCollapse.set_child(telemInfoBox);

    const telemCol2 = new St.BoxLayout({
      vertical: true,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'noir-island-telem-col',
    });
    this._telemMemText = new St.Label({
      style_class: 'noir-island-line',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._telemNetText = new St.Label({
      style_class: 'noir-island-telem-turbo',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._telemMemText);
    this._noEllipsis(this._telemNetText);
    telemCol2.add_child(this._telemMemText);
    telemCol2.add_child(this._telemNetText);

    this._telemetryRow.add_child(this._telemCollapse);
    this._telemetryRow.add_child(this._hairline());
    this._telemetryRow.add_child(telemCol2);
    this._telemetryRow.add_child(this._hairline());
    this._telemetryRow.add_child(this._navBox('telemetry'));
    island.add_child(this._telemetryRow);

    // --------------------------------------------------- Lap Timer Card (Chrono)
    this._timerRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._timerCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._timerCollapse.connect('clicked', () => this._collapse());

    this._timerTile = new St.Bin({
      style_class: 'noir-island-timer-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timerIcon = new St.Icon({
      icon_name: 'preferences-system-time-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timerTile.set_child(this._timerIcon);

    const timerCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timerModeLabel = new St.Label({
      style_class: 'noir-island-timer-tag',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timerTimeLabel = new St.Label({
      style_class: 'noir-island-timer-digits',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._timerModeLabel);
    this._noEllipsis(this._timerTimeLabel);
    timerCol1.add_child(this._timerModeLabel);
    timerCol1.add_child(this._timerTimeLabel);

    const timerInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    timerInfoBox.add_child(this._timerTile);
    timerInfoBox.add_child(timerCol1);
    this._timerCollapse.set_child(timerInfoBox);

    const timerCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timerModeBtn = new St.Button({
      style_class: 'noir-island-timer-btn',
      can_focus: false,
    });
    this._timerModeBtn.set_child(new St.Label({text: 'MODE'}));
    this._timerModeBtn.connect('clicked', () => {
      this._timerMode = this._timerMode === 'pomodoro' ? 'stopwatch' : 'pomodoro';
      this._timerRunning = false;
      this._timerStart = 0;
      this._timerAccum = 0;
      this._fillTimer();
    });

    this._timerResetBtn = new St.Button({
      style_class: 'noir-island-timer-btn',
      can_focus: false,
    });
    this._timerResetBtn.set_child(new St.Label({text: 'RESET'}));
    this._timerResetBtn.connect('clicked', () => {
      this._timerRunning = false;
      this._timerStart = 0;
      this._timerAccum = 0;
      this._fillTimer();
    });

    this._timerPlayBtn = new St.Button({
      style_class: 'noir-island-btn--round noir-island-timer-btn--play',
      can_focus: false,
    });
    this._timerPlayBtn.set_child(new St.Icon({
      icon_name: 'media-playback-start-symbolic',
      icon_size: 16,
    }));
    this._timerPlayBtn.connect('clicked', () => {
      if (this._timerRunning) {
        this._timerAccum += monoMs() - this._timerStart;
        this._timerRunning = false;
      } else {
        this._timerStart = monoMs();
        this._timerRunning = true;
      }
      this._fillTimer();
    });

    timerCol2.add_child(this._timerModeBtn);
    timerCol2.add_child(this._timerResetBtn);
    timerCol2.add_child(this._timerPlayBtn);

    this._timerRow.add_child(this._timerCollapse);
    this._timerRow.add_child(this._hairline());
    this._timerRow.add_child(timerCol2);
    this._timerRow.add_child(this._hairline());
    this._timerRow.add_child(this._navBox('timer'));
    island.add_child(this._timerRow);

    // --------------------------------------------------- Rosso Notch Drop Shelf
    this._dropRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._dropCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._dropCollapse.connect('clicked', () => this._collapse());

    this._dropTile = new St.Bin({
      style_class: 'noir-island-drop-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._dropIcon = new St.Icon({
      icon_name: 'folder-download-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._dropTile.set_child(this._dropIcon);

    const dropCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._dropTitle = this._label('noir-island-title');
    this._dropSub = this._label('noir-island-line');
    this._noEllipsis(this._dropTitle);
    this._noEllipsis(this._dropSub);
    dropCol1.add_child(this._dropTitle);
    dropCol1.add_child(this._dropSub);

    const dropInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    dropInfoBox.add_child(this._dropTile);
    dropInfoBox.add_child(dropCol1);
    this._dropCollapse.set_child(dropInfoBox);

    const dropCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._dropOpenBtn = new St.Button({
      style_class: 'noir-island-drop-btn',
      can_focus: false,
    });
    this._dropOpenBtn.set_child(new St.Label({text: 'DOWNLOADS'}));
    this._dropOpenBtn.connect('clicked', () => {
      try {
        Gio.AppInfo.launch_default_for_uri('file:///home/arkan/Downloads', null);
      } catch (_) {}
    });

    this._dropClearBtn = new St.Button({
      style_class: 'noir-island-drop-btn',
      can_focus: false,
    });
    this._dropClearBtn.set_child(new St.Label({text: 'BERSIHKAN'}));
    this._dropClearBtn.connect('clicked', () => {
      this._droppedFiles = [];
      this._fillDrop();
    });

    dropCol2.add_child(this._dropOpenBtn);
    dropCol2.add_child(this._dropClearBtn);

    this._dropRow.add_child(this._dropCollapse);
    this._dropRow.add_child(this._hairline());
    this._dropRow.add_child(dropCol2);
    this._dropRow.add_child(this._hairline());
    this._dropRow.add_child(this._navBox('drop'));
    island.add_child(this._dropRow);

    // --------------------------------------------------- Carbon Clipboard Stack
    this._clipRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._clipCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._clipCollapse.connect('clicked', () => this._collapse());

    this._clipTile = new St.Bin({
      style_class: 'noir-island-clip-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipIcon = new St.Icon({
      icon_name: 'edit-copy-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipTile.set_child(this._clipIcon);

    const clipCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const clipTitleRow = new St.BoxLayout({style_class: 'noir-island-row'});
    this._clipSwatch = new St.Widget({
      style_class: 'noir-island-clip-swatch',
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipTitle = this._label('noir-island-title');
    this._noEllipsis(this._clipTitle);
    clipTitleRow.add_child(this._clipSwatch);
    clipTitleRow.add_child(this._clipTitle);

    this._clipSub = this._label('noir-island-line');
    this._noEllipsis(this._clipSub);
    clipCol1.add_child(clipTitleRow);
    clipCol1.add_child(this._clipSub);

    const clipInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    clipInfoBox.add_child(this._clipTile);
    clipInfoBox.add_child(clipCol1);
    this._clipCollapse.set_child(clipInfoBox);

    const clipCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._clipCopyBtn = new St.Button({
      style_class: 'noir-island-clip-btn',
      can_focus: false,
    });
    this._clipCopyBtn.set_child(new St.Label({text: 'SALIN'}));
    this._clipCopyBtn.connect('clicked', () => {
      if (this._clipStack.length > 0) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._clipStack[0]);
        this._clipTitle.set_text('DISALIN KE PAPAN KLIP!');
      }
    });

    this._clipClearBtn = new St.Button({
      style_class: 'noir-island-clip-btn',
      can_focus: false,
    });
    this._clipClearBtn.set_child(new St.Label({text: 'HAPUS'}));
    this._clipClearBtn.connect('clicked', () => {
      this._clipStack = [];
      this._lastClipText = '';
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '');
      this._fillClip();
    });

    clipCol2.add_child(this._clipCopyBtn);
    clipCol2.add_child(this._clipClearBtn);

    this._clipRow.add_child(this._clipCollapse);
    this._clipRow.add_child(this._hairline());
    this._clipRow.add_child(clipCol2);
    this._clipRow.add_child(this._hairline());
    this._clipRow.add_child(this._navBox('clip'));
    island.add_child(this._clipRow);

    // --------------------------------------------------- Pit Command Bar
    this._cmdRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._cmdCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._cmdCollapse.connect('clicked', () => this._collapse());

    this._cmdTile = new St.Bin({
      style_class: 'noir-island-cmd-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._cmdIcon = new St.Icon({
      icon_name: 'utilities-terminal-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._cmdTile.set_child(this._cmdIcon);

    const cmdCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._cmdTitle = this._label('noir-island-title');
    this._cmdSub = new St.Label({
      style_class: 'noir-island-cmd-output',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._cmdTitle);
    this._noEllipsis(this._cmdSub);
    cmdCol1.add_child(this._cmdTitle);
    cmdCol1.add_child(this._cmdSub);

    const cmdInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    cmdInfoBox.add_child(this._cmdTile);
    cmdInfoBox.add_child(cmdCol1);
    this._cmdCollapse.set_child(cmdInfoBox);

    const cmdCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    const cmdGitBtn = new St.Button({
      style_class: 'noir-island-cmd-btn',
      can_focus: false,
    });
    cmdGitBtn.set_child(new St.Label({text: 'GIT'}));
    cmdGitBtn.connect('clicked', () => this._execCmd('git'));

    const cmdIpBtn = new St.Button({
      style_class: 'noir-island-cmd-btn',
      can_focus: false,
    });
    cmdIpBtn.set_child(new St.Label({text: 'IP'}));
    cmdIpBtn.connect('clicked', () => this._execCmd('ip'));

    const cmdAudioBtn = new St.Button({
      style_class: 'noir-island-cmd-btn',
      can_focus: false,
    });
    cmdAudioBtn.set_child(new St.Label({text: 'PW-RST'}));
    cmdAudioBtn.connect('clicked', () => this._execCmd('audio'));

    cmdCol2.add_child(cmdGitBtn);
    cmdCol2.add_child(cmdIpBtn);
    cmdCol2.add_child(cmdAudioBtn);

    this._cmdRow.add_child(this._cmdCollapse);
    this._cmdRow.add_child(this._hairline());
    this._cmdRow.add_child(cmdCol2);
    this._cmdRow.add_child(this._hairline());
    this._cmdRow.add_child(this._navBox('cmd'));
    island.add_child(this._cmdRow);

    // --------------------------------------------------- Team Radio Cockpit
    this._radioRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._radioCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._radioCollapse.connect('clicked', () => this._collapse());

    this._radioTile = new St.Bin({
      style_class: 'noir-island-radio-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radioIcon = new St.Icon({
      icon_name: 'audio-input-microphone-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radioTile.set_child(this._radioIcon);

    const radioCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radioTitle = this._label('noir-island-title');
    this._radioSub = new St.Label({
      style_class: 'noir-island-radio-live',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._radioTitle);
    this._noEllipsis(this._radioSub);
    radioCol1.add_child(this._radioTitle);
    radioCol1.add_child(this._radioSub);

    const radioInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    radioInfoBox.add_child(this._radioTile);
    radioInfoBox.add_child(radioCol1);
    this._radioCollapse.set_child(radioInfoBox);

    const radioCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radioMuteBtn = new St.Button({
      style_class: 'noir-island-radio-mute-btn',
      can_focus: false,
    });
    this._radioMuteLabel = new St.Label({text: 'MUTE'});
    this._radioMuteBtn.set_child(this._radioMuteLabel);
    this._radioMuteBtn.connect('clicked', () => {
      try {
        if (this._mixer) {
          const src = this._mixer.get_default_source();
          if (src) {
            const isMuted = src.get_is_muted();
            src.set_is_muted(!isMuted);
            this._fillRadio();
          }
        }
      } catch (_) {}
    });

    radioCol2.add_child(this._radioMuteBtn);

    this._radioRow.add_child(this._radioCollapse);
    this._radioRow.add_child(this._hairline());
    this._radioRow.add_child(radioCol2);
    this._radioRow.add_child(this._hairline());
    this._radioRow.add_child(this._navBox('radio'));
    island.add_child(this._radioRow);

    // --------------------------------------------------- Track Map Mini-Radar
    this._radarRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._radarCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._radarCollapse.connect('clicked', () => this._collapse());

    this._radarTile = new St.Bin({
      style_class: 'noir-island-radar-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radarIcon = new St.Icon({
      icon_name: 'find-location-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radarTile.set_child(this._radarIcon);

    const radarCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._radarTitle = this._label('noir-island-title');
    this._radarSub = this._label('noir-island-line');
    this._noEllipsis(this._radarTitle);
    this._noEllipsis(this._radarSub);
    radarCol1.add_child(this._radarTitle);
    radarCol1.add_child(this._radarSub);

    const radarInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    radarInfoBox.add_child(this._radarTile);
    radarInfoBox.add_child(radarCol1);
    this._radarCollapse.set_child(radarInfoBox);

    this._radarCarsBox = new St.BoxLayout({
      style_class: 'noir-island-radar-track',
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._radarRow.add_child(this._radarCollapse);
    this._radarRow.add_child(this._hairline());
    this._radarRow.add_child(this._radarCarsBox);
    this._radarRow.add_child(this._hairline());
    this._radarRow.add_child(this._navBox('radar'));
    island.add_child(this._radarRow);

    // --------------------------------------------------- Ferrari Ignition HUD
    this._ignitionRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._igniteCollapse = new St.Button({
      style_class: 'noir-island-pillbtn',
      x_expand: true,
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
      can_focus: false,
    });
    this._igniteCollapse.connect('clicked', () => this._collapse());

    this._igniteTile = new St.Bin({
      style_class: 'noir-island-ignite-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._igniteIcon = new St.Icon({
      icon_name: 'security-high-symbolic',
      icon_size: 20,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._igniteTile.set_child(this._igniteIcon);

    const igniteCol1 = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._igniteTitle = this._label('noir-island-title');
    this._igniteSub = this._label('noir-island-line');
    this._noEllipsis(this._igniteTitle);
    this._noEllipsis(this._igniteSub);
    igniteCol1.add_child(this._igniteTitle);
    igniteCol1.add_child(this._igniteSub);

    const igniteInfoBox = new St.BoxLayout({style_class: 'noir-island-row'});
    igniteInfoBox.add_child(this._igniteTile);
    igniteInfoBox.add_child(igniteCol1);
    this._igniteCollapse.set_child(igniteInfoBox);

    const igniteCol2 = new St.BoxLayout({
      style_class: 'noir-island-ctl',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._igniteBtn = new St.Button({
      style_class: 'noir-island-ignite-btn',
      can_focus: false,
    });
    this._igniteBtn.set_child(new St.Label({text: 'START ENGINE'}));
    this._igniteBtn.connect('clicked', () => {
      this._igniteState = this._igniteState === 'IGNITED' ? 'READY' : 'IGNITED';
      this._playSfx('ignite');
      this._fillIgnition();
    });

    igniteCol2.add_child(this._igniteBtn);

    this._ignitionRow.add_child(this._igniteCollapse);
    this._ignitionRow.add_child(this._hairline());
    this._ignitionRow.add_child(igniteCol2);
    this._ignitionRow.add_child(this._hairline());
    this._ignitionRow.add_child(this._navBox('ignition'));
    island.add_child(this._ignitionRow);
  }

  _playSfx(type) {
    try {
      const sounds = {
        click: 'button-toggle-on',
        open: 'dialog-information',
        ignite: 'audio-volume-change',
      };
      const name = sounds[type] || 'button-toggle-on';
      GLib.spawn_command_line_async(`canberra-gtk-play -i ${name}`);
    } catch (_) {}
  }

  _stepNavMode(delta) {
    const modes = [
      'media', 'telemetry', 'timer', 'radar', 'drop',
      'clip', 'cmd', 'radio', 'ignition', 'weather',
    ];
    let cur = this._cardMode || (this._state === 'media' ? 'media' : 'telemetry');
    let idx = modes.indexOf(cur);
    if (idx === -1) idx = 0;
    let nextIdx = (idx + delta + modes.length) % modes.length;
    this._cardMode = modes[nextIdx];
    this._cardOpen = true;
    this._playSfx('click');
    this._wake();
    this._render();
  }

  _navBox(currentMode) {
    const container = new St.BoxLayout({
      style_class: 'noir-island-nav-container',
      vertical: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const hintLabel = new St.Label({
      style_class: 'noir-island-nav-hint',
      text: '',
    });
    this._noEllipsis(hintLabel);

    const box = new St.BoxLayout({
      style_class: 'noir-island-nav-box',
      y_align: Clutter.ActorAlign.CENTER,
    });
    const items = [
      { id: 'media', icon: 'audio-x-generic-symbolic', label: 'MEDIA PLAYER' },
      { id: 'telemetry', icon: 'utilities-system-monitor-symbolic', label: 'TELEMETRI F1' },
      { id: 'timer', icon: 'preferences-system-time-symbolic', label: 'CHRONOGRAPH' },
      { id: 'radar', icon: 'find-location-symbolic', label: 'RADAR MONZA' },
      { id: 'drop', icon: 'folder-download-symbolic', label: 'NOTCH DROP' },
      { id: 'clip', icon: 'edit-copy-symbolic', label: 'PAPAN KLIP' },
      { id: 'cmd', icon: 'utilities-terminal-symbolic', label: 'COMMAND BAR' },
      { id: 'radio', icon: 'audio-input-microphone-symbolic', label: 'TEAM RADIO' },
      { id: 'ignition', icon: 'security-high-symbolic', label: 'SECURITY HUD' },
      { id: 'weather', icon: 'weather-clear-symbolic', label: 'METEO RACING' },
    ];
    for (const item of items) {
      const isActive = item.id === currentMode;
      const btn = new St.Button({
        style_class: `noir-island-nav-btn noir-island-nav-btn--${item.id} ${isActive ? 'noir-island-nav-btn--active' : ''}`,
        can_focus: false,
      });
      const icon = new St.Icon({
        icon_name: item.icon,
        icon_size: 11,
      });
      btn.set_child(icon);
      btn.connect('enter-event', () => {
        hintLabel.set_text(item.label);
      });
      btn.connect('leave-event', () => {
        hintLabel.set_text('');
      });
      btn.connect('clicked', () => {
        this._playSfx('click');
        this._cardMode = item.id;
        this._cardOpen = true;
        this._wake();
        this._render();
      });
      box.add_child(btn);
    }
    container.add_child(hintLabel);
    container.add_child(box);
    return container;
  }

  _hairline() {
    return new St.Widget({
      style_class: 'noir-island-hairline',
      y_align: Clutter.ActorAlign.FILL,
    });
  }

  _label(className) {
    const label = new St.Label({
      style_class: className,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._ellipsize(label, Pango.EllipsizeMode.END);
    return label;
  }

  // ClutterText memanggang ellipsize END sebagai bawaan, jadi label pendek yang
  // tidak boleh terpotong (kicker, label tombol) harus dimatikan eksplisit.
  // Properti ini tidak lewat konstruktor St.Label, hanya lewat ClutterText-nya.
  _ellipsize(label, mode) {
    const ct = label.get_clutter_text();
    if (ct)
      ct.ellipsize = mode;
    return label;
  }

  _noEllipsis(label) {
    return this._ellipsize(label, Pango.EllipsizeMode.NONE);
  }

  _iconButton(iconName, clicked, extraClass) {
    const btn = new St.Button({
      style_class: extraClass ? `noir-island-btn ${extraClass}` : 'noir-island-btn',
      child: new St.Icon({icon_name: iconName, icon_size: 16}),
      y_align: Clutter.ActorAlign.CENTER,
    });
    btn.connect('clicked', clicked);
    return btn;
  }

  _textButton(text, clicked, extraClass) {
    const btn = new St.Button({
      style_class: extraClass ? `noir-island-btn ${extraClass}` : 'noir-island-btn',
      child: this._noEllipsis(new St.Label({
        style_class: 'noir-island-btnlabel',
        text,
      })),
      y_align: Clutter.ActorAlign.CENTER,
    });
    btn.connect('clicked', clicked);
    return btn;
  }

  _setPlayIcon(status) {
    const name = status === 'Playing'
      ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    this._btnPlay.set_child(new St.Icon({icon_name: name, icon_size: 16}));
  }

  // Geometri monitor terakhir yang diketahui. primaryMonitor bisa kosong sesaat
  // (konfigurasi display berubah), dan morph yang batal diam-diam meninggalkan
  // card di ukuran state sebelumnya: log state tetap tercetak, pixel-nya tidak.
  _monitor() {
    const mon = Main.layoutManager.primaryMonitor;
    if (mon) {
      // Monitor pindah/ganti resolusi = sumbu lama tidak berlaku lagi; jangan
      // dipertahankan sampai dateMenu memberi alokasi baru.
      if (this._mon && (this._mon.x !== mon.x || this._mon.width !== mon.width))
        this._axis = null;
      this._mon = {x: mon.x, y: mon.y, width: mon.width};
    } else if (this._mon)
      log('noir-island: primaryMonitor kosong, morph pakai geometri terakhir');
    return this._mon;
  }

  // Sumbu tempat island harus menggantung: titik tengah seksi tanggal di panel,
  // bukan tengah monitor. Panel Ubuntu tidak meletakkan jam di sumbu monitor —
  // logo di kiri dan indikator di kanan menarik alokasinya — jadi rata-monitor
  // terbaca sebagai geser (terukur ~37 px di kiri jam pada 1920 px).
  //
  // Nilainya di-cache karena _setClock() menyembunyikan dateMenu begitu island
  // naik ke peek/card, dan actor tersembunyi tidak meninggalkan alokasi yang
  // bisa dibaca; tanpa cache, morph peek -> card akan menarik island kembali ke
  // tengah monitor di tengah layar.
  _clockCenter() {
    const mon = this._monitor();
    const clock = Main.panel?.statusArea?.dateMenu?.container;
    if (clock?.visible) {
      // get_allocation_box().x1 memakai koordinat orang tua (box kanan panel),
      // jadi yang terbaca di sana adalah offset di dalam panel, bukan posisi di
      // panggung. Yang satu ruang dengan geometri island adalah transform.
      const [ax] = clock.get_transformed_position();
      const c = Math.round(ax + clock.get_allocation_box().get_width() / 2);
      if (Number.isFinite(c) && c >= mon.x && c <= mon.x + mon.width) {
        this._axis = c;
        return c;
      }
    }
    return this._axis ?? Math.round(mon.x + mon.width / 2);
  }

  // Sudut kiri-atas card untuk satu lebar. Island menggantung rata di tepi
  // bawah panel, bukan melayang di bawahnya.
  _anchor(w) {
    const mon = this._monitor();
    return [
      Math.round(this._clockCenter() - w / 2),
      Math.round(mon.y + (Main.panel.height || 0)),
    ];
  }

  _place() {
    if (!this._monitor() || !this._island)
      return;
    const [x, y] = this._anchor(this._island.width || PILL_W);
    this._island.set_position(x, y);
  }

  // Lebar card bergantung pada monitor, tingginya pada posisi panel. Keduanya
  // tidak ikut tersimpan di signature, jadi perubahan tata letak memaksa render
  // berikutnya menghitung morph ulang, bukan cuma memindah actor di tempat lama.
  _relayout() {
    this._sig = null;
    this._shape = '';
    this._place();
    this._render();
  }

  // Satu sakelar untuk seluruh konsekuensi "island sedang tampil": siapa yang
  // boleh merebut klik dan apakah key line rosso menyala. Jam panel BUKAN bagian
  // dari keputusan ini — dia baru dimakan mulai level peek/card, lihat _setClock.
  _setActive(on) {
    if (this._active === on || !this._island)
      return;
    this._active = on;
    // Input region chrome ditentukan saat actor dipasang, jadi bentuknya diganti
    // dengan pasang-ulang.
    Main.layoutManager.removeChrome(this._island);
    Main.layoutManager.addChrome(this._island, {affectsInputRegion: on});
    this._island.set_reactive(on);
    this._place();
    if (on)
      this._island.add_style_class_name('noir-island--live');
    else
      this._island.remove_style_class_name('noir-island--live');
  }

  // Jam panel hanya boleh dikembalikan kalau KITA yang menyembunyikannya: Just
  // Perfection menulis actor yang sama, dan show() buta akan memaksa tampil jam
  // yang memang dimatikan user di sana.
  //
  // Yang menyembunyikannya adalah LEVEL, bukan sekadar "island sedang tampil".
  // Pill tingginya 34 px dan menggantung di bawah panel, jadi dia tidak pernah
  // bisa membaca sebagai pengganti jam; melepaskan jam panel demi pill terbukti
  // menyisakan tengah panel yang kosong. Jam baru dimakan begitu island naik ke
  // peek/card dan isinya memang setingkat jam panel.
  _setClock(show) {
    const clock = Main.panel?.statusArea?.dateMenu?.container;
    if (!clock)
      return;
    if (show) {
      if (!this._clockHiddenByUs)
        return;
      this._clockHiddenByUs = false;
      clock.show();
    } else if (!this._clockHiddenByUs) {
      this._clockHiddenByUs = true;
      clock.hide();
    }
  }

  // Banner shell dan kartu island adalah dua wajah dari satu notifikasi. Selama
  // island sanggup menampilkannya, banner diblok lewat knob resmi shell sendiri —
  // MessageTray.bannerBlocked, setter publik yang dipakai panel.js:972 untuk menu
  // yang searah banner — bukan dengan menyembunyikan actor diam-diam. Begitu
  // island kalah (fullscreen atau DND) banner kembali seperti semula.
  _syncBannerBlock() {
    // Sesudah disable(), flag bukan milik kita lagi.
    if (this._dead)
      return;
    // panel.js menulis flag yang sama buta saat menu dibuka/ditutup; selama ada
    // menu terbuka keputusan bukan kita yang boleh menang.
    if (Main.panel.menuManager?.activeMenu)
      return;
    this._blockBanner(!this._fullscreen && !this._dndOff());
  }

  // Setter-nya sendiri idempoten (bandingkan lalu pulang), jadi memanggil ini
  // tiap tick tidak memicu _updateState() berulang.
  _blockBanner(on) {
    if (Main.messageTray)
      Main.messageTray.bannerBlocked = on;
  }

  // Hover diuji per poll, tidak pernah lewat sinyal: captured-event MOTION di
  // X11 tidak terkirim ke stage saat klien memegang pointer grab, dan track-input
  // tidak tersedia di Wayland.
  _pollHover() {
    const mon = this._monitor();
    if (!mon || !this._island)
      return;
    const [x, y] = global.get_pointer();
    const now = monoMs();
    if (this._lastPointerTime > 0 && now > this._lastPointerTime) {
      const dt = (now - this._lastPointerTime) / 1000;
      if (dt > 0.05) {
        const vx = (x - this._lastPointerX) / dt;
        const vy = (y - this._lastPointerY) / dt;
        const targetGx = Math.max(-12, Math.min(12, vx * 0.008));
        const targetGy = Math.max(-12, Math.min(12, vy * 0.008));
        this._gForceX = this._gForceX * 0.7 + targetGx * 0.3;
        this._gForceY = this._gForceY * 0.7 + targetGy * 0.3;
        if (this._gForceDot)
          this._gForceDot.set_translation(Math.round(this._gForceX), Math.round(this._gForceY), 0);
      }
    }
    this._lastPointerX = x;
    this._lastPointerY = y;
    this._lastPointerTime = now;
    const bawah = mon.y + (Main.panel.height || 0);
    // Sumbu hover = sumbu tempat island benar-benar digambar, bukan tengah
    // monitor: kalau dua hal ini beda, zona bangun meleset dari bentuk yang
    // baru saja dilihat pointer.
    const dx = Math.abs(x - this._clockCenter());
    const dekat = y >= mon.y && y <= bawah + HOVER_IN_Y && dx <= HOVER_IN_X;
    const jauh = y > bawah + HOVER_OUT_Y || dx > HOVER_OUT_X;
    if (this._hoverOn) {
      this._hoverIn = 0;
      if (!jauh) {
        this._hoverOut = 0;
        return;
      }
      if (++this._hoverOut < HOVER_OUT_POLLS)
        return;
      this._hoverOut = 0;
      this._hoverOn = false;
      // Pointer pergi = mulai hitung mundur tidur di sini; selama dia masih di
      // sekitar island, _awake() menahan card tanpa perlu jam diperpanjang.
      this._wake();
      this._render();
      // Card notif dan card yang dibuka lewat klik tidak ditopang hover, jadi
      // mereka tetap bangun. Hanya pill yang boleh meleleh sekarang juga, tanpa
      // menunggu grace: hover yang pergi adalah keputusan user, bukan fluktuasi.
      if (!this._level)
        this._stow();
      return;
    }
    this._hoverOut = 0;
    if (!dekat) {
      this._hoverIn = 0;
      return;
    }
    if (++this._hoverIn < HOVER_IN_POLLS)
      return;
    this._hoverIn = 0;
    this._hoverOn = true;
    this._render();
  }

  // Lebar dan tinggi dipatok per (level, content), hanya dipangkas kalau
  // monitornya sempit. Isi tidak boleh menentukan lebar: itu yang membuat morph
  // terasa sebagai kedip (156 -> 489 px tiap ganti trek, run baseline rig) dan
  // membuat ellipsis tidak pernah bekerja, karena actor selalu selebar teksnya.
  _capFor(level, content) {
    const want = level === 'card' ? (CARD_W[content] ?? MEDIA_W)
      : (LEVEL_W[level] ?? PILL_W);
    const mon = this._monitor();
    if (!mon || !Number.isFinite(mon.width))
      return want;
    return Math.max(MIN_W, Math.min(want, Math.round(mon.width * 0.6)));
  }

  _heightFor(level, content) {
    return level === 'card' ? (CARD_H[content] ?? CARD_H.media) : PILL_H;
  }

  // Level adalah efek samping dari isi, pointer, klik, dan timer peek — bukan
  // state baru. Prioritas NOTIF > MEDIA > IDLE tetap diputuskan _decideState().
  // Card media hanya lewat klik; card notif selalu penuh karena notifikasi
  // adalah interupsi yang membawa tombolnya sendiri. Null = tidak ada yang boleh tampil.
  _levelFor(content) {
    if (content === 'notif')
      return 'card';
    if (content === 'media') {
      const bangun = this._awake();
      if (this._cardOpen && bangun)
        return 'card';
      if (bangun && monoMs() < this._peekUntil)
        return 'peek';
      // Pill media tidak lagi bersyarat pointer: yang dijeda harus tetap bisa
      // diklik — tapi hanya selama island masih bangun. Jam idle yang jatuh
      // membuat pill ikut tidur; pointer yang datang lagi mengumpulkannya.
      if (this._opt.persistentPill && bangun)
        return 'pill';
      return this._hoverOn ? 'pill' : null;
    }
    if (content === 'weather' || content === 'telemetry' || content === 'timer' ||
        content === 'drop' || content === 'clip' || content === 'cmd' || content === 'radio' ||
        content === 'radar' || content === 'ignition') {
      const bangun = this._awake();
      return (this._cardOpen && bangun) ? 'card' : (this._hoverOn ? 'pill' : null);
    }
    if (content === 'idle') {
      const bangun = this._awake();
      if (this._cardOpen && bangun)
        return 'card';
    }
    return this._hoverOn || this._privacy() ? 'pill' : null;
  }

  // Ada aksi baru = island boleh menempel lagi `idle-hide-ms`. Hitung mundurnya
  // dimulai dari sekarang, bukan dari sisa jam sebelumnya, supaya pointer yang
  // mondar-mandir di dekat panel tidak pernah kehabisan jatah.
  _wake() {
    if (!this._opt.idleHide)
      return;
    this._wakeUntil = monoMs() + this._opt.idleHide;
  }

  // idleHide = 0 berarti tidak pernah tidur: pill persisten seperti sebelumnya.
  _awake() {
    return !this._opt.idleHide || this._hoverOn || monoMs() < this._wakeUntil;
  }

  // Isi = sesuatu yang boleh tampil (aturan ada di _decideState) plus notifikasi
  // yang masih mengantre, karena pill +N menahan jejaknya, plus pointer yang
  // sedang berdiri dekat panel: tanpa clause terakhir, grace _tick() akan
  // menidurkan pill jam di tengah hover. Clause privacy adalah pengecualian
  // sadar atas doktrin TIER 29 — lihat _privacy().
  _hasContent(player) {
    return this._decideState(player) !== 'idle' || this._pending.length > 0 ||
      this._hoverOn || this._privacy();
  }

  // Mundur ke dalam panel: tinggi menyusut ke 0 sambil seluruh card memudar,
  // lalu actor dimatikan. Row-row dihapus dari layout sebelum menyusut karena
  // Clutter tidak memotong anak — teks setinggi 67 px di dalam card setinggi
  // 0 px akan mencuat ke atas, ke area panel.
  _stow() {
    if (this._stowed || !this._island)
      return;
    this._stowed = true;
    this._stowAt = 0;
    this._cardOpen = false;
    this._cardMode = null;
    // Habis tidur, render berikutnya wajib menggambar lagi walau isinya sama
    // persis: actor-nya sendiri baru saja dimatikan.
    this._sig = null;
    this._armOutside(false);
    this._setActive(false);
    this._setClock(true);
    for (const row of [this._pillRow, this._mediaRow, this._notifRow, this._weatherRow, this._telemetryRow, this._timerRow, this._dropRow, this._clipRow, this._cmdRow, this._radioRow, this._radarRow, this._ignitionRow, this._progress])
      if (row) row.visible = false;
    const [x, y] = this._anchor(this._island.width);
    this._island.ease({
      height: 0,
      x,
      y,
      opacity: 0,
      duration: STOW_MS,
      mode: Clutter.AnimationMode.EASE_IN_QUART,
      onComplete: () => {
        // Bisa sudah dibatalkan _unstash sebelum animasi ini selesai.
        if (this._stowed && this._island)
          this._island.visible = false;
      },
    });
    log('noir-island: stow');
  }

  _unstash(w, h, x, y) {
    if (!this._stowed)
      return;
    this._stowed = false;
    this._stowAt = 0;
    const island = this._island;
    // Sisa transisi _stow() masih menggenggam opacity dan tinggi actor. Kalau
    // tidak dilepas, island naik dengan opacity 0: tetap teralokasi dan tetap
    // terbaca sebagai SHOWING, tapi tidak satu pun pixel-nya tampil.
    island.remove_all_transitions();
    island.visible = true;
    island.set_opacity(255);
    island.set_size(w, h);
    island.set_position(x, y);
    log('noir-island: unhide');
  }

  _animateTo(level, content) {
    const mon = this._monitor();
    if (!mon)
      return;
    const w = this._capFor(level, content);
    const h = this._heightFor(level, content);
    const [x, y] = this._anchor(w);
    // Geometri ikut dicetak di log morph: tanpa ini island yang teralokasi di
    // luar layar / opacity 0 tidak bisa dibedakan dari island yang tidak jalan.
    // sumbu = titik tengah seksi tanggal yang jadi acuan x, supaya rig bisa
    // membuktikan island rata di bawah jam dan bukan di tengah monitor.
    this._geo = `${w}x${h} @${x},${y} panel=${Math.round(Main.panel.height || 0)} sumbu=${this._clockCenter()}`;
    this._progW = Math.max(0, w - 2 * PROG_INSET);
    const wasStowed = this._stowed;
    this._unstash(w, h, x, y);

    const startW = this._island.width || w;
    const startH = this._island.height || h;
    const diffW = w - startW;
    const diffH = h - startH;

    if (!wasStowed && (Math.abs(diffW) > 10 || Math.abs(diffH) > 6)) {
      const dur = 180;
      const t0 = monoMs();
      if (this._bloomTimerId) {
        GLib.source_remove(this._bloomTimerId);
        this._bloomTimerId = 0;
      }
      this._bloomTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RAMP_MS, () => {
        if (!this._island || this._dead || this._stowed) {
          this._bloomTimerId = 0;
          return GLib.SOURCE_REMOVE;
        }
        const p = Math.min(1, Math.max(0, monoMs() - t0) / dur);
        const l = 1 - (1 - p) * (1 - p);
        const curW = Math.round(startW + diffW * l);
        const curH = Math.round(startH + diffH * l);
        const [curX, curY] = this._anchor(curW);
        this._island.set_size(curW, curH);
        this._island.set_position(curX, curY);
        const pw = Math.max(0, curW - 2 * PROG_INSET);
        this._progress.set_size(pw, PROGRESS_H);
        if (p >= 1) {
          this._bloomTimerId = 0;
          this._island.set_size(w, h);
          this._island.set_position(x, y);
          this._progress.set_size(this._progW, PROGRESS_H);
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    } else {
      this._island.set_size(w, h);
      this._island.set_position(x, y);
      this._progress.set_size(this._progW, PROGRESS_H);
    }

    this._fadeTo(level, content);
    this._setActive(true);
    this._setClock(level === 'pill');
    this._armOutside(level === 'card' && (content === 'media' || content === 'weather' || content === 'telemetry' || content === 'timer' || content === 'drop' || content === 'clip' || content === 'cmd' || content === 'radio' || content === 'radar' || content === 'ignition'));
  }

  // Teks yang muncul mendadak di tengah morph ukuran terlihat pop. Isi state
  // baru dinaikkan opacity-nya telat, setelah card hampir selesai melebar —
  // pola island yang tumbuh dulu baru menampilkan isinya.
  _fadeTo(level, content) {
    const rows = level !== 'card' ? [this._pillRow]
      : content === 'notif' ? [this._notifRow]
      : content === 'weather' ? [this._weatherRow]
      : content === 'telemetry' ? [this._telemetryRow]
      : content === 'timer' ? [this._timerRow]
      : content === 'drop' ? [this._dropRow]
      : content === 'clip' ? [this._clipRow]
      : content === 'cmd' ? [this._cmdRow]
      : content === 'radio' ? [this._radioRow]
      : content === 'radar' ? [this._radarRow]
      : content === 'ignition' ? [this._ignitionRow]
      : [this._mediaRow, this._progress];
    for (const row of rows) {
      if (!row)
        continue;
      this._rampTo(row, TULIS_OPACITY, 255,
        {dari: 0, tunda: Math.round(ANIM_MS * 0.35), dur: FADE_MS});
    }
  }

  // Clutter.ease() tidak boleh dipakai untuk apa pun yang nilainya harus
  // mendarat. Terbukti live di sesi Wayland mesin ini: transisi yang dibuat pada
  // frame yang sama dengan perubahan ukuran actor hilang tanpa meninggalkan
  // nilai akhirnya — opacity baris tetap 0 pada t=400 ms sementara transisinya
  // sudah tidak ada, padahal ease yang sama pada actor yang sudah tenang naik ke
  // 255 (A/B: noir-AB t400 op=0 trans=false → t950 easeTANPA-delay op=255).
  // Morph island SELALU mengubah ukuran di frame itu, jadi isinya tidak pernah
  // tergambar di mesin user. Rig X11 lolos karena di sana transisinya jalan, dan
  // assertion-nya cuma menghitung pixel non-hijau: badan card sudah cukup
  // memenuhi ambang walau teksnya nol pixel.
  //
  // Yang terbukti tetap berdetak di sini hanya GLib main loop (lihat _tick), dan
  // set_opacity/set_size langsung tergambar. Jadi transisi dirakit sendiri: satu
  // timer untuk semua ramp, berhenti saat tidak ada yang tersisa.
  _rampTo(actor, tulis, target, {dari = 0, tunda = 0, dur = FADE_MS} = {}) {
    this._ramps ??= new Set();
    for (const r of this._ramps) {
      if (r.actor === actor && r.tulis === tulis) {
        this._ramps.delete(r);
        break;
      }
    }
    const r = {
      actor, tulis, awal: dari, target, dur, mulai: monoMs() + tunda,
    };
    this._ramps.add(r);
    tulis(actor, dari);
    if (!this._rampId)
      this._rampId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RAMP_MS,
        () => this._stepRamps());
  }

  _stepRamps() {
    const kini = monoMs();
    for (const r of this._ramps) {
      const p = Math.min(1, Math.max(0, kini - r.mulai) / r.dur);
      // EASE_OUT yang mendekati bentuk lama: cepat di muka, melambat di ujung.
      const l = 1 - (1 - p) * (1 - p);
      r.tulis(r.actor, r.awal + (r.target - r.awal) * l);
      if (p >= 1)
        this._ramps.delete(r);
    }
    if (this._ramps.size)
      return GLib.SOURCE_CONTINUE;
    this._rampId = 0;
    return GLib.SOURCE_REMOVE;
  }

  // ------------------------------------------------------------------ render

  // Klik pill = minta card penuh. Sekaligus membatalkan pengumuman peek: user
  // sudah melihat cukup untuk memutuskan sendiri.
  _expand() {
    if (this._level === 'card')
      return;
    this._cardOpen = true;
    this._peekUntil = 0;
    this._forced = true;
    this._wake();
    this._render();
  }

  _collapse() {
    if (!this._cardOpen)
      return;
    this._cardOpen = false;
    this._cardMode = null;
    // Menyusut karena klik adalah aksi user: jam idle mulai ulang supaya pill
    // tidak ikut lenyap di tangan yang baru saja menutup card-nya.
    this._wake();
    this._render();
  }

  // Card media ditutup oleh tekanan pointer di mana pun di luar island. Preseden
  // yang sama dipakai noir-rail: tanpa pushModal, karena grab yang lupa dilepas
  // membuat desktop tidak bisa diklik sampai logout — terlalu mahal untuk
  // kenyamanan ini. Kartu notif tidak ikut dipantau: dia punya hold dan tombolnya
  // sendiri.
  _armOutside(on) {
    if (on && !this._outsideId) {
      this._outsideId = global.stage.connect('captured-event', (stage, event) => {
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            !this._overIsland(event))
          this._collapse();
        return false;
      });
    } else if (!on && this._outsideId) {
      global.stage.disconnect(this._outsideId);
      this._outsideId = 0;
    }
  }

  // Sumber event bisa null (tekanan sintetis/latar), jadi yang diuji geometri
  // actor-nya, bukan sumber event — sama seperti noir-rail.
  _overIsland(event) {
    if (!this._island || !this._island.visible)
      return true;
    const [x, y] = event.get_coords();
    const [ax, ay] = this._island.get_transformed_position();
    const [aw, ah] = this._island.get_transformed_size();
    if (![ax, ay, aw, ah].every(Number.isFinite))
      return true;
    return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
  }

  // Versi tanpa event dari uji yang sama: _tick() tidak memegang event, jadi
  // yang dibaca adalah posisi pointer hasil query. Island yang sedang tertidur
  // (visible false) tidak pernah menahan apa pun.
  _pointerOverIsland() {
    if (!this._island || !this._island.visible)
      return false;
    const [x, y] = global.get_pointer();
    const [ax, ay] = this._island.get_transformed_position();
    const [aw, ah] = this._island.get_transformed_size();
    if (![ax, ay, aw, ah].every(Number.isFinite))
      return false;
    return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
  }

  // ---------------------------------------------------------------- ambient
  // Slot ambient adalah isi pil saat tidak ada notifikasi dan tidak ada trek.
  // Dia bukan state baru: _decideState() tetap menyebutnya 'idle', yang berubah
  // hanya siapa yang mengisi teksnya.
  //
  // Urutan array = prioritas, dan hanya satu yang menang. Tidak ada rotasi
  // otomatis: konten yang muncul sendiri tanpa diminta adalah alasan orang
  // mematikan fitur (Apple HIG Live Activities), dan rotasi menuntut jam kedua
  // yang tidak mau kita bayar.
  //
  // Kontraknya sengaja tiga hal. nilai() adalah satu-satunya alasan pil berubah
  // — perbandingan itu sudah ada di kunci lukisan _render(), jadi ambang "hanya
  // kalau berubah" tidak perlu ditulis ulang per sumber. kicker() memutuskan
  // apakah sumber itu boleh membawa jam (sumber ambient tidak mewarisi jam
  // default; dulu pil idle selalu menampilkan angka yang sama dengan yang 30 px
  // di atasnya). enabled() adalah sakelar user.
  _providers() {
    return this._providerList ??= [
      {
        id: 'mic',
        enabled: () => this._privacy(),
        kicker: () => false,
        // Aplikasi, bukan sekadar "mikrofon": dot privacy di kanan atas sudah
        // mengatakan BAHWA ada yang merekam; yang tidak bisa ia katakan adalah
        // SIAPA. Nilainya disiapkan _syncMic(), tidak dipindai saat render.
        nilai: () => this._micLabel,
      },
      {
        id: 'agenda',
        enabled: () => this._opt.ambientAgenda,
        kicker: () => false,
        // Jam acara adalah bagian dari nilainya, bukan dari kicker: slot kicker
        // adalah jam SEKARANG, dan menaruh jam sekarang di sebelah jam sekarang
        // yang sudah ada di panel adalah persis duplikasi yang bikin
        // ambient-clock dimatikan.
        nilai: () => this._agendaLabel,
      },
      {
        id: 'weather',
        enabled: () => this._opt.ambientWeather,
        kicker: () => false,
        // "26° Light rain": angka + kondisi, tanpa nama kota. Ringkasan milik
        // libgweather selalu diawali "Jakarta: ", dan kota adalah satu-satunya
        // bagian yang sudah pasti diketahui user — di pil 240 px ia hanya
        // memakan tempat yang lebih berguna untuk suhunya.
        nilai: () => this._weatherLabel,
      },
      {
        id: 'clock',
        enabled: () => this._opt.ambientClock,
        kicker: () => true,
        // Tanggal, bukan menit: menit sudah ikut ke kunci lukisan pill lewat
        // `jam`, jadi memasukkannya ke sini hanya membuat signature isi berganti
        // tiap 60 dtk seolah ada yang baru.
        nilai: () => GLib.DateTime.new_now_local().format('%a %d %b'),
      },
    ];
  }

  // Provider yang boleh tampil sekarang: yang pertama enabled() dan punya nilai.
  _ambient() {
    for (const p of this._providers())
      if (p.enabled() && p.nilai())
        return p;
    return null;
  }

  // Tenant privacy. Gvc jalan di DALAM proses shell — typelib-nya ikut paket
  // gnome-shell dan menu volume sudah lebih dulu memakainya — jadi "ada yang
  // merekam" adalah sinyal yang datang, bukan keadaan yang harus ditanya: tanpa
  // subprocess, tanpa polling, dan tanpa 6,6 MB pw-dump tiap beberapa detik.
  // Kamera sengaja TIDAK lewat sini: tidak ada sinyal in-proses untuknya.
  _startMic() {
    // Batas eksternal: MixerControl adalah koneksi ke server suara — ia bisa
    // gagal (typelib beda, PipeWire tidak jalan, sesi headless). Harganya pernah
    // terukur: enable() melempar SEBELUM _tick() dipasang, jadi island hidup
    // separuh — kartu notifikasi tergambar tapi tidak pernah maju atau tidur —
    // dan rig merah 13 tes sambil terlihat hidup. Satu tenant tidak boleh bisa
    // mematikan seluruh island.
    try {
      this._mixer = Gvc.MixerControl.new('noir-island');
      this._on(this._mixer, 'stream-added', () => this._syncMic());
      this._on(this._mixer, 'stream-removed', () => this._syncMic());
      // open() dan jumlah stream dicetak sekali di sini: tanpa baris ini, rig
      // tidak bisa membedakan "mixer tidak terhubung" dari "terhubung tapi tidak
      // pernah melihat rekaman" — dan obat untuk keduanya beda.
      const buka = this._mixer.open();
      log(`noir-island: mixer buka=${buka} `
        + `stream=${(this._mixer.get_source_outputs() ?? []).length}`);
      this._syncMic();
    } catch (e) {
      this._mixer = null;
      log(`noir-island: Gvc mati: ${e.message}`);
    }
  }

  // Source-output = stream yang MEMBACA sebuah sumber. TANPA filter state, dan
  // itu terukur bukan diasumsikan: pipewire-pulse melaporkan stream-nya sebagai
  // GVC_STREAM_STATE_INVALID dan is_running() False padahal rekaman sedang
  // berjalan (probe pw-record: 8 baris state=INVALID running=False, lalu 0 stream
  // setelahnya). Menyaring pada state akan membunuh tenant ini diam-diam — persis
  // kegagalan R6 pertama. Yang tersisa hanyalah keberadaan stream, dan itu cukup:
  // dia lahir saat ada yang merekam dan mati saat berhenti.
  _recorder() {
    if (!this._mixer)
      return null;
    return (this._mixer.get_source_outputs() ?? [])[0] ?? null;
  }

  // Yang diisi server suara untuk stream rekaman: application_id kosong untuk
  // klien PipeWire (terukur: None), get_name() berisi nama klien — 'PW-CAT' untuk
  // pw-record, 'Firefox' untuk peramban. ID D-Bus/flatpak dipotong ke nama paling
  // kanan supaya muat di pil 240 px.
  _micApp(s) {
    const id = String(s.get_application_id() ?? '');
    const dariId = id.split('.').filter(x => x && !/^\d+$/.test(x)).pop();
    return String(dariId || s.get_name() || 'Mikrofon').toUpperCase();
  }

  // Edge-trigger: yang membangunkan island hanyalah perpindahan tidak-ada ->
  // ada. Stream yang lahir dan mati beruntun (ganti device, stream dipindah)
  // tidak boleh jadi kedip, dan matinya rekaman tidak boleh menambah jatah bangun.
  _syncMic() {
    const s = this._recorder();
    const sebelum = this._micOn;
    if (s && !sebelum)
      this._wake();
    this._micOn = !!s;
    // Label dihitung di sini, bukan di dalam nilai(): _render() berjalan tiap
    // 500 dtk, dan memindai daftar stream setiap kali artinya membayar kembali
    // polling yang baru saja kita hindari dengan memakai Gvc.
    this._micLabel = s ? `MIK ${this._micApp(s)}` : '';
    // Hanya perpindahan yang dicetak: "pil tidak bangun" dan "mixer tidak pernah
    // mendapat sinyal" terbaca sama di layar, dan yang pertama itu bug island
    // sementara yang kedua bukan.
    if (!!s !== sebelum)
      log(`noir-island: mic ${s ? `nyala ${this._micLabel}` : 'mati'}`);
    this._render();
  }

  // Satu-satunya ambient yang boleh menghitung sebagai ISI. Doktrin TIER 29
  // melarang provider menahan island di liangnya karena konten yang muncul
  // sendiri tanpa diminta adalah alasan orang mematikan fitur; keadaan "mic
  // sedang dipakai" bukan konten, dia peringatan.
  _privacy() {
    return this._micOn && this._opt.ambientMic;
  }

  // -------------------------------------------------------------------- agenda
  // Tenant agenda. Sama seperti Gvc, dia dibungkus try/catch: satu tenant tidak
  // boleh bisa mematikan seluruh island, dan pelajaran dari mic adalah lemparan
  // di dalam enable() terjadi SEBELUM _tick() dipasang — island hidup separuh
  // tanpa satu pun pesan yang menunjuk ke penyebabnya.
  _startAgenda() {
    try {
      this._agendaProxy = Gio.DBusProxy.new_sync(Gio.DBus.session,
        Gio.DBusProxyFlags.NONE, null, CAL_NAME, CAL_PATH, CAL_IFACE, null);
    } catch (e) {
      this._agendaProxy = null;
      log(`noir-island: agenda mati: ${e.message}`);
      return;
    }
    this._on(this._agendaProxy, 'g-signal', (p, sender, member, params) =>
      this._onAgenda(member, params));
    // Servernya di-aktif-on-demand. Kalau nama belum punya pemilik saat
    // enable(), jangan menyerah: _askAgenda() dipanggil lagi dari celah
    // hitungan menit di _tick().
    if (this._agendaProxy.g_name_owner)
      this._askAgenda();
  }

  // Kebijakan (b): satu kali melebarkan, tidak pernah menyempitkan, tidak pernah
  // mengulang. force_reload sengaja True — tanpa itu server yang sudah pernah
  // dipakai menu tanggal tidak mengirim isinya kepada kita.
  _askAgenda() {
    if (this._agendaAsked || !this._agendaProxy?.g_name_owner)
      return;
    this._agendaAsked = true;
    const now = Math.floor(GLib.DateTime.new_now_local().to_unix());
    this._agendaProxy.call('SetTimeRange',
      new GLib.Variant('(xxb)', [now - CAL_BEHIND_S, now + CAL_AHEAD_S, true]),
      Gio.DBusCallFlags.NONE, CAL_ASK_TIMEOUT_MS, null, (proxy, res) => {
        try {
          proxy.call_finish(res);
          log(`noir-island: agenda rentang=${CAL_BEHIND_S}..${CAL_AHEAD_S / 86400}h`);
        } catch (e) {
          // Gagal = belum ditanya. Buka pintu untuk percobaan menit berikutnya.
          this._agendaAsked = false;
          log(`noir-island: agenda gagal: ${e.message}`);
        }
      });
  }

  // unpack() mengembalikan Variant bersarang untuk tipe kompleks (terukur di
  // gjs 1.80: isi[0] bertipe "variant of type a(ssxxa{sv})", bukan array), jadi
  // yang dipakai deep_unpack() — sama seperti yang dilakukan menu tanggal shell.
  _onAgenda(member, params) {
    const isi = params.deep_unpack();
    if (member === 'EventsAddedOrUpdated') {
      for (const [id, ringkas, mulai, akhir] of isi[0])
        this._agenda.set(id, {ringkas, mulai, akhir});
    } else if (member === 'EventsRemoved') {
      for (const id of isi[0])
        this._dropAgenda(id);
    } else if (member === 'ClientDisappeared') {
      this._dropAgenda(`${isi[0]}\n`);
    } else {
      return;
    }
    this._syncAgenda();
  }

  // Id event dari server adalah `uid_sumber\nuid_event\n`, jadi pembersihan
  // bekerja per prefiks: satu sumber yang hilang sekaligus membuang seluruh
  // acaranya (aturan yang sama dipakai menu tanggal shell).
  _dropAgenda(prefiks) {
    for (const id of [...this._agenda.keys()])
      if (id.startsWith(prefiks))
        this._agenda.delete(id);
  }

  // Yang diambil bukan "acara hari ini" tapi acara pertama yang BELUM lewat:
  // 08.00-09.00 yang masih terdaftar jam 10.00 adalah noise, sementara rapat
  // yang sedang berlangsung justru masih layak dibaca.
  _nextEvent() {
    const now = Math.floor(GLib.DateTime.new_now_local().to_unix());
    let pilih = null;
    for (const e of this._agenda.values()) {
      if (e.akhir <= now)
        continue;
      if (!pilih || e.mulai < pilih.mulai)
        pilih = e;
    }
    return [pilih, now];
  }

  _syncAgenda() {
    const [e, now] = this._nextEvent();
    const baru = e ? this._formatAgenda(e, now) : '';
    // Sama seperti provider lain: hanya nilai yang berubah yang boleh memanggil
    // _render(). Island TIDAK dibangunkan di sini — agenda bukan peringatan,
    // dan doktrin TIER 29 tetap berlaku untuk dia.
    if (baru === this._agendaLabel)
      return;
    this._agendaLabel = baru;
    this._render();
  }

  // Semua hari dihitung dari tengah malam LOKAL: VALUE=DATE 20261025 terukur
  // datang sebagai 1792861200 = 00:00 WIB, bukan 00:00 UTC. Dari selisih
  // hari inilah "BSK" dan ambang seharian disimpulkan — server tidak mengirim
  // flag apa pun (additional tetap {} walau LOCATION/CATEGORIES/VALARM diisi).
  _formatAgenda(e, now) {
    const mulai = GLib.DateTime.new_from_unix_local(e.mulai);
    const zona = mulai.get_utc_offset();
    const hari = Math.floor((e.mulai + zona) / 86400) -
      Math.floor((now + zona) / 86400);
    const seharian = e.akhir - e.mulai >= 86400 &&
      mulai.get_hour() === 0 && mulai.get_minute() === 0;
    const awal = hari <= 0 ? '' : hari === 1 ? 'BSK ' : `${mulai.format('%d/%m')} `;
    const jam = seharian ? '' : `${mulai.format('%H:%M')} `;
    return `${awal}${jam}${e.ringkas}`.trim();
  }

  // -------------------------------------------------------------------- cuaca
  // Tenant cuaca. try/catch-nya wajib seperti dua tenant sebelumnya, dan dia
  // menambah satu keadaan yang harganya harus NOL: lokasi belum diisi. Itulah
  // kenapa Info tidak pernah dibangun sebelum ada koordinat — terukur,
  // update() tanpa lokasi kembali dalam 0 dtk, tidak pernah menurunkan
  // 'updated', dan tidak menyentuh jaringan sama sekali.
  _startWeather() {
    if (this._weatherInfo) {
      this._weatherInfo.abort();
      this._weatherInfo.run_dispose();
      this._weatherInfo = null;
    }
    this._weatherLabel = '';
    this._weatherCityName = null;
    const [teks, city] = this._weatherLoc();
    if (!teks) {
      log('noir-island: cuaca tanpa lokasi');
      this._render();
      return;
    }
    if (!city) {
      log(`noir-island: cuaca lokasi tidak sah: "${teks}"`);
      this._render();
      return;
    }
    try {
      this._weatherCityName = city.get_city_name();
      this._weatherInfo = new GWeather.Info({
        application_id: 'noir.island.Weather',
        contact_info: 'noir-island@arkan (extension GNOME Shell, mesin lokal)',
        enabled_providers: WEATHER_PROVIDERS,
      });
      this._weatherInfo.set_location(city);
      this._on(this._weatherInfo, 'updated', () => this._syncWeather());
      log(`noir-island: cuaca kota=${this._weatherCityName} ${teks}`);
      this._refreshWeather();
    } catch (e) {
      this._weatherInfo = null;
      this._weatherCityName = null;
      log(`noir-island: cuaca mati: ${e.message}`);
      this._render();
    }
  }

  // "lat,lon" adalah satu-satunya format yang harus dihafal. Bentuk serian
  // milik shell (org.gnome.shell.weather locations, av dari "(uv)") sengaja
  // tidak dipakai: isinya opaque, tidak stabil lintas versi libgweather, dan
  // menguncinya berarti ikut membaca setting internal shell.
  _weatherLoc() {
    // get_string() di GJS 1.80 mengembalikan string BIASA, bukan [ok, nilai]:
    // indeks [1] pada "-6.2,106.8" adalah karakter '6', dan rig membacanya sebagai
    // lokasi tidak sah. Bentuk get_value().unpack() sama seperti _syncOpts().
    const teks = String(this._settings.get_value('weather-location').unpack() ?? '').trim();
    if (!teks)
      return [teks, null];
    const [lat, lon] = teks.split(',').map(x => parseFloat(x));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return [teks, null];
    return [teks, GWeather.Location.get_world().find_nearest_city(lat, lon)];
  }

  // Yang dibatasi adalah umur DATA, bukan umur panggilan: ambang 10 menit di
  // bawah kedaluwarsa met.no (±31 menit) berarti sebagian celah menit dijawab
  // cache dalam proses. Saat fetch gagal, get_value_update() kembali false dan
  // umurnya jadi -1 — itu pintu retry menit berikutnya, bukan jalan keluar.
  // Tidak perlu flag "sedang di udara": tiga update() beruntun sebelum satu pun
  // 'updated' terukur hanya menghasilkan satu connect(:443), jadi libgweather
  // sudah menjaganya sendiri.
  _refreshWeather() {
    if (!this._weatherInfo)
      return;
    const [has, epoch] = this._weatherInfo.get_value_update();
    const now = Math.floor(GLib.DateTime.new_now_local().to_unix());
    if (has && now - epoch >= 0 && now - epoch < WEATHER_STALE_S)
      return;
    this._weatherInfo.update();
  }

  _syncWeather() {
    const baru = this._weatherText();
    // Dua kata kunci yang berbeda untuk dua hasil yang di layar terbaca sama:
    // "cuaca ->" adalah data yang mendarat, "cuaca gagal" adalah jaringan/provider
    // yang menolak. Rig menuntut yang pertama dan membedakan penyebabnya lewat
    // yang kedua, tanpa perlu menebak dari panjang baris.
    log(`noir-island: cuaca ${baru ? `-> "${baru}"` : `gagal (${this._weatherError()})`}`);
    if (baru === this._weatherLabel)
      return;
    this._weatherLabel = baru;
    // Tidak ada _wake() di sini: cuaca bukan peringatan. Dia hanya menggantikan
    // tulisan pil ketika pil sudah bangun (doktrin TIER 29).
    this._render();
  }

  _weatherError() {
    const e = this._weatherInfo?.network_error();
    if (e)
      return e.message;
    return String(this._weatherInfo?.get_weather_summary() ?? '') || 'tidak valid';
  }

  // Sumber angkanya penting: get_temp()/get_pressure()/get_wind() mengabaikan
  // unit yang diminta dan mengikuti KONVENSI LOKASI (terukur: Jakarta menghasilkan
  // "79.0 °F" dan "29.86 inHg"), dan schema org.gnome.system.units memang tidak
  // ada di Ubuntu ini — jadi satu-satunya jalan keluar adalah memformat sendiri
  // dari get_value_temp(CENTIGRADE). get_conditions()/get_value_conditions()
  // juga terukur kosong untuk MET_NO (flags=0), sehingga nuansa hujan hanya ada
  // di teks ringkasan — itu yang dipakai, dipotong dari depan "Jakarta: ".
  _weatherText() {
    const i = this._weatherInfo;
    if (!i || !i.is_valid())
      return '';
    const [has, t] = i.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
    // Sky INVALID (-1, bukan 0) berarti MET_NO mengirim suhu jam ini TANPA
    // kondisi: terukur di rig, labelnya lahir sebagai "27° Unknown" padahal
    // get_sky()=-1 dan forecast_list[0] epoch=0 + "Retrieval failed". "Unknown"
    // di pil 240 px adalah kata yang mengklaim sesuatu yang tidak kita tahu,
    // jadi yang tersisa hanyalah angkanya.
    const buta = i.get_sky() === GWeather.Sky.INVALID;
    let teks = '';
    if (!buta) {
      teks = String(i.get_weather_summary() ?? '');
      const pisah = teks.indexOf(': ');
      if (pisah >= 0)
        teks = teks.slice(pisah + 2);
      if (teks === 'Unknown')
        teks = '';
    }
    if (!has)
      return teks.trim();
    return `${Math.round(t)}° ${teks}`.trim();
  }

  // Satu-satunya tempat yang memutuskan state mana yang BOLEH tampil. Aturan
  // "isi" di _hasContent() harus dibaca dari sini, bukan dari daftarnya sendiri:
  // dulu trek Playing di bawah jendela fullscreen ditolak di sini tapi tetap
  // dihitung isi, sehingga jam mundur stow tidak pernah mulai dan island duduk
  // sebagai pill sampai treknya berhenti.
  _decideState(player) {
    if (this._showing && !this._dndOff()) {
      const critical = this._showing.n.urgency >= Urgency.CRITICAL;
      return !this._fullscreen || critical ? 'notif' : 'idle';
    }
    // Jeda tetap dihitung isi. Island adalah remote: remote yang hilang begitu
    // musik berhenti tidak bisa dipakai menekan Play lagi — dan di Wayland tidak
    // ada OSD lain yang menggantikannya.
    const ada = player && (player.status === 'Playing' ||
      (this._opt.showPaused && player.status === 'Paused'));
    return ada && !this._fullscreen ? 'media' : 'idle';
  }

  // Hasil _decideState boleh ditahan sebentar sebelum benar-benar diterima.
  // Yang lolos tanpa menunggu: bangun dari kosong, notifikasi apa pun, dan
  // perintah user. Yang ditahan adalah penurunan (notif -> media, media -> idle)
  // — persis jalur yang dipakai player yang flap Playing/Paused untuk membuat
  // card unfold-stow tanpa henti.
  _debounceState(next) {
    const now = monoMs();
    if (next === this._state) {
      this._wantState = null;
      return next;
    }
    if (this._forced || this._stowed || this._state === 'idle' || next === 'notif') {
      this._forced = false;
      this._wantState = next;
      this._wantAt = now;
      return next;
    }
    if (this._wantState !== next) {
      this._wantState = next;
      this._wantAt = now;
    }
    const sisa = DWELL_MS - (now - this._wantAt);
    if (sisa > 0) {
      // _render() tidak dipanggil tiap tick, jadi kandidat yang sedang ditahan
      // harus punya alarm sendiri; tanpa ini kartu notif menggantung selamanya
      // setelah hold-nya kedaluwarsa.
      if (!this._dwellId) {
        this._dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(sisa), () => {
          this._dwellId = 0;
          this._render();
          return GLib.SOURCE_REMOVE;
        });
      }
      return this._state;
    }
    return next;
  }

  // Ringkasan isi yang akan tampil. Yang TIDAK ikut: posisi progres dan label
  // waktu (disuapi _tick() langsung, tanpa lewat render), geometri monitor
  // (dibersihkan lewat _relayout), dan badge antrean (hanya angka di sudut, bukan
  // pengumuman — lihat kunci lukisan di _render). Jam masuk sebagai menit,
  // bukan detik.
  _signature(player, state) {
    if (state === 'notif') {
      const {src, n} = this._showing;
      return `notif|${src?.title ?? ''}|${n.title}|${n.body}|${n.urgency}`;
    }
    if (state === 'media') {
      const m = player.meta;
      return `media|${m.title}|${m.artist}|${m.album}|${player.status}`
        + `|${player.canPrev}${player.canNext}|${m.key ?? m.title}`;
    }
    if (state === 'weather') {
      return `weather|${this._weatherCityName ?? ''}|${this._weatherLabel}`;
    }
    if (state === 'telemetry') {
      return `telemetry|${Math.round(this._cpuUsage)}|${this._memUsedText}|${this._netRxText}`;
    }
    if (state === 'timer') {
      return `timer|${this._timerMode}|${this._timerRunning}|${Math.floor(this._timerAccum / 1000)}`;
    }
    if (state === 'drop') {
      return `drop|${this._droppedFiles.length}|${this._droppedFiles[0]?.name ?? ''}`;
    }
    if (state === 'clip') {
      return `clip|${this._clipStack.length}|${this._clipStack[0] ?? ''}`;
    }
    if (state === 'cmd') {
      return `cmd|${this._cmdOutput}`;
    }
    if (state === 'radio') {
      return `radio|${this._micOn}|${this._radioDuration}`;
    }
    if (state === 'radar') {
      return `radar|${this._radarCarsBox?.get_n_children?.() ?? 0}`;
    }
    if (state === 'ignition') {
      return `ignition|${this._igniteState}`;
    }
    const p = this._ambient();
    this._ambientId = p?.id ?? '-';
    this._ambientNilai = p ? p.nilai() : '';
    const resting = player?.meta?.title ? player : null;
    return `idle|${this._ambientId}|${this._ambientNilai}`
      + `|${resting ? resting.meta.title : ''}`;
  }

  _render() {
    if (!this._island || this._dead)
      return;
    // Keputusan banner didahulukan dari keputusan kartu: selama island sanggup
    // jadi wajah notifikasi, shell tidak boleh menampilkan yang kedua — dan itu
    // berlaku bahkan ketika island sedang tertidur.
    this._syncBannerBlock();
    const player = this._pick();
    // Tidak ada trek, tidak ada notifikasi, tidak ada pointer: biarkan island
    // tertidur di dalam panel. Yang membangunkannya hanya _animateTo lewat
    // _unstash. Cek ini di depan supaya dwell tidak memasang alarm untuk isi
    // yang tidak ada.
    if (this._stowed && !this._hasContent(player))
      return;
    const raw = this._decideState(player);
    let content = this._debounceState(raw);
    // State lama yang sedang ditahan bisa kehilangan isinya di tengah dwell
    // (kartu notif masih dilukis padahal _showing sudah kedaluwarsa). Kalau
    // tidak ada yang bisa dilukis, terima kandidat barunya.
    if ((content === 'notif' && !this._showing) || (content === 'media' && !player))
      content = raw;
    // Card adalah permintaan eksplisit; kalau isinya sudah jadi idle, tidak ada
    // lagi yang bisa dibuka.
    if (this._cardOpen && content !== 'notif') {
      if (this._cardMode === 'media' && !player)
        content = 'telemetry';
      else if (this._cardMode)
        content = this._cardMode;
      else if (content === 'idle')
        content = (this._ambient()?.id === 'weather') ? 'weather' : 'telemetry';
    } else if (content === 'idle') {
      this._cardOpen = false;
    }

    // Isi dihitung dulu, baru level: _peekUntil yang dipasang di sini adalah
    // yang membuat level berikutnya jadi 'peek'.
    const isi = this._signature(player, content);
    if (isi !== this._isi) {
      this._isi = isi;
      if (content !== 'idle') {
        this._peekUntil = monoMs() + this._opt.peekMs;
        // Isi baru = ada yang diumumkan, jadi jam idle mulai dari sekarang.
        // Tanpa ini island yang sudah terlanjur tidur tidak pernah bangun lagi
        // untuk trek berikutnya.
        this._wake();
      }
    }
    const level = this._levelFor(content);
    if (!level) {
      this._level = null;
      // Isi yang habis dibiarkan menempel sampai grace _tick() berhitung (celah
      // antar trek tidak boleh jadi kedip). Pengumuman yang sudah selesai tidak
      // punya alasan untuk tetap duduk di layar.
      if (content !== 'idle')
        this._stow();
      return;
    }
    this._armOutside(level === 'card' && (content === 'media' || content === 'weather' || content === 'telemetry' || content === 'timer' || content === 'drop' || content === 'clip' || content === 'cmd' || content === 'radio' || content === 'radar' || content === 'ignition'));

    // Jam menit masuk ke kunci lukisan pill, bukan ke signature isi: pill harus
    // mengganti angkanya sekali semenet, tapi card media tidak boleh tergambar
    // ulang karena jam. Badge masuk ke kunci yang sama, bukan ke signature:
    // antrean yang berubah bukan pengumuman baru, ia hanya angka di sudut pil —
    // di signature dia akan ikut memperpanjang peek dan membangunkan island.
    const jam = GLib.DateTime.new_now_local().format('%H:%M');
    const badge = this._unread();
    // Card media tidak memuat badge, jadi angkanya tidak boleh menggambarnya
    // ulang; pill, peek dan card notif selalu memuat.
    const kunci = level === 'card'
      ? content === 'notif' ? `${isi}|${level}|${badge}` : `${isi}|${level}`
      : `${isi}|${level}|${jam}|${badge}`;

    // Isi yang tidak berubah tidak digambar ulang. Tiap set_text memicu request
    // layout pada card yang sedang di-morph, dan render ulang tanpa perubahan
    // itulah yang terbaca mata sebagai kedip.
    if (kunci === this._sig && !this._stowed)
      return;
    this._sig = kunci;

    const card = level === 'card';
    this._pillRow.visible = !card;
    this._mediaRow.visible = card && content === 'media';
    this._progress.visible = card && content === 'media';
    this._notifRow.visible = card && content === 'notif';
    this._weatherRow.visible = card && content === 'weather';
    this._telemetryRow.visible = card && content === 'telemetry';
    this._timerRow.visible = card && content === 'timer';
    this._dropRow.visible = card && content === 'drop';
    this._clipRow.visible = card && content === 'clip';
    this._cmdRow.visible = card && content === 'cmd';
    this._radioRow.visible = card && content === 'radio';
    this._radarRow.visible = card && content === 'radar';
    this._ignitionRow.visible = card && content === 'ignition';

    if (card && content === 'notif')
      this._fillNotif(badge);
    else if (card && content === 'media')
      this._fillMedia(player);
    else if (card && content === 'weather')
      this._fillWeather();
    else if (card && content === 'telemetry')
      this._fillTelemetry();
    else if (card && content === 'timer')
      this._fillTimer();
    else if (card && content === 'drop')
      this._fillDrop();
    else if (card && content === 'clip')
      this._fillClip();
    else if (card && content === 'cmd')
      this._fillCmd();
    else if (card && content === 'radio')
      this._fillRadio();
    else if (card && content === 'radar')
      this._fillRadar();
    else if (card && content === 'ignition')
      this._fillIgnition();
    else
      this._fillPill(player, content, jam, badge);

    // Morph hanya kalau bentuk benar-benar berganti (atau island baru bangun).
    // Ganti trek di dalam level yang sama menurunkan opacity/isi, bukan ukuran.
    const bentuk = `${level}|${content}`;
    if (bentuk !== this._shape || this._stowed)
      this._animateTo(level, content);
    const asal = content === 'media' ? player.identity
      : content === 'notif' ? String(this._showing?.src?.title ?? '?') : '';
    // ambient ikut dicetak: provider adalah satu-satunya bagian island yang tidak
    // bisa dibuktikan dari screenshot (pil kosong dan pil mati terlihat sama),
    // dan rig membacanya dari sini.
    const amb = content === 'idle'
      ? ` ambient=${this._ambientId ?? '-'}`
        // Nilainya ikut, bukan hanya id: "siapa yang merekam" adalah satu-satunya
        // alasan tenant privacy ada, dan screenshot tidak bisa membacanya.
        + (this._ambientNilai ? `:${this._ambientNilai}` : '')
      : '';
    log(`noir-island: ${asal ? `${content} <- ${asal}` : content} ${level} ${this._geo}${amb}`
      + ` antre=${badge}`);
    this._state = content;
    this._level = level;
    this._shape = bentuk;
  }

  _fillPill(player, content, jam, badge) {
    // Pill media selalu membawa jam di slot kicker: di level pill angka itu cuma
    // pengiring, di peek/card dialah pengganti jam panel — island tidak boleh
    // memakan jam lalu menggantinya dengan judul lagu. Slot ambient berbeda: di
    // sana provider yang memutuskan, dan tanpa provider pil memang hanya berisi
    // titik rosso.
    if (content === 'media') {
      const wsIdx = global.workspace_manager ? global.workspace_manager.get_active_workspace_index() + 1 : 1;
      this._pillKicker.set_text(`G${wsIdx} · ${jam}`);
      this._pillText.set_text(player.meta.title);
      if (this._pillEq) {
        this._pillEq.visible = true;
        this._updateEq(player);
      }
    } else {
      const p = this._ambient();
      this._pillKicker.set_text(p?.kicker() ? jam : '');
      this._pillText.set_text(p?.nilai() ?? '');
      if (this._pillEq)
        this._pillEq.visible = false;
    }
    // Antrean tetap terlihat saat island diam: notifikasi yang tertahan
    // (fullscreen / DND) tidak boleh hilang tanpa jejak.
    this._pillBadge.visible = badge > 0;
    this._pillBadge.set_text(badge > 0 ? `+${badge}` : '');
  }

  _fillMedia(player) {
    const m = player.meta;
    // Trek berganti saat kartunya sudah di layar: teks diturunkan ke opacity 0
    // dulu, diisi, lalu dinaikkan — tanpa itu ada satu frame yang mencampur
    // judul lagu lama dengan artis lagu baru.
    const kunci = m.key || `${m.title}|${m.artist}`;
    const ganti = kunci !== this._shownKey;
    this._shownKey = kunci;
    if (ganti)
      this._mediaRow.set_opacity(0);
    this._mTitle.set_text(m.title);
    this._mArtist.set_text(m.artist || player.identity);
    this._mAlbum.set_text(m.album);
    this._fitText();
    this._setPlayIcon(player.status);
    // canControl/canSeek selama ini terbaca di bus lalu dibuang. Sekarang keduanya
    // dipakai: player yang tidak mau dikendalikan tidak boleh ditawari tombol, dan
    // rail yang tidak bisa di-seret tidak boleh bereaksi terhadap klik.
    const boleh = player.canControl !== false;
    this._btnPrev.visible = boleh && player.canPrev !== false;
    this._btnNext.visible = boleh && player.canNext !== false;
    this._btnPlay.visible = boleh;
    this._progress.reactive = boleh && player.canSeek !== false && !!m.length;
    this._loadCover(m.art, m.key);
    this._updateProgress(player);
    if (ganti) {
      this._rampTo(this._mediaRow, TULIS_OPACITY, 255, {dari: 0});
    }

    const lyricKey = `${m.title}|${m.artist}`;
    if (lyricKey !== this._lyricsKey) {
      this._lyricsKey = lyricKey;
      this._currentLyrics = this._lyricsCache.get(lyricKey) || null;
      if (this._mLyric) {
        this._mLyric.visible = false;
        this._mLyric.set_text('');
      }
    }
    if (this._lyricsCache.has(lyricKey)) {
      this._currentLyrics = this._lyricsCache.get(lyricKey);
      this._updateLyrics(player);
    } else if (this._lyricsFetching !== lyricKey) {
      this._fetchLyrics(player);
    }
  }

  // Waktu tidak pernah dikorbankan. "0:12 / 3:30" adalah alasan orang membuka
  // card media, dan menyembunyikannya terbukti tidak membuat judul panjang
  // benar-benar muat (rig: judul tetap terpotong, waktunya hilang). Yang mengalah
  // adalah baris sekunder — album lebih dulu, lalu artis — sesuai urutan
  // prioritas; judul selalu tinggal sendiri dan memotong dirinya dengan elipsis.
  _fitText() {
    const textW = this._capFor('card', 'media') - MEDIA_CHROME_W;
    const muat = (l) => {
      const [, nat] = l.get_preferred_width(-1);
      return !Number.isFinite(nat) || nat <= textW;
    };
    if (this._mLyric && this._mLyric.visible) {
      this._mAlbum.visible = false;
      this._mArtist.visible = false;
    } else {
      this._mAlbum.visible = !!this._mAlbum.text && muat(this._mAlbum);
      this._mArtist.visible = muat(this._mArtist);
    }
  }

  _updateProgress(player) {
    const m = player.meta;
    let elapsed = player.status === 'Playing'
      ? player.pos + player.rate * (monoMs() - player.posAt) / 1000
      : player.pos;
    // Dead reckoning tidak boleh melampaui panjang trek: sampel Position bisa
    // tertinggal satu tick, dan "44:17 / 4:04" lebih buruk daripada diam di 4:04.
    elapsed = Math.max(0, m.length ? Math.min(elapsed, m.length) : elapsed);
    this._time.set_text(m.length
      ? `${mmss(elapsed)} / ${mmss(m.length)}` : mmss(elapsed));
    const ratio = m.length ? Math.min(1, Math.max(0, elapsed / m.length)) : 0;
    // Tick 500 ms jadi anak tangga kalau isinya di-set mentah. Dibuat ease
    // sepanjang satu interval tick dengan laju datar: gerakan terasa kontinu
    // tanpa perlu timer tambahan, dan tick berikutnya menyambung dari sini.
    this._progressFill.ease({
      width: Math.round(this._progW * ratio),
      duration: TICK_MS,
      mode: Clutter.AnimationMode.LINEAR,
    });
    this._updateLyrics(player, elapsed);
    this._updateRevLights(player, elapsed);
    this._updateEq(player);
  }

  _fillNotif(badge) {
    const {src, n} = this._showing;
    const critical = n.urgency >= Urgency.CRITICAL;
    this._nKicker.set_text(String(src.title || 'Notifikasi').toUpperCase());
    // Nama aplikasi jadi merah hanya kalau urgensi critical: rosso penanda
    // yang berarti (TIER 0), bukan hiasan.
    if (critical)
      this._nKicker.add_style_class_name('noir-island-kicker--hot');
    else
      this._nKicker.remove_style_class_name('noir-island-kicker--hot');
    this._nTitle.set_text(n.title || '');
    this._nBody.set_text(this._oneLine(n.body || '', BODY_MAX));
    this._badge.visible = badge > 0;
    this._badge.set_text(badge > 0 ? `+${badge}` : '');
    this._iconBin.set_child(this._notifIcon(src));
    this._fillActions(n);
    // Rel rosso adalah gestur masuknya kartu: dialirkan dari tepi atas ke bawah
    // sekali per notifikasi. Baris ini dipanggil ulang tiap ada kejadian lain,
    // jadi animasinya dibedakan lewat identitas notifikasinya, tidak tiap render.
    if (this._shownNotif !== n) {
      this._shownNotif = n;
      this._rail.set_pivot_point(0.5, 0);
      this._rampTo(this._rail, TULIS_SCALE_Y, 1, {dari: 0, dur: RAIL_MS});
    }
  }

  // Tombol bawaan notifikasi: shell memasang "Show in Files" pada screenshot,
  // pembuat pesan boleh memasang aksinya sendiri. Dua yang muat terbaca di
  // satu baris; sisanya tetap tersedia di banner asli.
  _fillActions(n) {
    this._actBox.destroy_all_children();
    const acts = (n.actions || []).slice(0, ACT_MAX);
    for (const a of acts) {
      const label = this._oneLine(a.label || '', ACT_LABEL_MAX);
      if (!label)
        continue;
      this._actBox.add_child(this._textButton(
        label, () => this._invokeAction(n, a), 'noir-island-btn--act'));
    }
    this._actBox.visible = this._actBox.get_n_children() > 0;
    // "Buka" adalah aksi tunggal milik island; begitu notifikasinya punya
    // tombol sendiri, dua pintu ke satu tempat jadi satu.
    this._btnOpen.visible = !this._actBox.visible;
  }

  _invokeAction(n, action) {
    this._wake();
    try {
      action.activate();
    } catch (e) {
      log(`noir-island: aksi "${action.label}" gagal: ${e.message}`);
    }
  }

  _notifIcon(src) {
    const ic = src?.icon;
    if (ic instanceof Gio.Icon)
      return new St.Icon({gicon: ic, icon_size: 22});
    if (typeof ic === 'string' && ic)
      return new St.Icon({icon_name: ic, icon_size: 22});
    return new St.Icon({
      icon_name: 'preferences-system-notifications-symbolic',
      icon_size: 22,
    });
  }

  _oneLine(text, max) {
    // Body notifikasi boleh berisi markup Pango; yang membaca pill bukan
    // penanda tangannya.
    const flat = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  _dndOff() {
    return !this._notifSettings.get_boolean('show-banners');
  }

  _fillWeather() {
    const i = this._weatherInfo;
    if (!i || !i.is_valid())
      return;
    const [hasT, t] = i.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
    const tempStr = hasT ? `${Math.round(t)}°` : '--°';
    const cityStr = this._weatherCityName || 'Cuaca';
    const summary = String(i.get_weather_summary() ?? '');
    const condStr = summary.includes(': ') ? summary.split(': ')[1] : summary;
    const iconName = i.get_symbolic_icon_name() || 'weather-clear-symbolic';

    this._wIcon.set_icon_name(iconName);
    this._wCity.set_text(cityStr);
    this._wCond.set_text(condStr === 'Unknown' ? '' : condStr);
    this._wTemp.set_text(tempStr);

    const list = i.get_forecast_list() ?? [];
    let minT = 999;
    let maxT = -999;
    const validHours = [];

    // Loop mulai dari index 1 untuk menghindari forecast_list[0] rusak (epoch=0)
    for (let idx = 1; idx < list.length && idx <= 24; idx++) {
      const item = list[idx];
      const [hasVal, tempVal] = item.get_value_temp(GWeather.TemperatureUnit.CENTIGRADE);
      const [hasUp, epoch] = item.get_value_update();
      if (!hasVal || !hasUp || epoch <= 0)
        continue;
      if (tempVal < minT) minT = tempVal;
      if (tempVal > maxT) maxT = tempVal;

      if (validHours.length < 4) {
        const dt = GLib.DateTime.new_from_unix_local(epoch);
        const jam = dt ? dt.format('%H:%M') : '';
        const hIcon = item.get_symbolic_icon_name() || 'weather-clear-symbolic';
        validHours.push({
          jam,
          icon: hIcon,
          temp: `${Math.round(tempVal)}°`,
        });
      }
    }

    if (minT <= maxT && minT !== 999) {
      this._wRange.set_text(`H: ${Math.round(maxT)}°  L: ${Math.round(minT)}°`);
      this._wRange.visible = true;
    } else {
      this._wRange.visible = false;
    }

    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      const slot = this._wSlots[slotIdx];
      const data = validHours[slotIdx];
      if (data) {
        slot.jam.set_text(data.jam);
        slot.icon.set_icon_name(data.icon);
        slot.temp.set_text(data.temp);
        slot.box.visible = true;
      } else {
        slot.box.visible = false;
      }
    }
  }

  _sampleTelemetry() {
    try {
      const [okStat, bytesStat] = GLib.file_get_contents('/proc/stat');
      if (okStat) {
        const statStr = new TextDecoder().decode(bytesStat);
        const parts = statStr.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        const total = parts.reduce((a, b) => a + b, 0);
        const idle = parts[3] + (parts[4] || 0);
        if (this._lastCpuTotal > 0 && total > this._lastCpuTotal) {
          const diffTotal = total - this._lastCpuTotal;
          const diffIdle = idle - this._lastCpuIdle;
          this._cpuUsage = Math.max(0, Math.min(100, Math.round((1 - diffIdle / diffTotal) * 100)));
        }
        this._lastCpuTotal = total;
        this._lastCpuIdle = idle;
      }
    } catch (_) {}

    try {
      const [okMem, bytesMem] = GLib.file_get_contents('/proc/meminfo');
      if (okMem) {
        const memStr = new TextDecoder().decode(bytesMem);
        const totalMatch = memStr.match(/MemTotal:\s+(\d+)\s+kB/);
        const availMatch = memStr.match(/MemAvailable:\s+(\d+)\s+kB/);
        if (totalMatch && availMatch) {
          const totalKb = parseInt(totalMatch[1], 10);
          const availKb = parseInt(availMatch[1], 10);
          const usedKb = totalKb - availKb;
          this._memPct = Math.round((usedKb / totalKb) * 100);
          this._memUsedText = `${(usedKb / 1048576).toFixed(1)}G`;
          this._memTotalText = `${(totalKb / 1048576).toFixed(1)}G`;
        }
      }
    } catch (_) {}

    try {
      const [okNet, bytesNet] = GLib.file_get_contents('/proc/net/dev');
      if (okNet) {
        const netStr = new TextDecoder().decode(bytesNet);
        const lines = netStr.split('\n');
        let rx = 0;
        let tx = 0;
        for (const line of lines) {
          if (!line.includes(':') || line.includes('lo:'))
            continue;
          const cols = line.split(':')[1].trim().split(/\s+/).map(Number);
          rx += cols[0] || 0;
          tx += cols[8] || 0;
        }
        const now = monoMs();
        if (this._lastNetSample > 0 && now > this._lastNetSample) {
          const dtSec = (now - this._lastNetSample) / 1000;
          const rxRate = Math.max(0, (rx - this._lastNetRx) / dtSec);
          const txRate = Math.max(0, (tx - this._lastNetTx) / dtSec);
          const fmtRate = (bytes) => {
            if (bytes >= 1048576)
              return `${(bytes / 1048576).toFixed(1)}M/s`;
            return `${Math.round(bytes / 1024)}K/s`;
          };
          this._netRxText = fmtRate(rxRate);
          this._netTxText = fmtRate(txRate);
        }
        this._lastNetRx = rx;
        this._lastNetTx = tx;
        this._lastNetSample = now;
      }
    } catch (_) {}

    if (this._cpuUsage > 60) {
      if (this._island && !this._turboActive) {
        this._turboActive = true;
        this._island.add_style_class_name('noir-island--turbo-flame');
      }
    } else {
      if (this._turboActive) {
        this._turboActive = false;
        if (this._island)
          this._island.remove_style_class_name('noir-island--turbo-flame');
      }
    }
  }

  _fillTelemetry() {
    this._sampleTelemetry();
    this._telemCpuTitle.set_text(`V6 TURBO · ${this._cpuUsage}% CPU`);
    this._telemCpuSub.set_text(`RAM ${this._memUsedText} / ${this._memTotalText} (${this._memPct}%)`);
    const gLat = (Math.abs(this._gForceX) * 0.15).toFixed(1);
    this._telemMemText.set_text(`G-FORCE: ${gLat}G · ERS: ${100 - this._cpuUsage}%`);
    this._telemNetText.set_text(`TURBO ↓${this._netRxText || '0K/s'}`);
  }

  _fillTimer() {
    let elapsed = this._timerAccum;
    if (this._timerRunning)
      elapsed += monoMs() - this._timerStart;

    if (this._timerMode === 'pomodoro') {
      const POMO_TOTAL = 25 * 60 * 1000;
      const remainMs = Math.max(0, POMO_TOTAL - elapsed);
      const remainSec = Math.floor(remainMs / 1000);
      this._timerModeLabel.set_text(remainSec === 0 ? 'PIT STOP REQUIRED' : 'STINT FOCUS (POMODORO)');
      this._timerTimeLabel.set_text(mmss(remainSec));
    } else {
      const sec = Math.floor(elapsed / 1000);
      const ms = Math.floor((elapsed % 1000) / 100);
      this._timerModeLabel.set_text('FERRARI CHRONOGRAPH');
      this._timerTimeLabel.set_text(`${mmss(sec)}.${ms}`);
    }

    if (this._timerPlayBtn) {
      this._timerPlayBtn.set_child(new St.Icon({
        icon_name: this._timerRunning ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
        icon_size: 16,
      }));
    }
  }

  _fillDrop() {
    if (this._droppedFiles.length === 0) {
      this._dropTitle.set_text('ROSSO NOTCH DROP');
      this._dropSub.set_text('Siap menampung file / unduhan');
      this._dropTile.remove_style_class_name('noir-island-drop-tile--active');
    } else {
      const top = this._droppedFiles[0];
      this._dropTitle.set_text(top.name || 'File Tersimpan');
      this._dropSub.set_text(`${this._droppedFiles.length} file di shelf · ${top.size || ''}`);
      this._dropTile.add_style_class_name('noir-island-drop-tile--active');
    }
  }

  _syncClip() {
    try {
      St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_, text) => {
        if (!text || text === this._lastClipText)
          return;
        this._lastClipText = text;
        const trimmed = text.trim();
        if (!trimmed)
          return;
        this._clipStack = [trimmed, ...this._clipStack.filter(x => x !== trimmed)].slice(0, 5);
        if (this._clipRow && this._clipRow.visible)
          this._fillClip();
      });
    } catch (_) {}
  }

  _fillClip() {
    if (this._clipStack.length === 0) {
      this._clipTitle.set_text('PAPAN KLIP KOSONG');
      this._clipSub.set_text('Salin teks apa pun untuk melihat riwayat');
      this._clipSwatch.visible = false;
      return;
    }
    const current = this._clipStack[0];
    const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(current);
    if (isHex) {
      this._clipSwatch.set_style(`background-color: ${current};`);
      this._clipSwatch.visible = true;
      this._clipTitle.set_text(`WARNA HEX: ${current.toUpperCase()}`);
    } else {
      this._clipSwatch.visible = false;
      const clean = current.replace(/\s+/g, ' ');
      this._clipTitle.set_text(clean.length > 28 ? `${clean.slice(0, 27)}…` : clean);
    }
    this._clipSub.set_text(`${this._clipStack.length} klip tersimpan di stack`);
  }

  _execCmd(cmdType) {
    if (cmdType === 'git') {
      try {
        const [ok, out] = GLib.spawn_command_line_sync('git -C /home/arkan/ferrari-ubuntu status -s');
        if (ok) {
          const str = new TextDecoder().decode(out).trim();
          const lines = str ? str.split('\n').length : 0;
          this._cmdOutput = lines === 0 ? 'GIT: BERSIH (MAIN)' : `GIT: ${lines} FILE BERUBAH`;
        }
      } catch (e) {
        this._cmdOutput = 'GIT: GAGAL CEK';
      }
    } else if (cmdType === 'ip') {
      try {
        const [ok, out] = GLib.spawn_command_line_sync('hostname -I');
        if (ok) {
          const ip = new TextDecoder().decode(out).trim().split(' ')[0];
          this._cmdOutput = `IP: ${ip || '127.0.0.1'}`;
        }
      } catch (e) {
        this._cmdOutput = 'IP: TIDAK TERSEDIA';
      }
    } else if (cmdType === 'audio') {
      try {
        GLib.spawn_command_line_async('systemctl --user restart pipewire-pulse');
        this._cmdOutput = 'PW-RST: PIPEWIRE DI-RESTART';
      } catch (e) {
        this._cmdOutput = 'PW-RST: GAGAL';
      }
    }
    this._fillCmd();
  }

  _fillCmd() {
    this._cmdTitle.set_text('PIT COMMAND BAR');
    this._cmdSub.set_text(this._cmdOutput);
  }

  _fillRadio() {
    let appName = 'OFFLINE';
    let isMuted = false;
    if (this._mixer) {
      const src = this._mixer.get_default_source();
      if (src)
        isMuted = src.get_is_muted();
      const s = this._recorder();
      if (s)
        appName = this._micApp(s);
    }
    this._radioTitle.set_text(`RADIO PIT WALL · ${appName}`);
    this._radioSub.set_text(isMuted ? '● MUTED (TRANSMISI MATI)' : `● TRANSMITTING (${mmss(this._radioDuration)})`);
    if (this._radioMuteLabel)
      this._radioMuteLabel.set_text(isMuted ? 'UNMUTE' : 'MUTE');
    if (this._radioMuteBtn) {
      if (isMuted)
        this._radioMuteBtn.add_style_class_name('noir-island-radio-mute-btn--muted');
      else
        this._radioMuteBtn.remove_style_class_name('noir-island-radio-mute-btn--muted');
    }
  }

  _fillRadar() {
    this._radarTitle.set_text('AUTODROMO MONZA · RADAR');
    let winList = [];
    try {
      const ws = global.workspace_manager?.get_active_workspace();
      if (ws) {
        winList = ws.list_windows().filter(w => !w.is_skip_taskbar());
      }
    } catch (_) {}

    this._radarSub.set_text(`${winList.length} mobil aktif di sirkuit`);
    if (this._radarCarsBox) {
      this._radarCarsBox.destroy_all_children();
      for (let i = 0; i < Math.min(4, winList.length); i++) {
        const win = winList[i];
        let name = win.get_wm_class() || win.get_title() || 'Car';
        name = name.split('.').pop().slice(0, 8);
        const carBtn = new St.Button({
          style_class: 'noir-island-radar-car',
          can_focus: false,
        });
        carBtn.set_child(new St.Label({text: `🏎 ${name}`}));
        carBtn.connect('clicked', () => {
          this._playSfx('click');
          win.activate(global.get_current_time());
        });
        this._radarCarsBox.add_child(carBtn);
      }
    }
  }

  _fillIgnition() {
    if (this._igniteState === 'IGNITED') {
      this._igniteTitle.set_text('V6 HYBRID POWER UNIT ONLINE');
      this._igniteSub.set_text('SISTEM DIOTORISASI · MODE RACE ACTIVE');
      if (this._igniteBtn)
        this._igniteBtn.set_child(new St.Label({text: 'PIT STOP'}));
    } else {
      this._igniteTitle.set_text('SCUDERIA SECURITY · ENGINE START');
      this._igniteSub.set_text('SIAPKAN SIDIK JARI / OTORISASI');
      if (this._igniteBtn)
        this._igniteBtn.set_child(new St.Label({text: 'START ENGINE'}));
    }
  }

  _fetchLyrics(player) {
    const m = player?.meta;
    if (!m || !m.title)
      return;
    const key = `${m.title}|${m.artist}`;
    if (this._lyricsCache.has(key)) {
      this._currentLyrics = this._lyricsCache.get(key);
      this._lyricsKey = key;
      this._updateLyrics(player);
      return;
    }
    if (this._lyricsFetching === key || !this._soupSession)
      return;
    this._lyricsFetching = key;
    this._updateLyrics(player);

    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(m.title)}&artist_name=${encodeURIComponent(m.artist || '')}&duration=${Math.round(m.length || 0)}`;
    log(`noir-island: lirik cari "${m.title}" (${m.artist})`);
    try {
      const msg = Soup.Message.new('GET', url);
      msg.request_headers.append('User-Agent', 'noir-island/1.0 (https://github.com/arkan/noir-island)');
      this._soupSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, res) => {
        this._lyricsFetching = null;
        try {
          const bytes = session.send_and_read_finish(res);
          const text = new TextDecoder().decode(bytes.get_data());
          const data = JSON.parse(text);
          if (data && data.syncedLyrics) {
            const parsed = this._parseLRC(data.syncedLyrics);
            this._lyricsCache.set(key, parsed);
            log(`noir-island: lirik ok "${m.title}" -> ${parsed ? parsed.length : 0} baris`);
            if (this._shownKey === (m.key || `${m.title}|${m.artist}`) ||
                (player.meta && player.meta.title === m.title)) {
              this._currentLyrics = parsed;
              this._lyricsKey = key;
              this._updateLyrics(player);
            }
          } else if (data && data.instrumental) {
            this._lyricsCache.set(key, 'INSTRUMENTAL');
            log(`noir-island: lirik instrumental "${m.title}"`);
            if (this._shownKey === (m.key || `${m.title}|${m.artist}`) ||
                (player.meta && player.meta.title === m.title)) {
              this._currentLyrics = 'INSTRUMENTAL';
              this._lyricsKey = key;
              this._updateLyrics(player);
            }
          } else {
            this._lyricsCache.set(key, null);
            log(`noir-island: lirik nihil "${m.title}"`);
            if (player.meta && player.meta.title === m.title) {
              this._updateLyrics(player);
            }
          }
        } catch (e) {
          this._lyricsCache.set(key, null);
          log(`noir-island: lirik gagal "${m.title}": ${e}`);
          if (player.meta && player.meta.title === m.title) {
            this._updateLyrics(player);
          }
        }
      });
    } catch (e) {
      this._lyricsFetching = null;
    }
  }

  _parseLRC(lrcText) {
    const lines = lrcText.split('\n');
    const result = [];
    const reg = /^\[(\d{2}):(\d{2}(?:\.\d+)?)\](.*)$/;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = reg.exec(trimmed);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseFloat(match[2]);
        const text = match[3].trim();
        result.push({
          t: min * 60 + sec,
          text: text || '♪ Interlude ♪',
          isBreak: !text,
        });
      }
    }
    result.sort((a, b) => a.t - b.t);
    return result.length > 0 ? result : null;
  }

  _slideLyric(newText) {
    if (!this._mLyric)
      return;
    const isMuted = newText.startsWith('♪') || newText.includes('...');
    const styleClass = isMuted ? 'noir-island-lyric-muted' : 'noir-island-lyric-active';

    const player = this._pick();
    if (player?.meta?.title) {
      const m = player.meta;
      this._mTitle.set_text(m.artist ? `${m.title} · ${m.artist}` : m.title);
    }

    if (!this._mLyric.text || !this._mLyric.visible) {
      this._mLyric.set_style_class_name(styleClass);
      this._mLyric.set_text(newText);
      this._mLyric.set_translation(0, 0, 0);
      this._mLyric.set_opacity(255);
      this._mLyric.visible = true;
      this._fitText();
      return;
    }
    if (this._lyricSlidingText === newText)
      return;
    this._lyricSlidingText = newText;

    // Fase 1: slide up sedikit (-5px) sambil fade out
    this._rampTo(this._mLyric, TULIS_OPACITY, 0, {dari: this._mLyric.opacity, dur: 90});
    this._rampTo(this._mLyric, TULIS_TRANSLATION_Y, -5, {dari: 0, dur: 90});

    if (this._lyricTimerId)
      GLib.source_remove(this._lyricTimerId);

    this._lyricTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 95, () => {
      this._lyricTimerId = 0;
      if (!this._island || this._dead || !this._mLyric)
        return GLib.SOURCE_REMOVE;
      this._mLyric.set_style_class_name(styleClass);
      this._mLyric.set_text(newText);
      this._mLyric.visible = true;
      this._fitText();
      // Fase 2: slide in dari bawah (+5px -> 0px) sambil fade in
      this._rampTo(this._mLyric, TULIS_OPACITY, 255, {dari: 0, dur: 140});
      this._rampTo(this._mLyric, TULIS_TRANSLATION_Y, 0, {dari: 5, dur: 140});
      return GLib.SOURCE_REMOVE;
    });
  }

  _updateLyrics(player, elapsed) {
    if (!this._mLyric || !player?.meta?.title) {
      if (this._mLyric && this._mLyric.visible) {
        this._mLyric.visible = false;
        if (player?.meta?.title)
          this._mTitle.set_text(player.meta.title);
        this._fitText();
      }
      return;
    }

    const m = player.meta;
    const key = `${m.title}|${m.artist}`;

    // Sedang fetching lirik ke LRCLIB
    if (this._lyricsFetching === key) {
      this._slideLyric('Memuat lirik...');
      return;
    }

    // Lagu instrumental
    if (this._currentLyrics === 'INSTRUMENTAL') {
      this._slideLyric('♪ Instrumental ♪');
      return;
    }

    // Lirik tidak ditemukan / kosong
    if (!this._currentLyrics || !Array.isArray(this._currentLyrics) || this._currentLyrics.length === 0) {
      if (this._mLyric.visible) {
        this._mLyric.visible = false;
        if (player?.meta?.title)
          this._mTitle.set_text(player.meta.title);
        this._fitText();
      }
      return;
    }

    const cur = elapsed ?? (player.status === 'Playing'
      ? player.pos + player.rate * (monoMs() - player.posAt) / 1000
      : player.pos);

    // Intro: waktu sebelum lirik pertama dimulai
    if (cur < this._currentLyrics[0].t) {
      this._slideLyric('♪ Intro ♪');
      return;
    }

    let active = null;
    for (let i = 0; i < this._currentLyrics.length; i++) {
      if (cur >= this._currentLyrics[i].t) {
        active = this._currentLyrics[i];
      } else {
        break;
      }
    }
    if (active) {
      if (active.text !== this._mLyric.text || !this._mLyric.visible) {
        this._slideLyric(active.text);
      }
    } else if (this._mLyric.visible) {
      this._mLyric.visible = false;
      if (player?.meta?.title)
        this._mTitle.set_text(player.meta.title);
      this._fitText();
    }
  }

  _updateRevLights(player, elapsed) {
    if (!this._revBox || !this._mediaRow.visible || !this._revLeds)
      return;
    const playing = player?.status === 'Playing';
    if (!playing) {
      for (const {led} of this._revLeds)
        led.set_opacity(25);
      return;
    }
    const cur = elapsed ?? (player.status === 'Playing'
      ? player.pos + player.rate * (monoMs() - player.posAt) / 1000
      : player.pos);

    // Skala volume player (0.2 .. 1.0)
    const vol = typeof player.volume === 'number' ? Math.max(0.2, Math.min(1.0, player.volume)) : 1.0;

    // 1. Pita Bass / Low (LED 0, 1, 2 - Hijau):
    // Denyut ketukan drum (tempo ~120 BPM = 2 Hz), power wave
    const beat = Math.pow(Math.abs(Math.sin(cur * Math.PI * 2)), 2.5);
    const bassLevel = Math.min(1.0, beat * 1.25);

    // 2. Pita Vokal / Melodi (LED 3, 4, 5, 6 - Merah Rosso):
    // Mengikuti kehadiran lirik aktif dan modulasi nada vokal
    const isVocalActive = this._mLyric && this._mLyric.visible &&
      !this._mLyric.text?.startsWith('♪') && !this._mLyric.text?.includes('...');
    const vocalWave = isVocalActive
      ? 0.5 + 0.5 * Math.sin(cur * 7.8) * Math.cos(cur * 3.4)
      : 0.25 + 0.25 * Math.abs(Math.sin(cur * 4.2));
    const vocalLevel = Math.min(1.0, vocalWave * 1.2);

    // 3. Pita Treble / High (LED 7, 8, 9 - Biru Racing):
    // Percikan nada tinggi (cymbal/hi-hat) pada syncopation (fase offset)
    const treble = Math.pow(Math.abs(Math.cos(cur * Math.PI * 4 + 0.7)), 3.0);
    const trebleLevel = Math.min(1.0, treble * 1.3);

    // Pemetaan 10 LED ke 3 pita frekuensi nada:
    const tBass = [0.2, 0.5, 0.8];
    for (let i = 0; i < 3; i++) {
      const active = bassLevel >= tBass[i];
      const op = active ? Math.round(255 * vol) : Math.round(30 * vol);
      this._revLeds[i].led.set_opacity(op);
    }

    const tVocal = [0.2, 0.45, 0.7, 0.9];
    for (let i = 0; i < 4; i++) {
      const active = vocalLevel >= tVocal[i];
      const op = active ? Math.round(255 * vol) : Math.round(30 * vol);
      this._revLeds[3 + i].led.set_opacity(op);
    }

    const tTreble = [0.3, 0.6, 0.85];
    for (let i = 0; i < 3; i++) {
      const active = trebleLevel >= tTreble[i];
      const op = active ? Math.round(255 * vol) : Math.round(30 * vol);
      this._revLeds[7 + i].led.set_opacity(op);
    }
  }

  _updateEq(player) {
    if (!this._pillEq || !this._pillEq.visible || !this._eqBars)
      return;
    const playing = player?.status === 'Playing';
    if (!playing) {
      for (let i = 0; i < 4; i++) {
        this._eqBars[i].ease({
          height: 3,
          duration: TICK_MS,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
      return;
    }
    const cur = (player.pos + player.rate * (monoMs() - player.posAt) / 1000) || (monoMs() / 1000);
    const vol = typeof player.volume === 'number' ? Math.max(0.3, Math.min(1.0, player.volume)) : 1.0;

    // 4 Bar Equalizer disinkronkan ke 4 pita frekuensi:
    // Bar 0: Sub-bass (hentakan ritmik berat)
    const b0 = Math.round((3 + 9 * Math.pow(Math.abs(Math.sin(cur * Math.PI * 2)), 2)) * vol);
    // Bar 1: Mid-bass (ritme pengiring)
    const b1 = Math.round((4 + 11 * Math.abs(Math.sin(cur * 4.5 + 0.8))) * vol);
    // Bar 2: Vocal Presence (dinamika nada vokal)
    const isVocal = this._mLyric && this._mLyric.visible &&
      !this._mLyric.text?.startsWith('♪') && !this._mLyric.text?.includes('...');
    const b2 = Math.round((isVocal ? 6 + 8 * Math.abs(Math.cos(cur * 7.2)) : 3 + 5 * Math.abs(Math.sin(cur * 3.5))) * vol);
    // Bar 3: Treble / Shimmer
    const b3 = Math.round((3 + 8 * Math.pow(Math.abs(Math.cos(cur * Math.PI * 4 + 0.5)), 2)) * vol);

    const heights = [
      Math.max(3, Math.min(14, b0)),
      Math.max(3, Math.min(15, b1)),
      Math.max(3, Math.min(14, b2)),
      Math.max(3, Math.min(12, b3)),
    ];

    for (let i = 0; i < 4; i++) {
      this._eqBars[i].ease({
        height: heights[i],
        duration: TICK_MS,
        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
      });
    }
  }

  _changeVolume(player, delta) {
    const cur = typeof player.volume === 'number' ? player.volume : 1.0;
    const next = Math.max(0, Math.min(1.0, cur + delta));
    player.volume = next;
    Gio.DBus.session.call(player.name, MPRIS_PATH, PROPS_IFACE, 'Set',
      new GLib.Variant('(ssv)', [PLAYER_IFACE, 'Volume', new GLib.Variant('d', next)]),
      null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null, () => {});
    this._wake();
    log(`noir-island: volume ${(next * 100).toFixed(0)}% (${player.identity})`);
  }

  _raisePlayer(player) {
    this._wake();
    log(`noir-island: raise ${player.identity}`);
    Gio.DBus.session.call(player.name, MPRIS_PATH, MPRIS_ROOT, 'Raise',
      null, null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null, () => {});
  }

  // -------------------------------------------------------------------- media

  _startMpris() {
    // Nama player dipoll, bukan dipantau lewat NameOwnerChanged: jalur sinyal
    // itu tidak pernah memanggil handler di rig shell 46, dan pola poll yang
    // sama sudah terbukti dipakai noir-telemetry.
    this._scan();
  }

  _scan() {
    const names = new Set(this._listNames().filter(n => n.startsWith(MPRIS_PREFIX)));
    for (const name of names) {
      const entry = this._players.get(name);
      if (!entry) {
        this._attachPlayer(name);
      } else if (!entry.meta && entry.blindTry < BLIND_RETRY_MAX) {
        // GetAll saat lahir bisa gagal diam-diam (player lambat, bus sibuk) dan
        // tanpa jalur ini pemain itu buta selamanya: _players sudah menyimpannya
        // jadi tidak ada yang bertanya lagi. Terbukti di rig — island duduk
        // idle walaupun trek Paused sudah terdaftar di bus. Dibatasi supaya
        // nama yang memang bukan player tidak ditanya seumur hidup.
        entry.blindTry++;
        this._readAll(name);
      }
    }
    for (const name of [...this._players.keys()]) {
      if (!names.has(name))
        this._dropPlayer(name);
    }
  }

  // call_sync, bukan async: pola yang sama dipakai noir-telemetry dan sudah
  // terbukti menjawab di rig ini, termasuk saat player mati di tengah roundtrip.
  _listNames() {
    try {
      const reply = Gio.DBus.session.call_sync(DBUS_IFACE, DBUS_PATH, DBUS_IFACE,
        'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null);
      return reply.get_child_value(0).get_strv();
    } catch (e) {
      // Tanpa cabang ini seluruh trek hilang diam-diam: 400 dtk di ListNames
      // berarti daemon sibuk (rig Xephyr membuktikannya, dan dia pulih sendiri
      // pada tick berikutnya), jadi dia harus terdengar di log.
      log(`noir-island: ListNames gagal: ${e.message}`);
      return [];
    }
  }

  _attachPlayer(name) {
    if (this._players.has(name)) {
      this._readAll(name);
      return;
    }
    let proxy;
    try {
      proxy = Gio.DBusProxy.new_sync(Gio.DBus.session, Gio.DBusProxyFlags.NONE,
        null, name, MPRIS_PATH, PLAYER_IFACE, null);
    } catch (e) {
      return;
    }
    const entry = {
      name,
      proxy,
      status: 'Stopped',
      meta: null,
      identity: name.slice(MPRIS_PREFIX.length),
      pos: 0,
      posAt: monoMs(),
      posQuery: false,
      rate: 1,
      // Hitungan percobaan ulang untuk pemain yang lahir tanpa metadata.
      blindTry: 0,
      seen: monoMs(),
    };
    this._players.set(name, entry);
    // Kelahiran/kematian player adalah satu-satunya penjelasan "island tidak
    // muncul" yang bisa dibaca dari log, jadi keduanya dicatat.
    log(`noir-island: + player ${entry.identity}`);
    // PropertiesChanged datang lewat sinyal proxy (g-properties-changed), bukan
    // lewat connectSignal(): proxy ini terikat interface Player, jadi sinyal milik
    // org.freedesktop.DBus.Properties tidak diteruskan sebagai sinyal nama.
    proxy.connect('g-properties-changed', (p, changed) => {
      this._applyProps(entry, this._dict(changed));
      this._render();
    });
    this._readAll(name);
  }

  _readAll(name) {
    const entry = this._players.get(name);
    if (!entry)
      return;
    this._applyProps(entry, this._getAll(entry.name, PLAYER_IFACE));
    const root = this._getAll(entry.name, MPRIS_ROOT);
    const identity = this._val(root.Identity);
    if (identity)
      entry.identity = identity;
    this._render();
  }

  _dropPlayer(name) {
    const entry = this._players.get(name);
    if (!entry)
      return;
    // run_dispose melepas semua handler proxy; disconnect() tanpa id justru
    // memicu g_signal_handler_disconnect assertion.
    entry.proxy.run_dispose();
    this._players.delete(name);
    log(`noir-island: - player ${entry.identity}`);
    this._render();
  }

  _getAll(dest, iface) {
    try {
      const reply = Gio.DBus.session.call_sync(dest, MPRIS_PATH, PROPS_IFACE,
        'GetAll', new GLib.Variant('(s)', [iface]),
        new GLib.VariantType('(a{sv})'), Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT_MS, null);
      return this._dict(reply.get_child_value(0));
    } catch (e) {
      log(`noir-island: GetAll ${iface} dari ${dest} gagal: ${e.message}`);
      return {};
    }
  }

  // Posisi adalah satu-satunya properti MPRIS yang tidak pernah diumumkan lewat
  // PropertiesChanged, jadi harus ditanya. Ambil satu per pemain: guard posQuery
  // menahan antrean bila player lambat, dan jalur async supaya satu tick tidak
  // pernah memblokir loop shell.
  _samplePosition(entry) {
    if (!entry || entry.posQuery)
      return;
    entry.posQuery = true;
    Gio.DBus.session.call(entry.name, MPRIS_PATH, PROPS_IFACE, 'Get',
      new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
      new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS,
      null, (conn, res) => {
        entry.posQuery = false;
        let pos;
        try {
          pos = this._val(conn.call_finish(res).get_child_value(0));
        } catch (e) {
          return;
        }
        if (typeof pos !== 'number' || !isFinite(pos) || pos < 0)
          return;
        entry.pos = pos / 1e6;
        entry.posAt = monoMs();
        if (this._state === 'media' && this._pick() === entry && this._island)
          this._updateProgress(entry);
      });
  }

  _applyProps(entry, props) {
    const status = this._val(props.PlaybackStatus);
    if (status && status !== entry.status) {
      entry.status = status;
      // Titik acuan ditulis ulang saat status berubah: tanpa ini resume
      // melanjutkan jam dari posisi terakhir yang sempat terbaca, dan jeda
      // panjang ikut terhitung sebagai waktu play.
      entry.posAt = monoMs();
      this._samplePosition(entry);
    } else if (status)
      entry.status = status;
    if (props.Position !== undefined) {
      entry.pos = this._val(props.Position) || 0;
      entry.pos /= 1e6;
      entry.posAt = monoMs();
    }
    const rate = this._val(props.Rate);
    if (rate)
      entry.rate = rate;
    if (props.CanControl !== undefined)
      entry.canControl = this._val(props.CanControl) !== false;
    if (props.CanGoNext !== undefined)
      entry.canNext = this._val(props.CanGoNext) !== false;
    if (props.CanGoPrevious !== undefined)
      entry.canPrev = this._val(props.CanGoPrevious) !== false;
    if (props.CanSeek !== undefined)
      entry.canSeek = this._val(props.CanSeek) !== false;
    if (props.Metadata !== undefined)
      entry.meta = this._parseMeta(this._val(props.Metadata));
    entry.seen = monoMs();
  }

  // Nilai a{sv} datang berlapis: Variant "v" yang membungkus Variant aslinya.
  // Sekali unpack masih menyisakan objek Variant, jadi dibuka sampai habis —
  // kalau tidak, PlaybackStatus terbaca sebagai "[object variant]" dan tidak
  // pernah sama dengan 'Playing'.
  _val(v) {
    let out = v;
    for (let i = 0; i < 3 && out instanceof GLib.Variant; i++)
      out = out.unpack();
    return out;
  }

  _dict(v) {
    const raw = this._val(v);
    return raw && typeof raw === 'object' ? raw : {};
  }

  _parseMeta(meta) {
    if (!meta || typeof meta !== 'object')
      return null;
    const title = this._val(meta['xesam:title']);
    if (!title)
      return null;
    // Elemen array pun masih bisa berupa Variant (mis. xesam:artist bertipe as).
    const artist = this._val(meta['xesam:artist']);
    const artistText = (Array.isArray(artist) ? artist.map(a => this._val(a)) : [artist])
      .filter(Boolean).join(', ');
    const album = this._val(meta['xesam:album']);
    const len = this._val(meta['mpris:length']);
    const trackId = this._val(meta['mpris:trackid']);
    return {
      title: String(this._val(title)),
      artist: String(artistText),
      album: album ? String(this._val(album)) : '',
      art: String(this._val(meta['mpris:artUrl']) ?? ''),
      length: len ? Number(len) / 1e6 : 0,
      // path mentah dipakai SetPosition (butuh object path asli); key adalah
      // bentuk aman untuk nama file cache artwork.
      path: trackId ? String(trackId) : '',
      key: trackId ? String(trackId).replace(/[^A-Za-z0-9_-]/g, '_') : '',
    };
  }

  // Yang sedang Playing menang; kalau tidak ada, track Paused terakhir masih
  // layak dibaca di pill.
  _pick() {
    const list = [...this._players.values()].filter(e => e.meta?.title);
    list.sort((a, b) => {
      const ap = a.status === 'Playing' ? 1 : 0;
      const bp = b.status === 'Playing' ? 1 : 0;
      return bp - ap || b.seen - a.seen;
    });
    return list[0] || null;
  }

  _transport(method) {
    const player = this._pick();
    if (!player)
      return;
    this._wake();
    Gio.DBus.session.call(player.name, MPRIS_PATH, PLAYER_IFACE, method, null,
      null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null, (conn, res) => {
        try {
          conn.call_finish(res);
        } catch (e) {
          // Player menolak metode: status dari PropertiesChanged yang bicara.
        }
      });
  }

  // Seek dimulai dari tekanan pada band progres; rasionya dihitung dari alokasi
  // actor, jadi pemangkasan lebar di monitor sempit ikut benar.
  _seekAt(event) {
    const player = this._pick();
    const m = player?.meta;
    if (!player || !m?.length || player.canSeek === false ||
        player.canControl === false)
      return false;
    // get_allocation_box() memakai koordinat orang tua, sedangkan koordinat
    // event memakai panggung. Memakai yang pertama membuat rasio selalu 1 pada
    // card yang tidak menempel di x=0 (terbukti di rig: seek ke 212 dtk dari
    // klik di tengah rail).
    const [ax] = this._progress.get_transformed_position();
    const lebar = this._progress.get_allocation_box().get_width();
    if (lebar <= 0)
      return false;
    const [x] = event.get_coords();
    const ratio = Math.min(1, Math.max(0, (x - ax) / lebar));
    this._seek(player, ratio * m.length);
    return true;
  }

  // SetPosition kalau trackId-nya diketahui, Seek (relatif) kalau tidak. Posisi
  // akhir tetap milik bus; tulisan lokal di sini cuma supaya rail tidak menunggu
  // gema satu tick penuh.
  _seek(player, sec) {
    this._wake();
    const dari = player.status === 'Playing'
      ? player.pos + (monoMs() - player.posAt) / 1000 : player.pos;
    const punyaPath = !!player.meta.path;
    const method = punyaPath ? 'SetPosition' : 'Seek';
    const params = punyaPath
      ? new GLib.Variant('(ox)', [player.meta.path, Math.round(sec * 1e6)])
      : new GLib.Variant('(x)', [Math.round((sec - dari) * 1e6)]);
    player.pos = sec;
    player.posAt = monoMs();
    this._updateProgress(player);
    log(`noir-island: seek ${mmss(dari)} -> ${mmss(sec)}`);
    Gio.DBus.session.call(player.name, MPRIS_PATH, PLAYER_IFACE, method, params,
      null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null, (conn, res) => {
        try {
          conn.call_finish(res);
        } catch (e) {
          // Player menolak: minta posisi sebenarnya kembali, jangan biarkan rail
          // berpura-pura sudah pindah.
          log(`noir-island: ${method} ditolak`);
          this._samplePosition(player);
        }
      });
  }

  // Artwork diturunkan ke file cache lalu dipasang sebagai background-image:
  // St tidak punya jalur pixbuf langsung (Gio.Icon.new_for_pixbuf tidak ada).
  _loadCover(url, key) {
    const id = key || 'tanpa-id';
    if (this._coverKey === id)
      return;
    this._coverKey = id;

    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'noir-island']);
    GLib.mkdir_with_parents(dir, 0o755);
    const file = Gio.File.new_for_path(
      GLib.build_filenamev([dir, `cover-${id}.png`]));

    if (file.query_exists(null)) {
      this._paintCover(file.get_path());
      return;
    }
    if (!url || !/^(https?|file):/.test(url)) {
      this._paintCover(null);
      return;
    }

    Gio.File.new_for_uri(url).load_contents_async(null, (src, res) => {
      let bytes;
      try {
        [, bytes] = src.load_contents_finish(res);
      } catch (e) {
        this._paintCover(null);
        return;
      }
      // GJS 1.80 mengembalikan Uint8Array, bukan GLib.Bytes, dari
      // load_contents_finish — MemoryInputStream hanya mau yang kedua.
      if (this._coverKey !== id || !bytes || !bytes.get_size && !bytes.length)
        return;
      try {
        const raw = bytes.get_size ? bytes : GLib.Bytes.new(bytes);
        const stream = Gio.MemoryInputStream.new_from_bytes(raw);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(
          stream, 2 * COVER_PX, 2 * COVER_PX, true, null);
        pixbuf.savev(file.get_path(), 'png', [], []);
      } catch (e) {
        this._paintCover(null);
        return;
      }
      if (this._coverKey === id)
        this._paintCover(file.get_path());
    });
  }

  _paintCover(path) {
    if (!this._cover)
      return;
    this._coverIcon.visible = !path;
    this._cover.set_style(path
      ? `background-image: url("${path}");`
      : 'background-image: none;');
  }

  // ------------------------------------------------------------- notifikasi

  _startTray() {
    this._tray = Main.messageTray;
    this._on(this._tray, 'source-added', (t, src) => this._watch(src));
    this._on(this._tray, 'source-removed', (t, src) => this._unwatch(src));
    for (const src of this._tray.getSources())
      this._watch(src);
  }

  _watch(src) {
    if (this._watched.has(src))
      return;
    const ids = [
      src.connect('notification-added', (s, n) => this._onNotify(s, n)),
      src.connect('notify::count', () => this._render()),
    ];
    this._watched.set(src, {src, ids});
    for (const n of src.notifications ?? [])
      this._hook(n);
    this._render();
  }

  _unwatch(src) {
    const rec = this._watched.get(src);
    if (!rec)
      return;
    rec.ids.forEach(id => src.disconnect(id));
    this._watched.delete(src);
    this._pending = this._pending.filter(x => x.src !== src);
    if (this._showing?.src === src)
      this._showing = null;
    this._render();
  }

  _hook(n) {
    if (this._hooked.has(n))
      return;
    this._hooked.set(n, [
      n.connect('destroy', () => {
        // Notifikasinya sudah mati, jadi handler-nya ikut mati bersama objeknya;
        // yang perlu dilepas hanyalah entri Map-nya.
        this._hooked.delete(n);
        this._pending = this._pending.filter(x => x.n !== n);
        if (this._showing?.n === n)
          this._showing = null;
        this._render();
      }),
      // Tombol bisa lahir setelah notifikasinya muncul (shell menambahkan
      // "Show in Files" pada screenshot), jadi isinya harus ikut dipantau.
      n.connect('action-added', () => this._onActions(n)),
      n.connect('action-removed', () => this._onActions(n)),
    ]);
  }

  // Diisi ulang tanpa menyentuh mesin state: kartu yang sedang tampil tidak
  // boleh berkedip hanya karena satu tombol tambahan tiba.
  _onActions(n) {
    if (this._showing?.n === n)
      this._fillActions(n);
  }

  // Satu titik catat: _onNotify, sebelum DND berhak menolak menampilkan. Pesan
  // kembar dari aplikasi yang sama menyatu di kepala karena daftar tersortir
  // terbaru-di-depan, dan `unread`-nya dihitung per kedatangan — bukan per
  // record — supaya tiga pesan sama yang satu di antaranya sempat tampil masih
  // menyisakan dua di badge.
  _catat(src, n) {
    const app = String(src?.title ?? '');
    const judul = String(n.title ?? '');
    const sekarang = monoMs();
    let rec = this._log[0];
    if (!rec || rec.app !== app || rec.title !== judul) {
      rec = {app, title: judul, at: sekarang, unread: 0};
      this._log.unshift(rec);
      while (this._log.length > LOG_MAX)
        this._log.pop();
    }
    rec.at = sekarang;
    rec.unread++;
    return rec;
  }

  _unread() {
    const batas = monoMs() - LOG_TTL_MS;
    let banyak = 0;
    for (const r of this._log) {
      if (r.at < batas)
        break;
      banyak += r.unread;
    }
    return banyak;
  }

  // Antrean selalu tersortir urgensi turun, dan sisipnya memakai "<" ketat
  // sehingga sesama urgensi tetap FIFO. `_surface()` tinggal mengambil kepala;
  // kalau tidak tersortir, critical yang baru masuk harus menunggu satu hold
  // penuh di belakang yang dia singkirkan sendiri.
  _enqueue(item) {
    let i = this._pending.length;
    while (i > 0 && this._pending[i - 1].n.urgency < item.n.urgency)
      i--;
    this._pending.splice(i, 0, item);
    while (this._pending.length > QUEUE_MAX)
      this._pending.pop();
  }

  _onNotify(src, n) {
    this._hook(n);
    if (this._showing?.n === n || this._pending.some(x => x.n === n))
      return;
    // Dicatat sebelum DND menolak: jejak tinggal di badge meski island tidak
    // pernah menampilkan, dan menyalakan DND tidak boleh membuat pesan hilang
    // tanpa bekas.
    const rec = this._catat(src, n);
    if (this._dndOff())
      return;

    // Island yang sedang tidur dibangunkan oleh notifikasi baru, sama seperti
    // pointer yang datang dekat panel.
    this._wake();
    this._enqueue({src, n, rec});

    // Yang lebih urgent menyingkirkan yang sedang tampil; yang lama masuk
    // kembali lewat sisip yang sama, jadi ia tidak hilang dan tidak ikut
    // mendorong antrean.
    if (this._showing && n.urgency > this._showing.n.urgency) {
      const lama = this._showing;
      this._showing = null;
      this._enqueue({src: lama.src, n: lama.n, rec: lama.rec});
    }
    if (!this._showing)
      this._surface();
    // Tutup manual = perintah user, bukan fluktuasi isi: state berikutnya harus
    // langsung diterima, tidak boleh ditahan dwell.
    this._forced = true;
    this._render();
  }

  _surface() {
    // DND aktif: antrean yang tertinggal dibuang, bukan ditahan. Kalau tidak,
    // _pending tetap terisi selamanya dan _hasContent() tidak pernah memberi
    // izin tidur.
    if (this._dndOff()) {
      this._pending = [];
      return;
    }
    if (this._showing || !this._pending.length)
      return;
    const item = this._pending.shift();
    const urgency = item.n.urgency;
    // Tampil = terbayar: record-nya kehilangan satu tagihan badge. Yang tidak
    // pernah sampai ke baris ini (DND membuang antrean, aktornya mati duluan)
    // tetap tertagih, dan itu justru isi badge.
    if (item.rec && item.rec.unread > 0)
      item.rec.unread--;
    // Critical tidak kedaluwarsa menurut freedesktop, tapi tanpa batas island
    // jadi sandera satu kartu: media dan notif berikutnya tidak pernah tampil
    // lagi dan tidak ada satu pun log baru. Batas panjang tapi nyata.
    const hold = urgency >= Urgency.CRITICAL ? this._opt.holdCritical
      : urgency >= Urgency.HIGH ? this._opt.holdHigh : this._opt.holdNormal;
    const sekarang = monoMs();
    this._showing = {
      src: item.src,
      n: item.n,
      rec: item.rec,
      until: sekarang + hold,
      // Atap untuk perpanjangan saat pointer di atas kartu. Tanpa atap, pointer
      // yang ditinggal duduk di atas island mengunci satu kartu selamanya.
      ceiling: sekarang + hold + this._opt.holdHoverExtra,
    };
    // Suara dulu dimainkan messageTray lewat _updateShowingNotification(); begitu
    // banner diblok jalur itu tidak pernah jalan lagi, dan satu-satunya pemanggil
    // playSound() di shell 46 adalah sana. Island yang mengambil alih tampilnya
    // notifikasi, jadi ia juga yang mengambil alih suaranya.
    item.n.playSound();
  }

  _dismiss() {
    const showing = this._showing;
    if (!showing)
      return;
    this._showing = null;
    showing.n.destroy();
    this._surface();
    this._render();
  }

  _openTarget() {
    const showing = this._showing;
    if (!showing)
      return;
    this._wake();
    this._showing = null;
    showing.n.activate();
    this._surface();
    this._render();
  }

  _tick() {
    // panel.js menulis bannerBlocked buta saat menu searah banner ditutup, jadi
    // blok kita bisa hilang tanpa ada kejadian yang memberi tahu island. Tick
    // 500 dtk adalah cara termurah untuk tidak pernah kalah balapan dengan shell.
    this._syncBannerBlock();
    if (++this._scanEvery >= SCAN_TICKS) {
      this._scanEvery = 0;
      this._scan();
    }
    // Agenda punya jam sendiri yang lebih lambat: labelnya berisi jam acara,
    // jadi satu menit cukup untuk memindahkan pil ke acara berikutnya. Celah
    // ini juga pintu kedua untuk _askAgenda() — kalau CalendarServer belum
    // punya pemilik nama saat enable(), percobaan berikutnya datang dari sini.
    if (++this._agendaEvery >= AGENDA_TICKS) {
      this._agendaEvery = 0;
      this._askAgenda();
      this._syncAgenda();
    }
    // Cuaca juga dipanggil per menit, tapi kerjanya hanya satu perbandingan umur:
    // kalau datanya masih segar, jalur ini tidak menyentuh jaringan sama sekali.
    if (++this._weatherEvery >= WEATHER_TICKS) {
      this._weatherEvery = 0;
      this._refreshWeather();
    }
    // Pengumuman kedaluwarsa: peek turun ke pill, atau island tidur kalau
    // pointer tidak pernah ikut datang. Tick 500 ms sudah cukup murah untuk
    // jadi satu-satunya jam peek, timer kedua cuma menambah jalur yang bisa
    // bocor saat disable().
    if (this._peekUntil && monoMs() >= this._peekUntil) {
      this._peekUntil = 0;
      this._render();
    }
    // Jam idle: tanpa aksi, island menutup total — card turun lebih dulu, pill
    // media ikut tidur. Yang membangunkannya hanya pointer yang datang dekat
    // panel (lihat _pollHover), notifikasi baru (lihat _onNotify), dan isi baru
    // (lihat _render); yang tidak membangunkan adalah waktu yang berlalu.
    // Pointer yang BERDIRI di atas island dikecualikan: _awake() sudah
    // memperlakukan hoverOn sebagai bangun, jadi jam yang menjatuhkan card di
    // tengah tangan adalah kontradiksi — dan itu membuat jalan pulang lewat klik
    // (kolom teks card media) tidak pernah sempat dipanggil. Rig menangkapnya
    // sebagai card yang menyusut sendiri 6 dtk sesudah dibuka tanpa pointer
    // bergerak sama sekali.
    if (this._wakeUntil && monoMs() >= this._wakeUntil && !this._hoverOn) {
      this._wakeUntil = 0;
      this._peekUntil = 0;
      this._cardOpen = false;
      this._render();
    }
    // Kartu notif tidak boleh kabur di depan mata: selama pointer berdiri di
    // atas island, jam jatuhnya digeser ikut tick (dibatasi ceiling dari
    // _surface()). Tanpa ini masa tampil 15 dtk adalah satu-satunya kesempatan
    // user membaca sebelum kartunya hilang — dan banner messageTray sudah kita
    // blokir, jadi tidak ada wajah kedua yang menampung sisanya.
    if (this._showing) {
      if (this._pointerOverIsland())
        this._showing.until = Math.min(this._showing.until + TICK_MS,
          this._showing.ceiling);
      if (monoMs() >= this._showing.until) {
        this._showing = null;
        this._surface();
        this._render();
      }
    } else if (this._state === 'media') {
      const player = this._pick();
      if (player) {
        if (player.status === 'Playing')
          this._samplePosition(player);
        this._updateProgress(player);
      }
    }

    if (this._telemetryRow && this._telemetryRow.visible)
      this._fillTelemetry();
    if (this._timerRow && this._timerRow.visible)
      this._fillTimer();
    if (this._dropRow && this._dropRow.visible)
      this._fillDrop();
    if (this._clipRow && this._clipRow.visible)
      this._fillClip();
    if (this._cmdRow && this._cmdRow.visible)
      this._fillCmd();
    if (this._radioRow && this._radioRow.visible) {
      if (this._micOn)
        this._radioDuration++;
      else
        this._radioDuration = 0;
      this._fillRadio();
    }
    if (this._radarRow && this._radarRow.visible)
      this._fillRadar();
    if (this._ignitionRow && this._ignitionRow.visible)
      this._fillIgnition();
    this._syncClip();

    // Jam mundur mulai jalan saat memang tidak ada isi. Celah 1 dtk antara trek
    // terakhir dan trek berikutnya tidak boleh membuat island kedip masuk-keluar.
    const bicara = this._hasContent(this._pick());
    if (bicara || this._stowed) {
      this._stowAt = 0;
    } else if (this._stowAt) {
      if (monoMs() >= this._stowAt)
        this._stow();
    } else {
      this._stowAt = monoMs() + STOW_GRACE_MS;
    }
    // Slot ambient ikut diuji tiap tick, bukan hanya saat ada kejadian: provider
    // adalah satu-satunya isi yang bisa berubah tanpa sinyal apa pun (nilai
    // sensor, agenda berikutnya, cuaca). _render() sudah memotong di kunci
    // lukisan dan di cek "tidur tanpa isi", jadi memanggilnya buta tiap 500 dtk
    // lebih murah daripada merawat jam kedua yang bisa bocor saat disable().
    this._render();
  }
}
