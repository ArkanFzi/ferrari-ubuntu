import React, { useEffect, useState } from 'react';

interface F1RevLightsProps {
  isPlaying: boolean;
  level?: number; // 0 - 15 (jumlah LED menyala)
}

/**
 * Komponen Rev-Lights setir F1 Ferrari:
 * 5 LED Hijau (Low RPM) -> 5 LED Merah (Mid RPM) -> 5 LED Biru/Ungu (Shift Point)
 */
export const F1RevLights: React.FC<F1RevLightsProps> = ({ isPlaying, level }) => {
  const [activeLeds, setActiveLeds] = useState(0);

  useEffect(() => {
    if (!isPlaying) {
      setActiveLeds(0);
      return;
    }

    // Jika level diberikan secara eksplisit (dari FFT audio)
    if (level !== undefined) {
      setActiveLeds(Math.min(15, Math.max(0, Math.round(level))));
      return;
    }

    // Simulasi denyut rev-lights mengikuti tempo musik saat audio stream belum terhubung
    const interval = setInterval(() => {
      // Pola naik-turun dinamis menyerupai akselerasi gigi F1
      const rand = Math.floor(Math.random() * 16);
      setActiveLeds(rand);
    }, 120);

    return () => clearInterval(interval);
  }, [isPlaying, level]);

  const leds = Array.from({ length: 15 }, (_, i) => {
    const isActive = i < activeLeds;
    let colorClass = 'bg-neutral-800 border-neutral-700/50';

    if (isActive) {
      if (i < 5) {
        // Hijau
        colorClass = 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] border-emerald-400';
      } else if (i < 10) {
        // Merah Rosso Corsa
        colorClass = 'bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.9)] border-red-500';
      } else {
        // Ungu / Biru Shift Light
        colorClass = 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,1)] border-indigo-400';
      }
    }

    return (
      <div
        key={i}
        className={`w-1.5 h-1.5 rounded-full border transition-all duration-75 ${colorClass}`}
      />
    );
  });

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 bg-black/60 rounded-full border border-neutral-800/80">
      <span className="text-[9px] font-mono font-bold text-neutral-400 mr-1 select-none">RPM</span>
      <div className="flex items-center gap-1">{leds}</div>
    </div>
  );
};
