import React, { useEffect, useRef, useState } from 'react';
import type { LyricLine } from '../types/island';

interface LyricsPanelProps {
  title: string;
  artist: string;
  currentTime: number; // Dalam detik
}

export const LyricsPanel: React.FC<LyricsPanelProps> = ({
  title,
  artist,
  currentTime,
}) => {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Ambil lirik dari LRCLIB API ketika lagu berubah
  useEffect(() => {
    if (!title) {
      setLyrics([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchLyrics = async () => {
      try {
        const query = new URLSearchParams({
          track_name: title,
          artist_name: artist || '',
        });
        const res = await fetch(`https://lrclib.net/api/get?${query.toString()}`);
        if (!res.ok) throw new Error('Not found');

        const data = await res.json();
        if (data.syncedLyrics && isMounted) {
          // Parse format [mm:ss.xx]
          const lines: LyricLine[] = [];
          const rawLines = (data.syncedLyrics as string).split('\n');

          for (const raw of rawLines) {
            const match = raw.match(/\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/);
            if (match) {
              const minutes = parseInt(match[1], 10);
              const seconds = parseFloat(match[2]);
              const time = minutes * 60 + seconds;
              const text = match[3].trim();
              if (text) {
                lines.push({ time, text });
              }
            }
          }
          setLyrics(lines);
        } else if (data.plainLyrics && isMounted) {
          const plain = (data.plainLyrics as string).split('\n').map((l, idx) => ({
            time: idx * 4,
            text: l.trim(),
          }));
          setLyrics(plain);
        }
      } catch {
        if (isMounted) {
          // Demo fallback jika API offline atau lagu tidak ada lirik
          setLyrics([
            { time: 0, text: '♪ Instrumen Pembuka ♪' },
            { time: 10, text: `Memutar ${title || 'Lagu'}` },
            { time: 20, text: `Artis: ${artist || 'Tidak Diketahui'}` },
            { time: 35, text: '♪ Menikmati melodi Noir Island ♪' },
          ]);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLyrics();

    return () => {
      isMounted = false;
    };
  }, [title, artist]);

  // Cari baris lirik yang aktif berdasarkan waktu lagu saat ini
  useEffect(() => {
    if (lyrics.length === 0) return;

    let currentIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        currentIdx = i;
      } else {
        break;
      }
    }

    setActiveIndex(currentIdx);

    // Auto-scroll ke baris aktif
    if (activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentTime, lyrics]);

  if (loading) {
    return (
      <div className="w-[580px] h-[110px] flex items-center justify-center text-xs text-neutral-400">
        <span className="animate-pulse">Mencari lirik tersinkronisasi...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-[580px] h-[110px] px-6 py-2 overflow-y-auto flex flex-col items-center gap-2 select-none"
    >
      {lyrics.length === 0 ? (
        <p className="text-xs text-neutral-500 my-auto">Lirik tidak tersedia untuk lagu ini</p>
      ) : (
        lyrics.map((line, idx) => {
          const isActive = idx === activeIndex;
          const isPast = idx < activeIndex;

          return (
            <div
              key={idx}
              ref={isActive ? activeLineRef : null}
              className={`text-center transition-all duration-200 ${
                isActive
                  ? 'text-sm font-bold text-white scale-105 shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                  : isPast
                  ? 'text-xs text-neutral-500 opacity-60'
                  : 'text-xs text-neutral-400 opacity-80'
              }`}
            >
              {line.text}
            </div>
          );
        })
      )}
    </div>
  );
};
