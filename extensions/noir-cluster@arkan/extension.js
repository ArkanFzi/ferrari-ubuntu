// noir-cluster@arkan — cluster pengemudi.
// Mode berkendara bukan stiker: WET/SPORT/RACE menulis profil ke
// power-profiles-daemon dan ikut mengubah perilaku shell. AUTO menyerahkan
// pilihan profil itu ke termostat suhu CPU/GPU. Rev-light sepuluh segmen
// digambar dari delta /proc/stat, bukan dari perkiraan.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// panel.js hanya mengimpor ulang PanelMenu; GJS 1.80 menyebutnya ambiguous
// indirect export, jadi ambil dari modul aslinya.
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const ROLE = 'noir-cluster';
const APP_ID = 'noir-cluster@arkan';
const PPD_NAME = 'net.hadess.PowerProfiles';
const PPD_PATH = '/net/hadess/PowerProfiles';
const UP_NAME = 'org.freedesktop.UPower';
const UP_PATH = '/org/freedesktop/UPower';
// Persentase dan status pengisian tidak ada di objek root (root hanya
// DaemonVersion/OnBattery/Lid*), jadi perlu proxy kedua ke DisplayDevice.
const UP_DEV_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UP_DEV_IFACE = 'org.freedesktop.UPower.Device';
const SESSION_NAME = 'org.gnome.SessionManager';
const SESSION_PATH = '/org/gnome/SessionManager';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const INHIBIT_IDLE = 8;
const INHIBIT_REASON = 'noir-cluster: mode RACE';
const DBUS_TIMEOUT_MS = 200;

const BG_SCHEMA = 'org.gnome.desktop.background';
const BG_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'backgrounds']);
const LIVERY_NETRAL = 'ferrari-noir-dinamis.xml';

const LED_COUNT = 10;
// Geometri kecil sengaja: strip ini tinggal di dalam panel, bukan di kanvas.
const LED_W = 13;
const LED_H = 4;
const LED_GAP = 3;
const ROSSO_FROM = 7;
const REV_STEPS = [12, 20, 28, 38, 48, 58, 68, 78, 86, 93];
const SAMPLE_MS = 500;
// Jarum tach turun lebih lambat daripada naik; tanpa ini lampu berkedip
// mengikuti noise satu sampel.
const DECAY = 0.72;

const STRIP_W = LED_COUNT * LED_W + (LED_COUNT - 1) * LED_GAP;
const CLUSTER_GAP = 8;
// Gigi sekuensial dibaca dari jumlah lampu yang menyala, bukan dari waktu:
// naik-turunnya gigi ikut rev-up dan coast-down tanpa mesin tambahan.
const GEARS = ['N', '1', '1', '2', '2', '3', '3', '4', '4', '5', '6'];
// Beban CPU dipetakan sebagai throttle; 100% = 360 km/h supaya angkanya
// tetap tiga digit di rentang penuh.
const KMH_PER_PCT = 3.6;

// Sensor dicari lewat isi file `name`, bukan lewat nomor direktori: kernel
// menomor ulang hwmon setiap boot, jadi hwmon4 hari ini bukan hwmon4 besok.
const HWMON_ROOT = '/sys/class/hwmon';
const FAN_SENSOR = 'hp';
const CPU_SENSORS = ['coretemp', 'acpitz_0'];
const GPU_CMD = ['nvidia-smi', '--query-gpu=temperature.gpu', '--format=csv,noheader'];
// Terukur 26 ms untuk satu panggilan nvidia-smi di mesin ini; tetap dijalankan
// async supaya main loop shell tidak pernah menunggu subprocess.
const THERMAL_POLL_MS = 5000;
// dGPU boleh tertidur (hybrid graphics): nvidia-smi gagal lalu hidup lagi.
// Angka yang hilang karena gagal baca hanya ditahan sebentar, bukan membuat
// telemetri GPU mati sampai logout.
const GPU_RETRY_TICKS = 12;

// Tangga termostat. Angka bawah adalah ambang naik, angka setelahnya ambang
// turun — selisihnya 7 C, jadi fan tidak berayun di suhu yang bergoyang 1-2
// derajat. Diukur di mesin ini: coretemp paket 65-70 C saat idle dan meledak
// ke 87-93 C setiap burst singkat, choices OEM-nya cool/quiet/balanced/
// performance; power-profiles-daemon hanya mengekspos tiga yang terakhir
// (power-saver terbukti menulis 'quiet' ke platform-profile), jadi 'cool'
// tidak bisa dijangkau tanpa root dan tidak dipakai di sini.
const AUTO_UP_MID = 75;
const AUTO_UP_HIGH = 85;
const AUTO_DOWN_MID = 68;
const AUTO_DOWN_HIGH = 78;
const AUTO_GPU_HOT = 88;
// Naik boleh cepat, turun harus sabar: thermald dan EC butuh tenang, dan dua
// tingkat sekaligus dalam satu langkah terdengar seperti fan yang bingung.
const AUTO_RISE_MS = 15 * 1000;
const AUTO_FALL_MS = 90 * 1000;
// Dua jendela rata-rata. Naik pakai 15 s supaya fan bergerak cepat; turun
// pakai 60 s supaya burst pendek tidak ikut menentukan.
const AUTO_RISE_SAMPLES = 3;
const AUTO_FALL_SAMPLES = 12;
const BAND_PROFILE = ['power-saver', 'balanced', 'performance'];
const PROFILE_BAND = { 'power-saver': 0, balanced: 1, performance: 2 };

