# sharkord-hero-introducer

A [Sharkord](https://sharkord.com) plugin that automatically plays a personalised **MP3/MPEG intro** for each user the moment they join the server and a voice channel is active.

---

## Features

| Feature | Details |
|---------|---------|
| **Auto-play on join** | Detects user joins and plays the user's personal intro in the first active voice channel. |
| **MP3 and MPEG support** | Supports both `.mp3` and `.mpeg` audio files. |
| **Flexible file matching** | File names can be specified with or without extension, case-insensitive. Duplicate names are detected. |
| **On-demand playback** | The bot does not stay in the channel. Transport, producer, and stream are created per playback and cleaned up automatically. |
| **Enable / disable** | `/hero-enable` and `/hero-disable` commands let admins switch the plugin on or off at any time. |
| **Once-per-day** | Optional setting ensures each user is greeted at most once per calendar day. |
| **Volume control** | Server-side volume control (0-100%) applied via ffmpeg audio filter. |
| **Self-service mapping** | Users can set their own intro with `/hero-set-me`. |
| **Manual playback** | Play any user's intro or any song from the music directory on demand. |
| **Pipeline diagnostics** | `/hero-diagnose` runs a full audio pipeline diagnostic with PASS/FAIL report per stage. |
| **Stop command** | `/hero-stop` immediately stops all currently playing intros. |

---

## Requirements

- [Sharkord](https://github.com/Sharkord/sharkord) server
- [`ffmpeg`](https://ffmpeg.org/) available in `PATH` on the server machine
- [Bun](https://bun.sh/) runtime

---

## Installation

```bash
# Clone and build
git clone https://github.com/Popoboxxo/sharkord-hero-introducer.git
cd sharkord-hero-introducer
bun install
bun run build

# Copy the built plugin to your Sharkord plugins directory
cp -r dist/sharkord-hero-introducer ~/.config/sharkord/plugins/
```

Restart Sharkord and activate the plugin in the Plugins settings page.

---

## Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/hero-enable` | -- | Enable the plugin (intros will be played). |
| `/hero-disable` | -- | Disable the plugin (no intros until re-enabled). |
| `/hero-stop` | -- | Stop all currently playing intros immediately. |
| `/hero-set` | `<displayName> <audioFileName>` | Map an audio file to a display name. File name can be with or without extension. |
| `/hero-remove` | `<displayName>` | Remove the intro mapping for a display name. |
| `/hero-list` | -- | Show all display name to audio file mappings. |
| `/hero-files` | -- | List all available audio files (`.mp3`, `.mpeg`) in the music directory. |
| `/hero-set-me` | `<audioFileName>` | Map your own user to an intro audio file. |
| `/hero-play-me` | -- | Play your own intro in the voice channel you are currently in. |
| `/hero-play` | `<displayName>` | Play another user's intro in the voice channel you are currently in. |
| `/hero-play-song` | `<songName>` | Play any audio file from the music directory. |
| `/hero-diagnose` | -- | Run a full audio pipeline diagnostic (7 stages, PASS/FAIL report). |
| `/hero-dump-context` | `[testArg]` | (Debug) Dump the invoker context and args to the log. |

### Example

```
/hero-set eisenbart eisenbart.mpeg
/hero-set-me my-intro
/hero-list
/hero-play eisenbart
/hero-play-song vibecodin
/hero-files
/hero-stop
```

---

## Plugin Settings

These can be changed in the Sharkord UI under **Plugins > Hero Introducer > Settings**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Master on/off switch. |
| `oncePerDay` | boolean | `true` | When `true`, each user is greeted at most once per calendar day. |
| `debug` | boolean | `false` | When `true`, detailed debug information is logged (user joins, mapping lookups, playback steps). |
| `volume` | number | `25` | Playback volume (0-100%). Applied server-side via ffmpeg audio filter. |

---

## Display Name to Music Mapping

Mappings are managed with the `/hero-set` command and stored persistently in:

```
<plugin-dir>/data/music-map.json
```

### File format

```json
{
  "eisenbart": "eisenbart.mpeg",
  "icemage": "icemage.mpeg",
  "vibecodin": "vibecodin.mpeg"
}
```

The **key** is the user's **display name** (as shown in Sharkord and received via `user:joined` events).
The **value** is the **audio file name** (relative to the `<plugin-dir>/music/` directory).

### Music directory

Place all intro audio files in the plugin's music directory:

```
<plugin-dir>/music/
  eisenbart.mpeg
  icemage.mpeg
  vibecodin.mpeg
  my-custom-intro.mp3
```

The `/hero-files` command lists all available files in this directory.

---

## How it works

1. When a user joins the Sharkord server, the plugin checks whether it is enabled.
2. It looks up the user's **display name** (from the `user:joined` event) in `music-map.json`.
3. If an audio file mapping is found, it checks whether the user has already been greeted today (when `oncePerDay` is enabled).
4. The audio file is verified to exist in the `<plugin-dir>/music/` directory.
5. After a 5-second delay, the plugin obtains the first active voice channel router via the Sharkord mediasoup integration.
6. A `PlainTransport` is created and `ffmpeg` is spawned (via `Bun.spawn`) to decode the audio and send it as RTP/Opus to mediasoup.
7. The stream is exposed in the voice channel via `createStream` so all participants hear the intro.
8. When the ffmpeg process exits (end of file or `/hero-stop`) the transport, producer, and stream are cleaned up automatically. The bot does not persist in the channel.

---

## Development

```bash
bun install         # Install dependencies
bun run build       # Build the plugin
bun run build:zip   # Build and zip dist/
bun test            # Run all tests
bun test tests/unit # Run unit tests only
```

---

## License

MIT
