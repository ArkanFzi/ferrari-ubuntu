// noir-island@arkan — island melayang di tengah atas panel.
// Satu permukaan, tiga keadaan, satu antrean prioritas: NOTIF > MEDIA > IDLE.

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

const DBUS_IFACE = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_ROOT = 'org.mpris.MediaPlayer2';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

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
const MEDIA_W = 420;
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
// State baru harus bertahan sejenak sebelum diterima. Angka di bawah ambang
// kedip mata tapi di atas flapping player yang paling umum.
const DWELL_MS = 1200;
// Pengumuman isi (trek baru) melebar sebentar lalu mundur sendiri. Pointer di
// dalam region island tidak mempercepat maupun menahannya: level peek hanya
// soal lebar, bukan soal siapa yang boleh memegangnya.
const PEEK_MS = 3000;
// Hover dibaca lewat polling global.get_pointer(), bukan captured-event MOTION
// (di X11 tidak terkirim ke stage saat klien memegang pointer grab, jadi mati
// persis di atas video fullscreen) dan bukan track-input (Wayland). 8 query per
// detik saat island tertidur adalah harga tombol yang bisa diklik.
const HOVER_POLL_MS = 120;
// Dead band 20 px antara masuk dan keluar: tanpa itu pill yang persis seukuran
// region masuk akan nyala-mati tiap frame saat pointer berdiri di ambangnya.
const HOVER_IN_Y = 44;
const HOVER_OUT_Y = 64;
const HOVER_IN_X = 120;
const HOVER_OUT_X = 160;
// Dua poll (240 ms) untuk bangun, tiga (360 ms) untuk tidur: masuk harus terasa
// instan, keluar harus yakin.
const HOVER_IN_POLLS = 2;
const HOVER_OUT_POLLS = 3;
// Tarik-mundur ke bezel lebih cepat dari morph antar state: keluar harus terasa
// sebagai keputusan, bukan sebagai transisi yang sedang berlangsung.
const STOW_MS = 220;
const STOW_GRACE_MS = 4000;
const RAIL_MS = 200;
const HOLD_MS = 8000;
const HOLD_HIGH_MS = 20000;
const HOLD_CRITICAL_MS = 45000;
const TICK_MS = 500;
const DBUS_TIMEOUT_MS = 400;
const QUEUE_MAX = 8;
const BODY_MAX = 160;
const SCAN_TICKS = 4;
// Di bawah angka ini card tidak bisa memuat apa pun yang terbaca.
const MIN_W = 200;
// Seluruh isi card selain kolom judul pada state media: padding kiri-kanan
// (2x14), thumb (44), dua gap baris (2x10) dan kelompok kontrol lengkap
// (waktu + hairline + tiga tombol). Diukur di rig: card 420 px menyisakan
// 169 px untuk kolom teks.
const MEDIA_CHROME_W = 251;

// Geometri adalah fungsi dari (level, content), tidak pernah dari isinya. Pill
// dan peek cuma beda lebar; card mengambil angka per konten.
const CARD_W = {
  media: MEDIA_W,
  notif: NOTIF_W,
};