const STATS_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'noir-cluster']);
const STATS_FILE = GLib.build_filenamev([STATS_DIR, 'launch-times.json']);
const STATS_MAX = 20;
// Aplikasi yang hang saat startup tidak boleh meninggalkan stopwatch menggantung.
const LAUNCH_TIMEOUT_MS = 15000;
const CAPTION_MS = 2600;
const CAPTION_FADE_MS = 400;

// Team radio: hanya dipanggil pada tepi (transisi), bukan tiap PropertiesChanged.
// Histeresis 5% mencegah "box, box" berulang saat persentase bergoyang di ambang.
const SOUND_SCHEMA = 'org.gnome.desktop.sound';
const FUEL_LOW = 20;
const FUEL_REARM = 25;
const UP_STATE_FULLY_CHARGED = 4;

// 'off' = strip tidak pernah muncul; 'on' = strip hidup terus. Dulu SPORT dan
// AUTO berpintu AC ('ac'), tapi strip ini cuma baca /proc/stat — tidak ada
// daya yang dihemat, jadi pintunya hanya membuat cluster hilang tanpa sebab
// yang terlihat begitu kabel dicabut.
const MODES = {
  WET: { profile: 'power-saver', revs: 'off', livery: 'wet' },
  SPORT: { profile: 'balanced', revs: 'on', livery: null },
  RACE: { profile: 'performance', revs: 'on', livery: 'race' },
  // AUTO tidak membawa profil tetap: profilnya ditulis oleh termostat, dan
  // livery mengikuti profil yang sedang berlaku, bukan nama mode-nya.
  AUTO: { profile: null, revs: 'on', livery: 'auto' },
};
const ORDER = ['WET', 'SPORT', 'RACE', 'AUTO'];
const BY_PROFILE = { 'power-saver': 'WET', balanced: 'SPORT', performance: 'RACE' };

export default class NoirClusterExtension extends Extension {
  enable() {
    this._mode = null;
    this._applying = false;
    this._inhibitCookie = 0;
    this._liverySet = null;
    this._lit = 0;
    this._kmh = -1;
    this._revOn = false;
    this._capUp = false;
    this._rpm = 0;
    this._prevBusy = 0;
    this._prevTotal = 0;
    this._onBat = false;
    this._sampleId = 0;
    this._thermId = 0;
    this._keyId = 0;
    this._appId = 0;
    this._capId = 0;
    this._cpuT = null;
    this._gpuT = null;
    this._fan = [null, null];
    this._hwmon = {};
    this._gpuBusy = false;
    this._gpuSkip = 0;
    this._gpuDead = false;
    this._gpuProc = null;
    this._temps = [];
    this._autoProfile = null;
    this._autoBand = -1;
    this._autoWant = -1;
    this._autoWantSince = 0;
    this._ids = [];
    this._timers = new Set();
    this._launching = new Map();
    this._stats = this._loadStats();
    this._fuelCalled = false;

    this._settings = this.getSettings();
    this._bg = new Gio.Settings({ schema_id: BG_SCHEMA });
    this._sound = new Gio.Settings({ schema_id: SOUND_SCHEMA });

    // DBusProxy, bukan DBusConnection.call: bentuk terakhir minta 10 arg di
    // GJS. Setiap antarmuka dapat proxy sendiri supaya Properties.Get/Set
    // tidak dianggap lintas interface.
    this._ppd = this._proxy(Gio.BusType.SYSTEM, PPD_NAME, PPD_PATH, PPD_NAME);
    this._ppdProps = this._proxy(Gio.BusType.SYSTEM, PPD_NAME, PPD_PATH, PROPS_IFACE);
    this._up = this._proxy(Gio.BusType.SYSTEM, UP_NAME, UP_PATH, UP_NAME);
    this._upDev = this._proxy(Gio.BusType.SYSTEM, UP_NAME, UP_DEV_PATH, UP_DEV_IFACE);
    this._session = this._proxy(Gio.BusType.SESSION, SESSION_NAME, SESSION_PATH, SESSION_NAME);
    this._onBat = !!this._cached(this._up, 'OnBattery');
    this._upState = this._cached(this._upDev, 'State');
    this._upPct = this._cached(this._upDev, 'Percentage');

    this._buildChip();
    this._buildRevs();
    this._buildCaption();
    this._watchDbus();
    this._watchApps();

    // Mulai dari profil yang sedang aktif, bukan dari asumsi: menulis profil
    // saat login akan membalik pilihan user tanpa diminta.
    this._setMode(this._adoptedMode(), true);

    // Preferensi AUTO bertahan lintas login; selain itu profil live yang menang.
    if (this._settings.get_boolean('auto-cooling'))
      this._setMode('AUTO', true);

    this._keyId = Main.wm.addKeybinding('cycle-mode', this._settings,
      Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this._cycle());

    this._sampleId = GLib.timeout_add(GLib.PRIORITY_LOW, SAMPLE_MS, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });

