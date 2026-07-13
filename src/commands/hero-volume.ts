import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";

export function registerHeroVolumeCommand(state: PluginState): void {
  const { ctx, settings, debugLog } = state;

  ctx.commands.register<{ level?: number | string }>({
    name: "hero-volume",
    description: "Show or set the intro playback volume (0-100). Usage: /hero-volume [level]",
    args: [
      { name: "level", type: "number", description: "Volume percentage from 0 to 100. Omit to show the current value.", required: false, sensitive: false },
    ],
    async execute(invokerCtx: TInvokerContext, args: { level?: number | string }) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId;
      debugLog(`/hero-volume called — userId=${invokerUserId}, level=${args.level ?? "<none>"}`);

      const raw = args.level;
      if (raw === undefined || raw === null || raw === "") {
        const current = settings.get("volume");
        return `Current intro volume: ${current}%.`;
      }

      const level = Number(raw);
      if (!Number.isInteger(level) || level < 0 || level > 100) {
        return "Invalid volume. Please provide an integer between 0 and 100. Usage: /hero-volume [0-100]";
      }

      settings.set("volume", level);
      debugLog(`Volume updated to ${level}% by userId=${invokerUserId}`);
      return `Intro volume set to ${level}%.`;
    },
  });
}
