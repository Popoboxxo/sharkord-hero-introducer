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
  ] as const);

  /** Logs a message only when the debug setting is enabled. */
  function debugLog(message: string): void {
    if (settings.get("debug")) {
      ctx.log(`[DEBUG] ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Currently running ffmpeg processes keyed by userId. */
  const activeProcesses = new Map<number, ReturnType<typeof spawn>>();

  /** Set of currently active voice channel IDs. */
  const activeChannels = new Set<number>();

  /** Cache of userId → username, persisted to disk, populated from user:joined events. */
  const userCacheData = await readJsonFile<Record<string, string>>(userCacheFile, {});
  const userNameCache = new Map<number, string>(
    Object.entries(userCacheData).map(([id, name]) => [Number(id), name]),
  );
  ctx.log(`User cache loaded: ${userNameCache.size} entries`);

  // ---------------------------------------------------------------------------
  // Track active voice channels
  // ---------------------------------------------------------------------------

  ctx.events.on("voice:runtime_initialized", ({ channelId }) => {
    activeChannels.add(channelId);
    debugLog(`Voice channel ${channelId} is now active (total: ${activeChannels.size})`);
  });

  ctx.events.on("voice:runtime_closed", ({ channelId }) => {
    activeChannels.delete(channelId);
    debugLog(`Voice channel ${channelId} closed (remaining: ${activeChannels.size})`);
  });

  // ---------------------------------------------------------------------------
  // User join handler – trigger intro music
  // ---------------------------------------------------------------------------
  // NOTE: The 'user:joined' event fires when a user connects to the Sharkord
  // server (not specifically when they join a voice channel, since the SDK
  // does not expose a per-voice-channel join event). The intro is played in
  // the first currently active voice channel.

  ctx.events.on("user:joined", async ({ userId, username }) => {
    debugLog(`>>> user:joined event — userId=${userId}, username="${username}"`);

    // Cache the userId → username mapping for /hero-set-me (persist to disk)
    userNameCache.set(userId, username);
    const cacheObj = Object.fromEntries(userNameCache);
    await writeJsonFile(userCacheFile, cacheObj);
    debugLog(`User cache updated: userId=${userId} → "${username}" (total cached: ${userNameCache.size})`);
    debugLog(`Full user cache: [${[...userNameCache.entries()].map(([id, name]) => `${id}→"${name}"`).join(", ")}]`);

    const enabled = settings.get("enabled");
    if (!enabled) {
      debugLog(`Plugin disabled – skipping intro for "${username}" (userId=${userId})`);
      return;
    }

    // Load the music map (keyed by displayName / username)
    const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
    const mapKeys = Object.keys(musicMap);
    debugLog(`MusicMap loaded — ${mapKeys.length} entries: [${mapKeys.join(", ")}]`);
    debugLog(`Looking up username "${username}" in MusicMap...`);

    const audioFileName = musicMap[username];

    if (!audioFileName) {
      debugLog(`No intro configured for user "${username}" (userId=${userId}). Available mappings: ${mapKeys.length > 0 ? mapKeys.map((k) => `"${k}"→"${musicMap[k]}"`).join(", ") : "(none)"}`);
      return;
    }

    debugLog(`Match found: "${username}" → "${audioFileName}"`);

    // Check once-per-day setting (tracked by userId for uniqueness)
    const oncePerDay = settings.get("oncePerDay");
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(userId)];
      debugLog(`oncePerDay check — lastGreet for userId=${userId}: ${lastGreet ?? "(never)"}, today: ${todayISO()}`);
      if (lastGreet === todayISO()) {
        debugLog(`User "${username}" already greeted today – skipping intro`);
        return;
      }
    }

    // Resolve full path from music directory
    const audioPath = path.join(musicDir, audioFileName);
    debugLog(`Resolved audio path: ${audioPath}`);

    // Verify the audio file exists
    try {
      await fs.access(audioPath);
      debugLog(`Audio file exists: ${audioPath}`);
    } catch {
      ctx.error(
        `Intro file not found for user ${username}: ${audioPath}`,
      );
      return;
    }

    debugLog(`Active voice channels: [${[...activeChannels].join(", ")}] (count: ${activeChannels.size})`);

    // Play the intro in the first active voice channel
    debugLog(`Starting playback for "${username}" in channel ${[...activeChannels][0] ?? "(none)"}...`);
    await playIntroForUser(ctx, userId, username, audioPath, activeProcesses, activeChannels, debugLog);

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
      debugLog(`[CMD] hero-enable called by userId=${(_invokerCtx as Record<string, unknown>).userId}`);
      settings.set("enabled", true);
      return "✅ Hero Introducer enabled.";
    },
  });

  // /hero-disable
  ctx.commands.register({
    name: "hero-disable",
    description: "Disable the Hero Introducer plugin.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      debugLog(`[CMD] hero-disable called by userId=${(_invokerCtx as Record<string, unknown>).userId}`);
      settings.set("enabled", false);
      return "🔇 Hero Introducer disabled.";
    },
  });

  // /hero-stop  – stop currently playing intro
  ctx.commands.register({
    name: "hero-stop",
    description: "Stop the currently playing intro music.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      debugLog(`[CMD] hero-stop called by userId=${(_invokerCtx as Record<string, unknown>).userId}, activeProcesses=${activeProcesses.size}`);
      if (activeProcesses.size === 0) {
        return "ℹ️ No intro is currently playing.";
      }
      for (const [uid, proc] of activeProcesses) {
        proc.kill("SIGTERM");
        activeProcesses.delete(uid);
      }
      return "⏹️ Stopped all running intros.";
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
        description: "File name of the audio file in the music directory (e.g. john-intro.mp3 or john-intro.mpeg).",
        required: true,
        sensitive: false,
      },
    ],
    async executes(
      _invokerCtx: TInvokerContext,
      args: { displayName: string; audioFileName: string },
    ) {
      debugLog(`[CMD] hero-set called by userId=${(_invokerCtx as Record<string, unknown>).userId}, args=${JSON.stringify(args)}`);
      const { displayName, audioFileName } = args;
      if (!isSupportedAudioFile(audioFileName)) {
        return "❌ Only MP3 and MPEG files are supported.";
      }
      const fullPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(fullPath);
      } catch {
        return `❌ File not found in music directory: ${audioFileName}`;
      }
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[displayName] = audioFileName;
      await writeJsonFile(musicMapFile, musicMap);
      return `✅ Intro set for ${displayName}: ${audioFileName}`;
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
      debugLog(`[CMD] hero-remove called by userId=${(_invokerCtx as Record<string, unknown>).userId}, args=${JSON.stringify(args)}`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      if (!musicMap[args.displayName]) {
        return `ℹ️ No intro configured for ${args.displayName}.`;
      }
      delete musicMap[args.displayName];
      await writeJsonFile(musicMapFile, musicMap);
      return `🗑️ Intro removed for ${args.displayName}.`;
    },
  });

  // /hero-list
  ctx.commands.register({
    name: "hero-list",
    description: "List all configured DisplayName → audio file mappings.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      debugLog(`[CMD] hero-list called by userId=${(_invokerCtx as Record<string, unknown>).userId}`);
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const entries = Object.entries(musicMap);
      if (entries.length === 0) {
        return "ℹ️ No intro mappings configured yet.";
      }
      const lines = entries.map(([displayName, audioFileName]) => `• ${displayName}: ${audioFileName}`);
      return `**Intro Mappings**\n${lines.join("\n")}`;
    },
  });

  // /hero-files
  ctx.commands.register({
    name: "hero-files",
    description: "List all available audio files (.mp3, .mpeg) in the music directory.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
      debugLog(`[CMD] hero-files called by userId=${(_invokerCtx as Record<string, unknown>).userId}`);
      let files: string[];
      try {
        const dirEntries = await fs.readdir(musicDir);
        files = dirEntries.filter((f) => isSupportedAudioFile(f));
      } catch {
        files = [];
      }
      if (files.length === 0) {
        return "ℹ️ No audio files found in the music directory.";
      }
      const lines = files.map((f) => `• ${f}`);
      return `**Available Audio Files**\n${lines.join("\n")}`;
    },
  });

  // /hero-set-me <audioFileName> – map the invoking user to an audio file
  ctx.commands.register<{ audioFileName: string }>({
    name: "hero-set-me",
    description:
      "Map your own user to an intro audio file. Usage: /hero-set-me <audioFileName>",
    args: [
      {
        name: "audioFileName",
        type: "string",
        description:
          "File name of the audio file in the music directory (e.g. my-intro.mp3).",
        required: true,
        sensitive: false,
      },
    ],
    async executes(
      invokerCtx: TInvokerContext,
      args: { audioFileName: string },
    ) {
      const invokerUserId = (invokerCtx as Record<string, unknown>).userId as number | undefined;
      debugLog(`[CMD] hero-set-me called by userId=${invokerUserId}, args=${JSON.stringify(args)}`);

      const { audioFileName } = args;
      if (!isSupportedAudioFile(audioFileName)) {
        return "❌ Only MP3 and MPEG files are supported.";
      }
      const fullPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(fullPath);
      } catch {
        return `❌ File not found in music directory: ${audioFileName}`;
      }

      // Look up username from cache (populated by user:joined events)
      const invokerName = invokerUserId !== undefined ? userNameCache.get(invokerUserId) : undefined;
      if (!invokerName) {
        debugLog(`hero-set-me: userId=${invokerUserId}, cached usernames=[${[...userNameCache.entries()].map(([id, name]) => `${id}→${name}`).join(", ")}]`);
        return "❌ Could not determine your username. Please rejoin the server first so your name is cached, then try again.";
      }

      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      musicMap[invokerName] = audioFileName;
      await writeJsonFile(musicMapFile, musicMap);
      debugLog(`hero-set-me: mapped "${invokerName}" → "${audioFileName}"`);
      return `✅ Intro set for yourself (${invokerName}): ${audioFileName}`;
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
      debugLog(`[CMD] hero-play-me called by userId=${invokerUserId}, voiceChannelId=${voiceChannelId}`);

      if (invokerUserId === undefined) {
        return "❌ Could not determine your user ID.";
      }

      // Resolve username from cache
      const invokerName = userNameCache.get(invokerUserId);
      debugLog(`hero-play-me: userId=${invokerUserId} → cached username="${invokerName ?? "(not cached)"}"`);
      if (!invokerName) {
        return "❌ Your username is not cached yet. Please rejoin the server and try again.";
      }

      // Look up audio mapping
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const audioFileName = musicMap[invokerName];
      debugLog(`hero-play-me: MusicMap lookup "${invokerName}" → "${audioFileName ?? "(no mapping)"}"`);
      if (!audioFileName) {
        return `ℹ️ No intro configured for you (${invokerName}). Use /hero-set-me to set one.`;
      }

      // Verify audio file
      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `❌ Intro file not found: ${audioFileName}`;
      }

      // Determine target channel
      if (!voiceChannelId) {
        return "❌ You are not in a voice channel. Join one first, then try again.";
      }

      debugLog(`hero-play-me: playing "${audioFileName}" for "${invokerName}" in channel ${voiceChannelId}`);
      await playIntroForUser(ctx, invokerUserId, invokerName, audioPath, activeProcesses, activeChannels, debugLog, voiceChannelId);
      return `🎵 Playing your intro: ${audioFileName}`;
    },
  });

  // /hero-play <displayName> – play another user's intro in your voice channel
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
      debugLog(`[CMD] hero-play called by userId=${invokerUserId}, args=${JSON.stringify(args)}, voiceChannelId=${voiceChannelId}`);

      // Determine target channel
      if (!voiceChannelId) {
        return "❌ You are not in a voice channel. Join one first, then try again.";
      }

      // Look up audio mapping
      const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
      const audioFileName = musicMap[displayName];
      debugLog(`hero-play: MusicMap lookup "${displayName}" → "${audioFileName ?? "(no mapping)"}"`);
      if (!audioFileName) {
        return `ℹ️ No intro configured for ${displayName}.`;
      }

      // Verify audio file
      const audioPath = path.join(musicDir, audioFileName);
      try {
        await fs.access(audioPath);
      } catch {
        return `❌ Intro file not found: ${audioFileName}`;
      }

      debugLog(`hero-play: playing "${audioFileName}" for "${displayName}" in channel ${voiceChannelId}`);
      await playIntroForUser(ctx, invokerUserId ?? 0, displayName, audioPath, activeProcesses, activeChannels, debugLog, voiceChannelId);
      return `🎵 Playing intro for ${displayName}: ${audioFileName}`;
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
      return `📋 Dumped ${params.length} params to server log.`;
    },
  });

  ctx.ui.enable();
  ctx.log("Hero Introducer ready");
};

// ---------------------------------------------------------------------------
// Audio playback via ffmpeg → mediasoup PlainTransport
// ---------------------------------------------------------------------------

async function playIntroForUser(
  ctx: PluginContext,
  userId: number,
  username: string,
  mp3Path: string,
  activeProcesses: Map<number, ReturnType<typeof spawn>>,
  activeChannels: Set<number>,
  debugLog: (msg: string) => void = () => {},
  targetChannelId?: number,
): Promise<void> {
  debugLog(`playIntroForUser: state dump — activeProcesses=${activeProcesses.size}, activeChannels=[${[...activeChannels].join(", ")}], targetChannelId=${targetChannelId ?? "(auto)"}`);

  // Use the specified channel or fall back to the first active one
  const channelId = targetChannelId ?? [...activeChannels][0];
  if (channelId === undefined) {
    ctx.error("No active voice channel found – cannot play intro");
    return;
  }

  debugLog(`playIntroForUser: using channelId=${channelId}, userId=${userId}, username="${username}", mp3Path="${mp3Path}"`);

  let router;
  try {
    router = ctx.actions.voice.getRouter(channelId);
    debugLog(`Got router for channel ${channelId}`);
  } catch (err) {
    ctx.error(`Failed to get voice router for channel ${channelId}: ${String(err)}`);
    return;
  }

  const listenInfo = ctx.actions.voice.getListenInfo();
  debugLog(`listenInfo: ip=${listenInfo.ip}, announcedAddress=${listenInfo.announcedAddress}`);

  try {
    // Create a plain RTP transport to inject audio
    const plainTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: listenInfo.ip,
        announcedAddress: listenInfo.announcedAddress,
        portRange: { min: 40100, max: 40200 },
      },
      rtcpMux: true,
      comedia: true,
    });

    const rtpPort = plainTransport.tuple.localPort;
    // ffmpeg runs in the same container as mediasoup, so always send to 127.0.0.1
    // (plainTransport.tuple.localIp returns the announcedAddress which is the public IP)
    const rtpIp = "127.0.0.1";
    debugLog(`PlainTransport created: publicIp=${plainTransport.tuple.localIp}, rtpTarget=${rtpIp}:${rtpPort}`);

    // Produce audio on this transport (Opus is required by WebRTC/mediasoup)
    const producer = await plainTransport.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [
          {
            mimeType: "audio/opus",
            payloadType: 101,
            clockRate: 48000,
            channels: 2,
            parameters: {
              "sprop-stereo": 1,
            },
          },
        ],
        encodings: [{ ssrc: 11111111 + userId }],
      },
    });

    // Use ctx.actions.voice.createStream to expose the producer in the channel
    const stream = ctx.actions.voice.createStream({
      channelId,
      title: `🎵 Intro: ${username}`,
      key: `hero-intro-${userId}`,
      producers: { audio: producer },
    });

    debugLog(`Producer created, SSRC=${11111111 + userId}, stream key=hero-intro-${userId}`);

    // Spawn ffmpeg to decode the MP3 and send it as RTP/Opus to mediasoup
    // IMPORTANT: The SSRC must match the one configured in the producer, otherwise
    // mediasoup will drop the packets and no audio will be forwarded to consumers.
    const ssrc = 11111111 + userId;
    debugLog(`Spawning ffmpeg: -re -i "${mp3Path}" -vn -acodec libopus -ssrc ${ssrc} -f rtp rtp://${rtpIp}:${rtpPort}`);
    const ffmpeg = spawn("ffmpeg", [
      "-re",
      "-i", mp3Path,
      "-vn",
      "-acodec", "libopus",
      "-ab", "128k",
      "-ar", "48000",
      "-ac", "2",
      "-ssrc", String(ssrc),
      "-f", "rtp",
      `rtp://${rtpIp}:${rtpPort}?pkt_size=1316`,
    ]);

    activeProcesses.set(userId, ffmpeg);

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      ctx.debug(`ffmpeg: ${chunk.toString()}`);
    });

    ffmpeg.on("close", (code: number | null) => {
      ctx.log(
        `Intro for ${username} finished (ffmpeg exited with code ${code ?? "null"})`,
      );
      activeProcesses.delete(userId);
      stream.remove();
      producer.close();
      plainTransport.close();
    });

    ffmpeg.on("error", (err: Error) => {
      ctx.error(`ffmpeg error for ${username}: ${err.message}`);
      activeProcesses.delete(userId);
      stream.remove();
      try { producer.close(); } catch { /* ignore */ }
      try { plainTransport.close(); } catch { /* ignore */ }
    });
  } catch (err) {
    ctx.error(
      `Failed to set up audio stream for ${username}: ${String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Plugin unload entry point
// ---------------------------------------------------------------------------

const onUnload = (ctx: PluginContext) => {
  ctx.log("Hero Introducer unloaded");
};

export { onLoad, onUnload };
