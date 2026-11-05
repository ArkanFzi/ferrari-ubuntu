import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronUp,
  Music2,
  Gauge
} from 'lucide-react';
import { F1RevLights } from './F1RevLights';
import type { MediaState } from '../types/island';

interface MediaCardProps {
  media: MediaState;
  activeTab: 'media' | 'lyrics' | 'telemetry';
  onTabChange: (tab: 'media' | 'lyrics' | 'telemetry') => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onCollapse: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  activeTab,
  onTabChange,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onCollapse,
}) => {
  // Format detik ke mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  const progressPercent =
    media.duration > 0 ? (media.position / media.duration) * 100 : 0;

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * media.duration);
  };

  return (
    <div className="w-[580px] p-3 flex flex-col gap-2.5 select-none">
      {/* Header Bar: Status F1 Rev-Lights & Tab Selector */}
      <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <F1RevLights isPlaying={media.isPlaying} />

        {/* Tab Navigasi Mode */}
        <div className="flex items-center gap-1 bg-neutral-900/90 p-0.5 rounded-lg border border-neutral-800">
          <button
            onClick={() => onTabChange('media')}
            className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all ${
              activeTab === 'media'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Lagu
          </button>
          <button
            onClick={() => onTabChange('lyrics')}
            className={`px-2 py-0.5 text-[11px] font-medium rounded-md flex items-center gap-1 transition-all ${
              activeTab === 'lyrics'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Music2 className="w-3 h-3" />
            Lirik
          </button>
          <button
            onClick={() => onTabChange('telemetry')}
            className={`px-2 py-0.5 text-[11px] font-medium rounded-md flex items-center gap-1 transition-all ${
              activeTab === 'telemetry'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Gauge className="w-3 h-3" />
            Cockpit
          </button>
        </div>

        {/* Tombol Collapse */}
        <button
          onClick={onCollapse}
          className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors"
          title="Tutup Kartu (Pill Mode)"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      {/* Konten Utama Lagu */}
      <div className="flex items-center gap-3">
        {/* Artwork Album */}
        <div className="relative group/art shrink-0">
          {media.coverArt ? (
            <img
              src={media.coverArt}
              alt="Cover Art"
              className="w-14 h-14 rounded-xl object-cover border border-neutral-700/60 shadow-lg"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-950 border border-neutral-800 flex items-center justify-center">
              <span className="text-red-500 font-bold text-lg font-mono">F1</span>
            </div>
          )}
          {media.isPlaying && (
            <div className="absolute inset-0 rounded-xl bg-black/20 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover/art:opacity-100 transition-opacity">
              <div className="flex items-end gap-0.5 h-4">
                <span className="w-1 h-3 bg-red-500 rounded-full animate-bounce" />
                <span className="w-1 h-4 bg-red-400 rounded-full animate-bounce delay-100" />
                <span className="w-1 h-2 bg-red-600 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          )}
        </div>

        {/* Info Trek & Transport Controls */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="overflow-hidden pr-2">
              <h3 className="text-sm font-semibold text-neutral-100 truncate">
                {media.title || 'Tidak ada media aktif'}
              </h3>
              <p className="text-xs text-neutral-400 truncate">
                {media.artist || 'Buka Spotify, YouTube, atau pemutar musik lainnya'}
              </p>
            </div>

            {/* Tombol Transport Pemutar */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={onPrev}
                className="p-1.5 rounded-full text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                title="Sebelumnya"
              >
                <SkipBack className="w-4 h-4 fill-current" />
              </button>

              <button
                onClick={onTogglePlay}
                className="p-2 rounded-full bg-red-600 text-white hover:bg-red-500 shadow-md shadow-red-950/40 transition-transform active:scale-95"
                title={media.isPlaying ? 'Jeda' : 'Putar'}
              >
                {media.isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={onNext}
                className="p-1.5 rounded-full text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                title="Selanjutnya"
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </button>
            </div>
          </div>

          {/* Rel Progres Musik (Seekbar) */}
          <div className="mt-2 flex flex-col gap-1">
            <div
              onClick={handleProgressBarClick}
              className="w-full h-2 bg-neutral-800/80 rounded-full overflow-hidden cursor-pointer relative group/bar"
            >
              <div
                className="h-full bg-gradient-to-r from-red-700 to-red-500 rounded-full relative group-hover/bar:brightness-125 transition-all"
                style={{ width: `${progressPercent}%` }}
              >
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full opacity-0 group-hover/bar:opacity-100 transition-opacity shadow" />
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
              <span>{formatTime(media.position)}</span>
              <span>{formatTime(media.duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
