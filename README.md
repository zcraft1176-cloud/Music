# 🎵 Music Stream

**Free Music Streaming — tanpa iklan, tanpa langganan.**

Aplikasi web streaming musik gratis yang menggabungkan metadata dari Deezer dengan pemutaran audio melalui YouTube IFrame. Dilengkapi Google Sign-In untuk sinkronisasi playlist ke cloud.

---

## ✨ Fitur

- 🔍 **Pencarian Musik** — Cari jutaan lagu via Deezer API
- ▶️ **Streaming Gratis** — Pemutaran audio via YouTube IFrame Player
- 📝 **Playlist** — Buat, kelola, dan atur urutan lagu (drag & drop)
- ☁️ **Cloud Sync** — Login dengan Google, playlist tersimpan di Firebase
- 🎵 **Antrian (Queue)** — Tambah lagu ke antrian pemutaran
- ⌨️ **Keyboard Shortcuts** — Space (play/pause), Arrow keys (seek/volume)
- 📱 **Responsive** — Tampilan optimal di desktop & mobile
- 🌙 **Dark Mode** — Desain gelap modern yang nyaman di mata

## 🏗️ Arsitektur

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Deezer API │────▶│  CORS Proxy  │◀────│   Piped API      │
│  (Metadata)  │     │  proxy.php / │     │  (YouTube Search)│
└─────────────┘     │  api/proxy   │     └──────────────────┘
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐     ┌──────────────────┐
                     │   Frontend   │────▶│ YouTube IFrame    │
                     │  index.html  │     │ (Audio Playback)  │
                     └──────┬───────┘     └──────────────────┘
                            │
                     ┌──────▼───────┐
                     │   Firebase   │
                     │  Auth + DB   │
                     └──────────────┘
```

### Alur Kerja

1. **Pencarian** → Deezer API menyediakan metadata (judul, artis, cover art)
2. **Resolusi Audio** → Piped API mencari `videoId` YouTube yang cocok
3. **Pemutaran** → YouTube IFrame API memutar audio (hidden player)
4. **Playlist** → Disimpan di Firebase Firestore (cloud) + localStorage (cache)

## 📁 Struktur Project

```
Music/
├── index.html              # Halaman utama (SPA)
├── proxy.php               # CORS proxy untuk XAMPP/localhost
├── vercel.json             # Konfigurasi Vercel deployment
├── firebase.json           # Konfigurasi Firebase
├── firestore.rules         # Aturan keamanan Firestore
├── api/
│   └── proxy.js            # CORS proxy (Vercel Serverless Function)
└── src/
    ├── css/
    │   └── style.css       # Custom styles + animasi
    └── js/
        ├── api.js          # Integrasi API (Deezer, Piped, Jamendo)
        ├── app.js          # Entry point & global listeners
        ├── auth.js         # Firebase Auth (Google Sign-In)
        ├── player.js       # Audio player & YouTube IFrame engine
        ├── playlist.js     # Manajemen playlist + Firestore sync
        ├── search.js       # Pencarian & trending
        └── ui.js           # Rendering UI & interaksi DOM
```

## 🚀 Getting Started

### Prasyarat

- [XAMPP](https://www.apachefriends.org/) (untuk development lokal) atau
- [Node.js](https://nodejs.org/) + [Vercel CLI](https://vercel.com/cli) (untuk deployment)
- Akun [Firebase](https://firebase.google.com/) (gratis)

### Development Lokal (XAMPP)

1. **Clone repository**
   ```bash
   git clone https://github.com/zcraft1176-cloud/Music.git
   ```

2. **Pindahkan ke folder XAMPP**
   ```bash
   # Pindahkan folder ke htdocs XAMPP
   mv Music /path/to/xampp/htdocs/
   ```

3. **Jalankan XAMPP**
   - Start Apache
   - Buka `http://localhost/Music/`

### Deploy ke Vercel

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy**
   ```bash
   cd Music
   vercel
   ```

3. **Selesai!** — Vercel otomatis mendeteksi `vercel.json` dan `api/proxy.js`

> **Note:** Saat di Vercel, proxy otomatis menggunakan `/api/proxy` (serverless function) menggantikan `proxy.php`.

## 🔑 Konfigurasi Firebase

Project ini menggunakan Firebase untuk autentikasi dan penyimpanan playlist:

- **Auth** — Google Sign-In
- **Firestore** — Database playlist

Konfigurasi Firebase sudah tertanam di `src/js/auth.js`. Jika ingin menggunakan project Firebase sendiri:

1. Buat project di [Firebase Console](https://console.firebase.google.com/)
2. Aktifkan **Authentication** → Google provider
3. Aktifkan **Cloud Firestore**
4. Update config di `src/js/auth.js`
5. Deploy rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

## ⌨️ Keyboard Shortcuts

| Shortcut | Aksi |
|----------|------|
| `Space` | Play / Pause |
| `←` / `→` | Seek -10s / +10s |
| `↑` / `↓` | Volume +10% / -10% |
| `M` | Mute / Unmute |
| `N` | Next track |
| `P` | Previous track |
| `S` | Toggle shuffle |
| `R` | Toggle repeat |

## 🎵 Sumber Audio

| Sumber | Tipe | Kegunaan |
|--------|------|----------|
| **Deezer** | Metadata | Pencarian, cover art, info lagu |
| **YouTube** (via Piped) | Streaming | Audio pemutaran utama |
| **Jamendo** | Streaming | Musik indie berlisensi (opsional) |

## ⚠️ Keterbatasan

- **Iklan YouTube** — Bisa muncul sebelum lagu, disarankan pakai [uBlock Origin](https://ublockorigin.com/)
- **Piped Dependency** — Bergantung pada public instances Piped yang bisa down
- **Equalizer** — Tidak tersedia karena limitasi cross-origin YouTube IFrame. Gunakan ekstensi browser sebagai alternatif
- **Autoplay** — Browser membutuhkan interaksi pengguna pertama untuk memulai playback

## 🛠️ Tech Stack

- **Frontend** — HTML, CSS (Tailwind), Vanilla JavaScript
- **Auth & DB** — Firebase (Auth + Firestore)
- **Audio Engine** — YouTube IFrame API
- **APIs** — Deezer, Piped
- **Drag & Drop** — SortableJS
- **Hosting** — Vercel / GitHub Pages + XAMPP (dev)

## 📄 Lisensi

Project ini dibuat untuk keperluan personal dan edukasi. Musik yang diputar berasal dari sumber pihak ketiga (YouTube, Jamendo) dan tunduk pada kebijakan masing-masing platform.

---

<p align="center">
  Made with 💜 — Music Stream
</p>
