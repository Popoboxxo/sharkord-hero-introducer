import type { PluginState } from "../types";
import type { TInvokerContext } from "@sharkord/plugin-sdk";
import { runDiagnoseStages } from "./diagnose-stages";
import { runDiagnoseRouter } from "./diagnose-router";

export async function runDiagnose(state: PluginState, invokerCtx: TInvokerContext): Promise<string> {
  const { ctx, activeChannels, debugLog, musicDir, ffmpegCmd } = state;
  const channelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;

  if (!channelId) {
    return "You must be in a voice channel to use this command.";
  }
  if (!activeChannels.has(channelId)) {
    return "Voice channel is not active.";
  }

  const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
  const lines: string[] = ["=== HERO-INTRODUCER DIAGNOSTIC REPORT ===", ""];

  const pass = (stage: string, detail: string) => lines.push(`[PASS] ${stage}: ${detail}`);
  const fail = (stage: string, detail: string) => lines.push(`[FAIL] ${stage}: ${detail}`);
  const info = (stage: string, detail: string) => lines.push(`[INFO] ${stage}: ${detail}`);

  let ffmpeg: any;
  try {
    const stages = await runDiagnoseStages(ctx, channelId, { pass, fail, info }, ffmpegCmd, musicDir, debugLog);
    ffmpeg = stages.ffmpeg;

    await runDiagnoseRouter(
      ctx,
      stages.router,
      stages.transport,
      stages.producer,
      channelId,
      invokerUserId,
      { pass, fail, info },
      debugLog,
      lines,
    );

    try { stages.producer.close(); } catch { /* ignore */ }
    try { stages.transport.close(); } catch { /* ignore */ }
  } catch {
    // individual stages already logged failures
  } finally {
    if (ffmpeg) {
      try { ffmpeg.kill(); } catch { /* ignore */ }
    }
  }

  lines.push("", "=== VERDICT ===");
  const failures = lines.filter((l) => l.startsWith("[FAIL]"));
  if (failures.length === 0) {
    lines.push("All stages passed including transport state.");
    lines.push("If audio is still not heard: check browser autoplay policy, client volume, or contact Sharkord SDK support.");
  } else {
    lines.push(`${failures.length} failure(s) detected:`);
    for (const f of failures) lines.push(`  ${f}`);
  }

  const report = lines.join("\n");
  ctx.log(`[DIAG]\n${report}`);
  return report;
}
