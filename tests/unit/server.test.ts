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
// server.ts – Plugin lifecycle & registration tests
// ---------------------------------------------------------------------------

describe("server module exports", () => {
  it("[REQ-LIFE-001] should export onLoad as a function", async () => {
    const mod = await import("../../src/server");
    expect(typeof mod.onLoad).toBe("function");
  });

  it("[REQ-LIFE-002] should export onUnload as a function", async () => {
    const mod = await import("../../src/server");
    expect(typeof mod.onUnload).toBe("function");
  });
});

describe("MockPluginContext", () => {
  let ctx: MockPluginContext;
  let settings: MockSettings;

  beforeEach(() => {
    ({ ctx, settings } = createMockPluginContext());
  });

  it("[REQ-LIFE-001] should provide a working mock context", () => {
    expect(ctx.path).toBeDefined();
    expect(typeof ctx.log).toBe("function");
    expect(typeof ctx.debug).toBe("function");
    expect(typeof ctx.error).toBe("function");
  });

  it("[REQ-CFG-001] should have settings with get and set", () => {
    expect(typeof settings.get).toBe("function");
    expect(typeof settings.set).toBe("function");
    expect(settings.get("oncePerDay")).toBe(true);
  });

  it("[REQ-CORE-004] should have voice actions mocked", () => {
    const router = ctx.voice.getRouter(1);
    expect(router).toBeDefined();
    expect(typeof router.createPlainTransport).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Helper: Load plugin and extract registered commands / events
// ---------------------------------------------------------------------------

interface CommandDefinition {
  name: string;
  description: string;
  args: unknown[];
  execute: (...args: unknown[]) => Promise<string>;
}

async function loadPlugin(tmpDir: string) {
  const { ctx, settings } = createMockPluginContext({ path: tmpDir });
  const { onLoad } = await import(`../../src/server?server=${Date.now()}-${Math.random()}`);
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

  // Default active channels for command success-path tests.
  const voiceInitHandler = events.get("voice:runtime_initialized");
  if (voiceInitHandler) {
    await voiceInitHandler({ channelId: 1 });
    await voiceInitHandler({ channelId: 5 });
    await voiceInitHandler({ channelId: 10 });
  }

  return { ctx, settings, commands, events };
}

// ---------------------------------------------------------------------------
// Command & event handler tests (with real filesystem)
// ---------------------------------------------------------------------------

describe("Plugin onLoad – commands & data", () => {
  let tmpDir: string;
  let musicDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `hero-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    musicDir = path.join(tmpDir, "music");
    dataDir = path.join(tmpDir, "data");
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -- REQ-DATA-005 -------------------------------------------------------

  it("[REQ-DATA-005] should create the music directory on plugin load", async () => {
    await loadPlugin(tmpDir);
    const stat = await fs.stat(musicDir);
    expect(stat.isDirectory()).toBe(true);
  });

  // -- REQ-DATA-003 -------------------------------------------------------

  it("[REQ-DATA-003] should create the data directory on plugin load", async () => {
    await loadPlugin(tmpDir);
    const stat = await fs.stat(dataDir);
    expect(stat.isDirectory()).toBe(true);
  });

  // -- REQ-CMD-004: /hero-set ---------------------------------------------

  describe("/hero-set", () => {
    it("[REQ-CMD-004] should reject non-.mp3/.mpeg file names", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.execute(
        {},
        { displayName: "TestUser", audioFileName: "intro.wav" },
      );
      // resolveAudioFile reports no audio files or no match
      expect(result).toContain("No audio files found");
    });

    it("[REQ-CMD-004] should reject files that do not exist in the music directory", async () => {
      // Create the music directory with at least one file so resolveAudioFile
      // can list available files when reporting "File not found"
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "other.mp3"), "fake");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.execute(
        {},
        { displayName: "TestUser", audioFileName: "missing.mp3" },
      );
      expect(result).toContain("File not found");
    });

    it("[REQ-CMD-004] should save displayName to mp3FileName mapping and confirm", async () => {
      // Pre-create the mp3 file so the existence check passes
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "intro.mp3"), "fake-mp3-data");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.execute(
        {},
        { displayName: "TestUser", audioFileName: "intro.mp3" },
      );

      expect(result).toContain("Intro set for TestUser");
      expect(result).toContain("intro.mp3");

      // Verify persistence
      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["TestUser"]).toBe("intro.mp3");
    });

    it("[REQ-CMD-004] should accept .mpeg files", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "intro.mpeg"), "fake-mpeg-data");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.execute(
        {},
        { displayName: "MpegUser", audioFileName: "intro.mpeg" },
      );

      expect(result).toContain("Intro set for MpegUser");
      expect(result).toContain("intro.mpeg");

      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["MpegUser"]).toBe("intro.mpeg");
    });
  });

  // -- REQ-CMD-005: /hero-remove ------------------------------------------

  describe("/hero-remove", () => {
    it("[REQ-CMD-005] should remove an existing mapping", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ TestUser: "intro.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroRemove = commands.get("hero-remove")!;
      const result = await heroRemove.execute({}, { displayName: "TestUser" });
      expect(result).toContain("Intro removed for TestUser");

      // Verify persistence
      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["TestUser"]).toBeUndefined();
    });

    it("[REQ-CMD-005] should return info when no mapping exists for the display name", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroRemove = commands.get("hero-remove")!;
      const result = await heroRemove.execute({}, { displayName: "UnknownUser" });
      expect(result).toContain("No intro configured for UnknownUser");
    });
  });

  // -- REQ-CMD-006: /hero-list --------------------------------------------

  describe("/hero-list", () => {
    it("[REQ-CMD-006] should return formatted list with DisplayName: mp3FileName", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice-intro.mp3", Bob: "bob-theme.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroList = commands.get("hero-list")!;
      const result = await heroList.execute({});

      expect(result).toContain("Alice: alice-intro.mp3");
      expect(result).toContain("Bob: bob-theme.mp3");
    });

    it("[REQ-CMD-006] should return info when no mappings exist", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroList = commands.get("hero-list")!;
      const result = await heroList.execute({});
      expect(result).toContain("No intro mappings configured yet");
    });
  });

  // -- REQ-CMD-007: /hero-files -------------------------------------------

  describe("/hero-files", () => {
    it("[REQ-CMD-007] should list .mp3 and .mpeg files from the music directory", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "intro.mp3"), "fake");
      await fs.writeFile(path.join(musicDir, "theme.mpeg"), "fake");
      await fs.writeFile(path.join(musicDir, "readme.txt"), "not audio");

      const { commands } = await loadPlugin(tmpDir);
      const heroFiles = commands.get("hero-files")!;
      const result = await heroFiles.execute({});

      expect(result).toContain("intro.mp3");
      expect(result).toContain("theme.mpeg");
      expect(result).not.toContain("readme.txt");
    });

    it("[REQ-CMD-007] should return info when no audio files exist", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroFiles = commands.get("hero-files")!;
      const result = await heroFiles.execute({});
      expect(result).toContain("No audio files found");
    });
  });

  // -- REQ-CORE-013: user:joined – caches username only -------------------

  describe("user:joined handler", () => {
    it("[REQ-CORE-013] should cache userId → username on user:joined (no auto-intro)", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return false;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 999, username: "Alice" });

      // Verify: user cache was updated (written to disk)
      const cacheRaw = await fs.readFile(path.join(dataDir, "user-cache.json"), "utf8");
      const cache = JSON.parse(cacheRaw);
      expect(cache["999"]).toBe("Alice");

      // Verify: NO playback was triggered (getRouter must NOT be called)
      const getRouterCalls = (ctx.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);

      // user:joined remains cache-only
    });
  });

  // -- REQ-CORE-001: user:joined_voice triggers auto-intro -----------------

  describe("user:joined_voice handler", () => {
    it("[REQ-CORE-001] should start intro playback when mapping exists", async () => {
      process.env.HERO_INTRO_DELAY_MS = "0";

      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);
      settings.get = mock((key: string) => {
        if (key === "oncePerDay") return false;
        if (key === "debug") return false;
        if (key === "volume") return 25;
        return undefined;
      });
      const voiceJoinedHandler = events.get("user:joined_voice")!;

      await voiceJoinedHandler({ channelId: 5, userId: 900, username: "Alice" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const getRouterCalls = (ctx.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls.length).toBeGreaterThanOrEqual(1);
      expect(getRouterCalls[0][0]).toBe(5);

      delete process.env.HERO_INTRO_DELAY_MS;
    });

    it("[REQ-CORE-002] should not start playback when mapping does not exist", async () => {
      process.env.HERO_INTRO_DELAY_MS = "0";

      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });

      const { ctx, settings, events } = await loadPlugin(tmpDir);
      settings.get = mock((key: string) => {
        if (key === "oncePerDay") return false;
        if (key === "debug") return false;
        if (key === "volume") return 25;
        return undefined;
      });
      const voiceJoinedHandler = events.get("user:joined_voice")!;

      await voiceJoinedHandler({ channelId: 5, userId: 901, username: "NoMap" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const getRouterCalls = (ctx.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);

      delete process.env.HERO_INTRO_DELAY_MS;
    });

    it("[REQ-CORE-014] should not start playback when channel is not active", async () => {
      process.env.HERO_INTRO_DELAY_MS = "0";

      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);
      settings.get = mock((key: string) => {
        if (key === "oncePerDay") return false;
        if (key === "debug") return false;
        if (key === "volume") return 25;
        return undefined;
      });
      const voiceJoinedHandler = events.get("user:joined_voice")!;

      await voiceJoinedHandler({ channelId: 999, userId: 902, username: "Alice" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const getRouterCalls = (ctx.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls).toHaveLength(0);

      delete process.env.HERO_INTRO_DELAY_MS;
    });
  });

  // -- REQ-CORE-015: user:left_voice cleanup -------------------------------

  describe("user:left_voice handler", () => {
    it("[REQ-CORE-015] should stop active intro for user in channel", async () => {
      process.env.HERO_INTRO_DELAY_MS = "0";

      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);
      settings.get = mock((key: string) => {
        if (key === "oncePerDay") return false;
        if (key === "debug") return false;
        if (key === "volume") return 25;
        return undefined;
      });
      const voiceJoinedHandler = events.get("user:joined_voice")!;
      const voiceLeftHandler = events.get("user:left_voice")!;

      await voiceJoinedHandler({ channelId: 5, userId: 903, username: "Alice" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await voiceLeftHandler({ channelId: 5, userId: 903 });

      const getRouterCalls = (ctx.voice.getRouter as ReturnType<typeof mock>).mock.calls;
      expect(getRouterCalls.length).toBeGreaterThanOrEqual(1);

      delete process.env.HERO_INTRO_DELAY_MS;
    });
  });

  // -- REQ-CMD-009: /hero-set-me ------------------------------------------

  describe("/hero-set-me", () => {
    it("[REQ-CMD-009] should save mapping for invoker when user is in cache and file is valid", async () => {
      // Pre-populate user cache so the plugin knows userId 42 → "CachedUser"
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "42": "CachedUser" }),
      );
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "my-intro.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroSetMe = commands.get("hero-set-me")!;
      expect(heroSetMe).toBeDefined();

      const result = await heroSetMe.execute(
        { userId: 42, currentVoiceChannelId: 1 },
        { audioFileName: "my-intro.mp3" },
      );

      expect(result).toContain("CachedUser");
      expect(result).toContain("my-intro.mp3");

      // Verify persistence
      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["CachedUser"]).toBe("my-intro.mp3");
    });

    it("[REQ-CMD-009] should return error when user is not in cache", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "my-intro.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroSetMe = commands.get("hero-set-me")!;
      expect(heroSetMe).toBeDefined();

      const result = await heroSetMe.execute(
        { userId: 9999, currentVoiceChannelId: 1 },
        { audioFileName: "my-intro.mp3" },
      );

      expect(result).toContain("Could not determine your username");
    });

    it("[REQ-CMD-009] should reject unsupported file extensions", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "42": "CachedUser" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroSetMe = commands.get("hero-set-me")!;
      expect(heroSetMe).toBeDefined();

      const result = await heroSetMe.execute(
        { userId: 42, currentVoiceChannelId: 1 },
        { audioFileName: "intro.wav" },
      );

      // resolveAudioFile reports no audio files found (empty music dir)
      expect(result).toContain("No audio files found");
    });
  });

  // -- REQ-CMD-011: /hero-play-me -----------------------------------------

  describe("/hero-play-me", () => {
    it("[REQ-CMD-011] should start playback when user has mapping and is in voice channel", async () => {
      // Pre-populate user cache and music map
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "42": "HeroUser" }),
      );
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ HeroUser: "hero.mp3" }),
      );
      await fs.writeFile(path.join(musicDir, "hero.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      const result = await heroPlayMe.execute(
        { userId: 42, currentVoiceChannelId: 5 },
      );

      // Should return a success/playing message (not an error)
      expect(typeof result).toBe("string");
      expect(result).not.toContain("❌");
    });

    it("[REQ-CMD-011] should return info when user has no mapping", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "42": "NoMappingUser" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      const result = await heroPlayMe.execute(
        { userId: 42, currentVoiceChannelId: 5 },
      );

      expect(result).toContain("No intro configured");
    });

    it("[REQ-CMD-011] should return error when user is not in voice channel", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "42": "HeroUser" }),
      );
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ HeroUser: "hero.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      // No currentVoiceChannelId → error
      const result = await heroPlayMe.execute(
        { userId: 42 },
      );

      expect(result).toContain("You must be in a voice channel to use this command.");
    });

    it("[REQ-CMD-011] should return error when user is not in user cache", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      const result = await heroPlayMe.execute(
        { userId: 9999, currentVoiceChannelId: 5 },
      );

      expect(result).toContain("not cached");
    });
  });

  // -- REQ-CMD-012: /hero-play <displayName> ------------------------------

  describe("/hero-play", () => {
    it("[REQ-CMD-012] should start playback when displayName has mapping and file exists", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice-intro.mp3" }),
      );
      await fs.writeFile(path.join(musicDir, "alice-intro.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      const result = await heroPlay.execute(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "Alice" },
      );

      expect(typeof result).toBe("string");
      expect(result).not.toContain("❌");
    });

    it("[REQ-CMD-012] should return info when displayName has no mapping", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      const result = await heroPlay.execute(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "UnknownUser" },
      );

      expect(result).toContain("No intro configured");
    });

    it("[REQ-CMD-012] should fallback to file lookup when displayName mapping does not exist", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "vibecodin.mpeg"), "fake-mpeg");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      const result = await heroPlay.execute(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "vibecodin" },
      );

      expect(result).toContain("Playing intro for vibecodin: vibecodin.mpeg");
    });

    it("[REQ-CMD-012] should return error when displayName has mapping but file does not exist", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "missing-file.mp3" }),
      );

      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      const result = await heroPlay.execute(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "Alice" },
      );

      expect(result).toContain("file not found");
    });

    it("[REQ-CMD-012] should return error when invoker is not in voice channel", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice-intro.mp3" }),
      );
      await fs.writeFile(path.join(musicDir, "alice-intro.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlay = commands.get("hero-play")!;
      expect(heroPlay).toBeDefined();

      // No currentVoiceChannelId
      const result = await heroPlay.execute(
        { userId: 1 },
        { displayName: "Alice" },
      );

      expect(result).toContain("You must be in a voice channel to use this command.");
    });
  });

  // -- REQ-DBG-001: Debug-Logging ----------------------------------------

  describe("Debug-Logging", () => {
    it("[REQ-DBG-001] should log [DEBUG] messages to ctx.log when debug=true", async () => {
      // Pre-populate a mapping so user:joined triggers debugLog calls
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ DebugUser: "debug.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      // Enable debug mode AFTER plugin load
      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return false;
        if (key === "debug") return true;
        return undefined;
      });

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 100, username: "DebugUser" });

      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const debugMessages = logMessages.filter((m: string) => m.includes("[DEBUG]"));
      expect(debugMessages.length).toBeGreaterThan(0);
    });

    it("[REQ-DBG-001] should NOT log [DEBUG] messages to ctx.log when debug=false", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ QuietUser: "quiet.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      // Ensure debug is off (default)
      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return false;
        if (key === "debug") return false;
        return undefined;
      });

      // Clear log calls from plugin initialization
      (ctx.log as ReturnType<typeof mock>).mockClear();

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 200, username: "QuietUser" });

      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const debugMessages = logMessages.filter((m: string) => m.includes("[DEBUG]"));
      expect(debugMessages).toHaveLength(0);
    });
  });
});
