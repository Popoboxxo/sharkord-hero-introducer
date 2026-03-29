import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createMockPluginContext,
  type MockPluginContext,
  type MockSettings,
} from "../helpers/mock-plugin-context";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// channel-guard.test.ts
//
// Tests for voice-channel guard behaviours:
//
//   REQ-CORE-013  BUG-002: No intro when bot is alone in the channel
//   REQ-CMD-011-C /hero-play-me: error when invoker is not in a voice channel
//   REQ-CMD-012-D /hero-play:    error when invoker is not in a voice channel
//   REQ-CMD-013-E /hero-play-song: error when invoker is not in a voice channel
//   REQ-CMD-016-E all audio commands: error when channel is not active
//
// NOTE: REQ-CORE-013 is a NEW requirement not yet present in REQUIREMENTS.md.
// The hi-requirements agent must formally add it. The tests are written first
// (TDD — Red phase) because BUG-002 has not been fixed yet.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface CommandDefinition {
  name: string;
  description: string;
  args: unknown[];
  execute: (...args: unknown[]) => Promise<string>;
}

async function loadPlugin(tmpDir: string): Promise<{
  ctx: MockPluginContext;
  settings: MockSettings;
  commands: Map<string, CommandDefinition>;
  events: Map<string, (...args: unknown[]) => Promise<void>>;
}> {
  const { ctx, settings } = createMockPluginContext({ path: tmpDir });
  // Each test uses a fresh dynamic import via a unique query string so that
  // Bun's module cache does not bleed state between tests.
  const { onLoad } = await import(`../../src/server?t=${Date.now()}`);
  await (onLoad as Function)(ctx);

  const commands = new Map<string, CommandDefinition>();
  for (const call of (ctx.commands.register as ReturnType<typeof mock>).mock.calls) {
    const cmdDef = call[0] as CommandDefinition;
    commands.set(cmdDef.name, cmdDef);
  }

  const events = new Map<string, (...args: unknown[]) => Promise<void>>();
  for (const call of (ctx.events.on as ReturnType<typeof mock>).mock.calls) {
    const [eventName, handler] = call as [string, (...args: unknown[]) => Promise<void>];
    events.set(eventName, handler);
  }

  return { ctx, settings, commands, events };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Channel guard – voice channel membership & command guards", () => {
  let tmpDir: string;
  let musicDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `hero-cg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    musicDir = path.join(tmpDir, "music");
    dataDir = path.join(tmpDir, "data");
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // REQ-CORE-013  BUG-002: user:joined must NOT trigger auto-intro
  // -------------------------------------------------------------------------
  //
  // After BUG-002 fix: The user:joined event = server login, NOT voice channel
  // join. The SDK does not expose a voice:user_joined event.
  // The handler now only caches userId → username. No playback is triggered.
  // -------------------------------------------------------------------------

  describe("[REQ-CORE-013] BUG-002: user:joined must not trigger playback", () => {
    it("[REQ-CORE-013] should NOT trigger playback on user:joined — even with mapping + active channel", async () => {
      // Arrange: everything is set up for playback to succeed IF the handler
      // tried — mapping exists, audio file exists, channel is active.
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "solo.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ SoloUser: "solo.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return false;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      // Activate a voice channel
      const voiceInitHandler = events.get("voice:runtime_initialized")!;
      await voiceInitHandler({ channelId: 7 });

      // Act: fire user:joined (server login)
      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 1, username: "SoloUser" });

      // Assert: NO playback (getRouter must not be called)
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);

      // user:joined remains cache-only
    });

    it("[REQ-CORE-013] should still cache userId → username on user:joined", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });

      const { events } = await loadPlugin(tmpDir);

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 42, username: "CacheTestUser" });

      // Verify cache was written
      const cacheRaw = await fs.readFile(path.join(dataDir, "user-cache.json"), "utf8");
      const cache = JSON.parse(cacheRaw);
      expect(cache["42"]).toBe("CacheTestUser");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-011-C  /hero-play-me: invoker not in voice channel
  // -------------------------------------------------------------------------

  describe("/hero-play-me – voice channel guard", () => {
    it("[REQ-CMD-011-C] should return error message when invoker is not in a voice channel", async () => {
      // Arrange: user is in cache and has a mapping — only the channel is missing
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "hero.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "10": "ChannellessUser" }),
      );
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ ChannellessUser: "hero.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      // Act: invoke without currentVoiceChannelId
      const result = await heroPlayMe.execute({ userId: 10 });

      // Assert: specific error message as agreed in the requirement
      expect(typeof result).toBe("string");
      expect(result).toContain("You must be in a voice channel to use this command.");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-012-D  /hero-play: invoker not in voice channel
  // -------------------------------------------------------------------------

  describe("/hero-play – voice channel guard", () => {
    it("[REQ-CMD-012-D] should return error message when invoker is not in a voice channel", async () => {
      // Arrange: target displayName has a valid mapping — only channel is missing
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      // Act: invoke without currentVoiceChannelId
      const result = await heroPlay.execute(
        { userId: 1 },
        { displayName: "Alice" },
      );

      // Assert
      expect(typeof result).toBe("string");
      expect(result).toContain("You must be in a voice channel to use this command.");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-013-E  /hero-play-song: invoker not in voice channel
  // -------------------------------------------------------------------------

  describe("/hero-play-song – voice channel guard", () => {
    it("[REQ-CMD-013-E] should return error message when invoker is not in a voice channel", async () => {
      // Arrange: song file exists so that the only guard that fires is the
      // channel check.
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "eisenbart.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;
      expect(heroPlaySong).toBeDefined();

      // Act: invoke without currentVoiceChannelId
      const result = await heroPlaySong.execute(
        { userId: 1 },
        { songName: "eisenbart.mp3" },
      );

      // Assert
      expect(typeof result).toBe("string");
      expect(result).toContain("You must be in a voice channel to use this command.");
    });

    it("[REQ-CMD-013-E] should NOT play audio when invoker is not in a voice channel", async () => {
      // Same as above but verified via transport-creation side-effect absence
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "test.mp3"), "fake-mp3");

      const { ctx, commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;
      expect(heroPlaySong).toBeDefined();

      await heroPlaySong.execute(
        { userId: 5 },
        { songName: "test.mp3" },
      );

      // getRouter is the first side-effect of playAudio — must NOT be called
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-016-E  all audio commands: channel present but not active
  // -------------------------------------------------------------------------

  describe("[REQ-CMD-016-E] active channel guard", () => {
    it("[REQ-CMD-016-E] /hero-play-me should reject when currentVoiceChannelId is not active", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "hero.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "10": "GuardUser" }),
      );
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ GuardUser: "hero.mp3" }),
      );

      const { ctx, commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;

      const result = await heroPlayMe.execute({ userId: 10, currentVoiceChannelId: 99 });

      expect(result).toBe("Voice channel is not active.");
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);
    });

    it("[REQ-CMD-016-E] /hero-play should reject when currentVoiceChannelId is not active", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;

      const result = await heroPlay.execute(
        { userId: 1, currentVoiceChannelId: 99 },
        { displayName: "Alice" },
      );

      expect(result).toBe("Voice channel is not active.");
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);
    });

    it("[REQ-CMD-016-E] /hero-play-song should reject when currentVoiceChannelId is not active", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "track.mp3"), "fake-mp3");

      const { ctx, commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;

      const result = await heroPlaySong.execute(
        { userId: 1, currentVoiceChannelId: 99 },
        { songName: "track.mp3" },
      );

      expect(result).toBe("Voice channel is not active.");
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);
    });

    it("[REQ-CMD-016-E] /hero-diagnose should reject when currentVoiceChannelId is not active", async () => {
      const { ctx, commands } = await loadPlugin(tmpDir);
      const heroDiagnose = commands.get("hero-diagnose")!;

      const result = await heroDiagnose.execute({ userId: 1, currentVoiceChannelId: 99 });

      expect(result).toBe("Voice channel is not active.");
      const getRouterCalls = (ctx.actions.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);
    });
  });
});
