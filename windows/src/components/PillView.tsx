import React from 'react';
import { Disc3, Volume2 } from 'lucide-react';
import type { MediaState } from '../types/island';

interface PillViewProps {
  media: MediaState;
  onExpand: () => void;
}

export const PillView: React.FC<PillViewProps> = ({ media, onExpand }) => {
  return (
    <div
      onClick={onExpand}
      className="w-[240px] h-[34px] px-3 flex items-center justify-between cursor-pointer group select-none"
    >
      {/* Sisi Kiri: Ikon Musik berputar & Aksen Rosso */}
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="relative flex items-center justify-center">
          <Disc3
            className={`w-4 h-4 text-red-500 transition-transform ${
              media.isPlaying ? 'animate-spin' : ''
            }`}
            style={{ animationDuration: '4s' }}
          />
          {media.isPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
          )}
        </div>

        <span className="text-xs font-medium text-neutral-200 truncate max-w-[130px] group-hover:text-red-400 transition-colors">
          {media.title || 'Noir Island'}
        </span>
      </div>

      {/* Sisi Kanan: Mini Equalizer / Status Suara */}
      <div className="flex items-center gap-1.5 pl-2">
        {media.isPlaying ? (
          <div className="flex items-end gap-0.5 h-3">
            <span className="w-0.5 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="w-0.5 h-3 bg-red-400 rounded-full animate-pulse delay-75" />
            <span className="w-0.5 h-1.5 bg-red-500 rounded-full animate-pulse delay-150" />
            <span className="w-0.5 h-2.5 bg-red-600 rounded-full animate-pulse delay-100" />
          </div>
        ) : (
          <Volume2 className="w-3.5 h-3.5 text-neutral-500" />
        )}
      </div>
    </div>
  );
};
