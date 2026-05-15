import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";

export function registerHeroDebugCommand(state: PluginState): void {
  const { ctx, debugLog } = state;

  ctx.commands.register<{ testArg: string }>({
    name: "hero-dump-context",
    description: "(Debug) Dump the invoker context and args to the log.",
    args: [
      { name: "testArg", type: "string", description: "A test argument to see how args are passed.", required: false, sensitive: false },
    ],
    async execute(...params: unknown[]) {
      debugLog(`/hero-dump-context called`);
      const dump = params.map((p, i) => `param[${i}]: ${JSON.stringify(p, null, 2)}`).join("\n\n");
      ctx.log(`[DEBUG] Command params (${params.length} total):\n${dump}`);
      return `Context dump:\n\`\`\`json\n${dump}\n\`\`\``;
    },
  });
}
