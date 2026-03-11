# sharkord-A

A [Sharkord](https://sharkord.com) plugin that automatically plays a personalised **MP3 intro** for each user the moment they join a voice channel.

---

## Features

| Feature | Details |
|---------|---------|
| **Auto-play on join** | Joins the active voice channel and plays the user's personal MP3 when they enter. |
| **No file → no sound** | If no MP3 is mapped to a user, nothing happens. |
| **Enable / disable** | `/hero-enable` and `/hero-disable` commands let admins switch the plugin on or off at any time. |
| **Once-per-day** | Optional setting ensures each user is greeted at most once per calendar day. |
| **Stop command** | `/hero-stop` immediately stops all currently playing intros. |
| **MP3 support** | Uses `ffmpeg` to decode MP3 files and stream them as Opus RTP into mediasoup. |

---

## Requirements

- [Sharkord](https://github.com/Sharkord/sharkord) server
- [`ffmpeg`](https://ffmpeg.org/) available in `PATH` on the server machine

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

| Command | Description |
|---------|-------------|
| `/hero-enable` | Enable the plugin (intros will be played). |
| `/hero-disable` | Disable the plugin (no intros until re-enabled). |
| `/hero-stop` | Stop all currently playing intros immediately. |
| `/hero-set <userId> <filePath>` | Map an MP3 file to a user. |
| `/hero-remove <userId>` | Remove the MP3 mapping for a user. |
| `/hero-list` | Show all user → MP3 mappings. |

### Example

```
/hero-set popoboxxo john-intro.mp3
/hero-set eisenbart jane-intro.mp3
/hero-list
/hero-disable
/hero-enable
/hero-stop
```

---

## Plugin Settings

These can be changed in the Sharkord UI under **Plugins → Hero Introducer → Settings**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Master on/off switch. |
| `oncePerDay` | boolean | `true` | When `true`, each user is greeted at most once per calendar day. |

---

## User → Music Mapping

Mappings are managed with the `/hero-set` command and stored persistently in:

```
~/.config/sharkord/plugins/sharkord-hero-introducer/data/music-map.json
```

### File format

```json
{
  "42": "/home/sharkord/music/john-intro.mp3",
  "17": "/home/sharkord/music/jane-intro.mp3"
}
```

The **key** is the numeric Sharkord **user ID** (visible in the admin panel or via the user's profile).  
The **value** is the **absolute path** to the MP3 file on the server.

### Recommended folder layout

Place all intro MP3 files in a dedicated folder and use user IDs as file names for easy management:

```
/home/sharkord/music/intros/
├── 42.mp3   # John's intro
├── 17.mp3   # Jane's intro
└── 99.mp3   # Bob's intro
```

Then map them:

```
/hero-set 42 /home/sharkord/music/intros/42.mp3
/hero-set 17 /home/sharkord/music/intros/17.mp3
```

---

## How it works

1. When a user joins the Sharkord server the plugin checks whether the plugin is enabled.
2. It looks up the user's ID in `music-map.json`.
3. If an MP3 path is found it checks whether the user has already been greeted today (when `oncePerDay` is enabled).
4. The plugin obtains the first active voice channel router via the Sharkord mediasoup integration.
5. A `PlainTransport` is created and `ffmpeg` is spawned to decode the MP3 and send it as RTP/Opus to mediasoup.
6. The stream is exposed in the voice channel so all participants hear the intro.
7. When the ffmpeg process exits (end of file or `/hero-stop`) the transport and producer are cleaned up automatically.

---

## License

MIT
