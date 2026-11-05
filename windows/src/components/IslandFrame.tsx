import React from 'react';
import type { IslandMode } from '../types/island';

interface IslandFrameProps {
  mode: IslandMode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}

export const IslandFrame: React.FC<IslandFrameProps> = ({
  mode,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-island-mode={mode}
      className={`
        fixed top-0 left-1/2 -translate-x-1/2
        noir-glass
        rounded-b-[22px] border-t-0
        transition-all duration-300 ease-out
        overflow-hidden
        flex items-center justify-center
        z-50
        ${mode === 'pill' ? 'shadow-md' : 'shadow-2xl noir-rosso-glow'}
      `}
    >
      {/* Subtle Rosso Corsa Top Accent Line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-[2px] bg-red-600/70 rounded-full blur-[0.5px]" />

      {children}
    </div>
  );
};
