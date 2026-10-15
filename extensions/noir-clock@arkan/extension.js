// Jam analog di layer desktop. Digambar dengan Cairo, bukan CSS, supaya bisa
// presisi: wajah noir, jarum detik Rosso Corsa, dan redline 5 detik terakhir
// sebelum jam 12 (analogi garis merah pada tachometer).
//
// GNOME 46: St.DrawingArea tidak punya signal 'draw' lagi — pakai vfunc_repaint()
// + get_context() (pola yang sama dipakai ui/barLevel.js upstream).
//
// TIER 22 menambahkan layar ambient: setelah dua menit tanpa input, veil noir
// menutup desktop dan jam yang sama dipasang besar di tengah. idle-delay=0 sudah
// membuat shell tidak pernah mematikan layar, jadi fitur ini murni tambahan —
// tidak menyentuh gsettings maupun power policy.
//
// TIER 22b: "tidak ada input" ternyata bukan "tidak ada aktivitas". Video yang
// diputar tanpa disentuh membuat veil menutupi YouTube (suara jalan, layar jadi
// jam besar) dan overview terbuka di belakangnya. Jadi veil sekarang punya tiga
// rem — media MPRIS yang sedang Playing, inhibitor gnome-session, jendela
// fullscreen — plus satu layanan baru: selama media jalan noir-clock memegang
// Inhibit(Suspend|Idle) supaya laptop juga benar-benar tidak tertidur.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Cairo from 'gi://cairo';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DIAL = 260;          // garis tengah, px
const RIGHT_MARGIN = 46;   // jarak ke tepi kanan monitor
const TOP_BIAS = 0;        // + turun, - naik, dari tengah vertikal
const TICK_MS = 100;       // 10 Hz -> jarum detik menyapu, bukan berdetak

const AMB_DIAL = 560;           // garis tengah jam saat ambient, px
const AMB_IDLE_MS = 120 * 1000; // dua menit tanpa input
const AMB_RISE_MS = 800;
const AMB_FALL_MS = 300;
const AMB_REPAINT = 10;    // tick: saat ambient penuh jarum detik berdetak 1 Hz
const AMB_STROKE = 0.7;    // tebal garis terhadap jam desktop, lihat paintFace()
const AMB_ALPHA = 0.72;    // wajah redup, jarum detik tetap terbaca
const AMB_RAISE = 0.06;    // jam dinaikkan sekian fraksi dari tinggi layar

// Veil menuntut CPU saat layar tidak dimatikan oleh power policy, jadi ia hanya
// muncul waktu adaptor terpasang. UPower dibaca langsung: shell 46 tidak
// mengekspor proxy dayanya ke ekstensi.
const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const UPOWER_IFACE = 'org.freedesktop.UPower';

// Rem aktivitas. MPRIS dipakai karena "player ada" tidak sama dengan "media
// jalan": nama bus Chrome tetap terpasang saat video di-pause, jadi yang dibaca
// adalah PlaybackStatus. ListNames sinkronik (~1 ms) lebih murah daripada
// menunggu PropertiesChanged dari puluhan player yang tidak dikenal.
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const DBUS_IFACE = 'org.freedesktop.DBus';
const DBUS_TIMEOUT_MS = 100;

// Inhibitor gnome-session: aplikasi yang memegang Suspend/Idle (video player,
// presentasi, SSH session) adalah sinyal paling kuat bahwa layar tidak boleh
// ditutup. Cookie milik noir-clock sendiri disingkirkan dari perhitungan, kalau
// tidak fitur ini jadi mengunci dirinya sendiri.
const SESSION_BUS = 'org.gnome.SessionManager';
const SESSION_PATH = '/org/gnome/SessionManager';
const SESSION_IFACE = 'org.gnome.SessionManager';
const INHIBIT_SUSPEND = 1;
const INHIBIT_IDLE = 2;
const APP_ID = 'noir-clock@arkan';
const INHIBIT_REASON = 'noir-clock: pemutaran media';

