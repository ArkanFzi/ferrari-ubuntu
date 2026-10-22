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
const IDLE_W = 156;
const IDLE_H = 34;
const MEDIA_W = 452;
const MEDIA_H = 64;
const NOTIF_W = 474;
const NOTIF_H = 72;
const PROGRESS_H = 3;
// Sudut bawah card melengkung 22 px; pada tinggi 3 px lengkungan itu sudah
// masuk 11 px dari tepi, jadi rel progres berhenti di situ supaya tidak
// mencuat keluar siluet (St tidak punya clip-path/mask).
const PROG_INSET = 11;
const COVER_PX = 44;

const ANIM_MS = 260;
const FADE_MS = 120;
const HOLD_MS = 8000;
const HOLD_HIGH_MS = 20000;
const TICK_MS = 500;
const DBUS_TIMEOUT_MS = 400;
const QUEUE_MAX = 8;
const BODY_MAX = 160;
const SCAN_TICKS = 4;

const SIZE = {
  idle: [IDLE_W, IDLE_H],
  media: [MEDIA_W, MEDIA_H + PROGRESS_H],
  notif: [NOTIF_W, NOTIF_H],
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
    this._inputOn = null;
    this._coverKey = null;
    this._progW = IDLE_W - 2 * PROG_INSET;
    this._fullscreen = false;
    this._tickId = null;
    this._scanEvery = 0;

    this._notifSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.notifications',
    });

    this._buildIsland();
    Main.layoutManager.addChrome(this._island, {affectsInputRegion: false});
    this._inputOn = false;
    this._place();

    this._on(global.display, 'in-fullscreen-changed', () => {
      this._fullscreen = !!Main.layoutManager.primaryMonitor?.inFullscreen;
      this._render();
    });
    this._on(Main.layoutManager, 'monitors-changed', () => this._place());
    this._on(Main.panel, 'notify::height', () => this._place());
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
    this._render();
    log('noir-island: aktif');
  }

  disable() {
    if (this._tickId)
      GLib.source_remove(this._tickId);
    this._tickId = null;

    for (const [obj, id] of this._pairs)
      obj.disconnect(id);
    this._pairs = [];

    for (const {src, ids} of this._watched.values())
      ids.forEach(id => src.disconnect(id));
    this._watched.clear();

    // Handler destroy menempel pada notifikasi milik shell, jadi ikut dilepas
    // supaya tidak memanggil _render() setelah extension mati.
    for (const [n, id] of this._hooked.values())
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
    this._inputOn = null;
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
    island.set_size(IDLE_W, IDLE_H);
    this._island = island;

    // Pill: keadaan diam, dan keadaan jeda (track terakhir masih terbaca di bus).
    this._pillRow = new St.BoxLayout({style_class: 'noir-island-pad'});
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
    this._pillRow.add_child(this._dot);
    this._pillRow.add_child(this._pillKicker);
    this._pillRow.add_child(this._hairline());
    this._pillRow.add_child(this._pillText);
    this._pillRow.add_child(this._pillBadge);
    island.add_child(this._pillRow);

    // Media: artwork, tiga baris teks (judul/artis/album), transport.
    this._mediaRow = new St.BoxLayout({
      style_class: 'noir-island-pad noir-island-row',
      visible: false,
    });
    this._cover = new St.Bin({
      style_class: 'noir-island-cover',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
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
    });
    this._progressFill = new St.Widget({style_class: 'noir-island-progfill'});
    this._progress.add_child(this._progressFill);
    island.add_child(this._progress);

    // Notifikasi: rail rosso, ikon sumber dalam tile, tiga baris teks, tombol.
    // Baris ini sengaja tidak memakai noir-island-pad supaya rail dan tile
    // menyentuh tepi card; gantinya tile dan tombol membawa margin sendiri.
    this._notifRow = new St.BoxLayout({
      style_class: 'noir-island-row',
      visible: false,
    });
    this._rail = new St.Widget({style_class: 'noir-island-rail'});
    this._iconBin = new St.Bin({
      style_class: 'noir-island-tile',
      x_align: Clutter.ActorAlign.FILL,
      y_align: Clutter.ActorAlign.FILL,
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
    const label = new St.Label({style_class: className, x_expand: true});
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

  // Sudut kiri-atas card untuk satu lebar. Island menggantung rata di tepi
  // bawah panel, bukan melayang di bawahnya.
  _anchor(w) {
    const mon = Main.layoutManager.primaryMonitor;
    return [
      Math.round(mon.x + (mon.width - w) / 2),
      Math.round(mon.y + (Main.panel.height || 0)),
    ];
  }

  _place() {
    const mon = Main.layoutManager.primaryMonitor;
    if (!mon || !this._island)
      return;
    const [x, y] = this._anchor(this._island.width || IDLE_W);
    this._island.set_position(x, y);
  }

  // Island hanya boleh merebut klik saat melebar. Input region chrome ditentukan
  // saat actor dipasang, jadi bentuknya diganti dengan pasang-ulang.
  _setInput(on) {
    if (this._inputOn === on || !this._island)
      return;
    this._inputOn = on;
    Main.layoutManager.removeChrome(this._island);
    Main.layoutManager.addChrome(this._island, {affectsInputRegion: on});
    this._island.set_reactive(on);
    this._place();
  }

  // Lebar state diambil dari isi teksnya, bukan dari angka tetap: judul panjang
  // dan label tombol tidak boleh terpotong. Konstanta SIZE jadi batas bawah,
  // 70% monitor jadi batas atas. Padding sudah ikut terhitung karena yang
  // diukur lebar natural barisnya sendiri, bukan isi di dalamnya.
  _widthFor(state) {
    const base = SIZE[state][0];
    const row = state === 'media' ? this._mediaRow
      : state === 'notif' ? this._notifRow : this._pillRow;
    if (!row)
      return base;
    const [, nat] = row.get_preferred_width(SIZE[state][1]);
    const mon = Main.layoutManager.primaryMonitor;
    const cap = mon ? Math.round(mon.width * 0.7) : base;
    return Math.min(cap, Math.max(base, nat));
  }

  _animateTo(state) {
    const mon = Main.layoutManager.primaryMonitor;
    if (!mon)
      return;
    const w = this._widthFor(state);
    const h = SIZE[state][1];
    const [x, y] = this._anchor(w);
    this._progW = Math.max(0, w - 2 * PROG_INSET);
    this._island.ease({
      width: w,
      height: h,
      x,
      y,
      duration: ANIM_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUINT,
    });
    this._progress.set_size(this._progW, PROGRESS_H);
    this._fadeTo(state);
    this._setInput(state !== 'idle');
  }

  // Teks yang muncul mendadak di tengah morph ukuran terlihat pop. Isi state
  // baru dinaikkan opacity-nya telat, setelah card hampir selesai melebar —
  // pola island yang tumbuh dulu baru menampilkan isinya.
  _fadeTo(state) {
    const rows = state === 'media' ? [this._mediaRow, this._progress]
      : state === 'notif' ? [this._notifRow] : [this._pillRow];
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

  _render() {
    if (!this._island)
      return;
    const player = this._pick();
    let state = 'idle';

    if (this._showing && !this._dndOff()) {
      const critical = this._showing.n.urgency >= Urgency.CRITICAL;
      if (!this._fullscreen || critical)
        state = 'notif';
    } else if (player && player.status === 'Playing' && !this._fullscreen) {
      state = 'media';
    }

    // Baris ditampilkan dan diisi dulu supaya lebar naturalnya terukur dari isi
    // yang benar-benar akan tampil, bukan dari isi state sebelumnya.
    this._pillRow.visible = state === 'idle';
    this._mediaRow.visible = state === 'media';
    this._progress.visible = state === 'media';
    this._notifRow.visible = state === 'notif';

    if (state === 'notif')
      this._fillNotif();
    else if (state === 'media')
      this._fillMedia(player);
    else
      this._fillPill(player);

    if (state !== this._state) {
      this._animateTo(state);
      const asal = state === 'media' ? player.identity
        : state === 'notif' ? String(this._showing?.src?.title ?? '?') : '';
      log(`noir-island: ${asal ? `${state} <- ${asal}` : state}`);
    }
    this._state = state;

    if (state === 'idle')
      this._island.remove_style_class_name('noir-island--live');
    else
      this._island.add_style_class_name('noir-island--live');
  }

  _fillPill(player) {
    const resting = player?.meta?.title ? player : null;
    this._pillKicker.set_text(resting ? 'JEDA' : 'DIAM');
    this._pillText.set_text(resting ? resting.meta.title : 'sunyi');
    // Antrean tetap terlihat saat island diam: notifikasi yang tertahan
    // (fullscreen / DND) tidak boleh hilang tanpa jejak.
    const queued = this._pending.length;
    this._pillBadge.visible = queued > 0;
    this._pillBadge.set_text(queued > 0 ? `+${queued}` : '');
  }

  _fillMedia(player) {
    const m = player.meta;
    this._mTitle.set_text(m.title);
    this._mArtist.set_text(m.artist || player.identity);
    this._mAlbum.set_text(m.album);
    this._mAlbum.visible = !!m.album;
    this._setPlayIcon(player.status);
    this._btnPrev.visible = player.canPrev !== false;
    this._btnNext.visible = player.canNext !== false;
    this._loadCover(m.art, m.key);
    this._updateProgress(player);
  }

  _updateProgress(player) {
    const m = player.meta;
    const elapsed = player.status === 'Playing'
      ? player.pos + player.rate * (monoMs() - player.posAt) / 1000
      : player.pos;
    this._time.set_text(m.length
      ? `${mmss(elapsed)} / ${mmss(m.length)}` : mmss(elapsed));
    const ratio = m.length ? Math.min(1, Math.max(0, elapsed / m.length)) : 0;
    this._progressFill.set_size(Math.round(this._progW * ratio), PROGRESS_H);
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

  _applyProps(entry, props) {
    const status = this._val(props.PlaybackStatus);
    if (status)
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

  _onNotify(src, n) {
    this._hook(n);
    if (this._showing?.n === n || this._pending.some(x => x.n === n))
      return;
    if (this._dndOff())
      return;

    this._pending.push({src, n});
    while (this._pending.length > QUEUE_MAX)
      this._pending.shift();

    // Yang lebih urgent menyingkirkan yang sedang tampil; yang lama antre lagi
    // di depan supaya tidak hilang.
    if (this._showing && n.urgency > this._showing.n.urgency) {
      this._pending.unshift({src: this._showing.src, n: this._showing.n});
      this._showing = null;
    }
    if (!this._showing)
      this._surface();
    this._render();
  }

  _surface() {
    if (this._showing || this._dndOff() || !this._pending.length)
      return;
    const item = this._pending.shift();
    const hold = item.n.urgency >= Urgency.HIGH ? HOLD_HIGH_MS : HOLD_MS;
    this._showing = {
      src: item.src,
      n: item.n,
      until: monoMs() + (item.n.urgency >= Urgency.CRITICAL ? Infinity : hold),
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
    if (this._showing && monoMs() >= this._showing.until) {
      this._showing = null;
      this._surface();
      this._render();
    } else if (this._state === 'media') {
      const player = this._pick();
      if (player)
        this._updateProgress(player);
    }
  }
}
