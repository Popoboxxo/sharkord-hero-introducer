import type { PluginContext, TInvokerContext } from "@sharkord/plugin-sdk";
import { spawn } from "child_process";
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

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const settings = await ctx.settings.register([
    {
      key: "enabled",
      name: "Plugin enabled",
      description: "When disabled no intro music will be played.",
      type: "boolean",
      defaultValue: true,
    },
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
    ffmpeg: ReturnType<typeof spawn>;
    cleanup: () => void;
  }
  const activeSessions = new Map<string, PlaybackSession>();

  /** Set of currently active voice channel IDs. */
  const activeChannels = new Set<number>();

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

  async function playAudio(
    channelId: number,
    userId: number,
    label: string,
    mp3Path: string,
  ): Promise<void> {
    const procKey = `${channelId}-${userId}`;
    debugLog(`playAudio: channelId=${channelId}, userId=${userId}, label="${label}", path="${mp3Path}"`);

    // Stop any existing playback for this user in this channel
    const existing = activeSessions.get(procKey);
    if (existing) {
      debugLog(`Stopping existing playback for ${procKey}`);
      existing.ffmpeg.kill("SIGTERM");
      existing.cleanup();
      activeSessions.delete(procKey);
    }

    // 1. Create transport + producer
    const router = ctx.actions.voice.getRouter(channelId);
    const listenInfo = await ctx.actions.voice.getListenInfo();
    debugLog(`listenInfo: ip=${listenInfo.ip}, announcedAddress=${listenInfo.announcedAddress}`);

    const transport = await router.createPlainTransport({
      listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
      rtcpMux: true,
      comedia: true,
      enableSrtp: false,
    });

    const ssrc = Math.floor(Math.random() * 1e9);
    const producer = await transport.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [{
          mimeType: "audio/opus",
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: { minptime: 10, useinbandfec: 1 },
          rtcpFeedback: [],
        }],
        encodings: [{ ssrc }],
      },
    });

    if (producer.paused) {
      await producer.resume();
    }

    const rtpPort = transport.tuple.localPort;
    debugLog(`Transport created — port=${rtpPort}, SSRC=${ssrc}, producerId=${producer.id}`);

    // 2. Spawn ffmpeg FIRST — matching working reference implementation order.
    //    ffmpeg must be sending RTP data BEFORE the stream is registered,
    //    so mediasoup has data flowing when the client creates consumers.
    const ffmpegRtpTarget = listenInfo.ip === "0.0.0.0" ? "127.0.0.1" : listenInfo.ip;

    // Volume: setting is 0-100, ffmpeg volume filter uses decimal (0.0-1.0)
    const volumePercent = settings.get("volume") as number;
    const volumeDecimal = Math.max(0, Math.min(100, volumePercent)) / 100;
    debugLog(`Spawning ffmpeg → rtp://${ffmpegRtpTarget}:${rtpPort} (SSRC=${ssrc}, volume=${volumePercent}%/${volumeDecimal})`);

    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel", settings.get("debug") ? "verbose" : "warning",
      "-stats_period", "5",
      "-re",
      "-i", mp3Path,
      "-vn",
      "-af", `volume=${volumeDecimal}`,
      "-c:a", "libopus",
      "-application", "audio",
      "-b:a", "128k",
      "-ar", "48000",
      "-ac", "2",
      "-frame_duration", "20",
      "-ssrc", String(ssrc),
      "-payload_type", "111",
      "-f", "rtp",
      `rtp://${ffmpegRtpTarget}:${rtpPort}?pkt_size=1200`,
    ];
    debugLog(`ffmpeg args: ${ffmpegArgs.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);
    debugLog(`ffmpeg spawned — PID=${ffmpeg.pid}`);

    // Track producer score changes (proves RTP data is flowing)
    producer.on("score", (score: unknown) => {
      debugLog(`Producer score: ${JSON.stringify(score)}`);
    });
    transport.on("tuple", (tuple: unknown) => {
      debugLog(`Transport tuple (RTP connected): ${JSON.stringify(tuple)}`);
    });

    // 3. Small delay to let ffmpeg start sending RTP, then register the stream.
    //    This ensures mediasoup has an active data flow before the client
    //    receives the onNewProducer event and creates a consumer.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stream = ctx.actions.voice.createStream({
      channelId,
      title: `Hero Intro: ${label}`,
      key: `hero-intro-${channelId}-${userId}`,
      producers: { audio: producer },
    });
    debugLog(`Stream registered (after ffmpeg start)`);

    // Cleanup function — tears down transport, producer, stream
    const cleanup = () => {
      try { stream.remove(); } catch { /* ignore */ }
      try { producer.close(); } catch { /* ignore */ }
      try { transport.close(); } catch { /* ignore */ }
      debugLog(`Cleaned up audio resources for ${procKey}`);
    };

    activeSessions.set(procKey, { ffmpeg, cleanup });

    // Collect ffmpeg stderr for debug output (split on \r and \n — ffmpeg uses \r for progress)
    let ffmpegStderrBuf = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      ffmpegStderrBuf += text;
      const lines = ffmpegStderrBuf.split(/\r\n|\r|\n/);
      ffmpegStderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) debugLog(`ffmpeg[${ffmpeg.pid}]: ${trimmed}`);
      }
    });

    ffmpeg.on("close", (code: number | null) => {
      if (ffmpegStderrBuf.trim()) debugLog(`ffmpeg[${ffmpeg.pid}]: ${ffmpegStderrBuf.trim()}`);
      debugLog(`ffmpeg[${ffmpeg.pid}] exited — code=${code ?? "null"}`);
      ctx.log(`Playback for "${label}" finished (ffmpeg exit code ${code ?? "null"})`);
      activeSessions.delete(procKey);
      cleanup();
    });

    ffmpeg.on("error", (err: Error) => {
      ctx.error(`ffmpeg error for "${label}": ${err.message}`);
      activeSessions.delete(procKey);
      cleanup();
    });
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
        session.ffmpeg.kill("SIGTERM");
        session.cleanup();
        activeSessions.delete(key);
      }
    }
    debugLog(`Voice channel ${channelId} closed (remaining: ${activeChannels.size})`);
  });

  // ---------------------------------------------------------------------------
  // User join handler – trigger intro music
  // ---------------------------------------------------------------------------

  /** Delay (ms) before playing the intro after a user connects to the server. */
  const INTRO_DELAY_MS = 5_000;

  ctx.events.on("user:joined", async ({ userId, username }) => {
    debugLog(`>>> user:joined event — userId=${userId}, username="${username}"`);

    // Cache the userId → username mapping for /hero-set-me (persist to disk)
    userNameCache.set(userId, username);
    const cacheObj = Object.fromEntries(userNameCache);
    await writeJsonFile(userCacheFile, cacheObj);
    debugLog(`User cache updated: userId=${userId} → "${username}" (total cached: ${userNameCache.size})`);

    const enabled = settings.get("enabled");
    if (!enabled) {
      debugLog(`Plugin disabled – skipping intro for "${username}" (userId=${userId})`);
      return;
    }

    // Load the music map (keyed by displayName / username)
    const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
    const mapKeys = Object.keys(musicMap);
    debugLog(`MusicMap loaded — ${mapKeys.length} entries: [${mapKeys.join(", ")}]`);

    const audioFileName = musicMap[username];

    if (!audioFileName) {
      debugLog(`No intro configured for user "${username}" (userId=${userId})`);
      return;
    }

    debugLog(`Match found: "${username}" → "${audioFileName}"`);

    // Check once-per-day setting
    const oncePerDay = settings.get("oncePerDay");
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(userId)];
      if (lastGreet === todayISO()) {
        debugLog(`User "${username}" already greeted today – skipping`);
        return;
      }
    }

    // Verify the audio file exists
    const audioPath = path.join(musicDir, audioFileName);
    try {
      await fs.access(audioPath);
    } catch {
      ctx.error(`Intro file not found for user ${username}: ${audioPath}`);
      return;
    }

    // Wait before playing so the user has time to join a voice channel
    debugLog(`Waiting ${INTRO_DELAY_MS}ms before playing intro for "${username}"...`);
    await new Promise((resolve) => setTimeout(resolve, INTRO_DELAY_MS));

    const channelId = [...activeChannels][0];
    if (channelId === undefined) {
      debugLog(`No active voice channel – cannot play intro for "${username}"`);
      return;
    }

    debugLog(`Starting playback for "${username}" in channel ${channelId}...`);
    await playAudio(channelId, userId, username, audioPath);

    // Record the greeting date
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      dailyGreets[String(userId)] = todayISO();
      await writeJsonFile(dailyGreetsFile, dailyGreets);
      debugLog(`Recorded greeting for userId=${userId} on ${todayISO()}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  // /hero-enable
  ctx.commands.register({
    name: "hero-enable",
    description: "Enable the Hero Introducer plugin.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      settings.set("enabled", true);
      return "Hero Introducer enabled.";
    },
  });

  // /hero-disable
  ctx.commands.register({
    name: "hero-disable",
    description: "Disable the Hero Introducer plugin.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      settings.set("enabled", false);
      return "Hero Introducer disabled.";
    },
  });

  // /hero-stop – stop currently playing intro
  ctx.commands.register({
    name: "hero-stop",
    description: "Stop the currently playing intro music.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      if (activeSessions.size === 0) {
        return "No intro is currently playing.";
      }
      for (const [key, session] of activeSessions) {
        session.ffmpeg.kill("SIGTERM");
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
    async executes(
      _invokerCtx: TInvokerContext,
      args: { displayName: string; audioFileName: string },
    ) {
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
    async executes(
      _invokerCtx: TInvokerContext,
      args: { displayName: string },
    ) {
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
    async executes(_invokerCtx: TInvokerContext) {
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
    async executes(_invokerCtx: TInvokerContext) {
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
    async executes(
      invokerCtx: TInvokerContext,
      args: { audioFileName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
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
    async executes(invokerCtx: TInvokerContext) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceChannelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;

      if (invokerUserId === undefined) {
        return "Could not determine your user ID.";
      }
      if (!voiceChannelId) {
        return "You are not in a voice channel. Join one first, then try again.";
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

      await playAudio(voiceChannelId, invokerUserId, invokerName, audioPath);
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
    async executes(
      invokerCtx: TInvokerContext,
      args: { displayName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceChannelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;
      const { displayName } = args;

      if (!voiceChannelId) {
        return "You are not in a voice channel. Join one first, then try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const audioFileName = musicMap[displayName];
      if (!audioFileName) {
        return `No intro configured for ${displayName}.`;
      }

      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `Intro file not found: ${audioFileName}`;
      }

      await playAudio(voiceChannelId, invokerUserId ?? 0, displayName, audioPath);
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
    async executes(
      invokerCtx: TInvokerContext,
      args: { songName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      const voiceChannelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;
      const { songName } = args;

      if (!songName) {
        return "Please provide a song name. Usage: /hero-play-song <songName>";
      }
      if (!voiceChannelId) {
        return "You are not in a voice channel. Join one first, then try again.";
      }

      const resolved = await resolveAudioFile(songName);
      if (!resolved.ok) {
        return resolved.message;
      }

      const audioPath = path.join(musicDir, resolved.fileName);
      await playAudio(voiceChannelId, invokerUserId ?? 0, resolved.fileName, audioPath);
      return `Playing: ${resolved.fileName}`;
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
    async executes(...params: unknown[]) {
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
