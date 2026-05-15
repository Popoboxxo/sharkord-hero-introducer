import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState, VoiceChannelGuardResult } from "../types";
import path from "path";
import fs from "fs/promises";
import { playAudio } from "../services/playback";
import { resolveAudioFile } from "../services/audio-resolution";
import { readJsonFile } from "../utils/json-io";
import type { MusicMap } from "../types";

function requireActiveVoiceChannel(state: PluginState, invokerCtx: TInvokerContext): VoiceChannelGuardResult {
  const channelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;
  if (!channelId) {
    return { ok: false, message: "You must be in a voice channel to use this command." };
  }
  if (!state.activeChannels.has(channelId)) {
    return { ok: false, message: "Voice channel is not active." };
  }
  return { ok: true, channelId };
}

export function registerHeroPlaybackCommands(state: PluginState): void {
  const { ctx, activeSessions, musicDir, musicMapFile, userNameCache, debugLog } = state;

  ctx.commands.register({
    name: "hero-stop",
    description: "Stop the currently playing intro music.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-stop called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      if (activeSessions.size === 0) {
        return "No intro is currently playing.";
      }
      for (const [key, session] of activeSessions) {
        session.ffmpeg.kill();
        session.cleanup();
        activeSessions.delete(key);
      }
      return "Stopped all running intros.";
    },
  });

  ctx.commands.register({
    name: "hero-play-me",
    description: "Play your own intro music in the voice channel you are currently in.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(state, invokerCtx);
      debugLog(`/hero-play-me called — userId=${invokerUserId}, voiceChannelId=${voiceGuard.ok ? voiceGuard.channelId : undefined}, channelActive=${voiceGuard.ok}`);

      if (invokerUserId === undefined) {
        return "Could not determine your user ID.";
      }
      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }
      const voiceChannelId = voiceGuard.channelId;

      const invokerName = userNameCache.get(invokerUserId);
      if (!invokerName) {
        return "Your username is not cached yet. Please rejoin the server and try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const audioFileName = musicMap[invokerName];
      if (!audioFileName) {
        return `No intro configured for you (${invokerName}). Use /hero-set-me to set one.`;
      }

      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `Intro file not found: ${audioFileName}`;
      }

      await playAudio(state, voiceChannelId, invokerUserId, invokerName, audioPath, invokerCtx);
      return `Playing your intro: ${audioFileName}`;
    },
  });

  ctx.commands.register<{ displayName: string }>({
    name: "hero-play",
    description: "Play the intro music of another user. Usage: /hero-play <displayName>",
    args: [
      { name: "displayName", type: "string", description: "The display name of the user whose intro to play.", required: true, sensitive: false },
    ],
    async execute(invokerCtx: TInvokerContext, args: { displayName: string }) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(state, invokerCtx);
      const { displayName } = args;
      debugLog(`/hero-play called — userId=${invokerUserId}, voiceChannelId=${voiceGuard.ok ? voiceGuard.channelId : undefined}, channelActive=${voiceGuard.ok}, displayName="${displayName}"`);

      if (!displayName) {
        return "Please provide a display name. Usage: /hero-play <displayName>";
      }
      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }
      const voiceChannelId = voiceGuard.channelId;

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      let audioFileName = musicMap[displayName];
      let playbackLabel = displayName;

      if (!audioFileName) {
        const resolved = await resolveAudioFile(musicDir, displayName);
        if (resolved.ok) {
          audioFileName = resolved.fileName;
          playbackLabel = resolved.fileName;
        } else {
          return `No intro configured for ${displayName}. Use /hero-play-song <songName> to play by file name.`;
        }
      }

      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `Intro file not found: ${audioFileName}`;
      }

      await playAudio(state, voiceChannelId, invokerUserId ?? 0, playbackLabel, audioPath, invokerCtx);
      return `Playing intro for ${displayName}: ${audioFileName}`;
    },
  });

  ctx.commands.register<{ songName: string }>({
    name: "hero-play-song",
    description: "Play a song from the music directory. Extension is optional.",
    args: [
      { name: "songName", type: "string", description: "Song name (with or without file extension, e.g. 'eisenbart' or 'eisenbart.mp3').", required: true, sensitive: false },
    ],
    async execute(invokerCtx: TInvokerContext, args: { songName: string }) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(state, invokerCtx);
      const { songName } = args;
      debugLog(`/hero-play-song called — userId=${invokerUserId}, voiceChannelId=${voiceGuard.ok ? voiceGuard.channelId : undefined}, channelActive=${voiceGuard.ok}, songName="${songName}"`);

      if (!songName) {
        return "Please provide a song name. Usage: /hero-play-song <songName>";
      }
      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }
      const voiceChannelId = voiceGuard.channelId;

      const resolved = await resolveAudioFile(musicDir, songName);
      if (!resolved.ok) {
        return resolved.message;
      }

      const audioPath = path.join(musicDir, resolved.fileName);
      await playAudio(state, voiceChannelId, invokerUserId ?? 0, resolved.fileName, audioPath, invokerCtx);
      return `Playing: ${resolved.fileName}`;
    },
  });
}
