import type { PluginContext, TInvokerContext } from "@sharkord/plugin-sdk";
import { Database } from "bun:sqlite";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Maps displayName (string) → audioFileName (string, .mp3 or .mpeg) in the music directory. */
type MusicMap = Record<string, string>;

/** Maps userId (string) → ISO date string "YYYY-MM-DD" of the last greeting. */
type DailyGreets = Record<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Supported audio file extensions for intro music. */
const SUPPORTED_EXTENSIONS = [".mp3", ".mpeg"];
const INTRO_DELAY_MS = Number(process.env.HERO_INTRO_DELAY_MS ?? "5000");

function isSupportedAudioFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Plugin load entry point
// ---------------------------------------------------------------------------

const onLoad = async (ctx: PluginContext) => {
  ctx.log("Hero Introducer loaded");

  // Persistent data paths (inside the plugin's own data directory)
  const dataDir = path.join(ctx.path, "data");
  const musicDir = path.join(ctx.path, "music");
  const musicMapFile = path.join(dataDir, "music-map.json");
  const dailyGreetsFile = path.join(dataDir, "daily-greets.json");
  const userCacheFile = path.join(dataDir, "user-cache.json");

  // Ensure data and music directories exist
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(musicDir, { recursive: true });

  // Resolve ffmpeg binary: prefer bundled bin/ inside plugin dir, fall back to $PATH
  const ffmpegBin = path.join(ctx.path, "bin", "ffmpeg");
  const ffmpegCmd = await fs.access(ffmpegBin).then(() => ffmpegBin).catch(() => "ffmpeg");

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const settings = await ctx.settings.register([
    {
      key: "oncePerDay",
      name: "Greet only once per day",
      description:
        "When enabled each user is greeted at most once per calendar day.",
      type: "boolean",
      defaultValue: true,
    },
    {
      key: "debug",
      name: "Debug mode",
      description:
        "When enabled, detailed debug information is logged (user joins, mapping lookups, playback steps).",
      type: "boolean",
      defaultValue: false,
    },
    {
      key: "volume",
      name: "Playback volume",
      description:
        "Volume for intro music playback (0–100%). Applied server-side via ffmpeg.",
      type: "number",
      defaultValue: 25,
    },
  ] as const);

  /** Logs a message only when the debug setting is enabled. */
  function debugLog(message: string): void {
    if (settings.get("debug")) {
      ctx.log(`[DEBUG] ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Audio file resolution (flexible: with/without extension, case-insensitive)
  // ---------------------------------------------------------------------------

  type ResolveResult =
    | { ok: true; fileName: string }
    | { ok: false; message: string };

  /**
   * Resolves an audio file name in the music directory.
   * Accepts input with or without file extension, case-insensitive.
   * Returns the actual filename on disk or an error message.
   */
  async function resolveAudioFile(input: string): Promise<ResolveResult> {
    let allFiles: string[];
    try {
      const dirEntries = await fs.readdir(musicDir);
      allFiles = dirEntries.filter((f) => isSupportedAudioFile(f));
    } catch {
      allFiles = [];
    }

    if (allFiles.length === 0) {
      return { ok: false, message: "No audio files found in the music directory." };
    }

    const hasExtension = isSupportedAudioFile(input);

    if (hasExtension) {
      // Exact match (case-insensitive)
      const match = allFiles.find(
        (f) => f.toLowerCase() === input.toLowerCase(),
      );
      if (match) {
        return { ok: true, fileName: match };
      }
      return {
        ok: false,
        message: `File not found: ${input}\n\nAvailable files:\n${allFiles.map((f) => `• ${f}`).join("\n")}`,
      };
    }

    // Match by base name without extension (case-insensitive)
    const lowerInput = input.toLowerCase();
    const matches = allFiles.filter((f) => {
      const nameWithoutExt = f.substring(0, f.lastIndexOf(".")).toLowerCase();
      return nameWithoutExt === lowerInput;
    });

    if (matches.length === 0) {
      return {
        ok: false,
        message: `No file found matching "${input}".\n\nAvailable files:\n${allFiles.map((f) => `• ${f}`).join("\n")}`,
      };
    }

    if (matches.length > 1) {
      return {
        ok: false,
        message: `Multiple files found matching "${input}":\n${matches.map((f) => `• ${f}`).join("\n")}\n\nPlease specify the full filename with extension.`,
      };
    }

    return { ok: true, fileName: matches[0] };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Currently running playback sessions keyed by `channelId-userId`. */
  interface PlaybackSession {
    ffmpeg: { kill(signal?: number): void };
    cleanup: () => void;
    done: Promise<void>;
  }
  const activeSessions = new Map<string, PlaybackSession>();

  /** Set of currently active voice channel IDs. */
  const activeChannels = new Set<number>();

  type VoiceChannelGuardResult =
    | { ok: true; channelId: number }
    | { ok: false; message: string };

  function requireActiveVoiceChannel(invokerCtx: TInvokerContext): VoiceChannelGuardResult {
    const channelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;
    if (!channelId) {
      return { ok: false, message: "You must be in a voice channel to use this command." };
    }
    if (!activeChannels.has(channelId)) {
      return { ok: false, message: "Voice channel is not active." };
    }
    return { ok: true, channelId };
  }

  // ---------------------------------------------------------------------------
  // Playback queue — ensures songs play sequentially per channel
  // ---------------------------------------------------------------------------

  interface QueueEntry {
    channelId: number;
    userId: number;
    label: string;
    mp3Path: string;
  }

  /** Per-channel playback queue. */
  const playbackQueues = new Map<number, QueueEntry[]>();
  /** Whether a channel is currently processing its queue. */
  const queueProcessing = new Set<number>();

  /** Enqueue a playback request and start processing if not already running. */
  function enqueuePlayback(entry: QueueEntry): void {
    let queue = playbackQueues.get(entry.channelId);
    if (!queue) {
      queue = [];
      playbackQueues.set(entry.channelId, queue);
    }
    queue.push(entry);
    debugLog(`Queue: enqueued "${entry.label}" for channel ${entry.channelId} (queue length: ${queue.length})`);
    processQueue(entry.channelId);
  }

  /** Process the next item in a channel's queue. */
  async function processQueue(channelId: number): Promise<void> {
    if (queueProcessing.has(channelId)) return; // already processing
    const queue = playbackQueues.get(channelId);
    if (!queue || queue.length === 0) return;

    queueProcessing.add(channelId);

    while (queue.length > 0) {
      const entry = queue.shift()!;
      debugLog(`Queue: playing "${entry.label}" in channel ${channelId} (${queue.length} remaining)`);
      try {
        await playAudioAndWait(channelId, entry.userId, entry.label, entry.mp3Path);
      } catch (err) {
        ctx.error(`Queue: playback failed for "${entry.label}": ${String(err)}`);
      }
    }

    queueProcessing.delete(channelId);
    playbackQueues.delete(channelId);
    debugLog(`Queue: channel ${channelId} queue empty`);
  }

  /** Cache of userId → username, persisted to disk, populated from user:joined events. */
  const userCacheData = await readJsonFile<Record<string, string>>(userCacheFile, {});
  const userNameCache = new Map<number, string>(
    Object.entries(userCacheData).map(([id, name]) => [Number(id), name]),
  );
  ctx.log(`User cache loaded: ${userNameCache.size} entries`);

  // ---------------------------------------------------------------------------
  // On-demand audio playback
  // ---------------------------------------------------------------------------
  // Creates a PlainTransport + Producer + Stream, waits for the client to
  // create a consumer via onNewProducer, then spawns ffmpeg. Cleans up
  // everything after playback finishes — the bot does NOT stay in the channel.

  interface VoiceActionsLike {
    getRouter(channelId: number): {
      createPlainTransport(params: unknown): Promise<{
        tuple: { localPort: number };
        produce(params: unknown): Promise<{
          id: string;
          on(event: string, handler: (payload: unknown) => void): void;
          getStats(): Promise<unknown>;
          close(): void;
        }>;
        close(): void;
      }>;
    };
    getListenInfo(): Promise<{ ip: string; announcedAddress: string }>;
    createStream(params: {
      key: string;
      channelId: number;
      title: string;
      avatarUrl: string;
      producers: { audio: unknown };
    }): { remove(): void };
  }

  function resolveVoiceActions(runtimeCtx?: TInvokerContext): VoiceActionsLike {
    // SDK 0.0.16: voice actions live at ctx.voice (not ctx.actions.voice)
    const fromRuntime = (runtimeCtx as { voice?: unknown } | undefined)?.voice;
    const fromPluginCtx = (ctx as unknown as { voice?: unknown }).voice;
    const candidate = (fromRuntime ?? fromPluginCtx) as Partial<VoiceActionsLike> | undefined;

    if (
      !candidate
      || typeof candidate.getRouter !== "function"
      || typeof candidate.getListenInfo !== "function"
      || typeof candidate.createStream !== "function"
    ) {
      throw new Error("Voice actions are unavailable in this command/event context.");
    }

    return candidate as VoiceActionsLike;
  }

  async function playAudio(
    channelId: number,
    userId: number,
    label: string,
    mp3Path: string,
    runtimeCtx?: TInvokerContext,
  ): Promise<void> {
    const procKey = `${channelId}-${userId}`;
    debugLog(`playAudio: channelId=${channelId}, userId=${userId}, label="${label}", path="${mp3Path}", activeSessions=${activeSessions.size}, activeChannels=[${[...activeChannels].join(", ")}]`);

    const voiceActions = resolveVoiceActions(runtimeCtx);

    // Stop any existing playback for this user in this channel
    const existing = activeSessions.get(procKey);
    if (existing) {
      debugLog(`Stopping existing playback for ${procKey}`);
      existing.ffmpeg.kill();
      existing.cleanup();
      activeSessions.delete(procKey);
    }

    // 1. Create transport + producer (matching sharkord-music-bot exactly)
    const router = voiceActions.getRouter(channelId);
    const listenInfo = await voiceActions.getListenInfo();
    debugLog(`listenInfo: ip=${listenInfo.ip}, announcedAddress=${listenInfo.announcedAddress}`);

    const transport = await router.createPlainTransport({
      listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
      rtcpMux: true,
      comedia: true,
      enableSrtp: false,
    });

    const ssrc = Math.floor(Math.random() * 1e9);

    // Match sharkord-music-bot exactly: hardcoded payloadType 111, empty parameters
    const producer = await transport.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [{
          mimeType: "audio/opus",
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: {},
          rtcpFeedback: [],
        }],
        encodings: [{ ssrc }],
      },
    });

    const rtpPort = transport.tuple.localPort;
    debugLog(`Transport created — port=${rtpPort}, SSRC=${ssrc}, producerId=${producer.id}`);

    // 2. Spawn ffmpeg via Bun.spawn (matching working reference exactly)
    // Use the raw listenInfo.ip as RTP target — the working music-bot sends to 0.0.0.0 directly
    const rtpTargetHost = listenInfo.ip;

    // Volume: setting is 0-100, ffmpeg volume filter uses decimal (0.0-1.0)
    const volumePercent = settings.get("volume") as number;
    const volumeDecimal = Math.max(0, Math.min(100, volumePercent)) / 100;
    debugLog(`Spawning ffmpeg → rtp://${rtpTargetHost}:${rtpPort} (SSRC=${ssrc}, volume=${volumePercent}%/${volumeDecimal})`);

    // ffmpeg args matching sharkord-music-bot exactly
    const ffmpegArgs = [
      ffmpegCmd,
      "-hide_banner",
      "-nostats",
      "-loglevel", settings.get("debug") ? "verbose" : "warning",
      "-re",
      "-i", mp3Path,
      "-vn",
      "-af", `volume=${volumeDecimal}`,
      "-c:a", "libopus",
      "-ar", "48000",
      "-ac", "2",
      "-b:a", "192k",
      "-application", "audio",
      "-payload_type", "111",
      "-ssrc", String(ssrc),
      "-f", "rtp",
      `rtp://${rtpTargetHost}:${rtpPort}?pkt_size=1200`,
    ];
    debugLog(`ffmpeg args: ${ffmpegArgs.slice(1).join(" ")}`);

    const ffmpeg = Bun.spawn({
      cmd: ffmpegArgs,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    debugLog(`ffmpeg spawned — PID=${ffmpeg.pid}`);

    // 3. Register stream with Sharkord (matching sharkord-music-bot exactly)
    const stream = voiceActions.createStream({
      key: `hero-intro-${channelId}-${userId}`,
      channelId,
      title: `Hero Intro: ${label}`,
      avatarUrl: "https://i.imgur.com/uVBNUK9.png",
      producers: { audio: producer },
    });
    debugLog(`Stream registered`);

    // Track producer score changes (proves RTP data is flowing)
    producer.on("score", (score: unknown) => {
      debugLog(`Producer score: ${JSON.stringify(score)}`);
    });

    // 5. Health-check: verify RTP data flows after 5s
    setTimeout(async () => {
      try {
        const stats = await producer.getStats();
        const s = (stats as Array<{ packetCount?: number; byteCount?: number; bytesReceived?: number; packetsReceived?: number }>)[0];
        const pkts = s?.packetCount ?? s?.packetsReceived ?? 0;
        const bytes = s?.byteCount ?? s?.bytesReceived ?? 0;
        if (pkts > 0) {
          debugLog(`Health-check OK: ${pkts} packets, ${bytes} bytes received by producer`);
        } else {
          ctx.log(`[WARN] Health-check: producer received 0 RTP packets after 5s — audio may not be audible`);
        }
      } catch {
        debugLog(`Health-check: producer.getStats() failed (producer may be closed)`);
      }
    }, 5000);

    // Cleanup function — tears down transport, producer, stream
    const cleanup = () => {
      try { stream.remove(); } catch { /* ignore */ }
      try { producer.close(); } catch { /* ignore */ }
      try { transport.close(); } catch { /* ignore */ }
      debugLog(`Cleaned up audio resources for ${procKey}`);
    };

    // Read ffmpeg stderr in background for debug logging
    if (ffmpeg.stderr) {
      (async () => {
        try {
          const reader = ffmpeg.stderr.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split(/\r\n|\r|\n/);
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed) debugLog(`ffmpeg[${ffmpeg.pid}]: ${trimmed}`);
            }
          }
          if (buf.trim()) debugLog(`ffmpeg[${ffmpeg.pid}]: ${buf.trim()}`);
        } catch { /* ignore */ }
      })();
    }

    // Wait for ffmpeg to finish, then clean up
    const done = ffmpeg.exited.then((code) => {
      debugLog(`ffmpeg[${ffmpeg.pid}] exited — code=${code ?? "null"}`);
      ctx.log(`Playback for "${label}" finished (ffmpeg exit code ${code ?? "null"})`);
      activeSessions.delete(procKey);
      cleanup();
    });

    activeSessions.set(procKey, { ffmpeg, cleanup, done });
  }

  /**
   * Play audio and wait for completion. Used by the queue to ensure sequential playback.
   */
  async function playAudioAndWait(
    channelId: number,
    userId: number,
    label: string,
    mp3Path: string,
    runtimeCtx?: TInvokerContext,
  ): Promise<void> {
    await playAudio(channelId, userId, label, mp3Path, runtimeCtx);
    const procKey = `${channelId}-${userId}`;
    const session = activeSessions.get(procKey);
    if (session) {
      await session.done;
    }
  }

  // ---------------------------------------------------------------------------
  // Track active voice channels
  // ---------------------------------------------------------------------------

  ctx.events.on("voice:runtime_initialized", ({ channelId }) => {
    activeChannels.add(channelId);
    debugLog(`Voice channel ${channelId} is now active (total: ${activeChannels.size})`);
  });

  ctx.events.on("voice:runtime_closed", ({ channelId }) => {
    activeChannels.delete(channelId);
    // Kill any active playback sessions for this channel
    for (const [key, session] of activeSessions) {
      if (key.startsWith(`${channelId}-`)) {
        session.ffmpeg.kill();
        session.cleanup();
        activeSessions.delete(key);
      }
    }
    // Clear the playback queue for this channel
    playbackQueues.delete(channelId);
    queueProcessing.delete(channelId);
    debugLog(`Voice channel ${channelId} closed (remaining: ${activeChannels.size})`);
  });

  // ---------------------------------------------------------------------------
  // Voice user events (Sharkord >= 0.0.16)
  // ---------------------------------------------------------------------------

  ctx.events.on("voice:user_joined", async (payload: Record<string, unknown>) => {
    const channelId = payload.channelId as number;
    const userId = payload.userId as number;
    const payloadUsername = payload.username as string | undefined;

    const cachedUsername = userNameCache.get(userId);
    const username = payloadUsername ?? cachedUsername;

    debugLog(`>>> voice:user_joined event — channelId=${channelId}, userId=${userId}, username="${username ?? "unknown"}"`);

    if (!activeChannels.has(channelId)) {
      debugLog(`Auto-intro skipped for userId=${userId} — voice channel ${channelId} is not active`);
      return;
    }

    if (payloadUsername) {
      userNameCache.set(userId, payloadUsername);
      await writeJsonFile(userCacheFile, Object.fromEntries(userNameCache));
      debugLog(`User cache updated via voice:user_joined: userId=${userId} → "${payloadUsername}"`);
    }

    if (!username) {
      debugLog(`Auto-intro skipped for userId=${userId} — no username in payload or cache`);
      return;
    }

    const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
    const audioFileName = musicMap[username];
    if (!audioFileName) {
      debugLog(`Auto-intro skipped for "${username}" — no mapping found`);
      return;
    }

    const oncePerDay = settings.get("oncePerDay");
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(userId)];
      if (lastGreet === todayISO()) {
        debugLog(`Skipping intro for "${username}" — already greeted today`);
        return;
      }
    }

    const mp3Path = path.join(musicDir, audioFileName);
    const exists = await fs.access(mp3Path).then(() => true).catch(() => false);
    if (!exists) {
      ctx.error(`Mapped file for "${username}" not found: ${mp3Path}`);
      return;
    }

    if (INTRO_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, INTRO_DELAY_MS));
    }

    if (!activeChannels.has(channelId)) {
      debugLog(`Auto-intro skipped for "${username}" — channel ${channelId} became inactive during delay`);
      return;
    }

    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      dailyGreets[String(userId)] = todayISO();
      await writeJsonFile(dailyGreetsFile, dailyGreets);
    }

    enqueuePlayback({
      channelId,
      userId,
      label: username,
      mp3Path,
    });
  });

  ctx.events.on("voice:user_left", (payload: Record<string, unknown>) => {
    const channelId = payload.channelId as number;
    const userId = payload.userId as number;
    const sessionKey = `${channelId}-${userId}`;

    // Remove pending queue entries for that user in this channel.
    const queue = playbackQueues.get(channelId);
    if (queue) {
      const filtered = queue.filter((entry) => entry.userId !== userId);
      if (filtered.length > 0) {
        playbackQueues.set(channelId, filtered);
      } else {
        playbackQueues.delete(channelId);
      }
    }

    // Stop an active intro for that user/channel.
    const active = activeSessions.get(sessionKey);
    if (active) {
      active.ffmpeg.kill();
      active.cleanup();
      activeSessions.delete(sessionKey);
      debugLog(`Stopped active intro on voice:user_left — channelId=${channelId}, userId=${userId}`);
    }
  });

  // ---------------------------------------------------------------------------
  // User join handler – cache username only
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------

  ctx.events.on("user:joined", async (payload: Record<string, unknown>) => {
    const userId = payload.userId as number;
    const username = payload.username as string;

    debugLog(`>>> user:joined event — userId=${userId}, username="${username}" (server login)`);

    // Cache the userId → username mapping for /hero-set-me (persist to disk)
    userNameCache.set(userId, username);
    const cacheObj = Object.fromEntries(userNameCache);
    await writeJsonFile(userCacheFile, cacheObj);
    debugLog(`User cache updated: userId=${userId} → "${username}" (total cached: ${userNameCache.size})`);

    // NOTE: No automatic intro playback here.
    // Auto-play is handled by voice:user_joined (Sharkord >= 0.0.16).
  });

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  // /hero-stop – stop currently playing intro
  ctx.commands.register({
    name: "hero-stop",
    description: "Stop the currently playing intro music.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-stop called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      if (activeSessions.size === 0) {
        return "No intro is currently playing.";
      }
      for (const [key, session] of activeSessions) {
        session.ffmpeg.kill();
        session.cleanup();
        activeSessions.delete(key);
      }
      return "Stopped all running intros.";
    },
  });

  // /hero-set <displayName> <audioFileName>
  ctx.commands.register<{ displayName: string; audioFileName: string }>({
    name: "hero-set",
    description:
      "Map an audio file to a user. Usage: /hero-set <displayName> <audioFileName>",
    args: [
      {
        name: "displayName",
        type: "string",
        description: "The display name of the user to configure the intro for.",
        required: true,
        sensitive: false,
      },
      {
        name: "audioFileName",
        type: "string",
        description: "Audio file name (with or without extension, e.g. 'john-intro' or 'john-intro.mp3').",
        required: true,
        sensitive: false,
      },
    ],
    async execute(
      _invokerCtx: TInvokerContext,
      args: { displayName: string; audioFileName: string },
    ) {
      debugLog(`/hero-set called — displayName="${args.displayName}", audioFileName="${args.audioFileName}"`);
      const { displayName, audioFileName } = args;
      if (!displayName || !audioFileName) {
        return "Please provide both arguments. Usage: /hero-set <displayName> <audioFileName>";
      }
      const resolved = await resolveAudioFile(audioFileName);
      if (!resolved.ok) {
        return resolved.message;
      }
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[displayName] = resolved.fileName;
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro set for ${displayName}: ${resolved.fileName}`;
    },
  });

  // /hero-remove <displayName>
  ctx.commands.register<{ displayName: string }>({
    name: "hero-remove",
    description: "Remove the intro music mapping for a user.",
    args: [
      {
        name: "displayName",
        type: "string",
        description: "The display name of the user whose intro mapping should be removed.",
        required: true,
        sensitive: false,
      },
    ],
    async execute(
      _invokerCtx: TInvokerContext,
      args: { displayName: string },
    ) {
      debugLog(`/hero-remove called — displayName="${args.displayName}"`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      if (!musicMap[args.displayName]) {
        return `No intro configured for ${args.displayName}.`;
      }
      delete musicMap[args.displayName];
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro removed for ${args.displayName}.`;
    },
  });

  // /hero-list
  ctx.commands.register({
    name: "hero-list",
    description: "List all configured DisplayName → audio file mappings.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-list called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const entries = Object.entries(musicMap);
      if (entries.length === 0) {
        return "No intro mappings configured yet.";
      }
      const lines = entries.map(([displayName, audioFileName]) => `${displayName}: ${audioFileName}`);
      return `Intro Mappings\n${lines.join("\n")}`;
    },
  });

  // /hero-files
  ctx.commands.register({
    name: "hero-files",
    description: "List all available audio files (.mp3, .mpeg) in the music directory.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-files called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      let files: string[];
      try {
        const dirEntries = await fs.readdir(musicDir);
        files = dirEntries.filter((f) => isSupportedAudioFile(f));
      } catch {
        files = [];
      }
      if (files.length === 0) {
        return "No audio files found in the music directory.";
      }
      const lines = files.map((f) => `${f}`);
      return `Available Audio Files\n${lines.join("\n")}`;
    },
  });

  // /hero-set-me <audioFileName>
  ctx.commands.register<{ audioFileName: string }>({
    name: "hero-set-me",
    description:
      "Map your own user to an intro audio file. Usage: /hero-set-me <audioFileName>",
    args: [
      {
        name: "audioFileName",
        type: "string",
        description:
          "Audio file name (with or without extension, e.g. 'my-intro' or 'my-intro.mp3').",
        required: true,
        sensitive: false,
      },
    ],
    async execute(
      invokerCtx: TInvokerContext,
      args: { audioFileName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-set-me called — userId=${invokerUserId}, audioFileName="${args.audioFileName}"`);
      const { audioFileName } = args;
      if (!audioFileName) {
        return "Please provide an audio file name. Usage: /hero-set-me <audioFileName>";
      }
      const resolved = await resolveAudioFile(audioFileName);
      if (!resolved.ok) {
        return resolved.message;
      }

      const invokerName = invokerUserId !== undefined ? userNameCache.get(invokerUserId) : undefined;
      if (!invokerName) {
        return "Could not determine your username. Please rejoin the server first so your name is cached, then try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[invokerName] = resolved.fileName;
      await writeJsonFile(musicMapFile, musicMap);
      return `Intro set for yourself (${invokerName}): ${resolved.fileName}`;
    },
  });

  // /hero-play-me – play your own intro in the current voice channel
  ctx.commands.register({
    name: "hero-play-me",
    description: "Play your own intro music in the voice channel you are currently in.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(invokerCtx);
      const voiceChannelId = voiceGuard.ok ? voiceGuard.channelId : undefined;
      debugLog(`/hero-play-me called — userId=${invokerUserId}, voiceChannelId=${voiceChannelId}, channelActive=${voiceGuard.ok}`);

      if (invokerUserId === undefined) {
        return "Could not determine your user ID.";
      }
      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }

      const invokerName = userNameCache.get(invokerUserId);
      if (!invokerName) {
        return "Your username is not cached yet. Please rejoin the server and try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const audioFileName = musicMap[invokerName];
      if (!audioFileName) {
        return `No intro configured for you (${invokerName}). Use /hero-set-me to set one.`;
      }

      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `Intro file not found: ${audioFileName}`;
      }

      await playAudio(voiceChannelId, invokerUserId, invokerName, audioPath, invokerCtx);
      return `Playing your intro: ${audioFileName}`;
    },
  });

  // /hero-play <displayName>
  ctx.commands.register<{ displayName: string }>({
    name: "hero-play",
    description: "Play the intro music of another user. Usage: /hero-play <displayName>",
    args: [
      {
        name: "displayName",
        type: "string",
        description: "The display name of the user whose intro to play.",
        required: true,
        sensitive: false,
      },
    ],
    async execute(
      invokerCtx: TInvokerContext,
      args: { displayName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(invokerCtx);
      const voiceChannelId = voiceGuard.ok ? voiceGuard.channelId : undefined;
      const { displayName } = args;
      debugLog(`/hero-play called — userId=${invokerUserId}, voiceChannelId=${voiceChannelId}, channelActive=${voiceGuard.ok}, displayName="${displayName}"`);

      if (!displayName) {
        return "Please provide a display name. Usage: /hero-play <displayName>";
      }

      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      let audioFileName = musicMap[displayName];
      let playbackLabel = displayName;

      if (!audioFileName) {
        const resolved = await resolveAudioFile(displayName);
        if (resolved.ok) {
          audioFileName = resolved.fileName;
          playbackLabel = resolved.fileName;
        } else {
          return `No intro configured for ${displayName}. Use /hero-play-song <songName> to play by file name.`;
        }
      }

      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `Intro file not found: ${audioFileName}`;
      }

      await playAudio(voiceChannelId, invokerUserId ?? 0, playbackLabel, audioPath, invokerCtx);
      return `Playing intro for ${displayName}: ${audioFileName}`;
    },
  });

  // /hero-play-song <songName>
  ctx.commands.register<{ songName: string }>({
    name: "hero-play-song",
    description: "Play a song from the music directory. Extension is optional.",
    args: [
      {
        name: "songName",
        type: "string",
        description: "Song name (with or without file extension, e.g. 'eisenbart' or 'eisenbart.mp3').",
        required: true,
        sensitive: false,
      },
    ],
    async execute(
      invokerCtx: TInvokerContext,
      args: { songName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceGuard = requireActiveVoiceChannel(invokerCtx);
      const voiceChannelId = voiceGuard.ok ? voiceGuard.channelId : undefined;
      const { songName } = args;
      debugLog(`/hero-play-song called — userId=${invokerUserId}, voiceChannelId=${voiceChannelId}, channelActive=${voiceGuard.ok}, songName="${songName}"`);

      if (!songName) {
        return "Please provide a song name. Usage: /hero-play-song <songName>";
      }
      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }

      const resolved = await resolveAudioFile(songName);
      if (!resolved.ok) {
        return resolved.message;
      }

      const audioPath = path.join(musicDir, resolved.fileName);
      await playAudio(voiceChannelId, invokerUserId ?? 0, resolved.fileName, audioPath, invokerCtx);
      return `Playing: ${resolved.fileName}`;
    },
  });

  // /hero-reset-me – reset daily greet counter so the intro plays again
  ctx.commands.register({
    name: "hero-reset-me",
    description: "Reset your daily greeting counter so your intro plays again today.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-reset-me called — userId=${invokerUserId}`);

      if (invokerUserId === undefined) {
        return "Could not determine your user ID.";
      }

      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(invokerUserId)];

      if (!lastGreet) {
        return "You have no daily greeting entry to reset.";
      }

      delete dailyGreets[String(invokerUserId)];
      await writeJsonFile(dailyGreetsFile, dailyGreets);
      const invokerName = userNameCache.get(invokerUserId) ?? `userId=${invokerUserId}`;
      debugLog(`Daily greet reset for ${invokerName} (userId=${invokerUserId})`);
      return `Your daily greeting counter has been reset. Your intro will play again on your next join.`;
    },
  });

  // REQ-CMD-017
  // /hero-search-music – search Sharkord SQLite DB for audio attachments and copy them to music dir
  ctx.commands.register({
    name: "hero-search-music",
    description: "Search chat attachments for audio files and add them to the music library.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-search-music called by userId=${(invokerCtx as Record<string, unknown>).userId}`);

      const dbPath = path.join(ctx.path, "..", "..", "db.sqlite");
      const publicDir = path.join(ctx.path, "..", "..", "public");

      debugLog(`hero-search-music: dbPath=${dbPath}, publicDir=${publicDir}, musicDir=${musicDir}`);

      // Row type returned from the files query (DB uses snake_case column names)
      interface AudioFileRow {
        name: string;
        original_name: string | null;
        mime_type: string;
        extension: string;
      }

      let rows: AudioFileRow[];

      try {
        const db = new Database(dbPath, { readonly: true });
        rows = db.query(`
          SELECT DISTINCT f.name, f.original_name, f.mime_type, f.extension
          FROM files f
          INNER JOIN message_files mf ON mf.file_id = f.id
          WHERE f.mime_type IN ('audio/mpeg', 'audio/mp3')
             OR LOWER(f.extension) IN ('.mp3', '.mpeg', 'mp3', 'mpeg')
        `).all() as AudioFileRow[];
        db.close();
        debugLog(`hero-search-music: query returned ${rows.length} row(s)`);
      } catch (err) {
        const errorMsg = `Failed to read database at "${dbPath}": ${String(err)}`;
        ctx.error(`/hero-search-music: ${errorMsg}`);
        return errorMsg;
      }

      let copied = 0;
      let skipped = 0;
      const copiedFiles: string[] = [];
      const skippedFiles: string[] = [];

      for (const row of rows) {
        const destName = (row.original_name && row.original_name.trim().length > 0)
          ? row.original_name.trim()
          : row.name;

        const srcPath = path.join(publicDir, row.name);
        const destPath = path.join(musicDir, destName);

        debugLog(`hero-search-music: processing row name="${row.name}", original_name="${row.original_name ?? "null"}", destName="${destName}"`);

        // Check if destination already exists — skip if so
        try {
          await fs.access(destPath);
          // File exists → skip
          debugLog(`hero-search-music: skipping "${destName}" (already exists in music dir)`);
          skipped++;
          skippedFiles.push(destName);
          continue;
        } catch {
          // File does not exist → proceed with copy
        }

        // Verify source file exists
        const srcFile = Bun.file(srcPath);
        const srcExists = await srcFile.exists();
        if (!srcExists) {
          ctx.log(`[WARN] hero-search-music: source file not found, skipping — "${srcPath}"`);
          debugLog(`hero-search-music: source not found: ${srcPath}`);
          skipped++;
          skippedFiles.push(`${destName} (source missing: ${row.name})`);
          continue;
        }

        // Copy file
        try {
          await Bun.write(destPath, srcFile);
          debugLog(`hero-search-music: copied "${row.name}" → "${destName}"`);
          copied++;
          copiedFiles.push(destName);
        } catch (err) {
          ctx.error(`hero-search-music: failed to copy "${row.name}" → "${destName}": ${String(err)}`);
          skipped++;
          skippedFiles.push(`${destName} (copy error: ${String(err)})`);
        }
      }

      // Build result summary
      const lines: string[] = [
        "Search complete.",
        `Found: ${rows.length} audio file(s) in chat attachments`,
        `Copied: ${copied}`,
        `Skipped (already exists): ${skipped}`,
      ];

      if (copiedFiles.length > 0) {
        lines.push("", "Copied files:");
        for (const f of copiedFiles) {
          lines.push(`  + ${f}`);
        }
      }

      if (skippedFiles.length > 0) {
        lines.push("", "Skipped files:");
        for (const f of skippedFiles) {
          lines.push(`  - ${f}`);
        }
      }

      const result = lines.join("\n");
      debugLog(`hero-search-music: done — ${result}`);
      return result;
    },
  });

  // /hero-diagnose – full audio pipeline diagnostic
  ctx.commands.register({
    name: "hero-diagnose",
    description: "Run a full audio pipeline diagnostic to find where audio breaks.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      const voiceGuard = requireActiveVoiceChannel(invokerCtx);
      const voiceChannelId = voiceGuard.ok ? voiceGuard.channelId : undefined;
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-diagnose called by userId=${invokerUserId}, voiceChannelId=${voiceChannelId}, channelActive=${voiceGuard.ok}`);

      if (!voiceGuard.ok) {
        return voiceGuard.message;
      }

      const lines: string[] = ["=== HERO-INTRODUCER DIAGNOSTIC REPORT ===", ""];

      function pass(stage: string, detail: string) { lines.push(`[PASS] ${stage}: ${detail}`); }
      function fail(stage: string, detail: string) { lines.push(`[FAIL] ${stage}: ${detail}`); }
      function info(stage: string, detail: string) { lines.push(`[INFO] ${stage}: ${detail}`); }

      // --- Stage 0: Pre-flight ---
      let ffmpegOk = false;
      try {
        const probe = Bun.spawn({ cmd: [ffmpegCmd, "-version"], stdout: "pipe", stderr: "ignore", stdin: "ignore" });
        await probe.exited;
        ffmpegOk = true;
      } catch { /* ignore */ }

      if (ffmpegOk) pass("Stage 0", "ffmpeg found"); else fail("Stage 0", "ffmpeg NOT found");
      info("Stage 0", `Active channels: [${[...activeChannels].join(", ")}]`);

      // Diagnostic-local type interfaces for mediasoup objects (avoids `any`)
      interface DiagTransport {
        id: string;
        tuple: { localPort: number };
        produce(params: unknown): Promise<DiagProducer>;
        consume(params: unknown): Promise<unknown>;
        close(): void;
        dump(): Promise<Record<string, unknown>>;
        getStats?(): Promise<unknown>;
        consumers?: Map<string, DiagConsumerLike>;
      }
      interface DiagProducer {
        id: string;
        paused: boolean;
        close(): void;
        getStats(): Promise<Array<{ packetCount: number; byteCount: number; score: number }>>;
        observer?: { on(event: string, handler: (consumer: DiagConsumerLike) => void): void };
      }
      interface DiagConsumerLike {
        id: string;
        paused: boolean;
        kind?: string;
        type?: string;
        producerPaused?: boolean;
        score?: unknown;
        getStats(): Promise<unknown>;
      }
      interface DiagRouter {
        createPlainTransport(params: unknown): Promise<DiagTransport>;
        dump(): Promise<{
          transportIds?: string[];
          mapProducerIdConsumerIds?: Array<{ key: string; values: string[] }>;
        }>;
        rtpCapabilities: unknown;
        transportsForTesting?: Map<string, DiagTransport>;
      }
      interface DiagListenInfo {
        ip: string;
        announcedAddress: string;
      }

      // --- Stage 1: Transport ---
      let router: DiagRouter;
      let listenInfo: DiagListenInfo;
      let transport: DiagTransport;
      let rtpPort: number;
      try {
        router = (ctx as unknown as { voice: VoiceActionsLike }).voice.getRouter(voiceChannelId) as unknown as DiagRouter;
        listenInfo = await (ctx as unknown as { voice: VoiceActionsLike }).voice.getListenInfo() as unknown as DiagListenInfo;
        transport = await router.createPlainTransport({
          listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
          rtcpMux: true,
          comedia: true,
          enableSrtp: false,
        });
        rtpPort = transport.tuple.localPort;
        pass("Stage 1", `Transport created (port=${rtpPort}, ip=${listenInfo.ip})`);
      } catch (err) {
        fail("Stage 1", `Transport creation failed: ${String(err)}`);
        return lines.join("\n");
      }

      // --- Stage 2: Producer ---
      const ssrc = Math.floor(Math.random() * 1e9);
      // Use hardcoded payloadType 111 and empty parameters (matching playAudio exactly)
      info("Stage 2", `Using payloadType=111 (matching playAudio pipeline)`);

      let producer: DiagProducer;
      try {
        producer = await transport.produce({
          kind: "audio",
          rtpParameters: {
            codecs: [{
              mimeType: "audio/opus",
              payloadType: 111,
              clockRate: 48000,
              channels: 2,
              parameters: {},
              rtcpFeedback: [],
            }],
            encodings: [{ ssrc }],
          },
        });
        const producerPaused = producer.paused ?? "unknown";
        pass("Stage 2", `Producer created (id=${producer.id}, paused=${producerPaused}, SSRC=${ssrc})`);
        if (producer.paused) {
          fail("Stage 2", "Producer is PAUSED — RTP data will be discarded!");
        }
      } catch (err) {
        fail("Stage 2", `Producer creation failed: ${String(err)}`);
        try { transport.close(); } catch { /* ignore */ }
        return lines.join("\n");
      }

      // --- Stage 3: ffmpeg ---
      // Find any audio file to use as test input
      let testAudioPath: string | undefined;
      try {
        const files = await fs.readdir(musicDir);
        const audioFile = files.find((f) => isSupportedAudioFile(f));
        if (audioFile) testAudioPath = path.join(musicDir, audioFile);
      } catch { /* ignore */ }

      if (!testAudioPath) {
        info("Stage 3", "No audio file found — generating 3s silence via ffmpeg");
      }

      // ffmpeg args matching playAudio pipeline exactly
      const ffmpegArgs = testAudioPath
        ? [
          ffmpegCmd, "-hide_banner", "-nostats", "-loglevel", "warning",
          "-re", "-i", testAudioPath, "-vn", "-t", "5",
          "-af", "volume=0.25",
          "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "192k",
          "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
          "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
        ]
        : [
          ffmpegCmd, "-hide_banner", "-nostats", "-loglevel", "warning",
          "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3",
          "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "192k",
          "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
          "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
        ];

      const ffmpeg = Bun.spawn({ cmd: ffmpegArgs, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
      info("Stage 3", `ffmpeg spawned (PID=${ffmpeg.pid}, SSRC=${ssrc}, target=rtp://${listenInfo.ip}:${rtpPort})`);

      // Wait 2s for ffmpeg to send some packets
      await new Promise((r) => setTimeout(r, 2000));

      let producerStats: unknown;
      try {
        producerStats = await producer.getStats();
        const ps = (producerStats as Array<{ packetCount: number; byteCount: number; score: number }>)[0];
        if (ps && ps.packetCount > 0) {
          pass("Stage 3", `ffmpeg OK (${ps.packetCount} pkts, ${ps.byteCount} bytes, score=${ps.score})`);
        } else {
          fail("Stage 3", `No RTP packets received by producer (packetCount=${ps?.packetCount ?? 0})`);
        }
      } catch (err) {
        fail("Stage 3", `Producer getStats failed: ${String(err)}`);
      }

      // --- Stage 4: Stream + Consumer discovery (CRITICAL) ---
      let sdkConsumerFound = false;
      let sdkConsumerPaused: boolean | undefined;
      let sdkConsumerStats: unknown;

      // Hook into producer observer to catch SDK-created consumers
      if (producer.observer?.on) {
        producer.observer.on("newconsumer", async (consumer: DiagConsumerLike) => {
          sdkConsumerFound = true;
          sdkConsumerPaused = consumer.paused;
          try {
            sdkConsumerStats = await consumer.getStats();
          } catch { /* ignore */ }
          ctx.log(`[DIAG] SDK consumer detected: id=${consumer.id}, paused=${consumer.paused}`);
        });
      }

      const stream = (ctx as unknown as { voice: VoiceActionsLike }).voice.createStream({
        channelId: voiceChannelId,
        title: `Diagnostic Test`,
        key: `hero-diag-${voiceChannelId}-${invokerUserId ?? 0}`,
        producers: { audio: producer },
      });
      info("Stage 4", "Stream registered, waiting 5s for SDK to create consumer...");

      // Wait for SDK to create consumer
      await new Promise((r) => setTimeout(r, 5000));

      if (sdkConsumerFound) {
        info("Stage 4", `SDK consumer found! paused=${sdkConsumerPaused ?? "unknown"}`);
        if (sdkConsumerPaused) {
          fail("Stage 4", "SDK Consumer is PAUSED — this is likely the cause of BUG-001!");
          info("Stage 4", "mediasoup creates consumers paused by default. The SDK must call consumer.resume().");
        } else if (sdkConsumerPaused === false) {
          pass("Stage 4", "SDK Consumer is resumed (paused=false)");
        }
        if (sdkConsumerStats) {
          info("Stage 4", `SDK consumer stats: ${JSON.stringify(sdkConsumerStats)}`);
        }
      } else {
        info("Stage 4", "No SDK consumer detected via producer.observer");
        info("Stage 4", "Checking router dump for consumers...");
      }

      // --- Stage 5: Router state dump + object introspection ---
      try {
        const dump = await router.dump();
        const entry = dump.mapProducerIdConsumerIds?.find((e: { key: string }) => e.key === producer.id);
        const consumerIds = entry?.values ?? [];
        const consumerCount = consumerIds.length;
        info("Stage 5", `Router: ${dump.transportIds?.length ?? 0} transports`);
        info("Stage 5", `Consumers for our producer: ${consumerCount} — IDs: ${JSON.stringify(consumerIds)}`);

        if (consumerCount === 0) {
          fail("Stage 5", "No consumers exist for our producer! SDK did not create a consumer.");
        } else {
          pass("Stage 5", `${consumerCount} consumer(s) found in router`);
        }

        // Access all transports via router.transportsForTesting
        const allTransports: Map<string, DiagTransport> | undefined = (router as unknown as { transportsForTesting?: Map<string, DiagTransport> }).transportsForTesting;
        if (allTransports && allTransports instanceof Map) {
          info("Stage 5", `router.transportsForTesting: ${allTransports.size} transports`);

          for (const [tId, tObj] of allTransports) {
            // Skip our own diagnostic transport
            if (tId === transport.id) continue;

            // Each transport has a .consumers Map
            const consumers: Map<string, DiagConsumerLike> | undefined = tObj.consumers;
            if (consumers && consumers instanceof Map && consumers.size > 0) {
              for (const [cId, cObj] of consumers) {
                if (!consumerIds.includes(cId)) continue;

                // FOUND our consumer!
                const cPaused = cObj.paused;
                const cKind = cObj.kind ?? "unknown";
                const cType = cObj.type ?? "unknown";
                const cProducerPaused = cObj.producerPaused;
                info("Stage 5", `CONSUMER ${cId}:`);
                info("Stage 5", `  paused=${cPaused}, producerPaused=${cProducerPaused ?? "unknown"}, kind=${cKind}, type=${cType}`);
                info("Stage 5", `  on transport ${tId} (type=${typeof tObj.dump === "function" ? "has dump()" : "no dump"})`);

                if (cPaused) {
                  fail("Stage 5", `Consumer ${cId} is PAUSED! This is likely BUG-001!`);
                  info("Stage 5", "The Sharkord SDK may not be calling consumer.resume() for plugin-created producers.");
                } else {
                  pass("Stage 5", `Consumer ${cId} is RESUMED (paused=false)`);
                }

                // Get consumer stats
                try {
                  const cStats = await cObj.getStats();
                  info("Stage 5", `  stats: ${JSON.stringify(cStats)}`);
                } catch (e) {
                  info("Stage 5", `  stats error: ${String(e)}`);
                }

                // Get consumer score
                try {
                  info("Stage 5", `  score: ${JSON.stringify(cObj.score)}`);
                } catch { /* ignore */ }

                // Log consumer's own keys for further debugging
                const cKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(cObj) ?? {});
                info("Stage 5", `  proto keys: [${cKeys.join(", ")}]`);
              }
            }
          }
        } else {
          info("Stage 5", "router.transportsForTesting not available");
        }

        info("Stage 5", `All mappings: ${JSON.stringify(dump.mapProducerIdConsumerIds)}`);

        // --- Stage 6: Client transport deep inspection ---
        lines.push("");
        if (allTransports && allTransports instanceof Map) {
          for (const [tId, tObj] of allTransports) {
            if (tId === transport.id) continue;

            // Check if this transport hosts our consumer
            const tConsumers: Map<string, DiagConsumerLike> | undefined = tObj.consumers;
            const hasOurConsumer = tConsumers instanceof Map
              && [...tConsumers.keys()].some((k) => consumerIds.includes(k));
            if (!hasOurConsumer) continue;

            info("Stage 6", `=== CLIENT TRANSPORT ${tId} ===`);

            // Transport type and proto keys
            const tProtoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(tObj) ?? {});
            const tOwnKeys = Object.getOwnPropertyNames(tObj);
            info("Stage 6", `proto keys: [${tProtoKeys.join(", ")}]`);
            info("Stage 6", `own keys: [${tOwnKeys.join(", ")}]`);

            // Dump transport state
            try {
              const tDump = await tObj.dump();
              info("Stage 6", `type: ${tDump.type ?? "unknown"}`);
              info("Stage 6", `iceState: ${tDump.iceState ?? "n/a"}`);
              info("Stage 6", `iceRole: ${tDump.iceRole ?? "n/a"}`);
              info("Stage 6", `dtlsState: ${tDump.dtlsState ?? "n/a"}`);
              info("Stage 6", `sctpState: ${tDump.sctpState ?? "n/a"}`);
              info("Stage 6", `iceSelectedTuple: ${JSON.stringify(tDump.iceSelectedTuple ?? null)}`);
              info("Stage 6", `producerIds: ${JSON.stringify(tDump.producerIds ?? [])}`);
              info("Stage 6", `consumerIds: ${JSON.stringify(tDump.consumerIds ?? [])}`);

              // ICE state check
              if (tDump.iceState && tDump.iceState !== "completed") {
                fail("Stage 6", `ICE state is '${tDump.iceState}' (expected 'completed') — WebRTC handshake not complete!`);
              } else if (tDump.iceState === "completed") {
                pass("Stage 6", "ICE state: completed");
              }

              // DTLS state check
              if (tDump.dtlsState && tDump.dtlsState !== "connected") {
                fail("Stage 6", `DTLS state is '${tDump.dtlsState}' (expected 'connected') — encryption handshake not complete!`);
              } else if (tDump.dtlsState === "connected") {
                pass("Stage 6", "DTLS state: connected");
              }

              // Bytes sent/received on the transport
              if (tDump.bytesReceived !== undefined || tDump.bytesSent !== undefined) {
                info("Stage 6", `bytesReceived=${tDump.bytesReceived ?? 0}, bytesSent=${tDump.bytesSent ?? 0}`);
              }

              // Log full dump for detailed analysis
              info("Stage 6", `full dump: ${JSON.stringify(tDump)}`);
            } catch (e) {
              info("Stage 6", `dump error: ${String(e)}`);
            }

            // Transport getStats
            try {
              if (typeof tObj.getStats === "function") {
                const tStats = await tObj.getStats();
                info("Stage 6", `transport stats: ${JSON.stringify(tStats)}`);
              }
            } catch { /* ignore */ }

            // Check all consumers on this transport for outbound stats
            if (tConsumers instanceof Map) {
              for (const [cId, cObj] of tConsumers) {
                try {
                  const cStats = await cObj.getStats();
                  const outbound = (cStats as Array<Record<string, unknown>>).find(
                    (s) => s.type === "outbound-rtp",
                  );
                  const inbound = (cStats as Array<Record<string, unknown>>).find(
                    (s) => s.type === "inbound-rtp",
                  );
                  if (outbound) {
                    const outPkts = (outbound.packetCount as number) ?? 0;
                    const outBytes = (outbound.byteCount as number) ?? 0;
                    if (outPkts === 0) {
                      fail("Stage 6", `Consumer ${cId} outbound: 0 packets sent to client! Audio not reaching WebRTC transport.`);
                    } else {
                      pass("Stage 6", `Consumer ${cId} outbound: ${outPkts} pkts, ${outBytes} bytes sent`);
                    }
                    info("Stage 6", `Consumer ${cId} outbound-rtp: ${JSON.stringify(outbound)}`);
                  }
                  if (inbound) {
                    info("Stage 6", `Consumer ${cId} inbound-rtp: ${JSON.stringify(inbound)}`);
                  }
                } catch { /* ignore */ }
              }
            }
          }
        }
      } catch (err) {
        fail("Stage 5", `Router dump failed: ${String(err)}`);
      }

      // --- Cleanup ---
      ffmpeg.kill();
      try { producer.close(); } catch { /* ignore */ }
      try { transport.close(); } catch { /* ignore */ }

      // --- Verdict ---
      lines.push("");
      lines.push("=== VERDICT ===");
      const failures = lines.filter((l) => l.startsWith("[FAIL]"));
      if (failures.length === 0) {
        lines.push("All stages passed including transport state.");
        lines.push("If audio is still not heard: check browser autoplay policy, client volume, or contact Sharkord SDK support.");
      } else {
        lines.push(`${failures.length} failure(s) detected:`);
        for (const f of failures) lines.push(`  ${f}`);
      }

      const report = lines.join("\n");
      ctx.log(`[DIAG]\n${report}`);
      return report;
    },
  });

  // /hero-dump-context – logs the full invokerCtx for debugging SDK types
  ctx.commands.register<{ testArg: string }>({
    name: "hero-dump-context",
    description: "(Debug) Dump the invoker context and args to the log.",
    args: [
      {
        name: "testArg",
        type: "string",
        description: "A test argument to see how args are passed.",
        required: false,
        sensitive: false,
      },
    ],
    async execute(...params: unknown[]) {
      debugLog(`/hero-dump-context called`);
      const dump = params.map((p, i) => `param[${i}]: ${JSON.stringify(p, null, 2)}`).join("\n\n");
      ctx.log(`[DEBUG] Command params (${params.length} total):\n${dump}`);
      return `Context dump:\n\`\`\`json\n${dump}\n\`\`\``;
    },
  });

  ctx.ui.enable();
  ctx.log("Hero Introducer ready");
};

// ---------------------------------------------------------------------------
// Plugin unload entry point
// ---------------------------------------------------------------------------

const onUnload = (ctx: PluginContext) => {
  ctx.log("Hero Introducer unloaded");
};

export { onLoad, onUnload };
