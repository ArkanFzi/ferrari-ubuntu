// Rail di sisi dock: sub panel buka-tutup berisi aplikasi terkini, folder
// tersering, dan terminal cepat. Peringkatnya diambil dari perilaku nyata —
// bookmark GTK, ~/.bash_history, state aplikasi, dan log klik milik sendiri di
// ~/.local/share/noir-rail/usage.json — jadi langsung berguna tanpa konfigurasi.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Pango from 'gi://Pango';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PANEL_W = 300;
const ROW_H = 32;
const SEC_H = 22;
const SEP_H = 17;      // hairline + margin 8px atas/bawah
const PANEL_PAD = 20;  // padding vertikal .noir-rail-panel
const HANDLE_W = 30;
const HANDLE_H = 68;
const GAP = 8;
const EDGE_PAD = 8;    // jarak panel dari batas atas/bawah area kerja
const DOCK_ICON = 32;  // ikon pemicu saat menempel di dock
const FLOAT_ICON = 16;

const MAX_APPS = 7;
const MAX_DIRS = 7;
const MAX_CMDS = 6;

// Baris yang cuma bunyi-bunyi: mengetiknya di terminal baru tidak menambah nilai.
const NOISE = new Set(['clear', 'ls', 'cd', 'pwd', 'exit', 'll', 'la', 'c']);

// Panel ini sekali klik tanpa konfirmasi, jadi aksi yang tidak bisa dibatalkan
// disaring keluar dari daftar riwayat.
const BLOCKED = [
  /^sudo\b/, /^rm\b/, /^mv\b/, /^dd\b/, /^mkfs/, /^chmod\b/, /^chown\b/,
  /^git\s+push\b/, /^git\s+reset\b/, /^git\s+clean\b/, /^git\s+rebase\b/,
  /^curl\b/, /^wget\b/, /^kill/, /^killall/, /^reboot\b/, /^shutdown\b/,
  /^systemctl\s+(start|stop|restart|disable|enable)/, /^apt\b/, /^:(){/,
];

function readText(path) {
  try {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    // GLib.utf8_to_string tidak terekspos di GJS 1.80; byte array didekode
    // TextDecoder bawaan.
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return '';
  }
}

function spawn(argv) {
  const line = argv.map(a => GLib.shell_quote(a)).join(' ');
  try {
    GLib.spawn_command_line_async(line);
  } catch (e) {
    logError(e, 'noir-rail: gagal menjalankan');
  }
}

// Shell 46 tidak punya pseudo-class untuk state baterai — yang berubah cuma
// icon_name, dan warna ikon ikut teks panel. Jadi ambang kritis dibaca sendiri
// lewat UPower dan kelasnya dipasang manual.
const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_DISPLAY = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_DEVICE_IFACE = 'org.freedesktop.UPower.Device';
const BATT_OFF_AC = [2, 3, 6];  // discharging, empty, pending discharge
const BATT_CRIT = 10;           // persen, sejajar dengan peringatan "Nearly Empty"

// Indikator baterai bukan anggota statusArea: ia anak dari kotak indikator milik
// tombol Quick Settings (panel.js: QuickSettings._indicators), jadi dicari lewat
// kelas .power-status milik sendiri.
function batteryActor() {
  const box = Main.panel?.statusArea?.quickSettings?._indicators;
  if (!box)
    return null;
  return box.get_children().find(c => c.has_style_class_name?.('power-status')) ?? null;
}

// Baris "Battery Level" di dalam panel Quick Settings. Actor-nya lahir dari
// Indicator yang sama (status/system.js:323 this._systemItem = new SystemItem())
// lalu direparent ke grid .quick-settings lewat quickSettingsItems, jadi tidak
// bisa ditemukan lewat kelas .power-status di atas. Kelas aslinya .power-item
// (status/system.js:41) dan hanya dipakai satu kali di seluruh shell.
function batteryMenuItem() {
  const sys = Main.panel?.statusArea?.quickSettings?._system;
  return sys?._systemItem?.powerToggle ?? null;
}

function terminalApp() {
  for (const id of ['org.gnome.Terminal.desktop', 'org.gnome.Console.desktop']) {
    const info = Gio.DesktopAppInfo.new(id);
    if (info && info.should_show())
      return info;
  }
  return Gio.AppInfo.get_all().find(
    a => a.should_show() && /TerminalEmulator/.test(a.get_string('Categories') || ''))
    ?? Gio.DesktopAppInfo.new('xterm.desktop');
}

// gnome-terminal menerima --working-directory dan pemisah "--"; emulator lain
// didekati lewat sub-shell supaya cwd-nya ikut.
function openTerminal(dir, command) {
  const info = terminalApp();
  if (!info)
    return;

  const exec = info.get_executable();
  const base = GLib.path_get_basename(exec);
  const clientStyle = ['gnome-terminal', 'kgx'].includes(base);

  if (clientStyle) {
    const argv = [exec];
    if (dir)
      argv.push(`--working-directory=${dir}`);
    if (command)
      argv.push('--', 'bash', '-lc', command);
    spawn(argv);
    return;
  }

  const cd = dir ? `cd -- ${GLib.shell_quote(dir)} && ` : '';
  spawn(['sh', '-c', `${cd}exec ${GLib.shell_quote(exec)}`]);
}

function openInFiles(path) {
  const info = Gio.AppInfo.get_default_for_type('inode/directory', false);
  if (info) {
    info.launch_uris([Gio.File.new_for_path(path).get_uri()],
      global.create_app_launch_context(global.get_current_time(), -1));
    return;
  }
  spawn(['xdg-open', path]);
}

function dirLabel(path) {
  const home = GLib.get_home_dir();
  if (path === home)
    return '~';
  if (path.startsWith(home + '/'))
    return path.slice(home.length + 1);
  return path;
}

const Icon = (name, size = 18) => new St.Icon({ icon_name: name, icon_size: size });

// Chrome actor (termasuk dock) jadi anak langsung uiGroup; Clutter tidak
// menyediakan find_child_by_name di GJS, jadi dipindai sendiri.
function findChrome(name) {
  for (const child of Main.uiGroup.get_children()) {
    if (child.get_name() === name)
      return child;
  }
  return null;
}

// Kotak alokasi actor dihitung relatif ke induknya. Pemicu diselipkan ke dalam
// dash, jadi koordinatnya bukan koordinat stage — membandingkannya langsung
// dengan koordinat event membuat pemicu terbaca "di luar" dan setiap klik jadi
// tutup-buka dalam satu tekanan. Dipetakan ke stage lebih dulu.
function overActor(actor, x, y) {
  if (!actor || !actor.visible)
    return false;
  const [ax, ay] = actor.get_transformed_position();
  const [aw, ah] = actor.get_transformed_size();
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(aw) || !Number.isFinite(ah))
    return false;
  return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
}