// Saat veil sudah naik, status media dicek tiap tick; saat desktop biasa cek
// baru dimulai setelah idle mencapai AMB_WATCH_MS, supaya ListNames tidak
// dipanggil 10 kali per detik tanpa alasan.
const AMB_WATCH_MS = 60 * 1000;
const MEDIA_POLL_US = 1000 * 1000;

// Jendela anti-kejut: idle monitor kompositor tidak selalu naik lagi setelah
// gesture (tiga jari, empat jari) atau setelah overview dibuka-tutup. Jadi
// noir-clock menyimpan jam aktivitas versinya sendiri, berasal dari idle time
// yang TURUN, dan tidak menaikkan veil selama jendela ini masih terbuka.
const WAKE_WINDOW_US = 5000 * 1000;

const ROSSO = [0.855, 0.161, 0.110];   // #da291c — TIER 0
const BIANCO = [0.949, 0.949, 0.949];  // #f2f2f2
const NOIR = [0.04, 0.04, 0.04];

const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;

// Mesin status veil.
const S_OFF = 0;   // desktop biasa, jam kecil ikut berdetak 10 Hz
const S_RISE = 1;  // veil masuk
const S_ON = 2;    // veil penuh
const S_FALL = 3;  // veil keluar

function setRgb(cr, color, alpha) {
  cr.setSourceRGBA(color[0], color[1], color[2], alpha);
}

function drawHand(cr, cx, cy, angle, len, tail, width, color, alpha) {
  cr.setLineCap('round');
  cr.setLineWidth(width);
  setRgb(cr, color, alpha);
  cr.moveTo(cx - Math.cos(angle) * tail, cy - Math.sin(angle) * tail);
  cr.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
  cr.stroke();
}

// Satu wajah untuk dua ukuran. Semua jarak ditulis sebagai fraksi r (patokan
// r = 128, yaitu jam desktop) sehingga memperbesar tidak mengubah proporsinya;
// w mengali tebal garis dan a mengali alpha, dua hal yang justru harus ditahan
// saat wajah jadi besar supaya tidak terasa berat.
function paintFace(cr, cx, cy, r, w, a) {
  cr.setLineWidth(1 * w);
  cr.arc(cx, cy, r, 0, TWO_PI);
  setRgb(cr, NOIR, 0.55 * a);
  cr.fillPreserve();
  setRgb(cr, BIANCO, 0.16 * a);
  cr.stroke();

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * TWO_PI - HALF_PI;
    const major = i % 5 === 0;
    const inner = r * (major ? 0.844 : 0.906);
    cr.setLineWidth((major ? 2 : 1) * w);
    setRgb(cr, BIANCO, (major ? 0.5 : 0.18) * a);
    cr.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    cr.lineTo(cx + Math.cos(angle) * r * 0.969, cy + Math.sin(angle) * r * 0.969);
    cr.stroke();
  }

  cr.setLineWidth(3 * w);
  setRgb(cr, ROSSO, 0.85 * a);
  cr.arc(cx, cy, r * 0.992, -HALF_PI - (5 / 60) * TWO_PI, -HALF_PI);
  cr.stroke();

  paintNumerals(cr, cx, cy, r, a);

  const now = GLib.DateTime.new_now_local();
  const sec = now.get_second() + now.get_microsecond() / 1e6;
  const min = now.get_minute() + sec / 60;
  const hour = (now.get_hour() % 12) + min / 60;

  drawHand(cr, cx, cy, (hour / 12) * TWO_PI - HALF_PI, r * 0.50, r * 0.10, 5 * w, BIANCO, 0.95 * a);
  drawHand(cr, cx, cy, (min / 60) * TWO_PI - HALF_PI, r * 0.74, r * 0.12, 3 * w, BIANCO, 0.95 * a);
  drawHand(cr, cx, cy, (sec / 60) * TWO_PI - HALF_PI, r * 0.82, r * 0.22, 1.6 * w, ROSSO, 1 * a);

  cr.arc(cx, cy, r * 0.039, 0, TWO_PI);
  setRgb(cr, NOIR, 1);
  cr.fillPreserve();
  cr.setLineWidth(1.6 * w);
  setRgb(cr, ROSSO, 1 * a);
  cr.stroke();
}

