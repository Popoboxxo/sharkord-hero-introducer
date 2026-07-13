import type { PluginState } from "../types";
import { writeJsonFile } from "../utils/json-io";

export function registerUserEvents(state: PluginState): void {
  const { ctx, userNameCache, userCacheFile, debugLog } = state;

  ctx.events.on("user:joined", async (payload: Record<string, unknown>) => {
    const userId = payload.userId as number;
    const username = payload.username as string;

    debugLog(`>>> user:joined event — userId=${userId}, username="${username}" (server login)`);

    try {
      userNameCache.set(userId, username);
      const cacheObj = Object.fromEntries(userNameCache);
      await writeJsonFile(userCacheFile, cacheObj);
      debugLog(`User cache updated: userId=${userId} → "${username}" (total cached: ${userNameCache.size})`);
    } catch (err) {
      ctx.error(`user:joined handler failed for userId=${userId}: ${String(err)}`);
    }
  });
}
