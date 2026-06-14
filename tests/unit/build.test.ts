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
    const proc = Bun.spawn(["bun", "scripts/build.ts"], {
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

  it("[REQ-LIFE-003] should produce server/index.js in dist (v0.0.22 native)", async () => {
    const stat = await fs.stat(path.join(DIST, "server", "index.js"));
    expect(stat.isFile()).toBe(true);
  });

  it("[REQ-LIFE-003] should produce client/index.js in dist (v0.0.22 native)", async () => {
    const stat = await fs.stat(path.join(DIST, "client", "index.js"));
    expect(stat.isFile()).toBe(true);
  });

  it("[REQ-LIFE-003] should produce a valid manifest.json (sdkVersion 1)", async () => {
    const raw = await fs.readFile(path.join(DIST, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.id).toBe("sharkord-hero-introducer");
    expect(manifest.sdkVersion).toBe(1);
  });

  it("[REQ-LIFE-003] should export onLoad/onUnload as ESM from server/index.js", async () => {
    const content = await fs.readFile(path.join(DIST, "server", "index.js"), "utf8");
    expect(content).toContain("export");
    expect(content).toMatch(/onLoad/);
  });

  it("[REQ-LIFE-003] should export components from client/index.js", async () => {
    const content = await fs.readFile(path.join(DIST, "client", "index.js"), "utf8");
    expect(content).toContain("components");
  });
});
