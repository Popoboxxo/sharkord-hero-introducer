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
  ] as const);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Currently running ffmpeg processes keyed by userId. */
  const activeProcesses = new Map<number, ReturnType<typeof spawn>>();

  /** Set of currently active voice channel IDs. */
  const activeChannels = new Set<number>();

  // ---------------------------------------------------------------------------
  // Track active voice channels
  // ---------------------------------------------------------------------------

  ctx.events.on("voice:runtime_initialized", ({ channelId }) => {
    activeChannels.add(channelId);
    ctx.debug(`Voice channel ${channelId} is now active`);
  });

  ctx.events.on("voice:runtime_closed", ({ channelId }) => {
    activeChannels.delete(channelId);
    ctx.debug(`Voice channel ${channelId} closed`);
  });

  // ---------------------------------------------------------------------------
  // User join handler – trigger intro music
  // ---------------------------------------------------------------------------
  // NOTE: The 'user:joined' event fires when a user connects to the Sharkord
  // server (not specifically when they join a voice channel, since the SDK
  // does not expose a per-voice-channel join event). The intro is played in
  // the first currently active voice channel.

  ctx.events.on("user:joined", async ({ userId, username }) => {
    const enabled = settings.get("enabled");
    if (!enabled) {
      ctx.debug(`Hero Introducer disabled – skipping intro for ${username}`);
      return;
    }

    // Load the music map (keyed by displayName / username)
    const musicMap = await readJsonFile<MusicMap>(musicMapFile, {});
    const audioFileName = musicMap[username];

    if (!audioFileName) {
      ctx.debug(`No intro configured for user ${username} (${userId})`);
      return;
    }

    // Check once-per-day setting (tracked by userId for uniqueness)
    const oncePerDay = settings.get("oncePerDay");
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      const lastGreet = dailyGreets[String(userId)];
      if (lastGreet === todayISO()) {
        ctx.debug(
          `User ${username} already greeted today – skipping intro`,
        );
        return;
      }
    }

    // Resolve full path from music directory
    const audioPath = path.join(musicDir, audioFileName);

    // Verify the audio file exists
    try {
      await fs.access(audioPath);
    } catch {
      ctx.error(
        `Intro file not found for user ${username}: ${audioPath}`,
      );
      return;
    }

    // Play the intro in the first active voice channel
    await playIntroForUser(ctx, userId, username, audioPath, activeProcesses, activeChannels);

    // Record the greeting date
    if (oncePerDay) {
      const dailyGreets = await readJsonFile<DailyGreets>(dailyGreetsFile, {});
      dailyGreets[String(userId)] = todayISO();
      await writeJsonFile(dailyGreetsFile, dailyGreets);
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
      return "✅ Hero Introducer enabled.";
    },
  });

  // /hero-disable
  ctx.commands.register({
    name: "hero-disable",
    description: "Disable the Hero Introducer plugin.",
    args: [],
    async executes(_invokerCtx: TInvokerContext) {
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
): Promise<void> {
  // Use the first currently active voice channel
  const channelId = [...activeChannels][0];
  if (channelId === undefined) {
    ctx.error("No active voice channel found – cannot play intro");
    return;
  }

  let router;
  try {
    router = ctx.actions.voice.getRouter(channelId);
  } catch (err) {
    ctx.error(`Failed to get voice router for channel ${channelId}: ${String(err)}`);
    return;
  }

  const listenInfo = ctx.actions.voice.getListenInfo();

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
    const rtpIp = plainTransport.tuple.localIp;

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

    // Spawn ffmpeg to decode the MP3 and send it as RTP/Opus to mediasoup
    const ffmpeg = spawn("ffmpeg", [
      "-re",
      "-i", mp3Path,
      "-vn",
      "-acodec", "libopus",
      "-ab", "128k",
      "-ar", "48000",
      "-ac", "2",
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
