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
    expect(settings.get("enabled")).toBe(true);
    expect(settings.get("oncePerDay")).toBe(true);
  });

  it("[REQ-CORE-004] should have voice actions mocked", () => {
    const router = ctx.actions.voice.getRouter(1);
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
  executes: (...args: unknown[]) => Promise<string>;
}

async function loadPlugin(tmpDir: string) {
  const { ctx, settings } = createMockPluginContext({ path: tmpDir });
  const { onLoad } = await import("../../src/server");
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
      const result = await heroSet.executes(
        {},
        { displayName: "TestUser", audioFileName: "intro.wav" },
      );
      expect(result).toContain("Only MP3 and MPEG files are supported");
    });

    it("[REQ-CMD-004] should reject files that do not exist in the music directory", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.executes(
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
      const result = await heroSet.executes(
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
      const result = await heroSet.executes(
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
      const result = await heroRemove.executes({}, { displayName: "TestUser" });
      expect(result).toContain("Intro removed for TestUser");

      // Verify persistence
      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["TestUser"]).toBeUndefined();
    });

    it("[REQ-CMD-005] should return info when no mapping exists for the display name", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroRemove = commands.get("hero-remove")!;
      const result = await heroRemove.executes({}, { displayName: "UnknownUser" });
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
      const result = await heroList.executes({});

      expect(result).toContain("Alice: alice-intro.mp3");
      expect(result).toContain("Bob: bob-theme.mp3");
    });

    it("[REQ-CMD-006] should return info when no mappings exist", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroList = commands.get("hero-list")!;
      const result = await heroList.executes({});
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
      const result = await heroFiles.executes({});

      expect(result).toContain("intro.mp3");
      expect(result).toContain("theme.mpeg");
      expect(result).not.toContain("readme.txt");
    });

    it("[REQ-CMD-007] should return info when no audio files exist", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroFiles = commands.get("hero-files")!;
      const result = await heroFiles.executes({});
      expect(result).toContain("No audio files found");
    });
  });

  // -- REQ-CORE-001: user:joined – username-based lookup ------------------

  describe("user:joined handler", () => {
    it("[REQ-CORE-001] should look up intro by username, not by userId", async () => {
      // Set up a mapping keyed by username "Alice"
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "alice.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ Alice: "alice.mp3" }),
      );

      const { ctx, events } = await loadPlugin(tmpDir);
      const userJoinedHandler = events.get("user:joined")!;

      // userId 999 has no mapping, but username "Alice" does
      await userJoinedHandler({ userId: 999, username: "Alice" });

      const debugMessages = (ctx.debug as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const errorMessages = (ctx.error as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );

      // If lookup used userId (999), "No intro configured" would appear.
      // Since it uses username ("Alice"), the mapping is found.
      const noIntroMsg = debugMessages.filter((m: string) =>
        m.includes("No intro configured"),
      );
      expect(noIntroMsg).toHaveLength(0);

      // With no active voice channel the handler reaches playIntroForUser
      // which logs "No active voice channel found"
      const noChannelMsg = errorMessages.filter((m: string) =>
        m.includes("No active voice channel"),
      );
      expect(noChannelMsg).toHaveLength(1);
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

      const result = await heroSetMe.executes(
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

      const result = await heroSetMe.executes(
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

      const result = await heroSetMe.executes(
        { userId: 42, currentVoiceChannelId: 1 },
        { audioFileName: "intro.wav" },
      );

      expect(result).toContain("Only MP3 and MPEG files are supported");
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

      const result = await heroPlayMe.executes(
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

      const result = await heroPlayMe.executes(
        { userId: 42, currentVoiceChannelId: 5 },
      );

      expect(result).toContain("ℹ️");
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
      const result = await heroPlayMe.executes(
        { userId: 42 },
      );

      expect(result).toContain("❌");
    });

    it("[REQ-CMD-011] should return error when user is not in user cache", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroPlayMe = commands.get("hero-play-me")!;
      expect(heroPlayMe).toBeDefined();

      const result = await heroPlayMe.executes(
        { userId: 9999, currentVoiceChannelId: 5 },
      );

      expect(result).toContain("❌");
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

      const result = await heroPlay.executes(
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

      const result = await heroPlay.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "UnknownUser" },
      );

      expect(result).toContain("ℹ️");
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

      const result = await heroPlay.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { displayName: "Alice" },
      );

      expect(result).toContain("❌");
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
      const result = await heroPlay.executes(
        { userId: 1 },
        { displayName: "Alice" },
      );

      expect(result).toContain("❌");
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
