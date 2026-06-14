import type { PluginContext } from "@sharkord/plugin-sdk";
import { initializePluginState } from "./services/init";
import { registerVoiceEvents } from "./handlers/voice-events";
import { registerUserEvents } from "./handlers/user-events";
import { registerHeroPlaybackCommands } from "./commands/hero-playback";
import { registerHeroManagementCommands } from "./commands/hero-management";
import { registerHeroUserCommands } from "./commands/hero-user";
import { registerHeroSearchMusicCommand } from "./commands/hero-search-music";
import { registerHeroDiagnoseCommand } from "./commands/hero-diagnose";
import { registerHeroDebugCommand } from "./commands/hero-debug";
import { readJsonFile } from "./utils/json-io";
import type { MusicMap } from "./types";

export async function onLoad(ctx: PluginContext) {
  ctx.log("Hero Introducer loaded");
  const state = await initializePluginState(ctx);
  registerVoiceEvents(state);
  registerUserEvents(state);
  registerHeroPlaybackCommands(state);
  registerHeroManagementCommands(state);
  registerHeroUserCommands(state);
  registerHeroSearchMusicCommand(state);
  registerHeroDiagnoseCommand(state);
  registerHeroDebugCommand(state);

  // Server action consumed by the client UI (status badge / admin panel).
  (ctx as unknown as { actions?: { register?: (a: unknown) => void } }).actions?.register?.({
    name: "hero:state",
    description: "Return Hero Introducer status (intro count, active channels).",
    async execute() {
      const map = await readJsonFile<MusicMap>(state.musicMapFile, {});
      return {
        introCount: Object.keys(map).length,
        activeChannels: state.activeChannels.size,
        knownUsers: state.userNameCache.size,
      };
    },
  });

  ctx.ui.enable();
  ctx.log("Hero Introducer ready");
}

export function onUnload(ctx: PluginContext) {
  ctx.log("Hero Introducer unloaded");
}
