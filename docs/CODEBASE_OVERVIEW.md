# Codebase Overview — sharkord-hero-introducer

> **Stand:** 13. März 2026
> **Version:** 0.1.0

---

## Dateiübersicht

| Datei | Zeilen | Rolle |
|-------|--------|-------|
| `src/server.ts` | ~600 | Plugin-Server-Entry-Point: Lifecycle, Commands, Events, Playback |
| `src/client.ts` | 2 | Leerer Client-Entry-Point (kein UI) |
| `build.ts` | ~63 | Bun Build-Script (Server + Client + package.json kopieren) |

---

## src/server.ts

### Types

| Type | Definition | REQ |
|------|-----------|-----|
| `MusicMap` | `Record<string, string>` — displayName → audioFileName (.mp3 oder .mpeg) | REQ-DATA-001 |
| `DailyGreets` | `Record<string, string>` — userId → ISO-Datum `"YYYY-MM-DD"` | REQ-DATA-002 |

### Konstanten

| Konstante | Wert | Beschreibung | REQ |
|-----------|------|-------------|-----|
| `SUPPORTED_EXTENSIONS` | `[".mp3", ".mpeg"]` | Unterstützte Audio-Dateiendungen | REQ-CMD-004, REQ-CMD-007 |

### Interne Hilfsfunktionen

| Funktion | Signatur | Beschreibung | REQ |
|----------|----------|-------------|-----|
| `isSupportedAudioFile` | `(fileName: string) => boolean` | Prüft ob Dateiname auf unterstützte Endung endet (`.mp3` oder `.mpeg`) | REQ-CMD-004, REQ-CMD-007 |
| `todayISO` | `() => string` | Gibt heutiges Datum als `"YYYY-MM-DD"` zurück | REQ-CFG-002 |
| `readJsonFile` | `<T>(filePath: string, fallback: T) => Promise<T>` | Liest JSON-Datei, bei Fehler → `fallback` | REQ-DATA-004 |
| `writeJsonFile` | `(filePath: string, data: unknown) => Promise<void>` | Schreibt JSON mit `mkdir -p` für Parent-Dir | REQ-DATA-001, REQ-DATA-002 |

### Exportierte API

| Export | Signatur | REQ |
|--------|----------|-----|
| `onLoad` | `(ctx: PluginContext) => Promise<void>` | REQ-LIFE-001 |
| `onUnload` | `(ctx: PluginContext) => void` | REQ-LIFE-002 |

### onLoad — Registrierungen

#### Settings

| Key | Typ | Default | REQ |
|-----|-----|---------|-----|
| `enabled` | `boolean` | `true` | REQ-CFG-001 |
| `oncePerDay` | `boolean` | `true` | REQ-CFG-002 |
| `debug` | `boolean` | `false` | REQ-CFG-004 |

#### Interne Hilfsfunktionen (in onLoad-Closure)

| Funktion | Signatur | Beschreibung | REQ |
|----------|----------|-------------|-----|
| `debugLog` | `(message: string) => void` | Loggt nur wenn `debug=true`, mit `[DEBUG]` Prefix via `ctx.log()` | REQ-DBG-001 |

#### State (lokal in onLoad-Closure)

| Variable | Typ | Zweck |
|----------|-----|-------|
| `activeProcesses` | `Map<number, ChildProcess>` | Laufende ffmpeg-Prozesse, keyed by userId |
| `activeChannels` | `Set<number>` | Aktive Voice-Channel-IDs |
| `userNameCache` | `Map<number, string>` | userId → username Cache, persistiert zu `data/user-cache.json`. Beim Start aus Datei geladen, bei jedem `user:joined` Event aktualisiert und auf Disk geschrieben. |

**Startup-Logging:** Beim Laden wird die User-Cache-Größe geloggt (`User cache loaded: N entries`).

#### Events

| Event | Handler-Logik | REQ |
|-------|--------------|-----|
| `voice:runtime_initialized` | `activeChannels.add(channelId)`, `debugLog()` | REQ-CORE-005, REQ-DBG-002 |
| `voice:runtime_closed` | `activeChannels.delete(channelId)`, `debugLog()` | REQ-CORE-005, REQ-DBG-002 |
| `user:joined` | Intro-Logik: `userNameCache` aktualisieren + persistieren → enabled-Check → MusicMap-Lookup → oncePerDay-Check → Datei-Existenz → `playIntroForUser()` → DailyGreets speichern. `debugLog()` an vielen Stellen. Loggt Cache-Update mit Gesamtzahl und vollständigem Cache-Inhalt (REQ-DBG-006). | REQ-CORE-001 bis REQ-CORE-003, REQ-CFG-001, REQ-CFG-002, REQ-DBG-003, REQ-DBG-006 |

#### Commands

