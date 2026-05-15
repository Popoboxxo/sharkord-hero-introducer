// TODO(SDK-upgrade): Remove after SDK >= 0.1.0 — ctx.actions.voice deprecated in 0.0.16
import type { PluginContext, TInvokerContext } from "@sharkord/plugin-sdk";

export interface VoiceActionsLike {
  getRouter(channelId: number): any;
  getListenInfo(): Promise<{ ip: string; announcedAddress: string }>;
  createStream(params: any): { remove(): void };
}

export function resolveVoiceActions(ctx: PluginContext, runtimeCtx?: TInvokerContext): VoiceActionsLike {
  const runtimeVoice = (runtimeCtx as any)?.voice;
  const pluginVoice = (ctx as any).voice;
  const candidate = (runtimeVoice ?? pluginVoice) as Partial<VoiceActionsLike> | undefined;

  if (
    candidate
    && typeof candidate.getRouter === "function"
    && typeof candidate.getListenInfo === "function"
    && typeof candidate.createStream === "function"
  ) {
    return candidate as VoiceActionsLike;
  }

  const fromRuntime = (runtimeCtx as any)?.actions?.voice;
  const fromPluginCtx = (ctx as any).actions?.voice;
  const fallback = (fromRuntime ?? fromPluginCtx) as Partial<VoiceActionsLike> | undefined;

  if (
    !fallback
    || typeof fallback.getRouter !== "function"
    || typeof fallback.getListenInfo !== "function"
    || typeof fallback.createStream !== "function"
  ) {
    throw new Error("Voice actions are unavailable in this command/event context.");
  }
  return fallback as VoiceActionsLike;
}
