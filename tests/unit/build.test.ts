import { describe, it, expect, beforeAll } from "bun:test";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Build verification tests
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dir, "../..");
const DIST = path.join(ROOT, "dist", "sharkord-hero-introducer");

describe("Build", () => {
  // Run the build once before all tests in this suite
  beforeAll(async () => {
    const proc = Bun.spawn(["bun", "build.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Build failed (exit ${exitCode}): ${stderr}`);
    }
  });

  it("[REQ-LIFE-003] should produce server.js in dist", async () => {
    const stat = await fs.stat(path.join(DIST, "server.js"));
    expect(stat.isFile()).toBe(true);
  });

  it("[REQ-LIFE-003] should produce client.js in dist", async () => {
    const stat = await fs.stat(path.join(DIST, "client.js"));
    expect(stat.isFile()).toBe(true);
  });

  it("[REQ-LIFE-003] should copy package.json into dist", async () => {
    const raw = await fs.readFile(path.join(DIST, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    expect(pkg.name).toBe("sharkord-hero-introducer");
  });

  it("[REQ-LIFE-003] should produce valid ESM in server.js", async () => {
    const content = await fs.readFile(path.join(DIST, "server.js"), "utf8");
    // The build targets ESM format — check for export marker
    expect(content).toContain("export");
  });
});
