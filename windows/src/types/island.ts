export type IslandMode = 'pill' | 'peek' | 'media' | 'lyrics' | 'telemetry' | 'notif';

export interface MediaState {
  title: string;
  artist: string;
  album: string;
  coverArt: string;
  isPlaying: boolean;
  position: number;      // Dalam detik
  duration: number;      // Dalam detik
  volume: number;        // 0 - 100
}

export interface LyricLine {
  time: number;          // Dalam detik
  text: string;
}

export interface TelemetryData {
  cpuUsage: number;      // 0 - 100%
  cpuTemp: number;       // Derajat Celsius
  ramUsage: number;      // 0 - 100%
  ramUsedGb: number;
  ramTotalGb: number;
  batteryPercent: number;
  batteryCharging: boolean;
}

export interface NotificationItem {
  id: string;
  app: string;
  title: string;
  body: string;
  timestamp: number;
}
