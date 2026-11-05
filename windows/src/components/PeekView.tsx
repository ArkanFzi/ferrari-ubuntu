import React from 'react';
import { Play, Pause, ChevronDown } from 'lucide-react';
import type { MediaState } from '../types/island';

interface PeekViewProps {
  media: MediaState;
  onTogglePlay: (e: React.MouseEvent) => void;
  onExpand: () => void;
}

export const PeekView: React.FC<PeekViewProps> = ({ media, onTogglePlay, onExpand }) => {
  return (
    <div
      onClick={onExpand}
      className="w-[340px] h-[34px] px-2.5 flex items-center justify-between cursor-pointer group select-none"
    >
      {/* Sisi Kiri: Artwork & Teks Musik */}
      <div className="flex items-center gap-2 overflow-hidden flex-1">
        {media.coverArt ? (
          <img
            src={media.coverArt}
            alt="Album Art"
            className="w-5 h-5 rounded-full object-cover border border-neutral-700/50"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-red-950/60 border border-red-800/40 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-red-600" />
          </div>
        )}

        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="text-xs font-semibold text-neutral-100 truncate max-w-[140px]">
            {media.title || 'Tidak ada lagu aktif'}
          </span>
          <span className="text-[10px] text-neutral-500">•</span>
          <span className="text-[11px] text-neutral-400 truncate max-w-[90px]">
            {media.artist || 'Media Player'}
          </span>
        </div>
      </div>

      {/* Sisi Kanan: Kontrol Cepat & Tombol Expand */}
      <div className="flex items-center gap-1 pl-2">
        <button
          onClick={onTogglePlay}
          className="p-1 rounded-full text-neutral-300 hover:text-white hover:bg-neutral-800/80 transition-colors"
          title={media.isPlaying ? 'Jeda' : 'Putar'}
        >
          {media.isPlaying ? (
            <Pause className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
        </button>

        <button
          onClick={onExpand}
          className="p-1 rounded-full text-neutral-400 hover:text-red-400 transition-colors"
          title="Buka Kartu Lengkap"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
