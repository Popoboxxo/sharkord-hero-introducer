# Architektur — sharkord-hero-introducer

> **Stand:** 17. Maerz 2026
> **Version:** 0.1.0

---

## Ueberblick

Das Plugin besteht aus zwei Entry-Points (Server und Client), wobei der Client aktuell leer ist. Die gesamte Logik befindet sich in `src/server.ts`.

```
src/
  server.ts    -- Plugin-Logik (Lifecycle, Commands, Events, Playback, Diagnose)
  client.ts    -- Leerer Client-Entry (kein UI)

build.ts       -- Bun Build-Script
```

---

## Modul-Architektur

`src/server.ts` ist als einzelne Datei strukturiert, die sich in folgende logische Bereiche gliedert:

```
server.ts
  |
  +-- Types (MusicMap, DailyGreets)
  |
  +-- Hilfsfunktionen (Modul-Ebene)
  |     +- isSupportedAudioFile()
  |     +- todayISO()
  |     +- readJsonFile()
  |     +- writeJsonFile()
  |
  +-- onLoad(ctx) -- Hauptfunktion, enthaelt alles in einer Closure:
  |     |
  |     +-- Settings-Registrierung (enabled, oncePerDay, debug, volume)
  |     +-- debugLog() -- Closure-interne Hilfsfunktion
  |     +-- resolveAudioFile() -- Closure-interne Hilfsfunktion
  |     +-- ResolveResult, PlaybackSession -- Closure-interne Types
  |     |
  |     +-- State (activeSessions, activeChannels, userNameCache)
  |     |
  |     +-- playAudio() -- On-demand Streaming-Pipeline
  |     |
  |     +-- Event-Handler
  |     |     +- voice:runtime_initialized
  |     |     +- voice:runtime_closed
  |     |     +- user:joined
  |     |
  |     +-- Commands (13 Stueck)
  |     |     +- hero-enable, hero-disable, hero-stop
  |     |     +- hero-set, hero-remove, hero-list, hero-files
  |     |     +- hero-set-me, hero-play-me, hero-play, hero-play-song
  |     |     +- hero-diagnose, hero-dump-context
  |     |
  |     +-- ctx.ui.enable()
  |
  +-- onUnload(ctx) -- Cleanup-Funktion
  |
  +-- export { onLoad, onUnload }
```

---

## Externe Abhaengigkeiten

| Abhaengigkeit | Verwendung | Build-Behandlung |
|---------------|-----------|-----------------|
| `@sharkord/plugin-sdk` | `PluginContext`, `TInvokerContext` Types | Zur Laufzeit von Sharkord bereitgestellt |
| `@sharkord/shared` | Shared Types | Zur Laufzeit von Sharkord bereitgestellt |
| `mediasoup` | WebRTC SFU (Router, PlainTransport, Producer) | `external` im Build — nicht gebuendelt |
| `ffmpeg` | Audio-Dekodierung (MP3/MPEG -> Opus RTP) | System-Binary, muss in `PATH` sein |

---

## Audio-Pipeline

```
Audio-Datei (.mp3/.mpeg)
  |
  v
ffmpeg (Bun.spawn)
  - Dekodiert Audio
  - Enkodiert als Opus
  - Sendet als RTP-Pakete
  |
  v
mediasoup PlainTransport (UDP, comedia)
  - Empfaengt RTP auf lokalen Port
  |
  v
mediasoup Producer (audio/opus, PT 111, 48kHz, stereo)
  |
  v
Sharkord SDK createStream()
  - Exponiert Producer im Voice-Channel
  |
  v
mediasoup Consumer (vom SDK erstellt)
  - Leitet Audio an WebRTC-Clients weiter
  |
  v
Browser/Client
  - Empfaengt Audio via WebRTC
```

**Volume-Kontrolle:** Wird server-seitig via ffmpeg-Audiofilter (`-af volume=X.XX`) angewendet, bevor das Audio in die RTP-Pipeline gelangt.

---

## Datenfluss

### Persistenz-Schicht

```
<plugin-dir>/
  data/
    music-map.json      -- displayName -> audioFileName
    daily-greets.json   -- userId -> ISO-Datum (letzte Begruessung)
    user-cache.json     -- userId -> username (fuer /hero-set-me, /hero-play-me)
  music/
    *.mp3, *.mpeg       -- Audio-Dateien
```

Alle JSON-Dateien werden ueber die generischen Hilfsfunktionen `readJsonFile()` und `writeJsonFile()` verwaltet. Bei nicht-existierenden Dateien wird ein Fallback-Wert (`{}`) verwendet.

### State-Management (In-Memory)

```
activeSessions: Map<string, PlaybackSession>
  - Key: "channelId-userId"
  - Value: { ffmpeg, cleanup }
  - Lifecycle: Erstellt bei playAudio(), geloescht bei ffmpeg-Exit oder /hero-stop

activeChannels: Set<number>
  - Befuellt durch voice:runtime_initialized
  - Geleert durch voice:runtime_closed

userNameCache: Map<number, string>
  - Beim Start aus user-cache.json geladen
  - Bei jedem user:joined aktualisiert und persistiert
```

---

## Build-Pipeline

```
bun build.ts
  |
  +-- Bun.build(server.ts)
  |     - target: bun
  |     - format: esm
  |     - minify: true
  |     - external: ["mediasoup"]
  |
  +-- Bun.build(client.ts)  (parallel)
  |     - target: browser
  |     - format: esm
  |     - minify: true
  |     - plugins: [clientGlobals]
  |
  +-- fs.copyFile(package.json)
  |
  v
dist/sharkord-hero-introducer/
  server.js
  client.js
  package.json
```

---

## Architektur-Entscheidungen

| Entscheidung | Begruendung |
|-------------|-------------|
| Alles in einer Datei (`server.ts`) | Plugin ist ueberschaubar genug. Closure-basierter State vermeidet globale Variablen. |
| On-demand Playback (kein persistenter Bot) | Ressourcen werden nur waehrend der Wiedergabe belegt und danach aufgeraeumt. |
| `Bun.spawn` statt `child_process.spawn` | Bun-Runtime-Konformitaet. Angelehnt an das funktionierende Referenz-Plugin `sharkord-music-bot`. |
| displayName statt userId als MusicMap-Key | Benutzerfreundlicher. Username wird aus dem `user:joined`-Event entnommen. |
| Flexible Dateinamen-Aufloesung | Benutzerkomfort: Eingabe mit/ohne Endung, case-insensitive, Duplikat-Warnung. |
| Server-seitige Volume-Kontrolle via ffmpeg | Einfacher als Client-seitige Anpassung, sofort wirksam fuer alle Listener. |
| `/hero-diagnose` mit 7 Stages | Systematische Fehlersuche fuer BUG-001 (Audio nicht hoerbar). Jede Stage ist isoliert testbar. |

---

## Aenderungshistorie

| Datum | Aenderung |
|-------|----------|
| 2026-03-17 | Initiale Erstellung basierend auf IST-Zustand des Codes |
