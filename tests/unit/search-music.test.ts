import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createMockPluginContext,
} from "../helpers/mock-plugin-context";
import { mock } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// /hero-search-music — REQ-CMD-017
// ---------------------------------------------------------------------------
// REQ-CMD-017 is marked "Open" in REQUIREMENTS.md but the command is already
// implemented in server.ts. Tests are written against the actual output format
// produced by the implementation and verify all specified acceptance criteria.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: create a test SQLite DB that mimics the Sharkord server DB schema
// ---------------------------------------------------------------------------

interface TestFileEntry {
  id: number;
  name: string;
  original_name: string;
  mime_type: string;
  extension: string;
}

function createTestDb(
  dbPath: string,
  files: TestFileEntry[],
): void {
  const db = new Database(dbPath);
  db.run(
    `CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      name TEXT,
      original_name TEXT,
      mime_type TEXT,
      extension TEXT,
      user_id INTEGER,
      size INTEGER,
      md5 TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )`,
  );
  db.run(`CREATE TABLE message_files (message_id INTEGER, file_id INTEGER, created_at INTEGER, updated_at INTEGER)`);
  for (const f of files) {
    db.run(
      `INSERT INTO files VALUES (?, ?, ?, ?, ?, 1, 1000, 'abc', 1, NULL)`,
      [f.id, f.name, f.original_name, f.mime_type, f.extension],
    );
    db.run(`INSERT INTO message_files VALUES (1, ?, 1, NULL)`, [f.id]);
  }
  db.close();
}

// ---------------------------------------------------------------------------
// Helper: load plugin and extract registered commands
// ---------------------------------------------------------------------------

interface CommandDefinition {
  name: string;
  description: string;
  args: unknown[];
  execute: (...args: unknown[]) => Promise<string>;
}

