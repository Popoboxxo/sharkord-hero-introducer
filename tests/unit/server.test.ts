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
    it("[REQ-CMD-004] should reject non-.mp3 file names", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.executes(
        {},
        { displayName: "TestUser", mp3FileName: "intro.wav" },
      );
      expect(result).toContain("Only MP3 files are supported");
    });

    it("[REQ-CMD-004] should reject files that do not exist in the music directory", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroSet = commands.get("hero-set")!;
      const result = await heroSet.executes(
        {},
        { displayName: "TestUser", mp3FileName: "missing.mp3" },
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
        { displayName: "TestUser", mp3FileName: "intro.mp3" },
      );

      expect(result).toContain("Intro set for TestUser");
      expect(result).toContain("intro.mp3");

      // Verify persistence
      const raw = await fs.readFile(path.join(dataDir, "music-map.json"), "utf8");
      const map = JSON.parse(raw);
      expect(map["TestUser"]).toBe("intro.mp3");
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
    it("[REQ-CMD-007] should list .mp3 files from the music directory", async () => {
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(path.join(musicDir, "intro.mp3"), "fake");
      await fs.writeFile(path.join(musicDir, "theme.mp3"), "fake");
      await fs.writeFile(path.join(musicDir, "readme.txt"), "not an mp3");

      const { commands } = await loadPlugin(tmpDir);
      const heroFiles = commands.get("hero-files")!;
      const result = await heroFiles.executes({});

      expect(result).toContain("intro.mp3");
      expect(result).toContain("theme.mp3");
      expect(result).not.toContain("readme.txt");
    });

    it("[REQ-CMD-007] should return info when no .mp3 files exist", async () => {
      const { commands } = await loadPlugin(tmpDir);
      const heroFiles = commands.get("hero-files")!;
      const result = await heroFiles.executes({});
      expect(result).toContain("No MP3 files found");
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
});