| Command | Args | Rückgabe | REQ |
|---------|------|---------|-----|
| `/hero-enable` | — | Setzt `enabled=true`, Bestätigung | REQ-CMD-001 |
| `/hero-disable` | — | Setzt `enabled=false`, Bestätigung | REQ-CMD-002 |
| `/hero-stop` | — | Killt alle ffmpeg-Prozesse (SIGTERM), leert `activeProcesses` | REQ-CMD-003 |
| `/hero-set` | `displayName: string`, `audioFileName: string` | Validiert unterstützte Endung (`.mp3`/`.mpeg`) + Datei-Existenz, speichert Mapping | REQ-CMD-004 |
| `/hero-remove` | `displayName: string` | Löscht Mapping aus MusicMap | REQ-CMD-005 |
| `/hero-list` | — | Listet alle DisplayName→audioFileName-Zuordnungen | REQ-CMD-006 |
| `/hero-files` | — | Listet alle `.mp3`- und `.mpeg`-Dateien im music-Ordner | REQ-CMD-007 |
| `/hero-set-me` | `audioFileName: string` | Mappt den ausführenden User auf Audio-Datei. Nutzt `invokerCtx.username`. | REQ-CMD-009 |
| `/hero-debug` | — | Toggelt Debug-Setting (`debug` on/off) | REQ-CMD-008 |
| `/hero-play-me` | — | Spielt das eigene Intro des aufrufenden Users ab. Nutzt `invokerCtx.userId` → `userNameCache` → MusicMap-Lookup. Spielt im Channel von `invokerCtx.currentVoiceChannelId`. | REQ-CMD-011 |
| `/hero-play` | `displayName: string` | Spielt das Intro einer anderen Person ab. MusicMap-Lookup über `displayName`. Spielt im Channel von `invokerCtx.currentVoiceChannelId`. | REQ-CMD-012 |
| `/hero-dump-context` | `testArg?: string` | Dumpt alle Command-Parameter als JSON ins Server-Log | REQ-CMD-010 |

**Logging:** Jede Command-`executes`-Funktion loggt beim Aufruf `[CMD] <name> called by userId=..., args=...` (REQ-DBG-005).

Abschließend: `ctx.ui.enable()` (REQ-CFG-003).

### playIntroForUser (interne Funktion)

```typescript
async function playIntroForUser(
  ctx: PluginContext,
  userId: number,
  username: string,
  mp3Path: string,
  activeProcesses: Map<number, ReturnType<typeof spawn>>,
  activeChannels: Set<number>,
  debugLog: (msg: string) => void = () => {},
  targetChannelId?: number,
): Promise<void>
```

**REQ:** REQ-CORE-004, REQ-CORE-006, REQ-CORE-007, REQ-DBG-004, REQ-DBG-007, REQ-CMD-011, REQ-CMD-012

**Ablauf:**

0. State-Dump loggen: activeProcesses count, activeChannels list, targetChannelId (REQ-DBG-007)
1. `targetChannelId` verwenden falls gesetzt, sonst erster aktiver Channel aus `activeChannels` → kein Channel = Error-Log + Return (REQ-CORE-006)
2. `debugLog()` bei jedem Schritt (channelId, Router, Transport, Producer, ffmpeg-Spawn) (REQ-DBG-004)
3. `ctx.actions.voice.getRouter(channelId)` → mediasoup Router holen
4. `router.createPlainTransport()` mit UDP, `rtcpMux: true`, `comedia: true`, Port-Range 40100–40200
5. `plainTransport.produce()` → Opus-Producer (48kHz, stereo, SSRC = 11111111 + userId)
6. `ctx.actions.voice.createStream()` → Stream im Channel exponieren (Titel: `🎵 Intro: {username}`)
7. `spawn("ffmpeg", [...])` → MP3 decodieren → Opus-RTP an `rtp://{ip}:{port}?pkt_size=1316`
8. ffmpeg in `activeProcesses` registrieren
9. **Cleanup bei `close`-Event:** `activeProcesses.delete`, `stream.remove()`, `producer.close()`, `plainTransport.close()` (REQ-CORE-007)
10. **Cleanup bei `error`-Event:** Identisch, mit try/catch um close-Aufrufe

### onUnload

Loggt `"Hero Introducer unloaded"`.

---

## src/client.ts

Leerer Export. Kein UI.

```typescript
export {};
```

---

## build.ts

### Server-Build

| Option | Wert |
|--------|------|
| entrypoint | `src/server.ts` |
| target | `bun` |
| format | `esm` |
| minify | `true` |
| external | `["mediasoup"]` (REQ-NF-003) |

### Client-Build

| Option | Wert |
|--------|------|
| entrypoint | `src/client.ts` |
| target | `browser` |
| format | `esm` |
| minify | `true` |
| plugins | `clientGlobals` — React/ReactDOM als `window.__SHARKORD_*` (REQ-NF-004) |

**clientGlobals BunPlugin:** Mapped `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client` auf `window.__SHARKORD_*` Globals.

### Post-Build

Kopiert `package.json` → `dist/sharkord-hero-introducer/package.json`.

Output-Verzeichnis: `dist/sharkord-hero-introducer/`

---

## Flows

