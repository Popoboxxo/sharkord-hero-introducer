import type { PluginContext } from "@sharkord/plugin-sdk";

export type MusicMap = Record<string, string>;
export type DailyGreets = Record<string, string>;

export interface PlaybackSession {
  ffmpeg: { kill(signal?: number): void };
  cleanup: () => void;
  done: Promise<void>;
}

export interface QueueEntry {
  channelId: number;
  userId: number;
  label: string;
  mp3Path: string;
}

export type ResolveResult =
  | { ok: true; fileName: string }
  | { ok: false; message: string };

export type VoiceChannelGuardResult =
  | { ok: true; channelId: number }
  | { ok: false; message: string };

export interface HeroSettings {
  get(key: "oncePerDay"): boolean;
  get(key: "debug"): boolean;
  get(key: "volume"): number;
  set(key: "volume", value: number): void;
}

export interface PluginState {
  ctx: PluginContext;
  settings: HeroSettings;
  dataDir: string;
  musicDir: string;
  musicMapFile: string;
  dailyGreetsFile: string;
  userCacheFile: string;
  ffmpegCmd: string;
  activeSessions: Map<string, PlaybackSession>;
  activeChannels: Set<number>;
  playbackQueues: Map<number, QueueEntry[]>;
  queueProcessing: Set<number>;
  // Guards against concurrent processing of the same channel-user voice join
  // (prevents a double intro when a user rejoins within the intro delay window).
  introInFlight: Set<string>;
  userNameCache: Map<number, string>;
  debugLog: (message: string) => void;
}
