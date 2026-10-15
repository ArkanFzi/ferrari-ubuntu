// noir-startlights@arkan — start-light gantry.
// Lima lampu merah menyatu dari kiri ke kanan lalu padam, seperti balance
// start. Actor dipasang lewat addChrome sehingga tidak ikut tertata ulang
// oleh panel dan tidak menyerap input. Di layar kunci dipakai addTopChrome,
// karena lightbox fade-to-black menutupi screenShieldGroup.
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LIGHT_COUNT = 5;
const LIGHT_SIZE = 34;
const LIGHT_GAP = 26;
const STEP_MS = 400;
const HOLD_MS = 350;
const FADE_MS = 260;
// Panel belum tentu selesai dilayout saat enable() dipanggil.
const START_DELAY_MS = 800;
const TOP_FRACTION = 0.12;

export default class NoirStartLightsExtension extends Extension {
  enable() {
    this._timers = [];
    this._lmId = 0;
    this._ssIds = [];
    this._gantry = null;
    this._chrome = false;
    this._onShield = false;
    this._lights = [];

    if (Main.sessionMode.isGreeter)
      return;

    this._watchShield();
    this._after(START_DELAY_MS, () => this.play());
  }

  disable() {
    for (const id of this._timers)
      GLib.source_remove(id);
    this._timers = [];

    if (this._lmId) {
      Main.layoutManager.disconnect(this._lmId);
      this._lmId = 0;
    }
    for (const id of this._ssIds)
      Main.screenShield.disconnect(id);
    this._ssIds = [];
    this._destroyGantry();
  }

  // lock-screen-shown baru menyala setelah shield benar-benar tampil; memakai
  // locked-changed akan mengejar animasi masuk shield.
  _watchShield() {
    this._ssIds = [
      Main.screenShield.connect('lock-screen-shown', () => {
        if (this._gantry)
          return;
        this._onShield = true;
        this.play(true);
      }),
      Main.screenShield.connect('active-changed', () => {
        if (!Main.screenShield.active && this._onShield)
          this._destroyGantry();
      }),
    ];
  }

  _after(ms, fn) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      this._timers = this._timers.filter(t => t !== id);
      fn();
      return GLib.SOURCE_REMOVE;
    });
    this._timers.push(id);
    return id;
  }

  play(onShield = false) {
    if (this._gantry)
      return this._gantry;

    const gantry = new St.Widget({
      style_class: 'noir-gantry',
      reactive: false,
      can_focus: false,
      opacity: 0,
      layout_manager: new Clutter.BoxLayout({ spacing: LIGHT_GAP }),
    });
    gantry.set_size(LIGHT_COUNT * LIGHT_SIZE + (LIGHT_COUNT - 1) * LIGHT_GAP, LIGHT_SIZE);

    this._lights = [];
    for (let i = 0; i < LIGHT_COUNT; i++) {
      const light = new St.Bin({ style_class: 'noir-gantry-light' });
      light.set_size(LIGHT_SIZE, LIGHT_SIZE);
      this._lights.push(light);
      gantry.add_child(light);
    }

    this._gantry = gantry;
    this._chrome = true;
    // Lightbox fade-to-black layar kunci berada di atas screenShieldGroup dalam
    // uiGroup, jadi di shield actor harus dipasang sebagai top chrome.
    if (onShield)
      Main.layoutManager.addTopChrome(gantry, { affectsInputRegion: false });
    else
      Main.layoutManager.addChrome(gantry, { affectsInputRegion: false });
    this._place();
    if (!this._lmId)
      this._lmId = Main.layoutManager.connect('monitors-changed', () => this._place());

    gantry.ease({ opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

    this._lights.forEach((light, i) => {
      this._after(FADE_MS + i * STEP_MS, () =>
        light.add_style_class_name('noir-gantry-light--on'));
    });

    const offAt = FADE_MS + LIGHT_COUNT * STEP_MS + HOLD_MS;
    this._after(offAt, () => {
      for (const light of this._lights)
        light.remove_style_class_name('noir-gantry-light--on');
      // environment.js mengenal onComplete/onStopped, bukan onDone.
      this._gantry?.ease({
        opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => this._destroyGantry(),
      });
    });

    log('noir-startlights: gantry dimulai');
    return gantry;
  }

  _topY() {
    const mon = Main.layoutManager.primaryMonitor;
    if (!mon)
      return 0;
    return (Main.panel.height || 0) + Math.round(mon.height * TOP_FRACTION);
  }

  _place() {
    const mon = Main.layoutManager.primaryMonitor;
    if (!mon || !this._gantry)
      return;
    const w = LIGHT_COUNT * LIGHT_SIZE + (LIGHT_COUNT - 1) * LIGHT_GAP;
    this._gantry.set_position(Math.round(mon.x + (mon.width - w) / 2),
      Math.round(mon.y + this._topY()));
  }

  _destroyGantry() {
    if (!this._gantry)
      return;
    if (this._chrome)
      Main.layoutManager.removeChrome(this._gantry);
    this._gantry.destroy();
    this._gantry = null;
    this._chrome = false;
    this._onShield = false;
    this._lights = [];
    log('noir-startlights: gantry selesai');
  }
}
