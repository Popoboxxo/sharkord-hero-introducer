import type { PluginState } from "../types";
import type { MusicMap, DailyGreets } from "../types";
import { enqueuePlayback } from "../services/queue";
import { readJsonFile, writeJsonFile } from "../utils/json-io";
import { todayISO, INTRO_DELAY_MS } from "../utils/helpers";
import path from "path";
import fs from "fs/promises";

export function registerVoiceEvents(state: PluginState): void {
  const { ctx, activeChannels, activeSessions, playbackQueues, queueProcessing, userNameCache, musicMapFile, musicDir, dailyGreetsFile, userCacheFile, debugLog, settings } = state;

  ctx.events.on("voice:runtime_initialized", ({ channelId }: { channelId: number }) => {
    activeChannels.add(channelId);
    debugLog(`Voice channel ${channelId} is now active (total: ${activeChannels.size})`);
  });

  ctx.events.on("voice:runtime_closed", ({ channelId }: { channelId: number }) => {
    activeChannels.delete(channelId);
    for (const [key, session] of activeSessions) {
      if (key.startsWith(`${channelId}-`)) {
        session.ffmpeg.kill();
        session.cleanup();
        activeSessions.delete(key);
      }
    }
    playbackQueues.delete(channelId);
    queueProcessing.delete(channelId);
    debugLog(`Voice channel ${channelId} closed (remaining: ${activeChannels.size})`);
  });

  ctx.events.on("voice:user_joined", async (payload: Record<string, unknown>) => {
    const channelId = payload.channelId as number;
    const userId = payload.userId as number;
    const payloadUsername = payload.username as string | undefined;

    const cachedUsername = userNameCache.get(userId);
    const username = payloadUsername ?? cachedUsername;

    debugLog(`>>> voice:user_joined event — channelId=${channelId}, userId=${userId}, username="${username ?? "unknown"}"`);

    if (!activeChannels.has(channelId)) {
      debugLog(`Auto-intro skipped for userId=${userId} — voice channel ${channelId} is not active`);
      return;
    }

    if (payloadUsername) {
      userNameCache.set(userId, payloadUsername);
      await writeJsonFile(userCacheFile, Object.fromEntries(userNameCache));
      debugLog(`User cache updated via voice:user_joined: userId=${userId} → "${payloadUsername}"`);
    }

    if (!username) {
      debugLog(`Auto-intro skipped for userId=${userId} — no username in payload or cache`);
      return;
    }

    const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
    const audioFileName = musicMap[username];
    if (!audioFileName) {
      debugLog(`Auto-intro skipped for "${username}" — no mapping found`);
      return;
    }

    const oncePerDay = settings.get("oncePerDay");
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(userId)];
      if (lastGreet === todayISO()) {
        debugLog(`Skipping intro for "${username}" — already greeted today`);
        return;
      }
    }

    const mp3Path = path.join(musicDir, audioFileName);
    const exists = await fs.access(mp3Path).then(() => true).catch(() => false);
    if (!exists) {
      ctx.error(`Mapped file for "${username}" not found: ${mp3Path}`);
      return;
    }

    if (INTRO_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, INTRO_DELAY_MS));
    }

    if (!activeChannels.has(channelId)) {
      debugLog(`Auto-intro skipped for "${username}" — channel ${channelId} became inactive during delay`);
      return;
    }

    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      dailyGreets[String(userId)] = todayISO();
      await writeJsonFile(dailyGreetsFile, dailyGreets);
    }

    enqueuePlayback(state, { channelId, userId, label: username, mp3Path });
  });

  ctx.events.on("voice:user_left", (payload: Record<string, unknown>) => {
    const channelId = payload.channelId as number;
    const userId = payload.userId as number;
    const sessionKey = `${channelId}-${userId}`;

    const queue = playbackQueues.get(channelId);
    if (queue) {
      const filtered = queue.filter((entry) => entry.userId !== userId);
      if (filtered.length > 0) {
        playbackQueues.set(channelId, filtered);
      } else {
        playbackQueues.delete(channelId);
      }
    }

    const active = activeSessions.get(sessionKey);
    if (active) {
      active.ffmpeg.kill();
      active.cleanup();
      activeSessions.delete(sessionKey);
      debugLog(`Stopped active intro on voice:user_left — channelId=${channelId}, userId=${userId}`);
    }
  });
}
