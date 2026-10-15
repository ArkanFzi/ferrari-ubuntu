// noir-telemetry@arkan — chip PIT.
// Satu indikator kecil: "sesi sedang ditahan". Dibaca dari dua sinyal yang
// benar-benar tersedia publik — pemutar MPRIS dengan PlaybackStatus Playing, dan
// bit suspend/idle pada InhibitedActions gnome-session. Tidak ada state shell
// privat yang disentuh, jadi indikator ini tidak ikut berubah saat gnome-shell
// naik versi.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// panel.js hanya mengimpor ulang PanelMenu; GJS 1.80 menyebutnya ambiguous
// indirect export, jadi ambil dari modul aslinya.
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const ROLE = 'noir-telemetry';
const SESSION_IFACE = 'org.gnome.SessionManager';
const SESSION_PATH = '/org/gnome/SessionManager';
const DBUS_IFACE = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

// Enum D-Bus gnome-session, didapat dari mengukur delta InhibitedActions per
// panggilan: logout 1, switch-user 2, suspend 4, idle 8. Hanya suspend dan idle
// yang berarti "layar jangan ditutup". Bit lain selalu menyala di sesi sehat —
// di sesi ini dasarnya sudah 10 (switch-user + idle) — jadi kalau semuanya
// dihitung, chip tidak pernah bisa mati.
const INHIBIT_KEEP_AWAKE = 4 | 8;

const POLL_MS = 2000;
const DBUS_TIMEOUT_MS = 200;

export default class NoirTelemetryExtension extends Extension {
  enable() {
    this._on = false;
    this._reason = '';

    // addToStatusArea menolak actor biasa ("Status indicator must be an instance
    // of PanelMenu.Button", terukur di rig), jadi chip dibungkus Button tapi
    // reaktifnya dimatikan: tidak ada popup yang kosong saat diklik.
    this._chip = new PanelMenu.Button(0.0, 'Pit stop');
    this._chip.reactive = false;

    const box = new St.BoxLayout({ style_class: 'noir-pit' });
    this._dot = new St.Widget({
      style_class: 'noir-pit-dot',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._label = new St.Label({
      text: 'PIT',
      y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(this._dot);
    box.add_child(this._label);
    this._chip.add_child(box);
    this._chip.visible = false;

    Main.panel.addToStatusArea(ROLE, this._chip, 0, 'right');

    this._tick();
    // Satu baris saat aktif supaya "ekstensi mati" bisa dibedakan dari
    // "tidak ada yang menahan sesi" tanpa harus membuka looking glass.
    log(`noir-telemetry: aktif, state awal ${this._on ? `PIT nyala (${this._reason})` : 'PIT mati'}`);
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable() {
    if (this._timer)
      GLib.source_remove(this._timer);
    this._timer = 0;
    if (this._chip)
      this._chip.destroy();
    this._chip = null;
    this._dot = null;
    this._label = null;
  }

  _tick() {
    const playing = this._playingNames();
    const held = playing.length === 0 && this._keepAwakeHeld();
    const on = playing.length > 0 || held;
    const reason = playing.length > 0
      ? `media: ${playing.join(', ')}`
      : (held ? 'inhibitor suspend/idle' : '');
    if (on === this._on && reason === this._reason)
      return;
    this._on = on;
    this._reason = reason;
    this._paint();
    log(`noir-telemetry: PIT ${on ? 'nyala' : 'mati'} — ${reason || 'kosong'}`);
  }

  _paint() {
    this._chip.visible = this._on;
    this._chip.tooltip_text = this._on ? `PIT STOP: ${this._reason}` : '';
  }

  _keepAwakeHeld() {
    const mask = this._sessionMask();
    return mask !== null && (mask & INHIBIT_KEEP_AWAKE) !== 0;
  }

  _sessionMask() {
    try {
      const r = Gio.DBus.session.call_sync(SESSION_IFACE, SESSION_PATH,
        PROPS_IFACE, 'Get',
        new GLib.Variant('(ss)', [SESSION_IFACE, 'InhibitedActions']),
        new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE,
        DBUS_TIMEOUT_MS, null);
      return r.get_child_value(0).get_variant().get_uint32();
    } catch (e) {
      return null;
    }
  }

  _playingNames() {
    let names;
    try {
      const reply = Gio.DBus.session.call_sync(DBUS_IFACE, DBUS_PATH,
        DBUS_IFACE, 'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null);
      names = reply.get_child_value(0).get_strv();
    } catch (e) {
      return [];
    }

    const out = [];
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
          out.push(name.slice(MPRIS_PREFIX.length));
      } catch (e) {
        // Player mati di tengah roundtrip: nama berikutnya yang menjawab.
      }
    }
    return out;
  }
}
