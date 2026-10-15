# Checklist sebelum repo dijadikan publik

Jalankan `bash scripts/sanitize-check.sh` lebih dulu (otomatis). Sisa poin di
bawah butuh keputusan manusia — tidak bisa diperiksa dengan grep.

Cara kerja gerbang: pola data pribadi (nama user, hostname, model mesin dari
DMI) dibaca dari mesin yang menjalankan skrip, bukan ditulis sebagai teks di
repo. Jadi skrip yang sama memblokir hardware siapa pun yang menjalankannya,
dan jalankanlah dia di mesin yang datanya mau kamu lindungi — bukan di mesin
lain yang nilai aslinya tidak dia kenal.

## Identitas & perangkat

1. Isi `LICENSE` (baris `Copyright`) dengan nama atau handle yang memang boleh
   terlihat publik.
2. Email penulis commit harus noreply GitHub
   (`<id>@users.noreply.github.com`). Cek: `git log --format='%ae %ce' | sort -u`.
   Riwayat hanya satu commit, jadi `git commit --amend --reset-author` masih murah.
3. Putuskan handle di UUID `noir-*@<handle>`: ikut terbuka atau ganti sebelum
   publish (mengganti berarti mengubah `metadata.json`, nama folder, schema id,
   dan kunci dconf sekaligus). Kalau handle itu sama dengan nama login mesinmu,
   poin ini bukan soal selera tapi soal data pribadi.
4. Tidak ada nomor seri, UUID koneksi Wi-Fi, machine-id, MAC, atau hostname
   yang tersisa di teks maupun metadata aset biner.

## Isi yang mungkin tidak kamu sadari ikut terbawa

5. `assets/gdm/gnome-shell-theme.gresource` = turunan CSS Yaru (LGPL-2.1).
   `NOTICE` sudah menyebut sumber dan cara memulihkan versi pristine.
6. `theme/overrides/gnome-shell/gnome-shell.css` = file generated WhiteSur yang
   kami tambahi rosso. Unduhan upstream ada di `NOTICE`.
7. Wallpaper foto (pembalap/brand) sengaja tidak dimasukkan. Kalau nanti kamu
   tambahkan file JPG dari internet, cek lisensinya satu per satu.
8. `settings/noir.dconf` dibuat dari whitelist. Daftar aplikasi di dock
   (`favorite-apps`) sudah distandarkan ke firefox/nautilus/settings/terminal —
   kalau kamu mengubahnya, jaga supaya tidak memetakan aplikasi spesifik milikmu
   (termasuk nama profil Chrome/PWA).
9. `docs/` tidak boleh menyebut nama proyek kerja, klien, atau path repo internal.

## Fungsional di mesin lain

10. Uji di akun baru (`adduser uji`) atau VM: `fetch-deps.sh --check` →
    `install.sh` → logout/login. Yang gagal di akun bersih biasanya aset user
    yang ternyata masih di-andalkan ada (ikon, cursor, font).
11. Ubuntu non-24.04 / GNOME selain 46: jangan claim jalan. Perluas
    `shell-version` hanya setelah extension diuji.
12. Bagian sistem (GDM + Plymouth) diuji terpisah; jangan tulis di README bahwa
    repo "mengubah boot" tanpa menyebut butuh initramfs rebuild.

## Setelah publik

13. Pantau `git log` tetap bersih dari data pribadi saat kamu menambah aset.
14. Jalankan ulang `sanitize-check.sh` sebelum tiap rilis/tag, dan jangan
    menandai tag sebelum keluar 0.
