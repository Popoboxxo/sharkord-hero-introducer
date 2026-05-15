import type { PluginState, QueueEntry } from "../types";
import { playAudioAndWait } from "./playback";

export function enqueuePlayback(state: PluginState, entry: QueueEntry): void {
  let queue = state.playbackQueues.get(entry.channelId);
  if (!queue) {
    queue = [];
    state.playbackQueues.set(entry.channelId, queue);
  }
  queue.push(entry);
  state.debugLog(`Queue: enqueued "${entry.label}" for channel ${entry.channelId} (queue length: ${queue.length})`);
  processQueue(state, entry.channelId);
}

export async function processQueue(state: PluginState, channelId: number): Promise<void> {
  if (state.queueProcessing.has(channelId)) return;
  const queue = state.playbackQueues.get(channelId);
  if (!queue || queue.length === 0) return;

  state.queueProcessing.add(channelId);

  while (queue.length > 0) {
    const entry = queue.shift()!;
    state.debugLog(`Queue: playing "${entry.label}" in channel ${channelId} (${queue.length} remaining)`);
    try {
      await playAudioAndWait(state, entry.channelId, entry.userId, entry.label, entry.mp3Path);
    } catch (err) {
      state.ctx.error(`Queue: playback failed for "${entry.label}": ${String(err)}`);
    }
  }

  state.queueProcessing.delete(channelId);
  state.playbackQueues.delete(channelId);
  state.debugLog(`Queue: channel ${channelId} queue empty`);
}
