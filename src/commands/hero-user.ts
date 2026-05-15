import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";
import { resolveAudioFile } from "../services/audio-resolution";
import { readJsonFile, writeJsonFile } from "../utils/json-io";
import type { MusicMap, DailyGreets } from "../types";

export function registerHeroUserCommands(state: PluginState): void {
  const { ctx, musicMapFile, userNameCache, debugLog } = state;

  ctx.commands.register<{ audioFileName: string }>({
    name: "hero-set-me",
    description: "Map your own user to an intro audio file. Usage: /hero-set-me <audioFileName>",
    args: [
      { name: "audioFileName", type: "string", description: "Audio file name (with or without extension, e.g. 'my-intro' or 'my-intro.mp3').", required: true, sensitive: false },
    ],
    async execute(invokerCtx: TInvokerContext, args: { audioFileName: string }) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-set-me called — userId=${invokerUserId}, audioFileName="${args.audioFileName}"`);
      const { audioFileName } = args;
      if (!audioFileName) {
        return "Please provide an audio file name. Usage: /hero-set-me <audioFileName>";
      }
      const resolved = await resolveAudioFile(state.musicDir, audioFileName);
      if (!resolved.ok) {
        return resolved.message;
      }

      const invokerName = invokerUserId !== undefined ? userNameCache.get(invokerUserId) : undefined;
      if (!invokerName) {
        return "Could not determine your username. Please rejoin the server first so your name is cached, then try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[invokerName] = resolved.fileName;
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro set for yourself (${invokerName}): ${resolved.fileName}`;
    },
  });

  ctx.commands.register({
    name: "hero-reset-me",
    description: "Reset your daily greeting counter so your intro plays again today.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-reset-me called — userId=${invokerUserId}`);

      if (invokerUserId === undefined) {
        return "Could not determine your user ID.";
      }

      const dailyGreets = await readJsonFile<DailyGreets>(state.dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(invokerUserId)];

      if (!lastGreet) {
        return "You have no daily greeting entry to reset.";
      }

      delete dailyGreets[String(invokerUserId)];
      await writeJsonFile(state.dailyGreetsFile, dailyGreets);
      const invokerName = userNameCache.get(invokerUserId) ?? `userId=${invokerUserId}`;
      debugLog(`Daily greet reset for ${invokerName} (userId=${invokerUserId})`);
      return `Your daily greeting counter has been reset. Your intro will play again on your next join.`;
    },
  });
}
