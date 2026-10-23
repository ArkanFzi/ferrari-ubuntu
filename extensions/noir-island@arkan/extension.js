// noir-island@arkan — pemuat island. Isinya ada di island.js, dan tugas stub ini
// hanya satu: membuat island.js bisa diganti tanpa logout. Shell 46 menolak
// me-reload extension (org.gnome.Shell.Extensions.ReloadExtension menjawab
// "deprecated and does not work"), dan GJS menyimpan modul per URI sehingga
// menulis ulang extension.js tidak pernah dibaca lagi. Yang terbukti bekerja di
// GJS 1.80: memuat dari PATH yang berbeda — query-string pada URI yang sama
// tetap mengembalikan modul lama.
//
// Build aktif ditunjuk oleh ~/.local/share/noir-island/CURRENT (satu baris
// path). Tanpa penunjuk itu — kondisi setiap install biasa — island dimuat dari
// folder terpasang, jadi jalur ini tidak pernah bisa membuat island mati.

import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const POINTER = GLib.build_filenamev([GLib.get_home_dir(),
  '.local', 'share', 'noir-island', 'CURRENT']);

export default class NoirIslandLoader extends Extension {
  enable() {
    // disable()/enable() berurutan cepat (mis. dua klik di Extensions app) bisa
    // membuat dua promise selesai bertumpuk; hanya permintaan terakhir yang
    // boleh membangun island, sisanya dibuang tanpa efek samping.
    const seq = this._seq = (this._seq || 0) + 1;
    const dir = this._buildDir();
    import(`file://${dir}/island.js`).then(m => {
      if (seq !== this._seq) {
        log('noir-island: build usang dibuang');
        return;
      }
      // Nama export adalah batas antara dua berkas yang bisa berbeda versi
      // (build lama terlanjur dipublikasikan sebelum stub tahu bentuk barunya),
      // dan island yang gagal bangun meninggalkan jam panel tertutup.
      if (typeof m.Island !== 'function') {
        log(`noir-island: ${dir}/island.js tidak menjual Island, build ditinggalkan`);
        return;
      }
      this._impl = new m.Island();
      this._impl.enable(this);
    }).catch(e => {
      log(`noir-island: gagal memuat ${dir}/island.js: ${e.message}`);
    });
  }

  _buildDir() {
    if (GLib.file_test(POINTER, GLib.FileTest.EXISTS)) {
      const [, bytes] = GLib.file_get_contents(POINTER);
      const dir = new TextDecoder().decode(bytes).trim();
      if (GLib.file_test(GLib.build_filenamev([dir, 'island.js']),
        GLib.FileTest.EXISTS))
        return dir;
      log(`noir-island: CURRENT menunjuk ${dir} tanpa island.js, pakai build terpasang`);
    }
    return this.dir.get_path();
  }

  disable() {
    // Naikkan seq lebih dulu supaya promise yang belum selesai tidak lagi
    // membangun island di sesi yang sedang dibongkar.
    this._seq = (this._seq || 0) + 1;
    if (this._impl)
      this._impl.disable();
    this._impl = null;
  }
}
