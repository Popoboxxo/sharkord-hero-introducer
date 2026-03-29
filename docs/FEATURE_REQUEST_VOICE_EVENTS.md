# Feature Request: Voice Channel Join/Leave Events for Plugin SDK

## Status (29.03.2026)

Erfuellt in Sharkord `0.0.16`: Das Plugin nutzt jetzt `voice:user_joined` und `voice:user_left` fuer den Voice-Event-Flow.

## Historisches Problem

The Plugin SDK does not expose events when users join or leave a voice channel. The only available user event is `user:joined`, which fires when a user **logs into the server** — not when they enter a voice channel. There is also no API to query which users are currently in a voice channel.

This makes it impossible for plugins to react to voice channel activity. For example, a plugin that plays a personal intro when a user joins a voice channel cannot know *when* or *which channel* the user joined, causing it to either never play or play in the wrong (possibly empty) channel.

## Proposed Solution

**1. Expose `voice:user_joined` and `voice:user_left` events on the plugin EventBus:**

```typescript
ctx.events.on("voice:user_joined", (payload) => {
  // payload: { channelId: number, userId: number, username: string }
});

ctx.events.on("voice:user_left", (payload) => {
  // payload: { channelId: number, userId: number }
});
```

The internal PubSub events `userJoinVoice` and `userLeaveVoice` already exist and carry exactly this data — they just need to be forwarded to the plugin EventBus.

**2. Add a voice state query to `ctx.actions.voice`:**

```typescript
ctx.actions.voice.getUserVoiceChannel(userId: number): number | undefined
// Returns the channelId the user is currently in, or undefined if not in voice
```

`VoiceRuntime.findRuntimeByUserId()` already implements this internally and just needs to be exposed.
