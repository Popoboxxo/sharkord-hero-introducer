import fs from "fs/promises";
import path from "path";
import type { PluginContext } from "@sharkord/plugin-sdk";
import type { PluginState, HeroSettings } from "../types";
import { readJsonFile } from "../utils/json-io";

export async function initializePluginState(ctx: PluginContext): Promise<PluginState> {
  const dataDir = path.join(ctx.path, "data");
  const musicDir = path.join(ctx.path, "music");
  const musicMapFile = path.join(dataDir, "music-map.json");
  const dailyGreetsFile = path.join(dataDir, "daily-greets.json");
  const userCacheFile = path.join(dataDir, "user-cache.json");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(musicDir, { recursive: true });

  const ffmpegBin = path.join(ctx.path, "bin", "ffmpeg");
  const ffmpegCmd = await fs.access(ffmpegBin).then(() => ffmpegBin).catch(() => "ffmpeg");

  const settings = (await ctx.settings.register([
    {
      key: "oncePerDay",
      name: "Greet only once per day",
      description: "When enabled each user is greeted at most once per calendar day.",
      type: "boolean",
      defaultValue: true,
    },
    {
      key: "debug",
      name: "Debug mode",
      description: "When enabled, detailed debug information is logged.",
      type: "boolean",
      defaultValue: false,
    },
    {
      key: "volume",
      name: "Playback volume",
      description: "Volume for intro music playback (0–100%). Applied server-side via ffmpeg.",
      type: "number",
      defaultValue: 25,
    },
  ] as const)) as unknown as HeroSettings;

  const debugLog = (message: string): void => {
    if (settings.get("debug")) {
      ctx.log(`[DEBUG] ${message}`);
    }
  };

  const userCacheData = await readJsonFile<Record<string, string>>(userCacheFile, {});
  const userNameCache = new Map<number, string>(
    Object.entries(userCacheData).map(([id, name]) => [Number(id), name]),
  );
  ctx.log(`User cache loaded: ${userNameCache.size} entries`);

  return {
    ctx,
    settings,
    dataDir,
    musicDir,
    musicMapFile,
    dailyGreetsFile,
    userCacheFile,
    ffmpegCmd,
    activeSessions: new Map(),
    activeChannels: new Set(),
    playbackQueues: new Map(),
    queueProcessing: new Set(),
    userNameCache,
    debugLog,
  };
}