const CARD_H = {
  media: MEDIA_H + PROGRESS_H,
  notif: NOTIF_H,
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

export default class NoirIslandExtension extends Extension {
  enable() {
    this._players = new Map();
    this._pending = [];
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
    this._cardOpen = false;
    this._outsideId = 0;
    this._active = null;
    this._clockHiddenByUs = false;

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
      if (this._dndOff())
        this._showing = null;
      this._render();
    });

    this._startTray();
    this._startMpris();
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
    // Statement pertama, sebelum apa pun yang bisa melempar: satu-satunya
    // jaminan jam panel kembali kalau island sedang memakannya.
    this._setActive(false);
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

    for (const [obj, id] of this._pairs)
      obj.disconnect(id);
    this._pairs = [];

    for (const {src, ids} of this._watched.values())
      ids.forEach(id => src.disconnect(id));
    this._watched.clear();

    // Handler destroy menempel pada notifikasi milik shell, jadi ikut dilepas
    // supaya tidak memanggil _render() setelah extension mati. Yang diiterasi
    // adalah pasangan [notifikasi, id] milik Map itu sendiri — .values() hanya
    // mengeluarkan id (angka), dan menghancurkan sisa disable() di bawahnya.
    for (const [n, id] of this._hooked)
      n.disconnect(id);
    this._hooked.clear();

    this._pending = [];
    this._showing = null;

    for (const e of this._players.values())
      e.proxy.run_dispose();
    this._players.clear();

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

  // ---------------------------------------------------------------- permukaan

  _buildIsland() {
    const island = new St.BoxLayout({
      style_class: 'noir-island',
      vertical: true,
      reactive: false,
    });
    island.set_size(PILL_W, PILL_H);
    this._island = island;

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
      style_class: 'noir-island-kicker',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._noEllipsis(this._pillKicker);
    this._pillText = this._label('noir-island-line');
    this._pillBadge = new St.Label({
      style_class: 'noir-island-badge',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    pill.add_child(this._dot);
    pill.add_child(this._pillKicker);
    pill.add_child(this._hairline());
    pill.add_child(this._pillText);
    pill.add_child(this._pillBadge);
    island.add_child(this._pillRow);

    // Media: artwork, tiga baris teks (judul/artis/album), transport.
    this._mediaRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      y_expand: true,
      visible: false,
    });
    this._cover = new St.Bin({
      style_class: 'noir-island-cover',
      x_align: Clutter.ActorAlign.FILL,
      // CENTER, bukan FILL: tinggi 44 px di CSS hanya batas bawah, jadi Bin yang
      // fill ikut meregang setinggi barisnya (thumb jadi persegi panjang).
      y_align: Clutter.ActorAlign.CENTER,
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
    this._mTitle = this._label('noir-island-title');
    this._mArtist = this._label('noir-island-line');
    this._mAlbum = this._label('noir-island-faint');
    col.add_child(this._mTitle);
    col.add_child(this._mArtist);
    col.add_child(this._mAlbum);

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

    this._mediaRow.add_child(this._cover);
    this._mediaRow.add_child(col);
    this._mediaRow.add_child(ctl);
    island.add_child(this._mediaRow);

    this._progress = new St.Widget({
      style_class: 'noir-island-prog',
      visible: false,
      // Band setinggi 12 px, bar terlihat tetap 3 px di dasarnya: target pointer
      // 3 px tidak pernah bisa dipanggil, dan rail inilah satu-satunya jalur seek
      // di card.
      reactive: true,
    });
    this._progress.connect('button-press-event', (a, e) => this._seekAt(e));
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
    const btns = new St.BoxLayout({style_class: 'noir-island-actions'});
    btns.add_child(this._badge);
    btns.add_child(this._btnClose);
    btns.add_child(this._btnOpen);

    this._notifRow.add_child(this._rail);
    this._notifRow.add_child(this._iconBin);
    this._notifRow.add_child(ncol);
    this._notifRow.add_child(btns);
    island.add_child(this._notifRow);
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
    if (mon)
      this._mon = {x: mon.x, y: mon.y, width: mon.width};
    else if (this._mon)
      log('noir-island: primaryMonitor kosong, morph pakai geometri terakhir');
    return this._mon;
  }

  // Sudut kiri-atas card untuk satu lebar. Island menggantung rata di tepi
  // bawah panel, bukan melayang di bawahnya.
  _anchor(w) {
    const mon = this._monitor();
    return [
      Math.round(mon.x + (mon.width - w) / 2),
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
  // boleh merebut klik, apakah key line rosso menyala, dan apakah jam panel boleh
  // ada. Ketiganya harus naik-turun bersamaan, atau island bisa terlihat tapi
  // tidak bisa diklik — atau makan jam panel selamanya.
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
    this._setClock(!on);
  }

  // Jam panel hanya boleh dikembalikan kalau KITA yang menyembunyikannya: Just
  // Perfection menulis actor yang sama, dan show() buta akan memaksa tampil jam
  // yang memang dimatikan user di sana.
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

  // Hover diuji per poll, tidak pernah lewat sinyal: captured-event MOTION di
  // X11 tidak terkirim ke stage saat klien memegang pointer grab, dan track-input
  // tidak tersedia di Wayland.
  _pollHover() {
    const mon = this._monitor();
    if (!mon || !this._island)
      return;
    const [x, y] = global.get_pointer();
    const bawah = mon.y + (Main.panel.height || 0);
    const dx = Math.abs(x - (mon.x + mon.width / 2));
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
      if (this._cardOpen)
        return 'card';
      if (monoMs() < this._peekUntil)
        return 'peek';
      return this._hoverOn ? 'pill' : null;
    }
    return this._hoverOn ? 'pill' : null;
  }

  // Isi = sesuatu yang boleh tampil (aturan ada di _decideState) plus notifikasi
  // yang masih mengantre, karena pill +N menahan jejaknya, plus pointer yang
  // sedang berdiri dekat panel: tanpa clause terakhir, grace _tick() akan
  // menidurkan pill jam di tengah hover.
  _hasContent(player) {
    return this._decideState(player) !== 'idle' || this._pending.length > 0 ||
      this._hoverOn;
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
    // Habis tidur, render berikutnya wajib menggambar lagi walau isinya sama
    // persis: actor-nya sendiri baru saja dimatikan.
    this._sig = null;
    this._armOutside(false);
    this._setActive(false);
    for (const row of [this._pillRow, this._mediaRow, this._notifRow, this._progress])
      row.visible = false;
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

  _unstash(w, x, y) {
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
    island.set_size(w, 0);
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
    this._geo = `${w}x${h} @${x},${y} panel=${Math.round(Main.panel.height || 0)}`;
    this._progW = Math.max(0, w - 2 * PROG_INSET);
    this._unstash(w, x, y);
    this._island.ease({
      width: w,
      height: h,
      x,
      y,
      duration: ANIM_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUINT,
    });
    this._progress.set_size(this._progW, PROGRESS_H);
    this._fadeTo(level, content);
    this._setActive(true);
  }

  // Teks yang muncul mendadak di tengah morph ukuran terlihat pop. Isi state
  // baru dinaikkan opacity-nya telat, setelah card hampir selesai melebar —
  // pola island yang tumbuh dulu baru menampilkan isinya.
  _fadeTo(level, content) {
    const rows = level !== 'card' ? [this._pillRow]
      : content === 'notif' ? [this._notifRow] : [this._mediaRow, this._progress];
    for (const row of rows) {
      if (!row)
        continue;
      row.set_opacity(0);
      row.ease({
        opacity: 255,
        delay: Math.round(ANIM_MS * 0.35),
        duration: FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT,
      });
    }
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
    this._render();
  }

  _collapse() {
    if (!this._cardOpen)
      return;
    this._cardOpen = false;
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
    if (player && player.status === 'Playing' && !this._fullscreen)
      return 'media';
    return 'idle';
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
  // waktu (disuapi _tick() langsung, tanpa lewat render) dan geometri monitor
  // (dibersihkan lewat _relayout). Jam masuk sebagai menit, bukan detik.
  _signature(player, state) {
    if (state === 'notif') {
      const {src, n} = this._showing;
      return `notif|${src?.title ?? ''}|${n.title}|${n.body}|${n.urgency}|${this._pending.length}`;
    }
    if (state === 'media') {
      const m = player.meta;
      return `media|${m.title}|${m.artist}|${m.album}|${player.status}`
        + `|${player.canPrev}${player.canNext}|${m.key ?? m.title}`;
    }
    const resting = player?.meta?.title ? player : null;
    return `idle|${resting ? resting.meta.title : ''}|${this._pending.length}`;
  }

  _render() {
    if (!this._island)
      return;
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
    if (content === 'idle')
      this._cardOpen = false;

    // Isi dihitung dulu, baru level: _peekUntil yang dipasang di sini adalah
    // yang membuat level berikutnya jadi 'peek'.
    const isi = this._signature(player, content);
    if (isi !== this._isi) {
      this._isi = isi;
      if (content !== 'idle')
        this._peekUntil = monoMs() + PEEK_MS;
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
    this._armOutside(level === 'card' && content === 'media');

    // Jam menit masuk ke kunci lukisan pill, bukan ke signature isi: pill harus
    // mengganti angkanya sekali semenet, tapi card media tidak boleh tergambar
    // ulang karena jam.
    const jam = GLib.DateTime.new_now_local().format('%H:%M');
    const kunci = level === 'card' ? `${isi}|${level}` : `${isi}|${level}|${jam}`;

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

    if (card && content === 'notif')
      this._fillNotif();
    else if (card)
      this._fillMedia(player);
    else
      this._fillPill(player, content, jam);

    // Morph hanya kalau bentuk benar-benar berganti (atau island baru bangun).
    // Ganti trek di dalam level yang sama menurunkan opacity/isi, bukan ukuran.
    const bentuk = `${level}|${content}`;
    if (bentuk !== this._shape || this._stowed)
      this._animateTo(level, content);
    const asal = content === 'media' ? player.identity
      : content === 'notif' ? String(this._showing?.src?.title ?? '?') : '';
    log(`noir-island: ${asal ? `${content} <- ${asal}` : content} ${level} ${this._geo}`);
    this._state = content;
    this._level = level;
    this._shape = bentuk;
  }

  _fillPill(player, content, jam) {
    // Pill selalu membawa jam di slot kicker: dialah yang menggantikan jam panel,
    // jadi island tidak boleh memakan jam lalu menggantinya dengan judul lagu.
    this._pillKicker.set_text(jam);
    this._pillText.set_text(content === 'media' ? player.meta.title
      : GLib.DateTime.new_now_local().format('%a %d %b'));
    // Antrean tetap terlihat saat island diam: notifikasi yang tertahan
    // (fullscreen / DND) tidak boleh hilang tanpa jejak.
    const queued = this._pending.length;
    this._pillBadge.visible = queued > 0;
    this._pillBadge.set_text(queued > 0 ? `+${queued}` : '');
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
    if (ganti)
      this._mediaRow.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT});
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
    this._mAlbum.visible = !!this._mAlbum.text && muat(this._mAlbum);
    this._mArtist.visible = muat(this._mArtist);
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
  }

  _fillNotif() {
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
    const queued = this._pending.length;
    this._badge.visible = queued > 0;
    this._badge.set_text(queued > 0 ? `+${queued}` : '');
    this._iconBin.set_child(this._notifIcon(src));
    // Rel rosso adalah gestur masuknya kartu: dialirkan dari tepi atas ke bawah
    // sekali per notifikasi. Baris ini dipanggil ulang tiap ada kejadian lain,
    // jadi animasinya dibedakan lewat identitas notifikasinya, tidak tiap render.
    if (this._shownNotif !== n) {
      this._shownNotif = n;
      this._rail.set_pivot_point(0.5, 0);
      this._rail.set_scale(1, 0);
      this._rail.ease({
        scale_y: 1,
        duration: RAIL_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUINT,
      });
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
      if (!this._players.has(name))
        this._attachPlayer(name);
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
      seen: monoMs(),
    };
    this._players.set(name, entry);
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
    this._hooked.set(n, n.connect('destroy', () => {
      this._hooked.delete(n);
      this._pending = this._pending.filter(x => x.n !== n);
      if (this._showing?.n === n)
        this._showing = null;
      this._render();
    }));
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
    if (this._dndOff())
      return;

    this._enqueue({src, n});

    // Yang lebih urgent menyingkirkan yang sedang tampil; yang lama masuk
    // kembali lewat sisip yang sama, jadi ia tidak hilang dan tidak ikut
    // mendorong antrean.
    if (this._showing && n.urgency > this._showing.n.urgency) {
      const lama = this._showing;
      this._showing = null;
      this._enqueue({src: lama.src, n: lama.n});
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
    // Critical tidak kedaluwarsa menurut freedesktop, tapi tanpa batas island
    // jadi sandera satu kartu: media dan notif berikutnya tidak pernah tampil
    // lagi dan tidak ada satu pun log baru. Batas panjang tapi nyata.
    const hold = urgency >= Urgency.CRITICAL ? HOLD_CRITICAL_MS
      : urgency >= Urgency.HIGH ? HOLD_HIGH_MS : HOLD_MS;
    this._showing = {
      src: item.src,
      n: item.n,
      until: monoMs() + hold,
    };
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
    this._showing = null;
    showing.n.activate();
    this._surface();
    this._render();
  }

  _tick() {
    if (++this._scanEvery >= SCAN_TICKS) {
      this._scanEvery = 0;
      this._scan();
    }
    // Pengumuman kedaluwarsa: peek turun ke pill, atau island tidur kalau
    // pointer tidak pernah ikut datang. Tick 500 ms sudah cukup murah untuk
    // jadi satu-satunya jam peek, timer kedua cuma menambah jalur yang bisa
    // bocor saat disable().
    if (this._peekUntil && monoMs() >= this._peekUntil) {
      this._peekUntil = 0;
      this._render();
    }
    if (this._showing && monoMs() >= this._showing.until) {
      this._showing = null;
      this._surface();
      this._render();
    } else if (this._state === 'media') {
      const player = this._pick();
      if (player) {
        if (player.status === 'Playing')
          this._samplePosition(player);
        this._updateProgress(player);
      }
    }

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
  }
}
