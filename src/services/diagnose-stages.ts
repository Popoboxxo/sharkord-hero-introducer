import path from "path";
import fs from "fs/promises";
import type { PluginContext } from "@sharkord/plugin-sdk";
import { resolveVoiceActions } from "../utils/voice-compat";
import { isSupportedAudioFile } from "../utils/helpers";
import type { DiagRouter, DiagTransport, DiagProducer, DiagListenInfo, StageReporter } from "./diagnose-types";

export async function runDiagnoseStages(
  ctx: PluginContext,
  voiceChannelId: number,
  reporter: StageReporter,
  ffmpegCmd: string,
  musicDir: string,
  debugLog: (msg: string) => void,
): Promise<{
  router: DiagRouter;
  listenInfo: DiagListenInfo;
  transport: DiagTransport;
  rtpPort: number;
  ssrc: number;
  producer: DiagProducer;
  ffmpeg: any;
}> {
  const { pass, fail, info } = reporter;

  // Stage 0
  let ffmpegOk = false;
  try {
    const probe = Bun.spawn({ cmd: [ffmpegCmd, "-version"], stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    await probe.exited;
    ffmpegOk = true;
  } catch { /* ignore */ }
  if (ffmpegOk) pass("Stage 0", "ffmpeg found"); else fail("Stage 0", "ffmpeg NOT found");

  // Stage 1
  let router: DiagRouter;
  let listenInfo: DiagListenInfo;
  let transport: DiagTransport;
  let rtpPort: number;
  try {
    const voiceActions = resolveVoiceActions(ctx);
    router = voiceActions.getRouter(voiceChannelId) as unknown as DiagRouter;
    listenInfo = await voiceActions.getListenInfo() as unknown as DiagListenInfo;
    transport = await router.createPlainTransport({
      listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
      rtcpMux: true,
      comedia: true,
      enableSrtp: false,
    });
    rtpPort = transport.tuple.localPort;
    pass("Stage 1", `Transport created (port=${rtpPort}, ip=${listenInfo.ip})`);
  } catch (err) {
    fail("Stage 1", `Transport creation failed: ${String(err)}`);
    throw new Error("Stage 1 failed");
  }

  // Stage 2
  const ssrc = Math.floor(Math.random() * 1e9);
  info("Stage 2", `Using payloadType=111 (matching playAudio pipeline)`);

  let producer: DiagProducer;
  try {
    producer = await transport.produce({
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
    const producerPaused = producer.paused ?? "unknown";
    pass("Stage 2", `Producer created (id=${producer.id}, paused=${producerPaused}, SSRC=${ssrc})`);
    if (producer.paused) {
      fail("Stage 2", "Producer is PAUSED — RTP data will be discarded!");
    }
  } catch (err) {
    fail("Stage 2", `Producer creation failed: ${String(err)}`);
    try { transport.close(); } catch { /* ignore */ }
    throw new Error("Stage 2 failed");
  }

  // Stage 3
  let testAudioPath: string | undefined;
  try {
    const files = await fs.readdir(musicDir);
    const audioFile = files.find((f: string) => isSupportedAudioFile(f));
    if (audioFile) testAudioPath = path.join(musicDir, audioFile);
  } catch { /* ignore */ }

  if (!testAudioPath) {
    info("Stage 3", "No audio file found — generating 3s silence via ffmpeg");
  }

  const ffmpegArgs = testAudioPath
    ? [
      ffmpegCmd, "-hide_banner", "-nostats", "-loglevel", "warning",
      "-re", "-i", testAudioPath, "-vn", "-t", "5",
      "-af", "volume=0.25",
      "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "192k",
      "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
      "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
    ]
    : [
      ffmpegCmd, "-hide_banner", "-nostats", "-loglevel", "warning",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3",
      "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "192k",
      "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
      "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
    ];

  const ffmpeg = Bun.spawn({ cmd: ffmpegArgs, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
  info("Stage 3", `ffmpeg spawned (PID=${ffmpeg.pid}, SSRC=${ssrc}, target=rtp://${listenInfo.ip}:${rtpPort})`);

  await new Promise((r) => setTimeout(r, 2000));

  let producerStats: unknown;
  try {
    producerStats = await producer.getStats();
    const ps = (producerStats as Array<{ packetCount: number; byteCount: number; score: number }>)[0];
    if (ps && ps.packetCount > 0) {
      pass("Stage 3", `ffmpeg OK (${ps.packetCount} pkts, ${ps.byteCount} bytes, score=${ps.score})`);
    } else {
      fail("Stage 3", `No RTP packets received by producer (packetCount=${ps?.packetCount ?? 0})`);
    }
  } catch (err) {
    fail("Stage 3", `Producer getStats failed: ${String(err)}`);
  }

  // Stage 4
  let sdkConsumerFound = false;
  let sdkConsumerPaused: boolean | undefined;
  let sdkConsumerStats: unknown;

  if (producer.observer?.on) {
    producer.observer.on("newconsumer", async (consumer) => {
      sdkConsumerFound = true;
      sdkConsumerPaused = consumer.paused;
      try {
        sdkConsumerStats = await consumer.getStats();
      } catch { /* ignore */ }
      ctx.log(`[DIAG] SDK consumer detected: id=${consumer.id}, paused=${consumer.paused}`);
    });
  }

  const voiceActions = resolveVoiceActions(ctx);
  const stream = voiceActions.createStream({
    channelId: voiceChannelId,
    title: `Diagnostic Test`,
    key: `hero-diag-${voiceChannelId}-${ssrc}`,
    producers: { audio: producer },
  });
  info("Stage 4", "Stream registered, waiting 5s for SDK to create consumer...");

  await new Promise((r) => setTimeout(r, 5000));

  if (sdkConsumerFound) {
    info("Stage 4", `SDK consumer found! paused=${sdkConsumerPaused ?? "unknown"}`);
    if (sdkConsumerPaused) {
      fail("Stage 4", "SDK Consumer is PAUSED — this is likely the cause of BUG-001!");
      info("Stage 4", "mediasoup creates consumers paused by default. The SDK must call consumer.resume().");
    } else if (sdkConsumerPaused === false) {
      pass("Stage 4", "SDK Consumer is resumed (paused=false)");
    }
    if (sdkConsumerStats) {
      info("Stage 4", `SDK consumer stats: ${JSON.stringify(sdkConsumerStats)}`);
    }
  } else {
    info("Stage 4", "No SDK consumer detected via producer.observer");
    info("Stage 4", "Checking router dump for consumers...");
  }

  return { router, listenInfo, transport, rtpPort, ssrc, producer, ffmpeg };
}