function paintNumerals(cr, cx, cy, r, a) {
  const layout = PangoCairo.create_layout(cr);
  const desc = new Pango.FontDescription();
  desc.set_family('Titillium Web');
  desc.set_weight(Pango.Weight.LIGHT);
  desc.set_absolute_size(r * 0.19 * Pango.SCALE);
  layout.set_font_description(desc);

  for (const [num, angle] of [[12, -HALF_PI], [3, 0], [6, HALF_PI], [9, Math.PI]]) {
    layout.set_text(`${num}`, -1);
    const [, logical] = layout.get_pixel_extents();
    cr.moveTo(
      cx + Math.cos(angle) * r * 0.72 - logical.width / 2 - logical.x,
      cy + Math.sin(angle) * r * 0.72 - logical.height / 2 - logical.y);
    setRgb(cr, BIANCO, 0.78 * a);
    PangoCairo.show_layout(cr, layout);
  }
}

const Dial = GObject.registerClass(class Dial extends St.DrawingArea {
  _init() {
    super._init({
      width: DIAL,
      height: DIAL,
      reactive: false,
      can_focus: false,
    });
  }

  vfunc_repaint() {
    const cr = this.get_context();
    const [width, height] = this.get_surface_size();
    paintFace(cr, width / 2, height / 2, Math.min(width, height) / 2 - 2, 1, 1);
    cr.$dispose();
  }
});

const Ambient = GObject.registerClass(class Ambient extends St.DrawingArea {
  _init() {
    super._init({
      reactive: false,
      can_focus: false,
      visible: false,
    });
  }

  vfunc_repaint() {
    const cr = this.get_context();
    const [width, height] = this.get_surface_size();
    this._paint(cr, width, height);
    cr.$dispose();
  }

  _paint(cr, width, height) {
    const cx = width / 2;
    const cy = Math.round(height * (0.5 - AMB_RAISE));
    const r = Math.min(AMB_DIAL, height * 0.62) / 2;

    // Veil gradien radial, bukan warna datar: tengah naik sedikit, sudut jatuh
    // ke hitam, jadi layar terasa seperti dashboard yang menyala sendiri.
    const veil = new Cairo.RadialGradient(cx, cy, 0, cx, cy, Math.hypot(width, height) / 2);
    veil.addColorStopRGBA(0, 0.045, 0.045, 0.052, 0.975);
    veil.addColorStopRGBA(0.6, 0.020, 0.020, 0.024, 0.988);
    veil.addColorStopRGBA(1, 0, 0, 0, 0.996);
    cr.setSource(veil);
    cr.paint();

    paintFace(cr, cx, cy, r, AMB_STROKE, AMB_ALPHA);

    const layout = PangoCairo.create_layout(cr);
    const desc = new Pango.FontDescription();
    desc.set_family('Titillium Web');
    desc.set_weight(Pango.Weight.LIGHT);
    desc.set_absolute_size(r * 0.115 * Pango.SCALE);
    layout.set_font_description(desc);
    const tanggal = new Intl.DateTimeFormat(undefined,
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date()).toUpperCase();
    layout.set_text(tanggal, -1);
    const [, logical] = layout.get_pixel_extents();
    cr.moveTo(cx - logical.width / 2 - logical.x,
      cy + r * 1.25 - logical.height / 2 - logical.y);
    setRgb(cr, BIANCO, 0.42);
    PangoCairo.show_layout(cr, layout);
  }
});

function shieldUp() {
  const shield = Main.screenShield;
  return !!shield && (shield.active || shield.locked);
}

