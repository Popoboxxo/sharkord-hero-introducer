# sharkord-hero-introducer

A [Sharkord](https://sharkord.com) plugin that automatically plays a personalised **MP3/MPEG intro** when a user joins a voice channel (`voice:user_joined`).

> [!WARNING]
> ## VibeCoding Experiment — Read Before Using
> This repository is intentionally run as a **VibeCoding experiment**.
> The primary goal is to demonstrate both the **benefits** and **risks** of LLM-driven development on a real but minimal project around Sharkord.
>
> ### Ground rules of this repo
> - **Source code interventions should happen only in absolute emergencies.**
> - The preferred workflow is to explore how far we can get with LLM providers, agent orchestration, and prompt-driven iteration.
> - This project is a **sandbox/playground** for experimenting with different AI coding styles, tooling, and operational patterns.
> - "Production hardening" is not the primary objective; learning effects and transparent trade-offs are.
> - And yes: it is also just a fun way to spend an evening with the Dudes on Sharkord, trying out weird and funny plugin ideas. :)
>
> In short: this is a practical lab setup around Sharkord to evaluate VibeCoding methods, compare approaches, and optionally extend a cool project while making limitations visible.

---

## Features

| Feature | Details |
|---------|---------|
| **Auto-play on voice join** | Uses `voice:user_joined` and plays the user's intro in the exact channel from the event payload. |
| **MP3 and MPEG support** | Supports both `.mp3` and `.mpeg` audio files. |
| **Flexible file matching** | File names can be specified with or without extension, case-insensitive. Duplicate names are detected. |
| **On-demand playback** | The bot does not stay in the channel. Transport, producer, and stream are created per playback and cleaned up automatically. |
| **Bundled ffmpeg support** | Plugin uses `bin/ffmpeg` from within the plugin directory if present; falls back to `ffmpeg` from `PATH`. |
| **Once-per-day** | Optional setting ensures each user is greeted at most once per calendar day. |
| **Volume control** | Server-side volume control (0-100%) applied via ffmpeg audio filter. |
| **Self-service mapping** | Users can set their own intro with `/hero-set-me`. |
| **Manual playback** | Play any user's intro or any song from the music directory on demand. |
| **Pipeline diagnostics** | `/hero-diagnose` runs a full audio pipeline diagnostic with PASS/FAIL report per stage. |
| **Stop command** | `/hero-stop` immediately stops all currently playing intros. |

---

## Requirements

- [Sharkord](https://github.com/Sharkord/sharkord) server >= 0.0.16
- [`ffmpeg`](https://ffmpeg.org/) — place as `bin/ffmpeg` (or `bin/ffmpeg.exe` on Windows) inside the plugin directory, or make it available in `PATH`
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

**ffmpeg binary:** Place `ffmpeg` (Linux/macOS) or `ffmpeg.exe` (Windows) in the `bin/` directory inside the plugin folder. The plugin will automatically use it. If no bundled binary is found, it falls back to `ffmpeg` from `PATH`.

---

## GitHub Issue Autofix Workflows

This repository includes a two-stage GitHub automation flow for issue handling:

1. `issue-auto-analysis.yml` runs automatically for new or reopened issues with read-only permissions.
2. `issue-auto-fix.yml` runs automatically for each newly opened issue and creates a draft PR when a fix passes validation.

The privileged workflow expects an OpenAI-compatible API configuration:

- Secret: `ISSUE_AUTOFIX_API_KEY`
- Variable: `ISSUE_AUTOFIX_MODEL` (optional, defaults to `gpt-5.4-mini`)
- Variable: `ISSUE_AUTOFIX_API_URL` (optional, defaults to `https://api.openai.com/v1/chat/completions`)

Safety model:

- Issue analysis never receives write permissions or repository secrets.
- The fixing workflow runs from trusted default-branch workflow code and only creates a draft PR after a valid patch, successful tests and a successful build.
- Untrusted issue text is sanitized and passed as serialized data into repository-owned Bun scripts.
- Generated patches may only touch `src/`, `docs/` or `README.md`.
- A draft pull request is created only if a patch applies cleanly, produces a diff, and both `bun test` and `bun run build` succeed.

Repository runbook:

1. Open an issue. The read-only analysis workflow stores an `issue-analysis-<number>` artifact.
2. The autofix workflow starts automatically and attempts to generate a patch.
3. Ensure the repository has `ISSUE_AUTOFIX_API_KEY` configured and optionally `ISSUE_AUTOFIX_MODEL` or `ISSUE_AUTOFIX_API_URL`.
4. Review the created draft PR manually before converting or merging it.

---

## Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
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

> **Note:** `/hero-enable` and `/hero-disable` have been removed. The plugin is always active once loaded. Use Sharkord's plugin management to enable or disable it.

---

## Plugin Settings

These can be changed in the Sharkord UI under **Plugins > Hero Introducer > Settings**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
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

The **key** is the user's **display name** (as shown in Sharkord and received via `voice:user_joined` events).
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

1. When a user joins a voice channel, Sharkord emits `voice:user_joined` with `channelId`, `userId`, and `username`.
2. The plugin looks up the user's **display name** in `music-map.json`.
3. If an audio file mapping is found, it checks whether the user has already been greeted today (when `oncePerDay` is enabled).
4. The audio file is verified to exist in the `<plugin-dir>/music/` directory.
5. After a configurable delay (`INTRO_DELAY_MS`, default 5 seconds), playback starts in the exact `channelId` from the event.
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

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) license. See the [LICENSE](LICENSE) file for details.