    this._thermId = GLib.timeout_add(GLib.PRIORITY_LOW, THERMAL_POLL_MS, () => {
      this._sensorsTick();
      return GLib.SOURCE_CONTINUE;
    });
    this._sensorsTick();
  }

  disable() {
    this._dropInhibit();
    if (this._liverySet) {
      const netral = GLib.filename_to_uri(this._liveryFile(null), null);
      this._bg.set_string('picture-uri', netral);
      this._bg.set_string('picture-uri-dark', netral);
    }
    this._liverySet = null;
    this._bg = null;
    this._sound = null;

    if (this._keyId)
      Main.wm.removeKeybinding('cycle-mode');
    this._keyId = 0;
    if (this._sampleId)
      GLib.source_remove(this._sampleId);
    this._sampleId = 0;
    if (this._thermId)
      GLib.source_remove(this._thermId);
    this._thermId = 0;
    if (this._gpuProc) {
      this._gpuProc.cancel();
      this._gpuProc = null;
    }
    this._gpuBusy = false;

    for (const [proxy, id] of this._ids)
      proxy?.disconnect(id);
    this._ids = [];

    for (const id of this._timers)
      GLib.source_remove(id);
    this._timers.clear();
    this._launching.clear();
    if (this._appSys && this._appId)
      this._appSys.disconnect(this._appId);
    this._appId = 0;
    this._appSys = null;

    // Cluster dan caption adalah anak kotak chip, jadi menghancurkan chip sudah
    // cukup untuk melepas keduanya dari panel.
    this._chip?.destroy();
    this._chip = null;
    this._chipBox = null;
    this._cluster = null;
    this._strip = null;
    this._gearLabel = null;
    this._speedLabel = null;
    this._caption = null;
    this._leds = [];
    this._ppd = this._ppdProps = this._up = this._upDev = this._session = null;
    this._thermItem = null;
    this._hwmon = {};
    this._cpuT = this._gpuT = null;
    this._fan = [null, null];
    this._autoProfile = null;
    this._autoBand = -1;
    this._autoWant = -1;
    this._mode = null;
  }

  // ── DBus ────────────────────────────────────────────────────────────────
  _proxy(bus, name, path, iface) {
    try {
      return Gio.DBusProxy.new_for_bus_sync(bus, Gio.DBusProxyFlags.NONE,
        null, name, path, iface, null);
    } catch (e) {
      log(`noir-cluster: ${name} tidak terjangkau: ${e.message}`);
      return null;
    }
  }

  _call(proxy, member, params) {
    if (!proxy)
      return null;
    try {
      return proxy.call_sync(member, params, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null);
    } catch (e) {
      // Polkit boleh menolak (sesi tidak aktif); mode tetap berubah di layar,
      // cuma profilnya yang tidak ikut.
      log(`noir-cluster: ${member} gagal: ${e.message}`);
      return null;
    }
  }

  _cached(proxy, name) {
    const v = proxy?.get_cached_property(name);
    return v ? v.unpack() : null;
  }

  // GJS 1.80 tidak membuka pembungkus "v" pada a{sv}: isi PropertiesChanged
  // masih Variant, padahal get_cached_property sudah mengembalikan nilai polos.
  // Tanpa ini, BY_PROFILE[Variant] selalu undefined dan mode jatuh ke SPORT.
  _plain(v) {
    if (!(v instanceof GLib.Variant))
      return v;
    switch (v.get_type_string()) {
      case 's':
        return v.get_string()[0];
      case 'b':
        return v.get_boolean();
      default:
        return v.unpack();
    }
  }

  _watchDbus() {
    this._ids.push([this._ppd, this._ppd?.connect('g-properties-changed', (p, changed) => {
      const prof = this._plain(changed.deep_unpack().ActiveProfile);
      if (typeof prof !== 'string')
        return;
      // Nilai di luar tiga profil (mis. 'custom' saat transisi) bukan perintah
      // ganti mode; memetakannya ke SPORT akan membalik shell sendiri.
      const mode = BY_PROFILE[prof];
      if (!mode) {
        log(`noir-cluster: profil ${prof} diabaikan`);
        return;
      }
      // Dalam AUTO, perubahan profil bukan perintah ganti mode — kebanyakan
      // justru tulisan termostat sendiri. Nilai baru hanya dicatat sebagai
      // tingkat sekarang, jadi Quick Settings tetap boleh menimpa dan AUTO
      // menghitung dari sana, bukan melawannya.
      if (this._mode === 'AUTO') {
        this._autoProfile = prof;
        this._autoBand = PROFILE_BAND[prof] ?? this._autoBand;
        this._autoWant = -1;
        this._syncInhibit(this._inhibitWanted());
        this._applyLivery('AUTO');
        this._paintChip();
        return;
      }
      this._setMode(mode, true);
    })]);
    this._ids.push([this._up, this._up?.connect('g-properties-changed', (p, changed) => {
      const on = this._plain(changed.deep_unpack().OnBattery);
      if (typeof on !== 'boolean')
        return;
      if (on && this._onBat === false)
        this._radio('radio-unplug', `RADIO · kabel lepas — ${this._pctText()}`);
      if (!on && this._onBat === true)
        this._radio('radio-plug', `RADIO · kabel masuk — ${this._pctText()}`);
      this._onBat = on;
    })]);
    this._ids.push([this._upDev, this._upDev?.connect('g-properties-changed', (p, changed) => {
      const c = changed.deep_unpack();
      const pct = this._plain(c.Percentage);
      if (typeof pct === 'number') {
        this._upPct = pct;
        this._fuelCallout(pct);
      }
      const st = this._plain(c.State);
      if (typeof st === 'number') {
        if (st === UP_STATE_FULLY_CHARGED && this._upState !== st)
          this._radio('radio-lights', 'RADIO · lampu hijau — baterai penuh');
        this._upState = st;
      }
    })]);
  }

  _pctText() {
    return typeof this._upPct === 'number' ? `${Math.round(this._upPct)}%` : 'baterai';
  }

  _fuelCallout(pct) {
    if (this._fuelCalled) {
      if (pct >= FUEL_REARM)
        this._fuelCalled = false;
      return;
    }
    if (pct > FUEL_LOW)
      return;
    this._fuelCalled = true;
    this._radio('radio-box', `BOX, BOX — ${this._pctText()}`);
  }

  // canberra-gtk-play menyelesaikan pencarian sendiri lewat sound theme
  // (Yaru, lalu fallback freedesktop), jadi id cukup — tidak perlu path.
  // spawn_command_line_async dipakai, bukan Gio.Subprocess: yang terakhir
  // meninggalkan zombie kalau hasilnya tidak pernah di-wait.
  _radio(id, text) {
    if (!this._settings.get_boolean('team-radio') ||
      !this._sound.get_boolean('event-sounds'))
      return;
    try {
      GLib.spawn_command_line_async(`canberra-gtk-play -i ${id} -d noir-cluster`);
    } catch (e) {
      log(`noir-cluster: radio ${id} gagal: ${e.message}`);
      return;
    }
    this._showCaption(text);
  }

  // Satu timer self-cleaning: semua id masuk this._timers supaya disable()
  // bisa melepasnya tanpa menyimpan satu per satu.
  _after(ms, fn) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      this._timers.delete(id);
      fn();
      return GLib.SOURCE_REMOVE;
    });
    this._timers.add(id);
    return id;
  }

  _profile() {
    return this._cached(this._ppd, 'ActiveProfile');
  }

  _adoptedMode() {
    return BY_PROFILE[this._profile()] ?? 'SPORT';
  }

  _onBattery() {
    return this._onBat;
  }

  // ── mode ────────────────────────────────────────────────────────────────
  _cycle() {
    const i = ORDER.indexOf(this._mode);
    this._setMode(ORDER[(i + 1) % ORDER.length], false);
  }

  _setMode(next, fromDbus) {
    const m = MODES[next];
    if (!m || this._applying)
      return;
    if (this._mode === next)
      return;

    this._applying = true;
    this._mode = next;
    if (next === 'AUTO') {
      // AUTO tidak membawa profil: mulai dari profil yang sedang berlaku supaya
      // termostat tidak membalik pilihan user pada detik pertama.
      this._autoProfile = this._profile();
      this._autoBand = PROFILE_BAND[this._autoProfile] ?? 1;
      this._autoWant = -1;
      this._temps = [];
    } else {
      this._autoProfile = null;
      this._autoBand = -1;
      this._autoWant = -1;
      if (!fromDbus) {
        this._call(this._ppdProps, 'Set',
          new GLib.Variant('(ssv)', [PPD_NAME, 'ActiveProfile', new GLib.Variant('s', m.profile)]));
      }
    }
    if (!fromDbus)
      this._settings.set_boolean('auto-cooling', next === 'AUTO');
    this._syncInhibit(this._inhibitWanted());
    this._applyLivery(next);
    this._paintChip();
    if (m.revs === 'off')
      this._parkRevs(true);
    this._applying = false;
    log(`noir-cluster: mode ${next} (${next === 'AUTO' ? `auto/${this._autoProfile}` : m.profile})`);
  }

  // Inhibitor mengikuti profil yang benar-benar berlaku, bukan nama mode: AUTO
  // yang sedang di puncak sama kerasnya dengan RACE yang dipilih manual.
  _inhibitWanted() {
    return this._mode === 'RACE' ||
      (this._mode === 'AUTO' && this._autoProfile === 'performance');
  }

  // ── termostat AUTO ──────────────────────────────────────────────────────
  _sensorsTick() {
    const seen = [];
    for (const sensor of CPU_SENSORS) {
      const dir = this._findHwmon(sensor);
      if (!dir)
        continue;
      const t = parseInt(this._sysfs(`${dir}/temp1_input`), 10);
      if (Number.isFinite(t))
        seen.push(t / 1000);
    }
    this._cpuT = seen.length ? Math.max(...seen) : null;

    const fan = this._findHwmon(FAN_SENSOR);
    this._fan = [1, 2].map(i => {
      const v = fan ? parseInt(this._sysfs(`${fan}/fan${i}_input`), 10) : NaN;
      return Number.isFinite(v) ? v : null;
    });

    this._readGpu();
    this._paintTelemetry();
    this._autoTick();
  }

  // Nomor hwmon tidak stabil, jadi sensor dikenali dari isi `name`. Hasil
  // pencarian disimpan tapi selalu diverifikasi ulang: nama yang hilang saat
  // modul unload tinggal membuat pencarian ulang, bukan membaca angka salah.
  _findHwmon(want) {
    const cached = this._hwmon[want];
    if (cached && this._sysfs(`${cached}/name`) === want)
      return cached;
    let dir;
    try {
      dir = GLib.Dir.open(HWMON_ROOT, 0);
    } catch {
      return null;
    }
    for (let n = dir.read_name(); n !== null; n = dir.read_name()) {
      const path = GLib.build_filenamev([HWMON_ROOT, n]);
      if (this._sysfs(`${path}/name`) === want) {
        dir.close();
        this._hwmon[want] = path;
        return path;
      }
    }
    dir.close();
    return null;
  }

  _sysfs(path) {
    try {
      const [, bytes] = GLib.file_get_contents(path);
      return new TextDecoder().decode(bytes).trim();
    } catch {
      return null;
    }
  }

  _readGpu() {
    if (this._gpuBusy)
      return;
    if (this._gpuSkip > 0) {
      this._gpuSkip--;
      return;
    }
    let proc;
    try {
      proc = Gio.Subprocess.new(GPU_CMD,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch {
      // Mesin tanpa driver/binary NVIDIA: jangan pasang subprocess gagal
      // sepanjang sesi.
      this._gpuDead = true;
      this._gpuT = null;
      this._paintTelemetry();
      return;
    }
    this._gpuBusy = true;
    this._gpuProc = proc;
    proc.communicate_async(null, null, (p, res) => {
      this._gpuBusy = false;
      this._gpuProc = null;
      if (!this._mode)
        return;
      let temp = null;
      try {
        // communicate_utf8_finish() bikin SIGSEGV kalau anak tidak menulis
        // apa pun ke stdout (nvidia-smi yang gagal karena dGPU tertidur):
        // GJS mengembalikan buffer NULL. Versi byte aman — keluarannya
        // GBytes berukuran 0 — jadi decoding dilakukan sendiri.
        const [, bytes] = p.communicate_finish(res);
        const text = new TextDecoder().decode(bytes ? bytes.toArray() : new Uint8Array());
        const t = parseInt(text.trim(), 10);
        if (Number.isFinite(t))
          temp = t;
      } catch {
        // Dibatalkan saat disable(): angka terakhir dipertahankan.
        return;
      }
      this._gpuT = temp;
      this._gpuSkip = temp === null ? GPU_RETRY_TICKS - 1 : 0;
      this._paintTelemetry();
    });
  }

  _hotTemp() {
    const seen = [this._cpuT, this._gpuT].filter(t => typeof t === 'number');
    return seen.length ? Math.max(...seen) : null;
  }

  // Tangga + semua rem, dipisah dari timer supaya ambangnya bisa diuji tanpa
  // shell dan tanpa memanaskan mesin. `rise` rata-rata pendek (15 s), `fall`
  // rata-rata panjang (60 s).
  _wantBand(rise, fall, band, { onBattery, gpuHot, throttled }) {
    let want = band;
    if (rise >= AUTO_UP_HIGH)
      want = 2;
    else if (rise >= AUTO_UP_MID)
      want = Math.max(want, 1);
    // Turun hanya boleh diputuskan oleh rata-rata panjang, dan hanya kalau
    // 15 detik terakhir tidak sedang memanas: rata-rata panjang selalu atras,
    // tanpa rem ini AUTO akan melonggarkan profil tepat saat beban mulai naik.
    // Suhu sesaat tidak dipakai sebagai rem — di mesin ini ia melompat ke 89 C
    // walau idle (diukur: 3% dari 60 sampel di atas 85 C) dan dwell turun tidak
    // akan pernah selesai.
    if (rise < AUTO_UP_MID) {
      if (fall <= AUTO_DOWN_MID)
        want = 0;
      else if (fall <= AUTO_DOWN_HIGH)
        want = Math.min(want, 1);
    }
    // Di baterai, performa puncak tidak membuat apa pun lebih dingin.
    if (onBattery)
      want = Math.min(want, 1);
    // GPU panas: tidak boleh turun, walaupun indikator lain menyuruh.
    if (gpuHot)
      want = Math.max(want, band);
    // PPD/thermald sedang memotong sendiri (baterai kritis, batas termal):
    // biarkan dia yang pegang, AUTO hanya boleh turun.
    if (throttled)
      want = Math.min(want, band);
    // Turun boleh satu tingkat per langkah, tidak boleh loncat.
    if (want < band)
      want = band - 1;
    return want;
  }

  _autoTick() {
    if (this._mode !== 'AUTO' || !this._settings.get_boolean('auto-cooling'))
      return;
    const t = this._hotTemp();
    if (t === null)
      return;

    this._temps.push(t);
    if (this._temps.length > AUTO_FALL_SAMPLES)
      this._temps.shift();
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const rise = mean(this._temps.slice(-AUTO_RISE_SAMPLES));
    const fall = mean(this._temps);

    const band = this._autoBand < 0 ? 1 : this._autoBand;
    const want = this._wantBand(rise, fall, band, {
      onBattery: this._onBattery(),
      gpuHot: typeof this._gpuT === 'number' && this._gpuT >= AUTO_GPU_HOT,
      throttled: !!(this._cached(this._ppd, 'PerformanceInhibited') ||
        this._cached(this._ppd, 'PerformanceDegraded')),
    });

    if (want === band) {
      this._autoWant = -1;
      return;
    }
    const now = GLib.get_monotonic_time() / 1000;
    if (this._autoWant !== want) {
      this._autoWant = want;
      this._autoWantSince = now;
      return;
    }
    const hold = want > band ? AUTO_RISE_MS : AUTO_FALL_MS;
    if (now - this._autoWantSince < hold)
      return;
    this._applyBand(want, t, fall);
  }

  _applyBand(band, t, fall) {
    const prof = BAND_PROFILE[band];
    this._temps = [];
    this._applying = true;
    const ok = this._call(this._ppdProps, 'Set',
      new GLib.Variant('(ssv)', [PPD_NAME, 'ActiveProfile', new GLib.Variant('s', prof)])) !== null;
    this._applying = false;
    this._autoBand = band;
    this._autoWant = -1;
    if (ok)
      this._autoProfile = prof;
    this._syncInhibit(this._inhibitWanted());
    this._applyLivery('AUTO');
    this._paintChip();
    log(`noir-cluster: auto ${Math.round(t)}C (rata2 ${Math.round(fall)}C) -> ${prof}${ok ? '' : ' (Set ditolak)'}`);
  }

  _telemetryText() {
    const num = v => (typeof v === 'number' ? `${Math.round(v)}` : '—');
    const fan = this._fan.map(num).join('/');
    return `CPU ${num(this._cpuT)}°  GPU ${num(this._gpuT)}°  FAN ${fan} rpm`;
  }

  _paintTelemetry() {
    const text = this._telemetryText();
    if (this._thermItem)
      this._thermItem.label.set_text(text);
    this._chipTooltip();
  }

  _chipTooltip() {
    if (!this._chip)
      return;
    const state = this._mode === 'AUTO'
      ? `AUTO · tingkat ${this._autoBand} · profil ${this._autoProfile ?? '—'}`
      : `${this._mode} · profil ${this._profile()}`;
    this._chip.tooltip_text = `${this._telemetryText()}\n${state}`;
  }

  _liveryFile(mode) {
    // AUTO bukan nama livery: yang dipakai livery dari profil yang sedang
    // berlaku, jadi wallpaper ikut panas-dingin dan bukan ikut nama mode.
    if (mode === 'AUTO')
      mode = BY_PROFILE[this._autoProfile ?? this._profile()] ?? 'SPORT';
    const f = mode && MODES[mode].livery ? `ferrari-livery-${MODES[mode].livery}.xml` : LIVERY_NETRAL;
    return GLib.build_filenamev([BG_DIR, f]);
  }

  // Dua key ditulis karena GNOME punya wallpaper terpisah untuk tema gelap;
  // menulis satu saja membuat desktop berganti livery saat GTK pindah terang/gelap.
  _applyLivery(mode) {
    const path = this._liveryFile(this._settings.get_boolean('livery') ? mode : null);
    const uri = GLib.filename_to_uri(path, null);
    if (this._liverySet === uri)
      return;
    this._bg.set_string('picture-uri', uri);
    this._bg.set_string('picture-uri-dark', uri);
    this._liverySet = uri;
    log(`noir-cluster: livery ${GLib.path_get_basename(path)}`);
  }

  _pid() {
    if (this._pidCache === undefined) {
      let p = 0;
      try {
        const [, bytes] = GLib.file_get_contents('/proc/self/stat');
        p = parseInt(new TextDecoder().decode(bytes).split(' ')[0], 10) || 0;
      } catch {
        p = 0;
      }
      this._pidCache = p;
    }
    return this._pidCache;
  }

  // RACE memegang Inhibit(Idle). Ini bonus: noir-clock sudah menganggap
  // inhibitor asing sebagai aktivitas, jadi veil ambient tidak naik tanpa
  // noir-clock perlu tahu apa pun soal mode.
  _syncInhibit(on) {
    if (on && !this._inhibitCookie) {
      // SessionManager.Inhibit bersignatur (susu): tanpa app_pid panggilan
      // ditolak InvalidArgs.
      const r = this._call(this._session, 'Inhibit', GLib.Variant.new_tuple([
        new GLib.Variant('s', APP_ID),
        new GLib.Variant('u', this._pid()),
        new GLib.Variant('s', INHIBIT_REASON),
        new GLib.Variant('u', INHIBIT_IDLE)]));
      this._inhibitCookie = r ? r.get_child_value(0).get_uint32() : 0;
      if (this._inhibitCookie)
        log(`noir-cluster: inhibit idle, cookie ${this._inhibitCookie}`);
    } else if (!on) {
      this._dropInhibit();
    }
  }

  _dropInhibit() {
    if (!this._inhibitCookie)
      return;
    this._call(this._session, 'Uninhibit', new GLib.Variant('(u)', [this._inhibitCookie]));
    log(`noir-cluster: inhibitor ${this._inhibitCookie} dilepas`);
    this._inhibitCookie = 0;
  }

  // ── chip panel ──────────────────────────────────────────────────────────
  _buildChip() {
    this._chip = new PanelMenu.Button(0.0, 'Mode berkendara');
    this._items = {};

    const box = new St.Widget({
      style_class: 'noir-cluster-chip',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      layout_manager: new Clutter.BoxLayout({ spacing: 7 }),
    });
    this._chipBox = box;
    this._dot = new St.Bin({
      style_class: 'noir-cluster-dot',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._label = new St.Label({ text: 'SPORT', y_align: Clutter.ActorAlign.CENTER });
    box.add_child(this._dot);
    box.add_child(this._label);
    this._chip.add_child(box);

    // Baris telemetry paling atas: buka menu = baca instrumen. Sengaja tidak
    // menambah actor ke panel — angka suhu/RPM tinggal di menu dan tooltip,
    // jadi TIER 3 (panel sunyi) tidak dilanggar.
    this._thermItem = new PopupMenu.PopupMenuItem(this._telemetryText(), { reactive: false });
    this._thermItem.add_style_class_name('noir-cluster-therm');
    this._chip.menu.addMenuItem(this._thermItem);
    this._chip.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (const name of ORDER) {
      const item = new PopupMenu.PopupMenuItem(name);
      item.connect('activate', () => this._setMode(name, false));
      this._chip.menu.addMenuItem(item);
      this._items[name] = item;
    }

    this._chip.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._revItem = new PopupMenu.PopupSwitchMenuItem('Rev-light',
      this._settings.get_boolean('rev-lights'));
    this._revItem.connect('toggled', (s, on) => {
      this._settings.set_boolean('rev-lights', on);
      this._parkRevs(!on);
    });
    this._chip.menu.addMenuItem(this._revItem);

    this._liveryItem = new PopupMenu.PopupSwitchMenuItem('Livery wallpaper',
      this._settings.get_boolean('livery'));
    this._liveryItem.connect('toggled', (s, on) => {
      this._settings.set_boolean('livery', on);
      this._applyLivery(on ? this._mode : null);
    });
    this._chip.menu.addMenuItem(this._liveryItem);

    this._launchItem = new PopupMenu.PopupSwitchMenuItem('Pit-lane timer',
      this._settings.get_boolean('launch-stats'));
    this._launchItem.connect('toggled', (s, on) =>
      this._settings.set_boolean('launch-stats', on));
    this._chip.menu.addMenuItem(this._launchItem);

    this._radioItem = new PopupMenu.PopupSwitchMenuItem('Team radio',
      this._settings.get_boolean('team-radio'));
    this._radioItem.connect('toggled', (s, on) =>
      this._settings.set_boolean('team-radio', on));
    this._chip.menu.addMenuItem(this._radioItem);

    Main.panel.addToStatusArea(ROLE, this._chip, 0, 'right');
  }

  _paintChip() {
    if (!this._chip)
      return;
    this._label.set_text(this._mode);
    for (const name of ORDER)
      this._chip.remove_style_class_name(`noir-cluster--${name.toLowerCase()}`);
    this._chip.add_style_class_name(`noir-cluster--${this._mode.toLowerCase()}`);
    for (const name of ORDER) {
      const it = this._items[name];
      if (name === this._mode)
        it.label.add_style_class_name('noir-cluster--active');
      else
        it.label.remove_style_class_name('noir-cluster--active');
    }
    this._revItem?.setToggleState(this._settings.get_boolean('rev-lights'), false);
    this._liveryItem?.setToggleState(this._settings.get_boolean('livery'), false);
    this._launchItem?.setToggleState(this._settings.get_boolean('launch-stats'), false);
    this._radioItem?.setToggleState(this._settings.get_boolean('team-radio'), false);
    this._chipTooltip();
  }

  // ── rev-light ───────────────────────────────────────────────────────────
  _buildRevs() {
    this._leds = [];
    // Ukuran dipasang lewat set_size(): St.Widget/St.Bin menolak x_size dan
    // y_size sebagai property konstruktor.
    this._strip = new St.Widget({
      style_class: 'noir-cluster-rev',
      reactive: false,
      can_focus: false,
      y_align: Clutter.ActorAlign.CENTER,
      layout_manager: new Clutter.BoxLayout({ spacing: LED_GAP }),
    });
    this._strip.set_size(STRIP_W, LED_H);
    for (let i = 0; i < LED_COUNT; i++) {
      const led = new St.Bin({
        style_class: i >= ROSSO_FROM
          ? 'noir-cluster-led noir-cluster-led--rosso' : 'noir-cluster-led',
      });
      led.set_size(LED_W, LED_H);
      this._leds.push(led);
      this._strip.add_child(led);
    }

    this._gearLabel = new St.Label({
      style_class: 'noir-cluster-num noir-cluster-num--gear',
      text: GEARS[0],
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._speedLabel = new St.Label({
      style_class: 'noir-cluster-num',
      text: '0',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Satu actor untuk lampu + gigi + kecepatan, ditanam di depan kotak chip
    // supaya ikut tata letak panel: tidak ada actor mengambang di kanvas.
    this._cluster = new St.Widget({
      reactive: false,
      can_focus: false,
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
      layout_manager: new Clutter.BoxLayout({ spacing: CLUSTER_GAP }),
    });
    this._cluster.add_child(this._gearLabel);
    this._cluster.add_child(this._strip);
    this._cluster.add_child(this._speedLabel);
    this._chipBox.insert_child_at_index(this._cluster, 0);
  }

  _showRevs() {
    if (!this._cluster || this._revOn || this._capUp)
      return;
    this._cluster.show();
    this._revOn = true;
  }

  // "Parkir" = lampu mati, gigi N, kecepatan 0. hide=true dipakai saat setting
  // atau mode memang tidak membawa rev-light, jadi strip tidak memakan panel.
  _parkRevs(hide) {
    this._rpm = 0;
    this._kmh = -1;
    if (this._lit) {
      for (const led of this._leds)
        led.remove_style_class_name('noir-cluster-led--lit');
      this._lit = 0;
    }
    this._gearLabel?.set_text(GEARS[0]);
    this._speedLabel?.set_text('0');
    if (hide && this._cluster && this._revOn) {
      this._cluster.hide();
      this._revOn = false;
    }
  }

  _readCpu() {
    try {
      const [ok, bytes] = GLib.file_get_contents('/proc/stat');
      if (!ok)
        return null;
      const f = new TextDecoder().decode(bytes).split('\n')[0].trim().split(/\s+/)
        .slice(1, 9).map(Number);
      const idle = f[3] + f[4];
      const total = f.reduce((a, b) => a + b, 0);
      return Number.isFinite(total) ? { busy: total - idle, total } : null;
    } catch {
      return null;
    }
  }

  _tick() {
    if (!this._mode)
      return;
    const gate = MODES[this._mode].revs;
    const on = this._settings.get_boolean('rev-lights') && gate === 'on';
    if (!on) {
      this._parkRevs(true);
      return;
    }
    this._showRevs();

    const s = this._readCpu();
    if (!s)
      return;
    if (this._prevTotal === 0) {
      this._prevBusy = s.busy;
      this._prevTotal = s.total;
      return;
    }
    const dB = s.busy - this._prevBusy;
    const dT = s.total - this._prevTotal;
    this._prevBusy = s.busy;
    this._prevTotal = s.total;
    if (dT <= 0)
      return;

    const load = (100 * dB) / dT;
    this._rpm = Math.max(load, this._rpm * DECAY);
    const lit = REV_STEPS.reduce((n, t) => n + (this._rpm >= t ? 1 : 0), 0);
    if (lit === 0) {
      // Idle: strip tetap di panel, lampunya saja yang padam.
      this._parkRevs(false);
      return;
    }
    if (lit !== this._lit) {
      for (let i = 0; i < this._leds.length; i++) {
        if (i < lit)
          this._leds[i].add_style_class_name('noir-cluster-led--lit');
        else
          this._leds[i].remove_style_class_name('noir-cluster-led--lit');
      }
      this._lit = lit;
      this._gearLabel.set_text(GEARS[Math.min(lit, GEARS.length - 1)]);
    }
    const kmh = Math.round(this._rpm * KMH_PER_PCT);
    if (kmh !== this._kmh) {
      this._speedLabel.set_text(`${kmh}`);
      this._kmh = kmh;
    }
  }

  // ── pit lane: waktu buka aplikasi ───────────────────────────────────────
  _watchApps() {
    this._appSys = Shell.AppSystem.get_default();
    this._appId = this._appSys.connect('app-state-changed',
      (sys, app) => this._onAppState(app));
  }

  // Cluster dan caption sekarang tinggal di dalam panel, jadi tidak ada lagi
  // tabrakan dengan bilah pencarian overview.
  _onAppState(app) {
    const st = app.state;
    if (st === Shell.AppState.STARTING) {
      if (!this._launching.has(app.id)) {
        this._launching.set(app.id, {
          t0: GLib.get_monotonic_time(),
          timer: this._after(LAUNCH_TIMEOUT_MS, () => this._dropLaunch(app.id)),
        });
      }
      return;
    }
    const rec = this._launching.get(app.id);
    if (!rec)
      return;
    this._dropLaunch(app.id);
    // STARTING -> RUNNING satu putaran penuh; STARTING -> INITIAL berarti
    // peluncuran batal dan tidak boleh ikut mencatat.
    if (st !== Shell.AppState.RUNNING && st !== Shell.AppState.NEEDS_ATTENTION)
      return;
    const dt = (GLib.get_monotonic_time() - rec.t0) / 1e6;
    if (!this._settings.get_boolean('launch-stats'))
      return;
    this._recordLaunch(app.id, dt);
    const med = this._median(this._stats[app.id]);
    this._showCaption(`${app.get_name()} ${dt.toFixed(1)} s · median ${med.toFixed(1)} s`);
  }

  _dropLaunch(id) {
    const rec = this._launching.get(id);
    if (!rec)
      return;
    if (this._timers.delete(rec.timer))
      GLib.source_remove(rec.timer);
    this._launching.delete(id);
  }

  _loadStats() {
    try {
      const [ok, bytes] = GLib.file_get_contents(STATS_FILE);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Belum ada catatan, atau file rusak: mulai dari nol.
      return {};
    }
  }

  _recordLaunch(id, dt) {
    const list = this._stats[id] ?? [];
    list.push(Math.round(dt * 10) / 10);
    if (list.length > STATS_MAX)
      list.shift();
    this._stats[id] = list;
    try {
      GLib.mkdir_with_parents(STATS_DIR, 0o755);
      GLib.file_set_contents(STATS_FILE, JSON.stringify(this._stats));
    } catch (e) {
      log(`noir-cluster: catatan launch gagal ditulis: ${e.message}`);
    }
  }

  _median(list) {
    if (!list?.length)
      return 0;
    const s = [...list].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  _buildCaption() {
    this._caption = new St.Label({
      style_class: 'noir-cluster-caption',
      reactive: false,
      can_focus: false,
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.START,
    });
    // Satu slot dengan cluster: saat pesan tampil cluster digantikan di tempat
    // yang sama, jadi titik dan label mode tidak berpindah di panel.
    this._chipBox.insert_child_at_index(this._caption, 0);
  }

  // Papan pit-lane mengambil alih slot cluster: cluster disembunyikan selama
  // pesan tampil dan lebar label dikunci ke lebar cluster. Tanpa itu panel
  // bergeser tiap pesan muncul dan teks panjang terpotong elipsis.
  _showCaption(text) {
    if (!this._caption)
      return;
    const [, w] = this._cluster?.get_preferred_width(-1) ?? [];
    if (w > 0)
      this._caption.set_width(w);
    if (!this._capUp && this._revOn) {
      this._cluster.hide();
      this._revOn = false;
    }
    this._capUp = true;
    this._caption.set_text(text);
    this._caption.remove_all_transitions();
    this._caption.opacity = 255;
    this._caption.show();
    if (this._capId) {
      this._timers.delete(this._capId);
      GLib.source_remove(this._capId);
    }
    this._capId = this._after(CAPTION_MS, () => {
      this._capId = 0;
      this._caption?.ease({
        opacity: 0,
        duration: CAPTION_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
          this._caption?.hide();
          this._capUp = false;
          // Jangan paksa cluster muncul: biarkan tick yang memutuskan, supaya
          // switch rev-light yang dimatikan saat pesan tampil tidak dibatalkan.
          this._tick();
        },
      });
    });
  }
}
