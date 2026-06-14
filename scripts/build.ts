#!/usr/bin/env bun
/**
 * Native Sharkord v0.0.22 build — sharkord-hero-introducer.
 *
 * Emits: dist/<id>/server/index.js (from src/server.ts), client/index.js,
 * manifest.json, logo.png, bin/.
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import { buildClient } from "../src/ui/kit/build-client";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const PLUGIN_NAME: string = pkg.name;
const OUTDIR = `dist/${PLUGIN_NAME}`;

const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/.+/.test(s);

async function main() {
  if (existsSync("dist")) await Bun.$`rm -rf dist`;
  mkdirSync(join(OUTDIR, "server"), { recursive: true });

  const server = await Bun.build({
    entrypoints: ["src/server.ts"],
    outdir: join(OUTDIR, "server"),
    target: "bun",
    format: "esm",
    minify: true,
    naming: "index.[ext]",
  });
  if (!server.success) {
    console.error("Server build failed:", server.logs);
    process.exit(1);
  }
  console.log(`✓ server bundle: ${OUTDIR}/server/index.js`);

  await buildClient({ entry: "src/client/index.tsx", outdir: OUTDIR });

  const sk = pkg.sharkord ?? {};
  const manifest: Record<string, unknown> = {
    id: PLUGIN_NAME,
    name: sk.name || "Hero Introducer",
    author: sk.author || "Unknown",
    description: (sk.description || pkg.description || PLUGIN_NAME).trim(),
    sdkVersion: 1,
    version: pkg.version,
  };
  if (isUrl(sk.homepage || pkg.homepage)) manifest.homepage = sk.homepage || pkg.homepage;
  if (isUrl(sk.logo)) manifest.logo = sk.logo;
  writeFileSync(join(OUTDIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest.json (v${manifest.version}, sdk=1)`);

  if (existsSync("logo.png")) copyFileSync("logo.png", join(OUTDIR, "logo.png"));
  mkdirSync(join(OUTDIR, "bin"), { recursive: true });

  console.log(`\n✓ Native v0.0.22 build complete: ${OUTDIR}/`);
}

main();