async function loadPlugin(tmpDir: string) {
  const { ctx, settings } = createMockPluginContext({ path: tmpDir });
  const { onLoad } = await import("../../src/server");
  await (onLoad as Function)(ctx);

  const commands = new Map<string, CommandDefinition>();
  for (const call of (ctx.commands.register as ReturnType<typeof mock>).mock
    .calls) {
    const cmdDef = call[0] as CommandDefinition;
    commands.set(cmdDef.name, cmdDef);
  }

  return { ctx, settings, commands };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("/hero-search-music (REQ-CMD-017)", () => {
  let tmpDir: string;
  let musicDir: string;
  let publicDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `hero-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // The plugin is at <pluginDir>; DB is at <pluginDir>/../../db.sqlite
    // so we need to create the structure: tmpDir/plugins/hero/  (3 levels)
    // and place db.sqlite at tmpDir/db.sqlite
    // Simplest: tmpDir IS the plugin dir, DB is at tmpDir/../../db.sqlite
    // We achieve this by putting the plugin 2 levels deep:
    //   tmpRoot/a/b  => tmpDir = tmpRoot/a/b
    //   DB at tmpRoot/db.sqlite
    const tmpRoot = path.join(
      os.tmpdir(),
      `hero-search-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDir = path.join(tmpRoot, "plugins", "sharkord-hero-introducer");
    musicDir = path.join(tmpDir, "music");
    publicDir = path.join(tmpRoot, "public");
    dbPath = path.join(tmpRoot, "db.sqlite");

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.mkdir(musicDir, { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
  });

  afterEach(async () => {
    // Resolve the root (2 levels up from tmpDir)
    const tmpRoot = path.resolve(tmpDir, "../..");
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-A — Normal case: 2 audio files in DB → both copied
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-A] should copy all audio files from DB and report Copied: 2", async () => {
    // Place source files in public/
    await fs.writeFile(path.join(publicDir, "file-hash-1"), "audio-data-1");
    await fs.writeFile(path.join(publicDir, "file-hash-2"), "audio-data-2");

    createTestDb(dbPath, [
      {
        id: 1,
        name: "file-hash-1",
        original_name:"song1.mp3",
        mime_type:"audio/mpeg",
        extension: ".mp3",
      },
      {
        id: 2,
        name: "file-hash-2",
        original_name:"song2.mp3",
        mime_type:"audio/mpeg",
        extension: ".mp3",
      },
    ]);

    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    const result = await searchCmd!.execute({}, {});

    // The summary line uses the format "Found: N audio file(s) in chat attachments"
    expect(result).toContain("Found: 2 audio file(s) in chat attachments");
    expect(result).toContain("Copied: 2");
    // Verify files were actually copied
    const dest1 = await fs.stat(path.join(musicDir, "song1.mp3"));
    const dest2 = await fs.stat(path.join(musicDir, "song2.mp3"));
    expect(dest1.isFile()).toBe(true);
    expect(dest2.isFile()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-B — Empty DB: no message_files → Found: 0
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-B] should report Found: 0 when DB has no audio files", async () => {
    // Create DB with empty tables
    const db = new Database(dbPath);
    db.run(
      `CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        name TEXT,
        original_name TEXT,
        mime_type TEXT,
        extension TEXT,
        user_id INTEGER,
        size INTEGER,
        md5 TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`,
    );
    db.run(`CREATE TABLE message_files (message_id INTEGER, file_id INTEGER, created_at INTEGER, updated_at INTEGER)`);
    db.close();

    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    const result = await searchCmd!.execute({}, {});

    expect(result).toContain("Found: 0 audio file(s) in chat attachments");
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-C — Name conflict: file already exists in musicDir → Skipped: 1
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-C] should skip files that already exist in musicDir and report Skipped: 1", async () => {
    // Pre-create the destination file
    await fs.writeFile(path.join(musicDir, "existing.mp3"), "already-here");
    // Also place source in public/
    await fs.writeFile(path.join(publicDir, "file-hash-3"), "new-audio-data");

    createTestDb(dbPath, [
      {
        id: 3,
        name: "file-hash-3",
        original_name:"existing.mp3",
        mime_type:"audio/mpeg",
        extension: ".mp3",
      },
    ]);

    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    const result = await searchCmd!.execute({}, {});

    // The summary uses "Skipped (already exists): N"
    expect(result).toContain("Skipped (already exists): 1");
    // The original content must not have been overwritten
    const content = await fs.readFile(path.join(musicDir, "existing.mp3"), "utf8");
    expect(content).toBe("already-here");
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-D — DB error: path does not exist → error message, no crash
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-D] should return an error message when DB file does not exist", async () => {
    // Do NOT create the DB file — it simply doesn't exist
    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    // Must not throw; must return a string with an error description
    let result: string;
    expect(async () => {
      result = await searchCmd!.execute({}, {});
    }).not.toThrow();

    result = await searchCmd!.execute({}, {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should mention the error or the path
    const lower = result.toLowerCase();
    expect(
      lower.includes("error") ||
      lower.includes("not found") ||
      lower.includes("failed") ||
      lower.includes("unable") ||
      lower.includes("db") ||
      lower.includes("database") ||
      lower.includes("sqlite"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-E — MIME filter: only audio files copied, images ignored
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-E] should only copy audio files and ignore non-audio entries", async () => {
    await fs.writeFile(path.join(publicDir, "audio-hash"), "audio-data");
    await fs.writeFile(path.join(publicDir, "image-hash"), "image-data");

    createTestDb(dbPath, [
      {
        id: 10,
        name: "audio-hash",
        original_name:"intro.mp3",
        mime_type:"audio/mpeg",
        extension: ".mp3",
      },
      {
        id: 11,
        name: "image-hash",
        original_name:"photo.jpg",
        mime_type:"image/jpeg",
        extension: ".jpg",
      },
    ]);

    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    const result = await searchCmd!.execute({}, {});

    // Only the audio file counts
    expect(result).toContain("Found: 1 audio file(s) in chat attachments");
    expect(result).toContain("Copied: 1");

    // Audio file must exist
    const audioStat = await fs.stat(path.join(musicDir, "intro.mp3"));
    expect(audioStat.isFile()).toBe(true);

    // Image file must NOT have been copied
    let imageExists = false;
    try {
      await fs.stat(path.join(musicDir, "photo.jpg"));
      imageExists = true;
    } catch {
      imageExists = false;
    }
    expect(imageExists).toBe(false);
  });

  // -------------------------------------------------------------------------
  // REQ-CMD-017-F — No voice channel required: command succeeds without one
  // -------------------------------------------------------------------------

  it("[REQ-CMD-017-F] should execute without error when invokerCtx has no currentVoiceChannelId", async () => {
    // Minimal DB with one audio file
    await fs.writeFile(path.join(publicDir, "audio-nvc"), "audio-data-nvc");
    createTestDb(dbPath, [
      {
        id: 20,
        name: "audio-nvc",
        original_name:"novoice.mp3",
        mime_type:"audio/mpeg",
        extension: ".mp3",
      },
    ]);

    const { commands } = await loadPlugin(tmpDir);
    const searchCmd = commands.get("hero-search-music");
    expect(searchCmd).toBeDefined();

    // invokerCtx without currentVoiceChannelId (undefined / not set)
    const invokerCtx = { userId: 1 }; // no currentVoiceChannelId

    let result: string;
    expect(async () => {
      result = await searchCmd!.execute(invokerCtx, {});
    }).not.toThrow();

    result = await searchCmd!.execute(invokerCtx, {});
    expect(typeof result).toBe("string");
    // Must not contain a "voice channel" error
    expect(result.toLowerCase()).not.toContain("voice channel");
  });
});
