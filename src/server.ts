import type { PluginContext, TInvokerContext } from "@sharkord/plugin-sdk";
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
    ffmpeg: { kill(signal?: number): void };
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
    debugLog(`playAudio: channelId=${channelId}, userId=${userId}, label="${label}", path="${mp3Path}", activeSessions=${activeSessions.size}, activeChannels=[${[...activeChannels].join(", ")}]`);

    // Stop any existing playback for this user in this channel
    const existing = activeSessions.get(procKey);
    if (existing) {
      debugLog(`Stopping existing playback for ${procKey}`);
      existing.ffmpeg.kill();
      existing.cleanup();
      activeSessions.delete(procKey);
    }

    // 1. Create transport + producer (matching sharkord-music-bot exactly)
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

    const ffmpegArgs = [
      "ffmpeg",
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
      "-b:a", "128k",
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

    // 3. Register stream with Sharkord (immediately after spawn, no delay)
    const stream = ctx.actions.voice.createStream({
      channelId,
      title: `Hero Intro: ${label}`,
      key: `hero-intro-${channelId}-${userId}`,
      producers: { audio: producer },
    });
    debugLog(`Stream registered`);

    // Track producer score changes (proves RTP data is flowing)
    producer.on("score", (score: unknown) => {
      debugLog(`Producer score: ${JSON.stringify(score)}`);
    });

    // Server-side test: create our OWN consumer to verify mediasoup routing works
    let testConsumerInterval: ReturnType<typeof setInterval> | undefined;
    try {
      const testTransport = await router.createPlainTransport({
        listenIp: { ip: listenInfo.ip, announcedIp: listenInfo.announcedAddress },
        rtcpMux: true,
        comedia: false,
      });
      const testConsumer = await testTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
      });
      if (testConsumer.paused) {
        await testConsumer.resume();
      }
      debugLog(`Test consumer created: id=${testConsumer.id}, paused=${testConsumer.paused}, kind=${testConsumer.kind}`);
      debugLog(`Test consumer rtpParams: ${JSON.stringify(testConsumer.rtpParameters.codecs[0])}`);

      // Connect test transport to a local UDP port to receive data
      const testPort = testTransport.tuple.localPort;
      debugLog(`Test consumer transport port: ${testPort}`);

      testConsumerInterval = setInterval(async () => {
        try {
          const stats = await testConsumer.getStats();
          debugLog(`Test consumer stats: ${JSON.stringify(stats)}`);
          const pStats = await producer.getStats();
          const ps = (pStats as unknown as Array<{ packetCount: number; byteCount: number; score: number }>)[0];
          debugLog(`Producer: ${ps?.packetCount ?? 0} pkts, ${ps?.byteCount ?? 0} bytes, score=${ps?.score ?? 0}`);
        } catch { /* ignore */ }
      }, 5000);

      // Also check client consumer
      setTimeout(async () => {
        try {
          const dump = await router.dump();
          const entry = dump.mapProducerIdConsumerIds.find((e: { key: string }) => e.key === producer.id);
          debugLog(`=== ROUTER STATE ===`);
          debugLog(`Consumers for our producer: ${JSON.stringify(entry)}`);
          debugLog(`All transports: ${JSON.stringify(dump.transportIds)}`);
          debugLog(`All producer→consumer mappings: ${JSON.stringify(dump.mapProducerIdConsumerIds)}`);
        } catch { /* ignore */ }
      }, 3000);
    } catch (err) {
      debugLog(`Test consumer error: ${String(err)}`);
    }

    const consumerCheckInterval = testConsumerInterval;

    // Cleanup function — tears down transport, producer, stream
    const cleanup = () => {
      clearInterval(consumerCheckInterval);
      try { producer.close(); } catch { /* ignore */ }
      try { transport.close(); } catch { /* ignore */ }
      debugLog(`Cleaned up audio resources for ${procKey}`);
    };

    activeSessions.set(procKey, { ffmpeg, cleanup });

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
    ffmpeg.exited.then((code) => {
      debugLog(`ffmpeg[${ffmpeg.pid}] exited — code=${code ?? "null"}`);
      ctx.log(`Playback for "${label}" finished (ffmpeg exit code ${code ?? "null"})`);
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
        session.ffmpeg.kill();
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
      ctx.error(`No active voice channel – cannot play intro for "${username}"`);
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
    async executes(invokerCtx: TInvokerContext) {
      debugLog(`/hero-enable called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      settings.set("enabled", true);
      return "Hero Introducer enabled.";
    },
  });

  // /hero-disable
  ctx.commands.register({
    name: "hero-disable",
    description: "Disable the Hero Introducer plugin.",
    args: [],
    async executes(invokerCtx: TInvokerContext) {
      debugLog(`/hero-disable called by userId=${(invokerCtx as Record<string, unknown>).userId}`);
      settings.set("enabled", false);
      return "Hero Introducer disabled.";
    },
  });

  // /hero-stop – stop currently playing intro
  ctx.commands.register({
    name: "hero-stop",
    description: "Stop the currently playing intro music.",
    args: [],
    async executes(invokerCtx: TInvokerContext) {
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
    async executes(invokerCtx: TInvokerContext) {
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
    async executes(invokerCtx: TInvokerContext) {
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

  // /hero-diagnose – full audio pipeline diagnostic
  ctx.commands.register({
    name: "hero-diagnose",
    description: "Run a full audio pipeline diagnostic to find where audio breaks.",
    args: [],
    async executes(invokerCtx: TInvokerContext) {
      const voiceChannelId = (invokerCtx as Record<string, unknown>).currentVoiceChannelId as number | undefined;
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`/hero-diagnose called by userId=${invokerUserId}, voiceChannelId=${voiceChannelId}`);
      const lines: string[] = ["=== HERO-INTRODUCER DIAGNOSTIC REPORT ===", ""];

      function pass(stage: string, detail: string) { lines.push(`[PASS] ${stage}: ${detail}`); }
      function fail(stage: string, detail: string) { lines.push(`[FAIL] ${stage}: ${detail}`); }
      function info(stage: string, detail: string) { lines.push(`[INFO] ${stage}: ${detail}`); }

      // --- Stage 0: Pre-flight ---
      if (!voiceChannelId) {
        fail("Stage 0", "You are not in a voice channel.");
        return lines.join("\n");
      }

      let ffmpegOk = false;
      try {
        const probe = Bun.spawn({ cmd: ["ffmpeg", "-version"], stdout: "pipe", stderr: "ignore", stdin: "ignore" });
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
        router = ctx.actions.voice.getRouter(voiceChannelId) as unknown as DiagRouter;
        listenInfo = await ctx.actions.voice.getListenInfo() as unknown as DiagListenInfo;
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

      const ffmpegArgs = testAudioPath
        ? [
          "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "warning",
          "-re", "-i", testAudioPath, "-vn", "-t", "5",
          "-af", "volume=0.25",
          "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "128k",
          "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
          "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
        ]
        : [
          "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "warning",
          "-re", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3",
          "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-b:a", "128k",
          "-application", "audio", "-payload_type", "111", "-ssrc", String(ssrc),
          "-f", "rtp", `rtp://${listenInfo.ip}:${rtpPort}?pkt_size=1200`,
        ];

      const ffmpeg = Bun.spawn({ cmd: ffmpegArgs, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
      info("Stage 3", `ffmpeg spawned (PID=${ffmpeg.pid}, SSRC=${ssrc}, target=rtp://${listenInfo.ip}:${rtpPort})`);

      // Wait 2s for ffmpeg to send some packets
      await new Promise((r) => setTimeout(r, 2000));

      let producerStats: any;
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
      let sdkConsumerPaused: boolean | string = "unknown";
      let sdkConsumerStats: any;

      // Hook into producer observer to catch SDK-created consumers
      if (producer.observer?.on) {
        producer.observer.on("newconsumer", async (consumer: any) => {
          sdkConsumerFound = true;
          sdkConsumerPaused = consumer.paused ?? "unknown";
          try {
            sdkConsumerStats = await consumer.getStats();
          } catch { /* ignore */ }
          ctx.log(`[DIAG] SDK consumer detected: id=${consumer.id}, paused=${consumer.paused}`);
        });
      }

      const stream = ctx.actions.voice.createStream({
        channelId: voiceChannelId,
        title: `Diagnostic Test`,
        key: `hero-diag-${voiceChannelId}-${invokerUserId ?? 0}`,
        producers: { audio: producer },
      });
      info("Stage 4", "Stream registered, waiting 5s for SDK to create consumer...");

      // Wait for SDK to create consumer
      await new Promise((r) => setTimeout(r, 5000));

      if (sdkConsumerFound) {
        info("Stage 4", `SDK consumer found! paused=${sdkConsumerPaused}`);
        if (sdkConsumerPaused === true) {
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
        const allTransports: Map<string, any> | undefined = (router as any).transportsForTesting;
        if (allTransports && allTransports instanceof Map) {
          info("Stage 5", `router.transportsForTesting: ${allTransports.size} transports`);

          for (const [tId, tObj] of allTransports) {
            // Skip our own diagnostic transport
            if (tId === transport.id) continue;

            // Each transport has a .consumers Map
            const consumers: Map<string, any> | undefined = tObj.consumers;
            if (consumers && consumers instanceof Map && consumers.size > 0) {
              for (const [cId, cObj] of consumers) {
                if (!consumerIds.includes(cId)) continue;

                // FOUND our consumer!
                const cPaused = cObj.paused ?? "unknown";
                const cKind = cObj.kind ?? "unknown";
                const cType = cObj.type ?? "unknown";
                const cProducerPaused = cObj.producerPaused ?? "unknown";
                info("Stage 5", `CONSUMER ${cId}:`);
                info("Stage 5", `  paused=${cPaused}, producerPaused=${cProducerPaused}, kind=${cKind}, type=${cType}`);
                info("Stage 5", `  on transport ${tId} (type=${typeof tObj.dump === "function" ? "has dump()" : "no dump"})`);

                if (cPaused === true) {
                  fail("Stage 5", `Consumer ${cId} is PAUSED! This is likely BUG-001!`);
                  info("Stage 5", "The Sharkord SDK may not be calling consumer.resume() for plugin-created producers.");
                } else if (cPaused === false) {
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
            const tConsumers: Map<string, any> | undefined = tObj.consumers;
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
    async executes(...params: unknown[]) {
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