// Pusat actor dalam koordinat stage, untuk menempatkan panel di samping pemicu.
function centerInStage(actor) {
  const [ax, ay] = actor.get_transformed_position();
  const [, ah] = actor.get_transformed_size();
  if (!Number.isFinite(ax) || !Number.isFinite(ay))
    return null;
  return ay + ah / 2;
}

// BFS over gaya kelas: dipakai untuk menemukan tombol app-grid dock tanpa
// menyebut field privat ubuntu-dock, yang bisa berganti nama antar versi.
function findByClass(root, className) {
  const queue = [root];
  while (queue.length) {
    const a = queue.shift();
    if ((a.get_style_class_name?.() ?? '').split(/\s+/).includes(className))
      return a;
    for (const c of a.get_children())
      queue.push(c);
  }
  return null;
}

// Dock tidak punya API untuk menambah tombol, jadi slotnya dicari saat runtime:
// anak langsung dari container app-grid yang memuat .show-apps. Index dipilih
// supaya :first-child/:last-child — yang dipakai tema untuk mengatur padding
// bawah tombol app grid — tidak berpindah alamat; kalau berpindah, ikon app
// grid kehilangan margin bawahnya dan kolom dock bergeser.
function dockSlot() {
  const dock = findChrome('dashtodockContainer');
  const btn = dock && findByClass(dock, 'show-apps');
  const anchor = btn?.get_parent();
  const parent = anchor?.get_parent();
  if (!parent)
    return null;

  const kids = parent.get_children();
  const i = kids.findIndex(k => k === anchor);
  if (i < 0)
    return null;

  return {
    parent,
    anchor,
    index: i === 0 ? i + 1 : i,
    face: findByClass(btn, 'overview-icon') ?? btn,
  };
}