### Flow 1: User-Join → Intro-Playback

```
user:joined(userId, username)
  │
  ├─ debugLog: userId, username
  │
  ├─ userNameCache.set(userId, username) → writeJsonFile(user-cache.json)
  │   └─ debugLog: Cache-Update mit Gesamtzahl + vollständigem Cache-Inhalt
  │
  ├─ enabled == false? → debugLog, return
  │
  ├─ MusicMap laden → debugLog (Anzahl Einträge, Keys)
  │
  ├─ MusicMap[username] nicht vorhanden? → debugLog (verfügbare Mappings), return
  │
  ├─ oncePerDay && bereits heute begrüßt? → debugLog, return
  │
  ├─ Audio-Datei existiert nicht? → Error-Log, return
  │
  ├─ debugLog: aktive Channels
  │
  └─ playIntroForUser(ctx, ..., debugLog)  [ohne targetChannelId]
       │
       ├─ State-Dump loggen (activeProcesses, activeChannels, targetChannelId)
       │
       ├─ Kein aktiver Channel? → Error-Log, return
       │
       ├─ debugLog bei jedem Schritt (Router, Transport, Producer, ffmpeg)
       │
       ├─ Router holen → PlainTransport erstellen → Producer erstellen
       │
       ├─ createStream() → Channel-Stream exponieren
       │
       ├─ ffmpeg spawnen (MP3/MPEG → Opus RTP)
       │
       └─ Bei ffmpeg close/error:
            └─ Cleanup: activeProcesses, stream, producer, transport
```

### Flow 2: /hero-set → Mapping speichern

```
/hero-set <displayName> <audioFileName>
  │
  ├─ Keine unterstützte Endung (.mp3/.mpeg)? → Fehlermeldung
  │
  ├─ Datei nicht in music/? → Fehlermeldung
  │
  └─ readJsonFile(musicMap) → Map[displayName] = audioFileName → writeJsonFile
```

### Flow 3: /hero-play-me → Eigenes Intro abspielen

```
/hero-play-me
  │
  ├─ invokerCtx.userId auslesen
  │
  ├─ userId undefined? → Fehlermeldung
  │
  ├─ userNameCache.get(userId) → username auflösen
  │   └─ Nicht gecached? → Fehlermeldung
  │
  ├─ MusicMap[username] → audioFileName
  │   └─ Kein Mapping? → Fehlermeldung
  │
  ├─ Audio-Datei existiert nicht? → Fehlermeldung
  │
  ├─ invokerCtx.currentVoiceChannelId → targetChannelId
  │   └─ Nicht im Channel? → Fehlermeldung
  │
  └─ playIntroForUser(ctx, ..., debugLog, targetChannelId)
```

### Flow 4: /hero-play → Fremdes Intro abspielen

```
/hero-play <displayName>
  │
  ├─ invokerCtx.currentVoiceChannelId → targetChannelId
  │   └─ Nicht im Channel? → Fehlermeldung
  │
  ├─ MusicMap[displayName] → audioFileName
  │   └─ Kein Mapping? → Fehlermeldung
  │
  ├─ Audio-Datei existiert nicht? → Fehlermeldung
  │
  └─ playIntroForUser(ctx, ..., debugLog, targetChannelId)
```

### Flow 5: Build

```
bun build.ts
  │
  ├── parallel:
  │     ├─ Bun.build(server.ts → dist/.../server.js)
  │     └─ Bun.build(client.ts → dist/.../client.js)
  │
  └── fs.copyFile(package.json → dist/.../package.json)
```

---

## Persistenz

| Datei | Pfad | Format | Inhalt |
|-------|------|--------|--------|
| MusicMap | `<plugin-dir>/data/music-map.json` | JSON | `{ displayName: audioFileName }` |
| DailyGreets | `<plugin-dir>/data/daily-greets.json` | JSON | `{ userId: "YYYY-MM-DD" }` |
| UserCache | `<plugin-dir>/data/user-cache.json` | JSON | `{ userId: username }` — Persistenter userId→username Cache |
| Audio-Dateien | `<plugin-dir>/music/*.mp3, *.mpeg` | Binär | Intro-Musik-Dateien |

---

## Docker-Testsystem

| Datei | Zweck |
|-------|-------|
| `docker-compose.dev.yml` | Mountet `tests/test_music/` nach Plugin-music-Ordner für Integrationstests |

**Test-Audiodateien** (`tests/test_music/`):
`dottin.mpeg`, `eisenbart.mpeg`, `icemage.mpeg`, `maintank.mpeg`, `vibecodin.mpeg`

---

## Test-Abdeckung

| Test-Datei | Anzahl Tests | Themen |
|------------|-------------|--------|
| `tests/unit/server.test.ts` | 18 | Commands, Data-Persistenz, Lifecycle, MPEG-Datei-Akzeptanz |
| `tests/unit/build.test.ts` | 4 | Build-Output, Externals |
| `tests/helpers/mock-plugin-context.ts` | — | PluginContext Mock-Factory |
