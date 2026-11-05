import React from 'react';
import { Cpu, HardDrive, Battery, Thermometer } from 'lucide-react';
import type { TelemetryData } from '../types/island';

interface TelemetryPanelProps {
  telemetry: TelemetryData;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ telemetry }) => {
  // Simulasi suhu ban F1 berdasarkan beban CPU/RAM
  const baseTireTemp = Math.round(85 + (telemetry.cpuUsage * 0.25));

  const getTireColor = (temp: number) => {
    if (temp < 80) return 'text-sky-400 bg-sky-950/40 border-sky-800'; // Cold (Blue)
    if (temp <= 100) return 'text-emerald-400 bg-emerald-950/40 border-emerald-800'; // Optimal (Green)
    return 'text-red-400 bg-red-950/40 border-red-800'; // Hot (Red)
  };

  return (
    <div className="w-[580px] px-4 py-2 flex items-center justify-between gap-4 select-none">
      {/* Kolom 1: Metrik CPU & Suhu */}
      <div className="flex-1 bg-black/40 p-2 rounded-xl border border-neutral-800/80 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-neutral-400 text-xs">
          <span className="flex items-center gap-1 font-medium">
            <Cpu className="w-3.5 h-3.5 text-red-500" />
            CPU Load
          </span>
          <span className="font-mono font-bold text-neutral-100">
            {Math.round(telemetry.cpuUsage)}%
          </span>
        </div>

        <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-red-600 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, telemetry.cpuUsage)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-0.5">
          <span className="flex items-center gap-1">
            <Thermometer className="w-3 h-3 text-orange-400" />
            Suhu
          </span>
          <span className="font-mono text-orange-300">{telemetry.cpuTemp}°C</span>
        </div>
      </div>

      {/* Kolom 2: RAM & Baterai */}
      <div className="flex-1 bg-black/40 p-2 rounded-xl border border-neutral-800/80 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-neutral-400 text-xs">
          <span className="flex items-center gap-1 font-medium">
            <HardDrive className="w-3.5 h-3.5 text-blue-500" />
            Memory
          </span>
          <span className="font-mono font-bold text-neutral-100">
            {Math.round(telemetry.ramUsage)}%
          </span>
        </div>

        <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, telemetry.ramUsage)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-0.5">
          <span className="flex items-center gap-1">
            <Battery className="w-3 h-3 text-emerald-400" />
            Baterai
          </span>
          <span className="font-mono text-emerald-300">
            {telemetry.batteryPercent}% {telemetry.batteryCharging ? '⚡' : ''}
          </span>
        </div>
      </div>

      {/* Kolom 3: 4-Tire F1 Thermal Heatmap Cockpit */}
      <div className="bg-black/60 px-3 py-1.5 rounded-xl border border-neutral-800/80 flex flex-col items-center">
        <span className="text-[10px] font-mono text-neutral-400 font-bold mb-1">
          TIRE THERMALS
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          <div
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getTireColor(
              baseTireTemp
            )}`}
          >
            FL {baseTireTemp}°
          </div>
          <div
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getTireColor(
              baseTireTemp + 1
            )}`}
          >
            FR {baseTireTemp + 1}°
          </div>
          <div
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getTireColor(
              baseTireTemp + 3
            )}`}
          >
            RL {baseTireTemp + 3}°
          </div>
          <div
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getTireColor(
              baseTireTemp + 4
            )}`}
          >
            RR {baseTireTemp + 4}°
          </div>
        </div>
      </div>
    </div>
  );
};
