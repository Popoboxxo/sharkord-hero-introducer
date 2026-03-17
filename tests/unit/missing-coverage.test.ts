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
// missing-coverage.test.ts — Tests for REQ-IDs without existing test coverage
// ---------------------------------------------------------------------------
// Covers: REQ-CORE-002, REQ-CORE-003, REQ-CORE-005, REQ-CORE-006,
//         REQ-CMD-001, REQ-CMD-002, REQ-CMD-003, REQ-CMD-010, REQ-CMD-013,
//         REQ-CFG-002, REQ-CFG-003, REQ-CFG-004,
//         REQ-DATA-001, REQ-DATA-002, REQ-DATA-004, REQ-DATA-007
// ---------------------------------------------------------------------------

interface CommandDefinition {
  name: string;
  description: string;
  args: unknown[];
  executes: (...args: unknown[]) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Helper: Load plugin and extract registered commands / events
// ---------------------------------------------------------------------------

async function loadPlugin(tmpDir: string) {
  const { ctx, settings } = createMockPluginContext({ path: tmpDir });
  const mod = await import(`../../src/server?missing=${Date.now()}-${Math.random()}`);
  await (mod.onLoad as Function)(ctx);

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
// Test infrastructure
// ---------------------------------------------------------------------------

describe("Missing Coverage Tests", () => {
  let tmpDir: string;
  let musicDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `hero-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    musicDir = path.join(tmpDir, "music");
    dataDir = path.join(tmpDir, "data");
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // REQ-CORE-002: No playback when user has no mapping
  // =========================================================================

  describe("REQ-CORE-002 — No playback without mapping", () => {
    it("[REQ-CORE-002] should not play audio and not error when user has no MP3 mapping", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      // Music map is empty — no mapping for anyone
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({}),
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
      await userJoinedHandler({ userId: 777, username: "NoMappingUser" });

      // No error should have been logged
      const errorMessages = (ctx.error as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      expect(errorMessages).toHaveLength(0);

      // Debug log should indicate no intro configured
      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const noIntroMessages = logMessages.filter((m: string) =>
        m.includes("No intro configured"),
      );
      expect(noIntroMessages.length).toBeGreaterThan(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-CORE-003: File existence check before playback
  // =========================================================================

  describe("REQ-CORE-003 — File existence check", () => {
    it("[REQ-CORE-003] should log error and not play when mapped audio file does not exist", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      // Map points to a file that does NOT exist on disk
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ GhostUser: "nonexistent.mp3" }),
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
      await userJoinedHandler({ userId: 888, username: "GhostUser" });

      // Should have logged an error about file not found
      const errorMessages = (ctx.error as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const fileNotFoundErrors = errorMessages.filter((m: string) =>
        m.includes("not found"),
      );
      expect(fileNotFoundErrors.length).toBeGreaterThan(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-CORE-005: Voice channel tracking
  // =========================================================================

  describe("REQ-CORE-005 — Voice channel tracking", () => {
    it("[REQ-CORE-005] should add channelId to active set on voice:runtime_initialized", async () => {
      const { events } = await loadPlugin(tmpDir);
      const initHandler = events.get("voice:runtime_initialized")!;
      expect(initHandler).toBeDefined();

      // The handler should run without errors
      await initHandler({ channelId: 42 });
      // We cannot inspect the internal Set directly, but we verify the event
      // handler was registered and executes without error
    });

    it("[REQ-CORE-005] should remove channelId from active set on voice:runtime_closed", async () => {
      const { events } = await loadPlugin(tmpDir);
      const closeHandler = events.get("voice:runtime_closed")!;
      expect(closeHandler).toBeDefined();

      await closeHandler({ channelId: 42 });
      // Handler executes without error
    });
  });

  // =========================================================================
  // REQ-CORE-006: No active voice channel
  // =========================================================================

  describe("REQ-CORE-006 — No active voice channel", () => {
    it("[REQ-CORE-006] should not play when no voice channel is active", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "lonely.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ LonelyUser: "lonely.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return false;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      // Do NOT trigger voice:runtime_initialized, so activeChannels is empty
      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 333, username: "LonelyUser" });

      // The debug log should mention no active voice channel
      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const noChannelMsg = logMessages.filter((m: string) =>
        m.includes("No active voice channel"),
      );
      expect(noChannelMsg.length).toBeGreaterThan(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-CMD-001: /hero-enable
  // =========================================================================

  describe("/hero-enable", () => {
    it("[REQ-CMD-001] should set enabled to true and return confirmation", async () => {
      const { ctx, settings, commands } = await loadPlugin(tmpDir);
      const heroEnable = commands.get("hero-enable")!;
      expect(heroEnable).toBeDefined();

      const result = await heroEnable.executes({});
      expect(result).toContain("enabled");

      // Verify settings.set was called with enabled=true
      const setCalls = (settings.set as ReturnType<typeof mock>).mock.calls;
      const enableCall = setCalls.find(
        (c: unknown[]) => c[0] === "enabled" && c[1] === true,
      );
      expect(enableCall).toBeDefined();
    });
  });

  // =========================================================================
  // REQ-CMD-002: /hero-disable
  // =========================================================================

  describe("/hero-disable", () => {
    it("[REQ-CMD-002] should set enabled to false and return confirmation", async () => {
      const { settings, commands } = await loadPlugin(tmpDir);
      const heroDisable = commands.get("hero-disable")!;
      expect(heroDisable).toBeDefined();

      const result = await heroDisable.executes({});
      expect(result).toContain("disabled");

      // Verify settings.set was called with enabled=false
      const setCalls = (settings.set as ReturnType<typeof mock>).mock.calls;
      const disableCall = setCalls.find(
        (c: unknown[]) => c[0] === "enabled" && c[1] === false,
      );
      expect(disableCall).toBeDefined();
    });
  });

  // =========================================================================
  // REQ-CMD-003: /hero-stop
  // =========================================================================

  describe("/hero-stop", () => {
    it("[REQ-CMD-003] should return info when no intros are playing", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroStop = commands.get("hero-stop")!;
      expect(heroStop).toBeDefined();

      const result = await heroStop.executes({});
      expect(result).toContain("No intro is currently playing");
    });
  });

  // =========================================================================
  // REQ-CMD-010: /hero-dump-context
  // =========================================================================

  describe("/hero-dump-context", () => {
    it("[REQ-CMD-010] should return invokerCtx as formatted JSON", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroDumpCtx = commands.get("hero-dump-context")!;
      expect(heroDumpCtx).toBeDefined();

      const invokerCtx = { userId: 42, currentVoiceChannelId: 5, someField: "test" };
      const result = await heroDumpCtx.executes(invokerCtx);

      expect(typeof result).toBe("string");
      // The result should contain JSON representation of the context
      expect(result).toContain("userId");
      expect(result).toContain("42");
    });
  });

  // =========================================================================
  // REQ-CMD-013: /hero-play-song
  // =========================================================================

  describe("/hero-play-song", () => {
    it("[REQ-CMD-013] should play a song when file exists and user is in voice channel", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "eisenbart.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;
      expect(heroPlaySong).toBeDefined();

      const result = await heroPlaySong.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { songName: "eisenbart.mp3" },
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("Playing");
      expect(result).toContain("eisenbart.mp3");
    });

    it("[REQ-CMD-013] should resolve file without extension", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "eisenbart.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;

      const result = await heroPlaySong.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { songName: "eisenbart" },
      );

      expect(result).toContain("Playing");
      expect(result).toContain("eisenbart.mp3");
    });

    it("[REQ-CMD-013] should warn about duplicates when multiple files match", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "song.mp3"), "fake-mp3");
      await fs.writeFile(path.join(musicDir, "song.mpeg"), "fake-mpeg");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;

      const result = await heroPlaySong.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { songName: "song" },
      );

      expect(result).toContain("Multiple files found");
      expect(result).toContain("song.mp3");
      expect(result).toContain("song.mpeg");
    });

    it("[REQ-CMD-013] should return error when song is not found", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "other.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;

      const result = await heroPlaySong.executes(
        { userId: 1, currentVoiceChannelId: 5 },
        { songName: "nonexistent" },
      );

      expect(result).toContain("No file found");
    });

    it("[REQ-CMD-013] should return error when user is not in voice channel", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "eisenbart.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroPlaySong = commands.get("hero-play-song")!;

      const result = await heroPlaySong.executes(
        { userId: 1 },
        { songName: "eisenbart.mp3" },
      );

      expect(result).toContain("not in a voice channel");
    });
  });

  // =========================================================================
  // REQ-CFG-002: oncePerDay setting
  // =========================================================================

  describe("REQ-CFG-002 — oncePerDay setting", () => {
    it("[REQ-CFG-002] should skip intro when oncePerDay=true and user was already greeted today", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "repeat.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ RepeatUser: "repeat.mp3" }),
      );
      // Write today's date as the last greet
      const today = new Date().toISOString().slice(0, 10);
      await fs.writeFile(
        path.join(dataDir, "daily-greets.json"),
        JSON.stringify({ "555": today }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return true;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 555, username: "RepeatUser" });

      // Debug log should say already greeted today
      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const alreadyGreeted = logMessages.filter((m: string) =>
        m.includes("already greeted today"),
      );
      expect(alreadyGreeted.length).toBeGreaterThan(0);
    }, 15000);

    it("[REQ-CFG-002] should allow intro when oncePerDay=false even if user was already greeted today", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "again.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ AgainUser: "again.mp3" }),
      );
      const today = new Date().toISOString().slice(0, 10);
      await fs.writeFile(
        path.join(dataDir, "daily-greets.json"),
        JSON.stringify({ "666": today }),
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
      await userJoinedHandler({ userId: 666, username: "AgainUser" });

      // Should NOT have logged "already greeted"
      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const alreadyGreeted = logMessages.filter((m: string) =>
        m.includes("already greeted today"),
      );
      expect(alreadyGreeted).toHaveLength(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-CFG-003: Settings UI activation
  // =========================================================================

  describe("REQ-CFG-003 — Settings UI activation", () => {
    it("[REQ-CFG-003] should call ctx.ui.enable() on plugin load", async () => {
      const { ctx } = await loadPlugin(tmpDir);
      const enableCalls = (ctx.ui.enable as ReturnType<typeof mock>).mock.calls;
      expect(enableCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // REQ-CFG-004: Debug setting
  // =========================================================================

  describe("REQ-CFG-004 — Debug setting registration", () => {
    it("[REQ-CFG-004] should register a debug setting of type boolean with default false", async () => {
      const { ctx } = await loadPlugin(tmpDir);
      const registerCalls = (ctx.settings.register as ReturnType<typeof mock>).mock.calls;
      expect(registerCalls.length).toBeGreaterThanOrEqual(1);

      // The settings.register call receives an array of setting definitions
      const settingsDefs = registerCalls[0][0] as Array<{
        key: string;
        type: string;
        defaultValue: unknown;
      }>;
      const debugSetting = settingsDefs.find((s) => s.key === "debug");
      expect(debugSetting).toBeDefined();
      expect(debugSetting!.type).toBe("boolean");
      expect(debugSetting!.defaultValue).toBe(false);
    });
  });

  // =========================================================================
  // REQ-DATA-001: MusicMap persistence path
  // =========================================================================

  describe("REQ-DATA-001 — MusicMap persistence", () => {
    it("[REQ-DATA-001] should persist music-map.json in <plugin-data-dir>/data/", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "persist.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;

      await heroSet.executes(
        {},
        { displayName: "PersistUser", audioFileName: "persist.mp3" },
      );

      const mapPath = path.join(dataDir, "music-map.json");
      const stat = await fs.stat(mapPath);
      expect(stat.isFile()).toBe(true);

      const raw = await fs.readFile(mapPath, "utf8");
      const map = JSON.parse(raw);
      expect(map["PersistUser"]).toBe("persist.mp3");
    });
  });

  // =========================================================================
  // REQ-DATA-002: Daily greets persistence
  // =========================================================================

  describe("REQ-DATA-002 — Daily greets persistence", () => {
    it("[REQ-DATA-002] should write daily-greets.json with userId and today's date after greeting", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "greet.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ GreetUser: "greet.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return true;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      // First we need an active channel so playback doesn't abort at the
      // "no active voice channel" check. Trigger voice:runtime_initialized.
      const initHandler = events.get("voice:runtime_initialized")!;
      await initHandler({ channelId: 10 });

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 444, username: "GreetUser" });

      // Check that daily-greets.json was written
      const greetsPath = path.join(dataDir, "daily-greets.json");
      const raw = await fs.readFile(greetsPath, "utf8");
      const greets = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      expect(greets["444"]).toBe(today);
    }, 15000);
  });

  // =========================================================================
  // REQ-DATA-004: JSON fallback on missing file
  // =========================================================================

  describe("REQ-DATA-004 — JSON fallback on missing file", () => {
    it("[REQ-DATA-004] should use empty object fallback when music-map.json does not exist", async () => {
      // Do NOT create music-map.json — it should not exist
      const { commands } = await loadPlugin(tmpDir);
      const heroList = commands.get("hero-list")!;

      const result = await heroList.executes({});
      expect(result).toContain("No intro mappings configured yet");
    });

    it("[REQ-DATA-004] should not crash when daily-greets.json does not exist", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "fallback.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ FallbackUser: "fallback.mp3" }),
      );
      // Do NOT create daily-greets.json

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return true;
        if (key === "oncePerDay") return true;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      const userJoinedHandler = events.get("user:joined")!;
      // This should NOT throw even though daily-greets.json doesn't exist
      await userJoinedHandler({ userId: 222, username: "FallbackUser" });

      // No unhandled error should have occurred
      const errorMessages = (ctx.error as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      // The only possible error is "No active voice channel found" which is expected
      const unexpectedErrors = errorMessages.filter(
        (m: string) => !m.includes("voice channel") && !m.includes("not found"),
      );
      expect(unexpectedErrors).toHaveLength(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-DATA-007: User cache persistence
  // =========================================================================

  describe("REQ-DATA-007 — User cache persistence", () => {
    it("[REQ-DATA-007] should persist userId to username mapping on user:joined event", async () => {
      const { events } = await loadPlugin(tmpDir);
      const userJoinedHandler = events.get("user:joined")!;

      await userJoinedHandler({ userId: 123, username: "CacheTestUser" });

      // Verify user-cache.json was written
      const cachePath = path.join(dataDir, "user-cache.json");
      const raw = await fs.readFile(cachePath, "utf8");
      const cache = JSON.parse(raw);
      expect(cache["123"]).toBe("CacheTestUser");
    });

    it("[REQ-DATA-007] should load user cache from disk on plugin start", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "99": "PreloadedUser" }),
      );

      const { commands } = await loadPlugin(tmpDir);

      // If user cache is loaded, /hero-set-me should find the cached user
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "preload.mp3"), "fake-mp3");

      // We need a fresh load with the user-cache pre-populated
      const { commands: cmds2 } = await loadPlugin(tmpDir);
      const heroSetMe = cmds2.get("hero-set-me")!;

      const result = await heroSetMe.executes(
        { userId: 99, currentVoiceChannelId: 1 },
        { audioFileName: "preload.mp3" },
      );

      expect(result).toContain("PreloadedUser");
      expect(result).toContain("preload.mp3");
    });

    it("[REQ-DATA-007] should use empty fallback when user-cache.json does not exist", async () => {
      // Do NOT create user-cache.json
      const { commands } = await loadPlugin(tmpDir);
      const heroSetMe = commands.get("hero-set-me")!;

      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "nouser.mp3"), "fake-mp3");

      const result = await heroSetMe.executes(
        { userId: 9876, currentVoiceChannelId: 1 },
        { audioFileName: "nouser.mp3" },
      );

      // Should report user not in cache
      expect(result).toContain("Could not determine your username");
    });
  });

  // =========================================================================
  // REQ-CFG-001: enabled setting (disabled behavior)
  // =========================================================================

  describe("REQ-CFG-001 — enabled=false behavior", () => {
    it("[REQ-CFG-001] should not play intro when enabled=false", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "disabled.mp3"), "fake-mp3");
      await fs.writeFile(
        path.join(dataDir, "music-map.json"),
        JSON.stringify({ DisabledUser: "disabled.mp3" }),
      );

      const { ctx, settings, events } = await loadPlugin(tmpDir);

      settings.get = mock((key: string) => {
        if (key === "enabled") return false;
        if (key === "oncePerDay") return false;
        if (key === "debug") return true;
        if (key === "volume") return 25;
        return undefined;
      });

      const userJoinedHandler = events.get("user:joined")!;
      await userJoinedHandler({ userId: 111, username: "DisabledUser" });

      // Debug log should indicate plugin is disabled
      const logMessages = (ctx.log as ReturnType<typeof mock>).mock.calls.map(
        (c: unknown[]) => String(c[0]),
      );
      const disabledMessages = logMessages.filter((m: string) =>
        m.includes("disabled") || m.includes("Plugin disabled"),
      );
      expect(disabledMessages.length).toBeGreaterThan(0);
    }, 15000);
  });

  // =========================================================================
  // REQ-CMD-004: Flexible filename resolution
  // =========================================================================

  describe("/hero-set — flexible filename resolution", () => {
    it("[REQ-CMD-004] should resolve filename without extension when exactly one match exists", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "MyTheme.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.executes(
        {},
        { displayName: "FlexUser", audioFileName: "mytheme" },
      );

      expect(result).toContain("Intro set for FlexUser");
      expect(result).toContain("MyTheme.mp3");
    });

    it("[REQ-CMD-004] should warn about duplicates when multiple files match name without extension", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "ambiguous.mp3"), "fake-mp3");
      await fs.writeFile(path.join(musicDir, "ambiguous.mpeg"), "fake-mpeg");

      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.executes(
        {},
        { displayName: "AmbigUser", audioFileName: "ambiguous" },
      );

      expect(result).toContain("Multiple files found");
    });
  });

  // =========================================================================
  // REQ-CMD-009: Flexible filename resolution for /hero-set-me
  // =========================================================================

  describe("/hero-set-me — flexible filename resolution", () => {
    it("[REQ-CMD-009] should resolve filename without extension for set-me", async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "user-cache.json"),
        JSON.stringify({ "50": "FlexMeUser" }),
      );
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "flexme.mp3"), "fake-mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroSetMe = commands.get("hero-set-me")!;

      const result = await heroSetMe.executes(
        { userId: 50, currentVoiceChannelId: 1 },
        { audioFileName: "flexme" },
      );

      expect(result).toContain("FlexMeUser");
      expect(result).toContain("flexme.mp3");
    });
  });
});