export default class NoirClockExtension extends Extension {
  enable() {
    this._dial = new Dial();
    Main.layoutManager._backgroundGroup.add_child(this._dial);
    this._place();

    this._idle = global.backend.get_core_idle_monitor();
    this._onBattery = false;
    this._state = S_OFF;
    this._frame = 0;

    // Status aktivitas: media yang sedang Playing, inhibitor orang lain, dan jam
    // wake lokal. _lastIdle dipakai untuk mendeteksi idle time yang turun
    // (= user bergerak) tanpa percaya penuh pada gesture.
    this._mediaPlaying = false;
    this._sessionBlocked = false;
    this._lastIdle = 0;
    this._lastWakeUs = 0;
    this._pollUs = 0;
    this._sessionProxy = null;
    this._inhibitCookie = 0;

    // addTopChrome(): veil harus menutupi panel dan dock juga — jam ambient di
    // belakang dock yang menyala terlihat rusak. Konsekuensinya ia ikut di atas
    // layar kunci, jadi _dropAmbient() wajib dipanggil begitu shield naik.
    this._amb = new Ambient();
    Main.layoutManager.addTopChrome(this._amb, { affectsInputRegion: false });
    this._amb.opacity = 0;

    this._watchPower();
    this._watchSession();
    this._placeAmbient();

    this._monId = Main.layoutManager.connect('monitors-changed', () => {
      this._place();
      this._placeAmbient();
    });
    this._shieldIds = [
      Main.screenShield.connect('active-changed', () => this._dropAmbient()),
      Main.screenShield.connect('locked-changed', () => this._dropAmbient()),
    ];

    this._tick = GLib.timeout_add(GLib.PRIORITY_LOW, TICK_MS, () => {
      this._step();
      return GLib.SOURCE_CONTINUE;
    });
    log('noir-clock: jam desktop + ambient siap');
  }

  _place() {
    const mon = Main.layoutManager.primaryMonitor;
    this._dial.set_position(
      mon.x + mon.width - DIAL - RIGHT_MARGIN,
      mon.y + Math.round((mon.height - DIAL) / 2) + TOP_BIAS);
  }

  _placeAmbient() {
    const mon = Main.layoutManager.primaryMonitor;
    this._amb.set_position(mon.x, mon.y);
    this._amb.set_size(mon.width, mon.height);
  }

