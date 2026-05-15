import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";
import { resolveAudioFile } from "../services/audio-resolution";
import { readJsonFile, writeJsonFile } from "../utils/json-io";
import type { MusicMap } from "../types";
import { isSupportedAudioFile } from "../utils/helpers";
import fs from "fs/promises";

export function registerHeroManagementCommands(state: PluginState): void {
  const { ctx, musicMapFile, musicDir, debugLog } = state;

  ctx.commands.register<{ displayName: string; audioFileName: string }>({
    name: "hero-set",
    description: "Map an audio file to a user. Usage: /hero-set <displayName> <audioFileName>",
    args: [
      { name: "displayName", type: "string", description: "The display name of the user to configure the intro for.", required: true, sensitive: false },
      { name: "audioFileName", type: "string", description: "Audio file name (with or without extension, e.g. 'john-intro' or 'john-intro.mp3').", required: true, sensitive: false },
    ],
    async execute(_invokerCtx: TInvokerContext, args: { displayName: string; audioFileName: string }) {
      debugLog(`/hero-set called — displayName="${args.displayName}", audioFileName="${args.audioFileName}"`);
      const { displayName, audioFileName } = args;
      if (!displayName || !audioFileName) {
        return "Please provide both arguments. Usage: /hero-set <displayName> <audioFileName>";
      }
      const resolved = await resolveAudioFile(musicDir, audioFileName);
      if (!resolved.ok) {
        return resolved.message;
      }
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[displayName] = resolved.fileName;
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro set for ${displayName}: ${resolved.fileName}`;
    },
  });

  ctx.commands.register<{ displayName: string }>({
    name: "hero-remove",
    description: "Remove the intro music mapping for a user.",
    args: [
      { name: "displayName", type: "string", description: "The display name of the user whose intro mapping should be removed.", required: true, sensitive: false },
    ],
    async execute(_invokerCtx: TInvokerContext, args: { displayName: string }) {
      debugLog(`/hero-remove called — displayName="${args.displayName}"`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      if (!musicMap[args.displayName]) {
        return `No intro configured for ${args.displayName}.`;
      }
      delete musicMap[args.displayName];
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro removed for ${args.displayName}.`;
    },
  });

  ctx.commands.register({
    name: "hero-list",
    description: "List all configured DisplayName → audio file mappings.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-list called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const entries = Object.entries(musicMap);
      if (entries.length === 0) {
        return "No intro mappings configured yet.";
      }
      const lines = entries.map(([displayName, audioFileName]) => `${displayName}: ${audioFileName}`);
      return `Intro Mappings\n${lines.join("\n")}`;
    },
  });

  ctx.commands.register({
    name: "hero-files",
    description: "List all available audio files (.mp3, .mpeg) in the music directory.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-files called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      let files: string[];
      try {
        const dirEntries = await fs.readdir(musicDir);
        files = dirEntries.filter((f: string) => isSupportedAudioFile(f));
      } catch {
        files = [];
      }
      if (files.length === 0) {
        return "No audio files found in the music directory.";
      }
      const lines = files.map((f) => `${f}`);
      return `Available Audio Files\n${lines.join("\n")}`;
    },
  });
}
