import type { PluginContext, TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";
import { resolveVoiceActions } from "../utils/voice-compat";

export async function playAudio(
  state: PluginState,
  channelId: number,
  userId: number,
  label: string,
  mp3Path: string,
  runtimeCtx?: TInvokerContext,
): Promise<void> {
  const { ctx, settings, activeSessions, ffmpegCmd, debugLog } = state;
  const procKey = `${channelId}-${userId}`;
  debugLog(`playAudio: channelId=${channelId}, userId=${userId}, label="${label}", path="${mp3Path}", activeSessions=${activeSessions.size}, activeChannels=[${[...state.activeChannels].join(", ")}]`);

  const voiceActions = resolveVoiceActions(ctx, runtimeCtx);

  const existing = activeSessions.get(procKey);
  if (existing) {
    debugLog(`Stopping existing playback for ${procKey}`);
    existing.ffmpeg.kill();
    existing.cleanup();
    activeSessions.delete(procKey);
  }

  const router = voiceActions.getRouter(channelId);
  const listenInfo = await voiceActions.getListenInfo();
  debugLog(`listenInfo: ip=${listenInfo.ip}, announcedAddress=${listenInfo.announcedAddress}`);

  const transport = await router.createPlainTransport({
    listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
    rtcpMux: true,
    comedia: true,
    enableSrtp: false,
  });

  const ssrc = Math.floor(Math.random() * 1e9);

  const producer = await transport.produce({
    kind: "audio",
    rtpParameters: {
      codecs: [{
        mimeType: "audio/opus",
        payloadType: 111,
        clockRate: 48000,
        channels: 2,
        parameters: {},
        rtcpFeedback: [],
      }],
      encodings: [{ ssrc }],
    },
  });

  const rtpPort = transport.tuple.localPort;
  debugLog(`Transport created — port=${rtpPort}, SSRC=${ssrc}, producerId=${producer.id}`);

  const rtpTargetHost = listenInfo.ip;
  const volumePercent = settings.get("volume");
  const volumeDecimal = Math.max(0, Math.min(100, volumePercent)) / 100;
  debugLog(`Spawning ffmpeg → rtp://${rtpTargetHost}:${rtpPort} (SSRC=${ssrc}, volume=${volumePercent}%/${volumeDecimal})`);

  const ffmpegArgs = [
    ffmpegCmd,
    "-hide_banner",
    "-nostats",
    "-loglevel", settings.get("debug") ? "verbose" : "warning",
    "-re",
    "-i", mp3Path,
    "-vn",
    "-af", `volume=${volumeDecimal}`,
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "-b:a", "192k",
    "-application", "audio",
    "-payload_type", "111",
    "-ssrc", String(ssrc),
    "-f", "rtp",
    `rtp://${rtpTargetHost}:${rtpPort}?pkt_size=1200`,
  ];
  debugLog(`ffmpeg args: ${ffmpegArgs.slice(1).join(" ")}`);

  const ffmpeg = Bun.spawn({
    cmd: ffmpegArgs,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  debugLog(`ffmpeg spawned — PID=${ffmpeg.pid}`);

  const stream = voiceActions.createStream({
    key: `hero-intro-${channelId}-${userId}`,
    channelId,
    title: `Hero Intro: ${label}`,
    avatarUrl: "https://i.imgur.com/uVBNUK9.png",
    producers: { audio: producer },
  });
  debugLog(`Stream registered`);

  producer.on("score", (score: unknown) => {
    debugLog(`Producer score: ${JSON.stringify(score)}`);
  });

  setTimeout(async () => {
    try {
      const stats = await producer.getStats();
      const s = (stats as Array<{ packetCount?: number; byteCount?: number; bytesReceived?: number; packetsReceived?: number }>)[0];
      const pkts = s?.packetCount ?? s?.packetsReceived ?? 0;
      const bytes = s?.byteCount ?? s?.bytesReceived ?? 0;
      if (pkts > 0) {
        debugLog(`Health-check OK: ${pkts} packets, ${bytes} bytes received by producer`);
      } else {
        ctx.log(`[WARN] Health-check: producer received 0 RTP packets after 5s — audio may not be audible`);
      }
    } catch {
      debugLog(`Health-check: producer.getStats() failed (producer may be closed)`);
    }
  }, 5000);

  const cleanup = () => {
    try { stream.remove(); } catch { /* ignore */ }
    try { producer.close(); } catch { /* ignore */ }
    try { transport.close(); } catch { /* ignore */ }
    debugLog(`Cleaned up audio resources for ${procKey}`);
  };

  if (ffmpeg.stderr) {
    (async () => {
      try {
        const reader = ffmpeg.stderr.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r\n|\r|\n/);
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) debugLog(`ffmpeg[${ffmpeg.pid}]: ${trimmed}`);
          }
        }
        if (buf.trim()) debugLog(`ffmpeg[${ffmpeg.pid}]: ${buf.trim()}`);
      } catch { /* ignore */ }
    })();
  }

  const done = ffmpeg.exited.then((code: number | null) => {
    debugLog(`ffmpeg[${ffmpeg.pid}] exited — code=${code ?? "null"}`);
    ctx.log(`Playback for "${label}" finished (ffmpeg exit code ${code ?? "null"})`);
    activeSessions.delete(procKey);
    cleanup();
  });

  activeSessions.set(procKey, { ffmpeg, cleanup, done });
}

export async function playAudioAndWait(
  state: PluginState,
  channelId: number,
  userId: number,
  label: string,
  mp3Path: string,
  runtimeCtx?: TInvokerContext,
): Promise<void> {
  await playAudio(state, channelId, userId, label, mp3Path, runtimeCtx);
  const procKey = `${channelId}-${userId}`;
  const session = state.activeSessions.get(procKey);
  if (session) {
    await session.done;
  }
}
