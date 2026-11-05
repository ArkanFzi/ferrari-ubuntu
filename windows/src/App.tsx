import React, { useState, useEffect, useRef } from 'react';
import { IslandFrame } from './components/IslandFrame';
import { PillView } from './components/PillView';
import { PeekView } from './components/PeekView';
import { MediaCard } from './components/MediaCard';
import { LyricsPanel } from './components/LyricsPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { NotificationCard } from './components/NotificationCard';
import type { IslandMode, MediaState, TelemetryData, NotificationItem } from './types/island';

export function App() {
  const [mode, setMode] = useState<IslandMode>('pill');
  const [activeTab, setActiveTab] = useState<'media' | 'lyrics' | 'telemetry'>('media');
  const hoverTimerRef = useRef<number | null>(null);

  // Status Media Musik
  const [media, setMedia] = useState<MediaState>({
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    album: 'Starboy',
    coverArt: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150&auto=format&fit=crop&q=80',
    isPlaying: true,
    position: 48,
    duration: 230,
    volume: 75,
  });

  // Telemetri Hardware (F1 Cockpit)
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    cpuUsage: 28,
    cpuTemp: 52,
    ramUsage: 45,
    ramUsedGb: 7.2,
    ramTotalGb: 16.0,
    batteryPercent: 88,
    batteryCharging: false,
  });

  // Notifikasi Sistem
  const [notification, setNotification] = useState<NotificationItem | null>(null);

  // Integrasi Event Tauri (jika berjalan di environment desktop Tauri)
  useEffect(() => {
    let unlistenMedia: (() => void) | undefined;
    let unlistenTelemetry: (() => void) | undefined;
    let unlistenNotif: (() => void) | undefined;

    const setupTauriListeners = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        // Mendengarkan update media dari Windows SMTC
        unlistenMedia = await listen<MediaState>('media-update', (event) => {
          setMedia(event.payload);
        });

        // Mendengarkan update telemetri sistem
        unlistenTelemetry = await listen<TelemetryData>('telemetry-update', (event) => {
          setTelemetry(event.payload);
        });

        // Mendengarkan notifikasi masuk
        unlistenNotif = await listen<NotificationItem>('notification-incoming', (event) => {
          setNotification(event.payload);
          setMode('notif');
        });
      } catch {
        // Berjalan di mode preview browser standar
      }
    };

    setupTauriListeners();

    return () => {
      if (unlistenMedia) unlistenMedia();
      if (unlistenTelemetry) unlistenTelemetry();
      if (unlistenNotif) unlistenNotif();
    };
  }, []);

  // Timer simulasi pergerakan detik lagu saat memutar
  useEffect(() => {
    if (!media.isPlaying) return;

    const interval = setInterval(() => {
      setMedia((prev) => {
        if (prev.position >= prev.duration) {
          return { ...prev, position: 0 };
        }
        return { ...prev, position: prev.position + 1 };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [media.isPlaying]);

  // Simulasi fluktuasi metrik telemetri F1 secara berkala
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry((prev) => ({
        ...prev,
        cpuUsage: Math.max(12, Math.min(95, prev.cpuUsage + (Math.random() * 8 - 4))),
        cpuTemp: Math.max(40, Math.min(85, Math.round(prev.cpuTemp + (Math.random() * 2 - 1)))),
        ramUsage: Math.max(30, Math.min(80, prev.ramUsage + (Math.random() * 2 - 1))),
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Logika Hover: jika di pill, arahkan kursor membuat peek
  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    if (mode === 'pill' && !notification) {
      setMode('peek');
    }
  };

  const handleMouseLeave = () => {
    // Auto-collapse kembali ke pill jika tidak sedang membuka expanded card atau notifikasi
    hoverTimerRef.current = window.setTimeout(() => {
      if (mode === 'peek') {
        setMode('pill');
      }
    }, 1200);
  };

  // Kontrol Transport
  const handleTogglePlay = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextState = !media.isPlaying;
    setMedia((prev) => ({ ...prev, isPlaying: nextState }));

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_play');
    } catch {
      // Fallback
    }
  };

  const handlePrev = async () => {
    setMedia((prev) => ({ ...prev, position: 0 }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('prev_track');
    } catch {}
  };

  const handleNext = async () => {
    setMedia((prev) => ({ ...prev, position: 0 }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('next_track');
    } catch {}
  };

  const handleSeek = async (seconds: number) => {
    setMedia((prev) => ({ ...prev, position: Math.round(seconds) }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('seek_to', { position: Math.round(seconds) });
    } catch {}
  };

  const handleDismissNotif = () => {
    setNotification(null);
    setMode('pill');
  };

  return (
    <main className="w-full h-full relative">
      <IslandFrame
        mode={mode}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* State 1: Notifikasi Berprioritas Tertinggi */}
        {notification && mode === 'notif' && (
          <NotificationCard
            notification={notification}
            onDismiss={handleDismissNotif}
            onOpen={handleDismissNotif}
          />
        )}

        {/* State 2: Mode Pill (Kompak) */}
        {!notification && mode === 'pill' && (
          <PillView
            media={media}
            onExpand={() => setMode('media')}
          />
        )}

        {/* State 3: Mode Peek (Sedang / Hover Preview) */}
        {!notification && mode === 'peek' && (
          <PeekView
            media={media}
            onTogglePlay={handleTogglePlay}
            onExpand={() => setMode('media')}
          />
        )}

        {/* State 4: Mode Kartu Lengkap (Expanded Media / Lirik / Cockpit) */}
        {!notification && (mode === 'media' || mode === 'lyrics' || mode === 'telemetry') && (
          <div className="flex flex-col">
            <MediaCard
              media={media}
              activeTab={activeTab}
              onTabChange={(tab) => {
                setActiveTab(tab);
                setMode(tab);
              }}
              onTogglePlay={handleTogglePlay}
              onPrev={handlePrev}
              onNext={handleNext}
              onSeek={handleSeek}
              onCollapse={() => setMode('pill')}
            />

            {/* Sub-Panel: Lirik Lagu */}
            {activeTab === 'lyrics' && (
              <div className="border-t border-neutral-800/80">
                <LyricsPanel
                  title={media.title}
                  artist={media.artist}
                  currentTime={media.position}
                />
              </div>
            )}

            {/* Sub-Panel: Cockpit F1 Telemetri */}
            {activeTab === 'telemetry' && (
              <div className="border-t border-neutral-800/80">
                <TelemetryPanel telemetry={telemetry} />
              </div>
            )}
          </div>
        )}
      </IslandFrame>
    </main>
  );
}

export default App;
