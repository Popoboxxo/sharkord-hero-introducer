import type { BunPlugin } from "bun";
import fs from "fs/promises";

const pluginId = "sharkord-hero-introducer";
const outdir = `dist/${pluginId}`;

type PackageJson = {
  name?: string;
  version?: string;
  sharkord?: {
    author?: string;
    homepage?: string;
    description?: string;
    logo?: string;
  };
};

const clientGlobals: BunPlugin = {
  name: "client-globals",
  setup(build) {
    const globals: Record<string, string> = {
      react: "window.__SHARKORD_REACT__",
      "react/jsx-runtime": "window.__SHARKORD_REACT_JSX__",
      "react/jsx-dev-runtime": "window.__SHARKORD_REACT_JSX_DEV__",
      "react-dom": "window.__SHARKORD_REACT_DOM__",
      "react-dom/client": "window.__SHARKORD_REACT_DOM_CLIENT__",
    };

    for (const [mod, global] of Object.entries(globals)) {
      build.onResolve(
        { filter: new RegExp(`^${mod.replace("/", "\\/")}$`) },
        () => ({
          path: mod,
          namespace: "client-global",
        }),
      );

      build.onLoad(
        {
          filter: new RegExp(`^${mod.replace("/", "\\/")}$`),
          namespace: "client-global",
        },
        () => ({
          contents: `module.exports = ${global};`,
          loader: "js",
        }),
      );
    }
  },
};

await Promise.all([
  Bun.build({
    entrypoints: ["src/server.ts"],
    outdir,
    target: "bun",
    minify: true,
    format: "esm",
    external: ["mediasoup"],
  }),

  Bun.build({
    entrypoints: ["src/client.ts"],
    outdir,
    target: "browser",
    minify: true,
    format: "esm",
    plugins: [clientGlobals],
  }),
]);

await fs.mkdir(`${outdir}/server`, { recursive: true });
await fs.mkdir(`${outdir}/client`, { recursive: true });
await fs.copyFile(`${outdir}/server.js`, `${outdir}/server/index.js`);
await fs.copyFile(`${outdir}/client.js`, `${outdir}/client/index.js`);

const packageJsonRaw = await fs.readFile("package.json", "utf-8");
const packageJson = JSON.parse(packageJsonRaw) as PackageJson;

const manifest = {
  id: pluginId,
  name: packageJson.name ?? pluginId,
  author: packageJson.sharkord?.author ?? "Unknown",
  description:
    packageJson.sharkord?.description ??
    "Sharkord hero intro plugin.",
  sdkVersion: 1,
  version: packageJson.version ?? "0.0.0",
  ...(packageJson.sharkord?.homepage
    ? { homepage: packageJson.sharkord.homepage }
    : {}),
};

await fs.copyFile("package.json", `${outdir}/package.json`);
await fs.writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
await fs.copyFile("logo.png", `${outdir}/logo.png`);