  _watchPower() {
    try {
      this._powerProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE, null, UPOWER_BUS, UPOWER_PATH,
        UPOWER_IFACE, null);
    } catch (e) {
      // Mesin tanpa UPower (desktop stasioner): ambient boleh selalu tampil.
      return;
    }
    this._powerChangedId = this._powerProxy.connect('g-properties-changed',
      () => {
        this._onBattery = !!this._powerProxy.get_cached_property('OnBattery')?.unpack();
      });
    this._onBattery = !!this._powerProxy.get_cached_property('OnBattery')?.unpack();
  }

  _watchSession() {
    try {
      this._sessionProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION,
        Gio.DBusProxyFlags.NONE, null, SESSION_BUS, SESSION_PATH,
        SESSION_IFACE, null);
    } catch (e) {
      // Rig Xephyr berjalan di bus sendiri tanpa gnome-session: semua jalur
      // inhibitor harus jadi no-op, bukan error tiap tick.
      this._sessionProxy = null;
    }
  }

  _sessionCall(method, params) {
    if (!this._sessionProxy)
      return null;
    try {
      return this._sessionProxy.call_sync(method, params,
        Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null);
    } catch (e) {
      return null;
    }
  }

  // InhibitedActions dibaca lewat Get, bukan dari cache proxy: cache baru terisi
  // kalau service mengirim PropertiesChanged, dan bentuknya null kalau tidak.
  _inhibitedActions() {
    const r = this._sessionCall(PROPS_IFACE + '.Get',
      new GLib.Variant('(ss)', [SESSION_IFACE, 'InhibitedActions']));
    return r ? r.get_child_value(0).get_variant().get_uint32() : 0;
  }

  // Cookie noir-clock sendiri ikut masuk bitmask ini. Tanpa dikeluarkan, begitu
  // kita memegang inhibitor veil tidak akan pernah naik lagi — fitur mengunci
  // dirinya sendiri.
  _sessionInhibited() {
    const own = this._inhibitCookie ? INHIBIT_SUSPEND | INHIBIT_IDLE : 0;
    return (this._inhibitedActions() & ~own) !== 0;
  }

  _mprisPlaying() {
    let names;
    try {
      const reply = Gio.DBus.session.call_sync(DBUS_IFACE,
        '/org/freedesktop/DBus', DBUS_IFACE, 'ListNames', null,
        new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT_MS, null);
      names = reply.get_child_value(0).get_strv();
    } catch (e) {
      return false;
    }
    for (const name of names) {
      if (!name.startsWith(MPRIS_PREFIX))
        continue;
      try {
        const r = Gio.DBus.session.call_sync(name, MPRIS_PATH, PROPS_IFACE,
          'Get', new GLib.Variant('(ss)',
            [MPRIS_PLAYER_IFACE, 'PlaybackStatus']),
          new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE,
          DBUS_TIMEOUT_MS, null);
        // unpack(), bukan get_string(): yang terakhir mengembalikan
        // [isi, panjang] sehingga 'Playing' tidak pernah sama dengan 'Playing'.
        if (r.get_child_value(0).get_variant().unpack() === 'Playing')
          return true;
      } catch (e) {
        // Player mati di tengah roundtrip: nama lain yang menjawab.
      }
    }
    return false;
  }

  // Dua pertanyaan (media + inhibitor) dijawab dalam satu roundtrip per detik;
  // hasilnya disimpan sebagai flag supaya _step() tidak memanggil D-Bus 10x
  // per detik pada jam 10 Hz.
  _pollActivity() {
    const now = GLib.get_monotonic_time();
    if (this._pollUs && now - this._pollUs < MEDIA_POLL_US)
      return;
    this._pollUs = now;

    const playing = this._mprisPlaying();
    const inhibited = this._sessionInhibited();
    if (playing === this._mediaPlaying && inhibited === this._sessionBlocked)
      return;
    this._mediaPlaying = playing;
    this._sessionBlocked = inhibited;
    this._syncInhibit(playing);
    if (playing)
      this._wake();
  }

  // 5C: selama media Playing noir-clock memegang Inhibit(Suspend|Idle) dan
  // melepaskannya lagi begitu playback berhenti. Ini bukan rem untuk veil (itu
  // sudah ada di _blocked) tapi jaminan positif: laptop benar-benar tidak
  // tertidur di tengah video, juga saat baterai. Sinkron, karena transisinya
  // jarang dan cookie harus langsung tercatat agar tidak ada inhibitor menggantung.
  _pid() {
    if (this._pidCache === undefined) {
      let p = 0;
      try {
        const [, bytes] = GLib.file_get_contents('/proc/self/stat');
        p = parseInt(new TextDecoder().decode(bytes).split(' ')[0], 10) || 0;
      } catch (e) {
        log(`noir-clock: pid tidak terbaca: ${e.message}`);
      }
      this._pidCache = p;
    }
    return this._pidCache;
  }

  _syncInhibit(playing) {
    if (playing && !this._inhibitCookie) {
      // Signature asli Inhibit adalah (susu) — app_pid ikut dipakai
      // SessionManager untuk membersihkan inhibitor saat klien hilang, jadi
      // tidak boleh dilewat. Varian dirakit per elemen karena '(suu)' dan
      // '(susu)' literal salah dipetakan GJS.
      const r = this._sessionCall('Inhibit', GLib.Variant.new_tuple([
        new GLib.Variant('s', APP_ID),
        new GLib.Variant('u', this._pid()),
        new GLib.Variant('s', INHIBIT_REASON),
        new GLib.Variant('u', INHIBIT_SUSPEND | INHIBIT_IDLE)]));
      this._inhibitCookie = r ? r.get_child_value(0).get_uint32() : 0;
      if (this._inhibitCookie)
        log(`noir-clock: inhibit suspend+idle, cookie ${this._inhibitCookie}`);
    } else if (!playing) {
      this._dropInhibit();
    }
  }

  _dropInhibit() {
    if (!this._inhibitCookie)
      return;
    this._sessionCall('Uninhibit', new GLib.Variant('(u)', [this._inhibitCookie]));
    log(`noir-clock: inhibitor ${this._inhibitCookie} dilepas`);
    this._inhibitCookie = 0;
  }

  _wake() {
    this._lastWakeUs = GLib.get_monotonic_time();
    this._pollUs = 0;
  }

  _awakeRecently() {
    return this._lastWakeUs !== 0 &&
      GLib.get_monotonic_time() - this._lastWakeUs < WAKE_WINDOW_US;
  }

  _fullscreenWindow() {
    // Meta.Window 46 tidak punya get_state() dan Meta.WindowState tidak
    // terekspos ke GJS; is_fullscreen() satu-satunya jalur yang ada.
    const win = global.display.get_focus_window();
    return !!win && win.is_fullscreen();
  }

  // Ada aktivitas yang kelihatan: video berjalan, ada aplikasi lain yang secara
  // eksplisit meminta layar tetap hidup, atau user sedang menonton fullscreen.
  _blocked() {
    return this._mediaPlaying || this._sessionBlocked ||
      this._fullscreenWindow();
  }

  // Idle time yang TURUN berarti ada input. Dipakai sebagai clock wake lokal
  // karena jalur gesture/overview tidak selalu menaikkan idle monitor.
  _trackWake(idle) {
    if (idle < this._lastIdle)
      this._wake();
    this._lastIdle = idle;
  }

  _shouldRaise(idle) {
    return !this._onBattery && idle >= AMB_IDLE_MS &&
      !this._awakeRecently() && !this._blocked();
  }

  _step() {
    const idle = this._idle.get_idletime();
    this._trackWake(idle);

    if (shieldUp() || Main.overview?.visible) {
      this._wake();
      this._dropAmbient();
      return;
    }

    // Media hanya perlu ditanya kalau ambient memang sudah masuk jarak: veil
    // sedang tampil, atau idle sudah setengah jalan ke ambang naik.
    if (this._state !== S_OFF || idle >= AMB_WATCH_MS)
      this._pollActivity();

    if (this._shouldRaise(idle)) {
      if (this._state === S_OFF)
        this._raiseAmbient();
    } else if (this._state === S_RISE || this._state === S_ON) {
      this._state = S_FALL;
    }

    if (this._state === S_OFF) {
      this._dial.queue_repaint();
      return;
    }

    if (this._state === S_ON) {
      if (++this._frame % AMB_REPAINT === 0)
        this._amb.queue_repaint();
      return;
    }

    // Opacity saja: permukaan veil sudah tergambar, jadi fade tidak butuh repaint.
    const rise = this._state === S_RISE;
    const step = Math.ceil(255 / ((rise ? AMB_RISE_MS : AMB_FALL_MS) / TICK_MS));
    const target = rise ? 255 : 0;
    this._amb.opacity = rise
      ? Math.min(target, this._amb.opacity + step)
      : Math.max(target, this._amb.opacity - step);

    if (this._amb.opacity !== target)
      return;

    if (rise) {
      this._state = S_ON;
      this._frame = 0;
    } else {
      this._amb.hide();
      this._dial.opacity = 255;
      this._dial.queue_repaint();
      this._state = S_OFF;
    }
  }

  _raiseAmbient() {
    this._state = S_RISE;
    this._frame = 0;
    this._dial.opacity = 0;
    this._amb.opacity = 0;
    this._amb.show();
    this._amb.queue_repaint();
  }

  // Layar kunci harus langsung terlihat: tidak ada fade di jalur ini.
  _dropAmbient() {
    if (this._state === S_OFF)
      return;
    this._amb.hide();
    this._amb.opacity = 0;
    this._dial.opacity = 255;
    this._dial.queue_repaint();
    this._state = S_OFF;
  }

  disable() {
    // Inhibitor harus dilepas sebelum proxy dibuang: kalau tidak, gnome-session
    // menahan suspend sampai bus shell mati (login berikutnya baru bersih).
    this._dropInhibit();
    this._sessionProxy = null;

    if (this._tick) {
      GLib.Source.remove(this._tick);
      this._tick = 0;
    }
    if (this._monId) {
      Main.layoutManager.disconnect(this._monId);
      this._monId = 0;
    }
    for (const id of this._shieldIds ?? [])
      Main.screenShield.disconnect(id);
    this._shieldIds = [];
    if (this._powerChangedId)
      this._powerProxy.disconnect(this._powerChangedId);
    this._powerChangedId = 0;
    this._powerProxy = null;
    this._idle = null;

    Main.layoutManager.removeChrome(this._amb);
    this._amb.destroy();
    this._amb = null;

    this._dial?.destroy();
    this._dial = null;
  }
}
