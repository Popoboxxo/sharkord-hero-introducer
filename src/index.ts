import { PluginConfig, PluginContext } from "@sharkord/plugin-sdk";
import { onLoad, onUnload } from "./server";
import pkg from "../package.json" with { type: "json" };

export default function plugin(context: PluginContext): PluginConfig {
  context.log(`🔌 sharkord-hero-introducer loaded`);

  return {
    name: "sharkord-hero-introducer",
    version: pkg.version,
    onLoad() {
      return onLoad(context);
    },
    onUnload() {
      return onUnload(context);
    },
  };
}
