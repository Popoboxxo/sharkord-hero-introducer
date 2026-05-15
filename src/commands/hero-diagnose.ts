import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";
import { runDiagnose } from "../services/diagnose";

export function registerHeroDiagnoseCommand(state: PluginState): void {
  const { ctx, debugLog } = state;

  ctx.commands.register({
    name: "hero-diagnose",
    description: "Run a full audio pipeline diagnostic to find where audio breaks.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-diagnose called by userId=${invokerUserId}`);
      return runDiagnose(state, invokerCtx);
    },
  });
}
