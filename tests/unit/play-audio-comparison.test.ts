import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createMockPluginContext,
  type MockPluginContext,
  type MockSettings,
  type MockCaptures,
} from "../helpers/mock-plugin-context";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// play-audio-comparison.test.ts – Reference parity tests
// ---------------------------------------------------------------------------
// Validates that our mediasoup/ffmpeg configuration matches the known-working
// sharkord-music-bot reference implementation. Any deviation from these
// reference values is a potential cause of BUG-001 (audio not audible).
// ---------------------------------------------------------------------------

interface CommandDefinition {
  name: string;
  description: string;
  args: unknown[];
  executes: (...args: unknown[]) => Promise<string>;
}

// Bun.spawn mock
let spawnCalls: Array<{ cmd: string[] }> = [];
let originalSpawn: typeof Bun.spawn;

function installSpawnMock() {
  originalSpawn = Bun.spawn;
  spawnCalls = [];
  (Bun as any).spawn = (opts: any) => {
    const cmd = opts.cmd ?? opts;
    spawnCalls.push({ cmd: Array.isArray(cmd) ? [...cmd] : [String(cmd)] });
    return {
      pid: 99999,
      kill: mock(() => {}),
      exited: new Promise<number>(() => {}),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      stdout: null,
      stdin: null,
    };
  };
}

function restoreSpawn() {
  (Bun as any).spawn = originalSpawn;
}

// ---------------------------------------------------------------------------
// Known-working reference values from sharkord-music-bot
// ---------------------------------------------------------------------------

const REFERENCE = {
  transport: {
    rtcpMux: true,
    comedia: true,
    enableSrtp: false,
  },
  codec: {
    mimeType: "audio/opus",
    payloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: {},
    rtcpFeedback: [],
  },
  ffmpeg: {
    codec: "libopus",
    sampleRate: "48000",
    channels: "2",
    bitrate: "192k",
    application: "audio",
    payloadType: "111",
    format: "rtp",
    pktSize: "1200",
  },
  stream: {
    producersField: "audio", // key within producers: { audio: ... }
  },
} as const;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe("Reference parity (sharkord-music-bot)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `hero-ref-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const musicDir = path.join(tmpDir, "music");
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(musicDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(musicDir, "ref.mp3"), "fake");
    await fs.writeFile(
      path.join(dataDir, "music-map.json"),
      JSON.stringify({ RefUser: "ref.mp3" }),
    );
    await fs.writeFile(
      path.join(dataDir, "user-cache.json"),
      JSON.stringify({ "1": "RefUser" }),
    );
    installSpawnMock();
  });

  afterEach(async () => {
    restoreSpawn();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function triggerPlayback() {
    const { ctx, settings, captures } = createMockPluginContext({ path: tmpDir });
    const mod = await import(`../../src/server?ref=${Date.now()}-${Math.random()}`);
    await (mod.onLoad as Function)(ctx);

    const commands = new Map<string, CommandDefinition>();
    for (const call of (ctx.commands.register as ReturnType<typeof mock>).mock.calls) {
      const cmdDef = call[0] as CommandDefinition;
      commands.set(cmdDef.name, cmdDef);
    }

    const heroPlayMe = commands.get("hero-play-me")!;
    await heroPlayMe.executes({ userId: 1, currentVoiceChannelId: 10 });

    return { ctx, captures };
  }

  // -----------------------------------------------------------------------
  // Transport config parity
  // -----------------------------------------------------------------------
  it("transport config matches reference (rtcpMux, comedia, enableSrtp)", async () => {
    const { captures } = await triggerPlayback();
    const args = captures.router.createPlainTransport.mock.calls[0][0];

    expect(args.rtcpMux).toBe(REFERENCE.transport.rtcpMux);
    expect(args.comedia).toBe(REFERENCE.transport.comedia);
    expect(args.enableSrtp).toBe(REFERENCE.transport.enableSrtp);
  });

  // -----------------------------------------------------------------------
  // Codec parameter parity
  // -----------------------------------------------------------------------
  it("producer codec parameters match reference exactly", async () => {
    const { captures } = await triggerPlayback();
    const rtpParams = captures.transport.produce.mock.calls[0][0];
    const codec = rtpParams.rtpParameters.codecs[0];

    expect(codec.mimeType).toBe(REFERENCE.codec.mimeType);
    expect(codec.payloadType).toBe(REFERENCE.codec.payloadType);
    expect(codec.clockRate).toBe(REFERENCE.codec.clockRate);
    expect(codec.channels).toBe(REFERENCE.codec.channels);
    expect(codec.parameters).toEqual(REFERENCE.codec.parameters);
    expect(codec.rtcpFeedback).toEqual(REFERENCE.codec.rtcpFeedback);
  });

  // -----------------------------------------------------------------------
  // ffmpeg argument parity
  // -----------------------------------------------------------------------
  it("ffmpeg arguments match reference codec and format settings", async () => {
    await triggerPlayback();
    expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
    const cmd = spawnCalls[0].cmd;

    // Codec
    expect(cmd).toContain(REFERENCE.ffmpeg.codec);
    // Sample rate
    expect(cmd).toContain(REFERENCE.ffmpeg.sampleRate);
    // Channels
    expect(cmd).toContain(REFERENCE.ffmpeg.channels);
    // Bitrate
    expect(cmd).toContain(REFERENCE.ffmpeg.bitrate);
    // Application mode
    expect(cmd).toContain(REFERENCE.ffmpeg.application);
    // Payload type
    expect(cmd).toContain(REFERENCE.ffmpeg.payloadType);
    // Format
    expect(cmd).toContain(REFERENCE.ffmpeg.format);
    // Packet size in URL
    const rtpUrl = cmd[cmd.length - 1];
    expect(rtpUrl).toContain(`pkt_size=${REFERENCE.ffmpeg.pktSize}`);
  });

  // -----------------------------------------------------------------------
  // createStream field name parity
  // -----------------------------------------------------------------------
  it("createStream uses 'producers: { audio: producer }' matching reference", async () => {
    const { ctx } = await triggerPlayback();
    const csm = ctx.actions.voice.createStream as ReturnType<typeof mock>;
    expect(csm.mock.calls.length).toBeGreaterThanOrEqual(1);

    const streamArgs = csm.mock.calls[0][0] as Record<string, unknown>;
    const producers = streamArgs.producers as Record<string, unknown>;

    // Field must be named "audio" (not "sound", "track", etc.)
    expect(producers[REFERENCE.stream.producersField]).toBeDefined();
    // No extra fields in producers
    expect(Object.keys(producers)).toEqual([REFERENCE.stream.producersField]);
  });
});
