import { PluginConfig, PluginContext } from "@sharkord/plugin-sdk";
import { onLoad, onUnload } from "./server";

export default function plugin(context: PluginContext): PluginConfig {
  context.log(`🔌 sharkord-hero-introducer loaded`);

  return {
    name: "sharkord-hero-introducer",
    version: "0.1.2-alpha.3",
    onLoad() {
      return onLoad(context);
    },
    onUnload() {
      return onUnload(context);
    },
  };
}
