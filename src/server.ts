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
  ctx.ui.enable();
  ctx.log("Hero Introducer ready");
}

export function onUnload(ctx: PluginContext) {
  ctx.log("Hero Introducer unloaded");
}