export default class NoirRailExtension extends Extension {
  enable() {
    this._dataDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'noir-rail']);
    this._usagePath = GLib.build_filenamev([this._dataDir, 'usage.json']);
    this._usage = this._readUsage();
    this._open = false;
    this._panelH = 0;
    this._saveId = 0;
    this._hideId = 0;
    this._outsideId = 0;
    this._overviewShownId = 0;
    this._overviewHiddenId = 0;
    this._launchId = 0;
    this._monitorsId = 0;
    this._fullscreenId = 0;
    this._mountId = 0;
    this._battProxy = null;
    this._battChangedId = 0;
    this._battActor = null;
    this._battItem = null;
    this._battRetryId = 0;
    this._battTries = 0;
    this._extIds = [];
    this._keyId = 0;
    this._teardown = false;
    this._disabling = false;
    this._inChrome = false;
    this._dockMode = false;

    this._panel = new St.BoxLayout({
      vertical: true,
      style_class: 'noir-rail-panel',
      reactive: true,
      can_focus: false,
      width: PANEL_W,
      visible: false,
    });
    Main.layoutManager.addChrome(this._panel);

    this._settings = this.getSettings();
    this._keyId = Main.wm.addKeybinding('toggle-rail', this._settings,
      Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, () => {
        this._toggle();
      });

    this._mountHandle();

    this._appSystem = Shell.AppSystem.get_default();
    this._launchId = this._appSystem.connect('app-state-changed', (sys, app) => {
      if (app.get_state() === Shell.AppState.RUNNING)
        this._bump('apps', app.get_id());
    });

    this._overviewShownId = Main.overview.connect('showing', () => this._syncVisibility());
    // 'hidden', bukan 'hiding': saat animasi penutupan mulai, overview.visible
    // masih true sehingga rail akan dibiarkan tersembunyi selamanya.
    this._overviewHiddenId = Main.overview.connect('hidden', () => this._syncVisibility());
    this._fullscreenId = global.display.connect('in-fullscreen-changed',
      () => this._syncVisibility());
    this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
      // ubuntu-dock membangun ulang dash saat monitor berubah; handle lama bisa
      // ikut musnah bersama dash-nya, dan slot baru belum tentu sudah ada.
      this._mountHandle();
      this._remountLater();
    });

    // Dock bisa dihidupkan/matikan kapan pun, dan Clutter 14 tidak punya sinyal
    // "anak ditambahkan" untuk dipantau, jadi kepulangannya dibaca dari daftar
    // ekstensi.
    this._extIds = [
      global.settings.connect('changed::enabled-extensions', () => this._remountSoon()),
      global.settings.connect('changed::disabled-extensions', () => this._remountSoon()),
    ];

    this._watchBattery();

    this._reposition();
    // Dock lahir belakangan: ubuntu-dock bisa baru membangun dash setelah
    // ekstensi ini aktif, jadi mount diulang sampai slotnya ada.
    this._remountSoon();
    this._syncVisibility();
    log('noir-rail: rail siap');
  }

  _watchBattery() {
    try {
      this._battProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM,
        Gio.DBusProxyFlags.NONE, null, UPOWER_BUS, UPOWER_DISPLAY,
        UPOWER_DEVICE_IFACE, null);
    } catch (e) {
      // Mesin tanpa UPower (desktop stasioner): fitur ini memang tidak berlaku.
      return;
    }
    this._battChangedId = this._battProxy.connect('g-properties-changed',
      () => this._syncBattery());
    this._syncBattery();
  }

  _syncBattery() {
    const actor = batteryActor();
    if (!actor) {
      // Panel membangun indikatornya di balik beberapa await (panel.js), jadi
      // saat ekstensi baru aktif actor-nya belum tentu sudah ada.
      if (this._battTries++ < 6)
        this._retryBattery();
      return;
    }
    this._battTries = 0;

    const pct = this._battProxy.get_cached_property('Percentage')?.unpack() ?? -1;
    const state = this._battProxy.get_cached_property('State')?.unpack() ?? 0;
    const crit = pct >= 0 && pct <= BATT_CRIT && BATT_OFF_AC.includes(state);

    // Peringatan harus terbaca di dua tempat yang sama-sama dilihat orang: ikon
    // panel dan baris "Battery Level" di dalam Quick Settings.
    this._markBattery('_battActor', actor, crit);
    this._markBattery('_battItem', batteryMenuItem(), crit);
  }

  _markBattery(slot, actor, crit) {
    if (!actor)
      return;
    if (this[slot] && this[slot] !== actor)
      this[slot].remove_style_class_name('noir-batt-critical');
    this[slot] = actor;
    if (crit)
      actor.add_style_class_name('noir-batt-critical');
    else
      actor.remove_style_class_name('noir-batt-critical');
  }

  _retryBattery() {
    this._removeId('_battRetryId');
    this._battRetryId = GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
      this._battRetryId = 0;
      if (!this._disabling)
        this._syncBattery();
      return GLib.SOURCE_REMOVE;
    });
  }

  disable() {
    this._disabling = true;
    if (this._launchId)
      this._appSystem.disconnect(this._launchId);
    Main.overview.disconnect(this._overviewShownId);
    Main.overview.disconnect(this._overviewHiddenId);
    Main.layoutManager.disconnect(this._monitorsId);
    global.display.disconnect(this._fullscreenId);
    if (this._outsideId)
      global.stage.disconnect(this._outsideId);
    if (this._keyId)
      Main.wm.removeKeybinding('toggle-rail');
    this._removeId('_saveId');
    this._removeId('_hideId');
    this._removeId('_mountId');
    this._removeId('_battRetryId');
    if (this._battChangedId)
      this._battProxy.disconnect(this._battChangedId);
    this._battActor?.remove_style_class_name('noir-batt-critical');
    this._battActor = null;
    this._battItem?.remove_style_class_name('noir-batt-critical');
    this._battItem = null;
    this._battProxy = null;
    for (const id of this._extIds)
      global.settings.disconnect(id);
    this._extIds = [];
    this._flushUsage();

    this._dropHandle();
    Main.layoutManager.removeChrome(this._panel);
    this._panel.destroy();
    this._panel = null;
    this._settings = null;
  }

  // ── pemicu: diselipkan ke dock, mengambang kalau dock tidak ada ─────────
  _buildHandle() {
    this._handle = new St.Button({ reactive: true, can_focus: false });
    this._face = new St.Bin();
    this._icon = Icon('pan-end-symbolic', FLOAT_ICON);
    this._face.add_child(this._icon);
    this._handle.child = this._face;
    this._handle.connect('clicked', () => this._toggle());
    // ubuntu-dock bisa menghancurkan dash kapan pun (ganti monitor, ubah
    // setting). Handle ikut musnah, jadi 'destroy' dipakai sebagai isyarat
    // untuk membangun ulang — bukan sebagai jalur pembersihan.
    this._handle.connect('destroy', () => this._onHandleDestroyed());
  }

  _mountHandle() {
    if (this._disabling)
      return;
    this._dropHandle();
    this._buildHandle();

    const slot = dockSlot();
    this._dockMode = !!slot;

    if (slot) {
      // Struktur ditiru dari dock sendiri: tombol seukuran satu langkah ikon
      // (transparan) dengan wajah lingkaran hover di dalamnya. St.Button adalah
      // St.Bin, jadi anak dengan x/y_align CENTER otomatis terpusat — sesuatu
      // yang tidak dilakukan St.BoxLayout pada sumbu utamanya.
      this._handle.add_style_class_name('noir-rail-slot');
      this._face.add_style_class_name('noir-rail-dock');
      this._face.set({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._icon.set({ icon_name: 'document-open-recent-symbolic', icon_size: DOCK_ICON });
      // Ukuran dikunci ke tombol app grid supaya ikut kalau dash-max-icon-size
      // berubah, dan handle tidak pernah melebarkan kolom dock.
      this._binds = [
        new Clutter.BindConstraint({
          source: slot.anchor,
          coordinate: Clutter.BindCoordinate.WIDTH,
        }),
        new Clutter.BindConstraint({
          source: slot.anchor,
          coordinate: Clutter.BindCoordinate.HEIGHT,
        }),
        new Clutter.BindConstraint({
          source: slot.face,
          coordinate: Clutter.BindCoordinate.WIDTH,
        }),
        new Clutter.BindConstraint({
          source: slot.face,
          coordinate: Clutter.BindCoordinate.HEIGHT,
        }),
      ];
      this._handle.add_constraint(this._binds[0]);
      this._handle.add_constraint(this._binds[1]);
      this._face.add_constraint(this._binds[2]);
      this._face.add_constraint(this._binds[3]);
      slot.parent.insert_child_at_index(this._handle, slot.index);
    } else {
      // addChrome() memasang ke uiGroup sekaligus mengurus input region. Tanpa
      // trackFullscreen: kalau tidak, LayoutManager ikut mengatur 'visible'
      // actor kita dan panel tertutup pun dipaksa tampil.
      this._handle.add_style_class_name('noir-rail-handle');
      this._handle.set({ width: HANDLE_W, height: HANDLE_H });
      Main.layoutManager.addChrome(this._handle);
      this._inChrome = true;
    }

    this._setOpenState(this._open);
    this._reposition();
    this._syncVisibility();
  }

  _dropHandle() {
    if (!this._handle)
      return;
    this._teardown = true;
    const handle = this._handle;
    this._handle = this._face = this._icon = null;
    this._binds = [];
    if (this._inChrome) {
      this._inChrome = false;
      Main.layoutManager.removeChrome(handle);
    } else {
      handle.get_parent()?.remove_child(handle);
    }
    handle.destroy();
    this._teardown = false;
  }

  _onHandleDestroyed() {
    if (this._teardown || this._disabling || this._mountId)
      return;
    this._handle = this._face = null;
    this._icon = null;
    this._inChrome = false;
    this._remountLater();
  }

  _remountSoon() {
    if (!this._dockMode)
      this._remountLater();
  }

  _remountLater(retries = 8) {
    this._removeId('_mountId');
    this._mountId = GLib.timeout_add(GLib.PRIORITY_LOW, 500, () => {
      this._mountId = 0;
      if (this._disabling)
        return GLib.SOURCE_REMOVE;
      this._mountHandle();
      if (!this._dockMode && retries > 1)
        this._remountLater(retries - 1);
      return GLib.SOURCE_REMOVE;
    });
  }

  _removeId(field) {
    if (this[field]) {
      GLib.Source.remove(this[field]);
      this[field] = 0;
    }
  }

  // ── penyimpanan perilaku ────────────────────────────────────────────────
  _readUsage() {
    try {
      return JSON.parse(readText(this._usagePath)) || {};
    } catch (e) {
      return {};
    }
  }

  _entry(section, key) {
    const s = this._usage[section] ??= {};
    return s[key] ??= { n: 0, t: 0 };
  }

  _bump(section, key) {
    const e = this._entry(section, key);
    e.n += 1;
    e.t = Math.floor(GLib.get_real_time() / GLib.USEC_PER_SEC);
    if (!this._saveId) {
      this._saveId = GLib.timeout_add(GLib.PRIORITY_LOW, 400, () => {
        this._saveId = 0;
        this._flushUsage();
        return GLib.SOURCE_REMOVE;
      });
    }
  }

  _flushUsage() {
    try {
      Gio.File.new_for_path(this._dataDir).make_directory(null);
    } catch (e) {
      if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
        logError(e, 'noir-rail: folder data');
    }
    try {
      GLib.file_set_contents(this._usagePath, JSON.stringify(this._usage));
    } catch (e) {
      logError(e, 'noir-rail: simpan usage');
    }
  }

  // ── sumber data ─────────────────────────────────────────────────────────
  _ranked(section, max) {
    const out = [];
    for (const [key, e] of Object.entries(this._usage[section] ?? {}))
      out.push([key, e.n, e.t]);
    out.sort((a, b) => b[1] - a[1] || b[2] - a[2]);
    return out.slice(0, max);
  }

  recentApps() {
    const system = Shell.AppSystem.get_default();
    const seen = new Set();
    const apps = [];

    const push = id => {
      if (!id || seen.has(id))
        return;
      const app = system.lookup_app(id);
      if (!app)
        return;
      seen.add(id);
      apps.push(app);
    };

    for (const [id, n] of this._ranked('apps', MAX_APPS * 3)) {
      if (apps.length >= MAX_APPS)
        break;
      push(id);
    }
    // Hari pertama log masih kosong: pakai yang sedang jalan, lalu favorit dock.
    for (const app of system.get_running()) {
      if (apps.length >= MAX_APPS)
        break;
      push(app.get_id());
    }
    if (apps.length < MAX_APPS) {
      const favs = new Gio.Settings({ schema_id: 'org.gnome.shell' }).get_strv('favorite-apps');
      for (const id of favs) {
        if (apps.length >= MAX_APPS)
          break;
        push(id);
      }
    }
    return apps;
  }

  _resolveDir(raw, home, topLevel) {
    if (!raw || raw === '.' || raw === '..' || raw.startsWith('..') || raw.includes('*'))
      return null;
    // Riwayat menyimpan apa adanya: kutip dan garis miring penutup ikut dibersihkan.
    const clean = raw.replace(/^["']|["']$/g, '').replace(/\/+$/, '') || '/';
    let p = clean.replace(/^~(?=\/|$)/, home);
    if (p.startsWith('/'))
      return this._isDir(p) ? p : null;
    // Nama relatif tidak diuji apa adanya: direktori kerja shell bukan direktori
    // user waktu perintah itu diketik, jadi selalu dipatok ke $HOME dulu, baru
    // ke anak langsung $HOME (riwayat sering berisi nama folder setingkat di
    // dalam proyek).
    const candidates = [GLib.build_filenamev([home, p])];
    for (const dir of topLevel)
      candidates.push(GLib.build_filenamev([dir, p]));
    return candidates.find(cand => this._isDir(cand)) ?? null;
  }

  _isDir(path) {
    return GLib.file_test(path, GLib.FileTest.IS_DIR);
  }

  frequentDirs() {
    const home = GLib.get_home_dir();
    const score = new Map();
    const add = (path, weight) => {
      if (path)
        score.set(path, (score.get(path) ?? 0) + weight);
    };

    for (const line of readText(GLib.build_filenamev(
      [GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks'])).split('\n')) {
      const uri = line.trim().split(/\s+/)[0];
      if (!uri.startsWith('file://'))
        continue;
      const f = Gio.File.new_for_uri(uri);
      const p = f.get_path ? f.get_path() : null;
      add(p, 4);   // bookmark = niat eksplisit, naik peringkat
    }

    const topLevel = this._homeChildren(home);
    const counts = this._cdCounts(topLevel, home);
    for (const [path, n] of counts)
      add(path, n);

    for (const [path, n] of this._ranked('dirs', MAX_DIRS * 4))
      add(path, 2 * n);

    const ranked = [...score.entries()]
      .filter(([p]) => this._isDir(p))
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);
    return ranked.slice(0, MAX_DIRS);
  }

  _homeChildren(home) {
    const out = [];
    try {
      const en = Gio.File.new_for_path(home).enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
      for (let info = en.next_file(null); info; info = en.next_file(null)) {
        if (info.get_is_directory())
          out.push(GLib.build_filenamev([home, info.get_name()]));
      }
    } catch (e) {
      // daftar induk hanya pelengkap resolusi nama relatif
    }
    return out;
  }

  _cdCounts(topLevel, home) {
    const hist = readText(GLib.build_filenamev([home, '.bash_history']));
    const tally = new Map();
    for (const line of hist.split('\n')) {
      if (line.startsWith('#'))
        continue;
      for (const [, raw] of line.matchAll(/(?:^|[;&|]\s*)cd\s+([^\s;&|]+)/g))
        tally.set(raw, (tally.get(raw) ?? 0) + 1);
    }
    const out = new Map();
    for (const [raw, n] of tally) {
      const p = this._resolveDir(raw, home, topLevel);
      if (p)
        out.set(p, (out.get(p) ?? 0) + n);
    }
    return out;
  }

  quickCommands() {
    const home = GLib.get_home_dir();
    const hist = readText(GLib.build_filenamev([home, '.bash_history']));
    const tally = new Map();

    hist.split('\n').forEach((raw, idx) => {
      if (raw.startsWith('#') || raw.length > 90 || raw.startsWith('!'))
        return;
      let line = raw.trim();
      const lead = line.match(/^cd\s+\S+\s*&&\s*(.+)$/);
      if (lead)
        line = lead[1].trim();
      if (!line)
        return;
      const first = line.split(/\s+/)[0];
      if (NOISE.has(first) || BLOCKED.some(re => re.test(line)))
        return;
      // Baris yang programnya tidak ada di PATH adalah salah ketik atau
      // syntax shell — bukan kandidat pintasan.
      if (!GLib.find_program_in_path(first))
        return;
      const prev = tally.get(line);
      tally.set(line, prev ? { n: prev.n + 1, at: idx } : { n: 1, at: idx });
    });

    for (const [cmd, e] of Object.entries(this._usage.cmds ?? {})) {
      const prev = tally.get(cmd);
      tally.set(cmd, { n: (prev?.n ?? 0) + 3 * e.n, at: prev?.at ?? e.t });
    }

    return [...tally.entries()]
      .sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at)
      .slice(0, MAX_CMDS)
      .map(([cmd]) => cmd);
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  _row({ iconName, gicon, text, hint, mono, mini, onClick }) {
    const btn = new St.Button({
      style_class: 'noir-rail-row',
      reactive: true,
      can_focus: false,
      x_expand: true,
      height: ROW_H,
    });

    // St.BoxLayout 14 tidak punya properti 'spacing'; jarak diatur lewat margin.
    const inner = new St.BoxLayout({ vertical: false, x_expand: true });
    const icon = gicon
      ? new St.Icon({ gicon, icon_size: 18 })
      : Icon(iconName);
    // St-14 cuma punya margin-left/right; margin-start/end tidak terdaftar.
    icon.margin_right = 8;
    inner.add_child(icon);

    const label = new St.Label({
      text,
      style_class: mono ? 'noir-rail-row-cmd' : 'noir-rail-row-label',
      y_align: Clutter.ActorAlign.CENTER,
      x_align: Clutter.ActorAlign.FILL,
      x_expand: true,
    });
    // St.Label tidak punya set_ellipsize; mode elipsis hidup di ClutterText
    // yang dibungkusnya (sama seperti yang dipakai ubuntu-dock).
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    inner.add_child(label);

    if (hint) {
      inner.add_child(new St.Label({
        text: hint,
        style_class: 'noir-rail-row-hint',
        y_align: Clutter.ActorAlign.CENTER,
        margin_left: 8,
      }));
    }

    if (mini) {
      const sub = new St.Button({
        style_class: 'noir-rail-mini',
        reactive: true,
        can_focus: false,
        margin_left: 6,
        child: Icon('utilities-terminal-symbolic', 14),
      });
      sub.connect('clicked', () => mini());
      inner.add_child(sub);
    }

    btn.child = inner;
    btn.connect('clicked', () => onClick());
    return btn;
  }

  _section(title, rows) {
    const box = new St.BoxLayout({ vertical: true, x_expand: true });
    box.add_child(new St.Label({
      text: title,
      style_class: 'noir-rail-section',
      x_align: Clutter.ActorAlign.START,
      height: SEC_H,
    }));
    for (const row of rows)
      box.add_child(row);
    return box;
  }

  _separator() {
    return new St.Widget({
      style_class: 'noir-rail-sep',
      height: 1,
      x_expand: true,
    });
  }

  _buildPanel() {
    this._panel.destroy_all_children();

    const apps = this.recentApps();
    const dirs = this.frequentDirs();
    const cmds = this.quickCommands();

    const appRows = apps.map(app => {
      const n = this._usage.apps?.[app.get_id()]?.n ?? 0;
      return this._row({
        gicon: app.get_icon(),
        text: app.get_name(),
        hint: n > 0 ? String(n) : '',
        onClick: () => {
          this._bump('apps', app.get_id());
          this._close();
          app.get_app_info().launch([],
            global.create_app_launch_context(global.get_current_time(), -1));
        },
      });
    });

    const dirRows = dirs.map(dir => this._row({
      iconName: 'folder-symbolic',
      text: dirLabel(dir),
      onClick: () => {
        this._bump('dirs', dir);
        this._close();
        openInFiles(dir);
      },
      mini: () => {
        this._bump('dirs', dir);
        this._close();
        openTerminal(dir, null);
      },
    }));

    const cmdRows = [this._row({
      iconName: 'utilities-terminal-symbolic',
      text: 'Terminal baru di ~',
      onClick: () => {
        this._close();
        openTerminal(GLib.get_home_dir(), null);
      },
    })].concat(cmds.map(cmd => this._row({
      iconName: 'utilities-terminal-symbolic',
      text: cmd,
      mono: true,
      onClick: () => {
        this._bump('cmds', cmd);
        this._close();
        openTerminal(GLib.get_home_dir(), cmd);
      },
    })));

    // Tinggi dibatasi area kerja: sisa ruang dibagi berurutan, jadi seksi yang
    // tidak muat kehilangan baris paling bawahnya saja.
    const mon = Main.layoutManager.primaryMonitor;
    const limit = mon
      ? Main.layoutManager.getWorkAreaForMonitor(mon.index).height - 24
      : 720;
    let room = Math.floor((limit - PANEL_PAD - 3 * SEC_H - 2 * SEP_H) / ROW_H);
    const fit = list => {
      const take = Math.max(0, Math.min(list.length, room));
      room -= take;
      return list.slice(0, take);
    };

    const sections = [
      ['Aplikasi terkini', fit(appRows)],
      ['Folder tersering', fit(dirRows)],
      ['Terminal', fit(cmdRows)],
    ].filter(([, rows]) => rows.length);

    sections.forEach(([title, rows], i) => {
      if (i)
        this._panel.add_child(this._separator());
      this._panel.add_child(this._section(title, rows));
    });

    const counted = sections.reduce((n, [, rows]) => n + rows.length, 0);
    this._panelH = PANEL_PAD + sections.length * SEC_H + counted * ROW_H
      + (sections.length - 1) * SEP_H;
  }

  // Dock tidak mengekspos API publik; nama actor-nya stabil lintas versi
  // dash-to-dock. Selalu di-resolve ulang supaya dock yang dibuat/dihancurkan
  // ubuntu-dock tidak meninggalkan rujukan basi.
  _reposition() {
    if (!this._handle)
      return;
    const mon = Main.layoutManager.primaryMonitor;
    if (!mon)
      return;
    const wa = Main.layoutManager.getWorkAreaForMonitor(mon.index);
    const box = findChrome('dashtodockContainer')?.get_allocation_box();
    const docked = box && box.x2 > 1;
    const x = (docked ? box.x2 : wa.x) + GAP;

    if (this._dockMode) {
      // Dock yang menaruh pemicu; panel hanya perlu mencari sisi kanannya,
      // lalu dijepit ke area kerja — pemicu duduk di dasar dock, jadi panel
      // setinggi apa pun tidak boleh keluar layar.
      const cy = centerInStage(this._handle) ?? this._panelH / 2;
      this._panel.set_position(x,
        this._clampTop(cy - this._panelH / 2, wa));
      return;
    }

    const top = docked ? box.y1 : wa.y;
    const band = docked ? box.y2 - box.y1 : wa.height;
    this._handle.set_position(x, Math.round(top + (band - HANDLE_H) / 2));
    this._panel.set_position(x + HANDLE_W + GAP,
      this._clampTop(top + (band - this._panelH) / 2, wa));
  }

  _clampTop(y, wa) {
    const min = wa.y + EDGE_PAD;
    const max = wa.y + wa.height - this._panelH - EDGE_PAD;
    return max < min ? min : Math.round(Math.max(min, Math.min(y, max)));
  }

  _toggle() {
    this._open ? this._close() : this._show();
  }

  _show() {
    this._open = true;
    this._buildPanel();
    this._reposition();
    this._syncVisibility();

    this._removeId('_hideId');
    this._panel.opacity = 0;
    this._panel.translation_x = -18;
    this._panel.save_easing_state();
    this._panel.set({
      easing_duration: 180,
      easing_mode: Clutter.AnimationMode.EASE_OUT_QUART,
      opacity: 255,
      translation_x: 0,
    });
    this._panel.restore_easing_state();

    this._setOpenState(true);
    if (!this._outsideId) {
      // Rail sengaja tidak pushModal: grab yang lupa dilepas membuat desktop
      // tidak bisa diklik sampai logout, dan harga itu terlalu mahal untuk
      // Escape. Tanpa modal, tombol keyboard tidak sampai ke actor chrome ini,
      // jadi hanya tekanan pointer di luar panel yang menutupnya.
      this._outsideId = global.stage.connect('captured-event', (stage, event) => {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
          // Sumber event bisa null (tekanan sintetis/latar), jadi kedua actor
          // diuji dengan geometri stage-nya, bukan dengan sumber event.
          const [x, y] = event.get_coords();
          if (!overActor(this._panel, x, y) && !overActor(this._handle, x, y))
            this._close();
        }
        return false;
      });
    }
  }

  _close() {
    if (!this._open)
      return;
    this._open = false;
    this._setOpenState(false);

    if (this._outsideId) {
      global.stage.disconnect(this._outsideId);
      this._outsideId = 0;
    }

    this._panel.save_easing_state();
    this._panel.set({
      easing_duration: 150,
      easing_mode: Clutter.AnimationMode.EASE_IN_QUART,
      opacity: 0,
      translation_x: -18,
    });
    this._panel.restore_easing_state();
    this._removeId('_hideId');
    this._hideId = GLib.timeout_add(GLib.PRIORITY_LOW, 160, () => {
      this._hideId = 0;
      this._panel.hide();
      return GLib.SOURCE_REMOVE;
    });
  }

  _syncVisibility() {
    if (!this._handle)
      return;
    const mon = Main.layoutManager.primaryMonitor;
    const hidden = Main.overview.visible
      || Main.sessionMode.currentMode === 'locked'
      || (mon ? global.display.get_monitor_in_fullscreen(mon.index) : false);
    this._handle.visible = !hidden;
    if (hidden) {
      this._panel.hide();
    } else if (this._open) {
      // Setelah overview/fullscreen berakhir, alokasi dock bisa sudah berubah.
      this._reposition();
      this._panel.show();
    }
  }

  // State dibuka ditandai dengan kelas nyata, bukan pseudo-class, supaya tidak
  // bergantung pada state tombol Clutter yang tidak kita pegang.
  _setOpenState(open) {
    if (!this._handle)
      return;
    if (open)
      this._handle.add_style_class_name('noir-rail-on');
    else
      this._handle.remove_style_class_name('noir-rail-on');
    if (!this._dockMode)
      this._icon.set({ icon_name: open ? 'pan-start-symbolic' : 'pan-end-symbolic' });
  }
}
