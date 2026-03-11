# Codebase Overview — sharkord-hero-introducer

> **Stand:** 11. März 2026
> **Version:** 0.1.0

---

## Dateiübersicht

| Datei | Zeilen | Rolle |
|-------|--------|-------|
| `src/server.ts` | ~436 | Plugin-Server-Entry-Point: Lifecycle, Commands, Events, Playback |
| `src/client.ts` | 2 | Leerer Client-Entry-Point (kein UI) |
| `build.ts` | ~63 | Bun Build-Script (Server + Client + package.json kopieren) |

---

## src/server.ts

### Types

| Type | Definition | REQ |
|------|-----------|-----|
| `MusicMap` | `Record<string, string>` — displayName → mp3FileName | REQ-DATA-001 |
| `DailyGreets` | `Record<string, string>` — userId → ISO-Datum `"YYYY-MM-DD"` | REQ-DATA-002 |

### Interne Hilfsfunktionen

| Funktion | Signatur | Beschreibung | REQ |
|----------|----------|-------------|-----|
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

#### State (lokal in onLoad-Closure)

| Variable | Typ | Zweck |
|----------|-----|-------|
| `activeProcesses` | `Map<number, ChildProcess>` | Laufende ffmpeg-Prozesse, keyed by userId |
| `activeChannels` | `Set<number>` | Aktive Voice-Channel-IDs |

#### Events

| Event | Handler-Logik | REQ |
|-------|--------------|-----|
| `voice:runtime_initialized` | `activeChannels.add(channelId)` | REQ-CORE-005 |
| `voice:runtime_closed` | `activeChannels.delete(channelId)` | REQ-CORE-005 |
| `user:joined` | Intro-Logik: enabled-Check → MusicMap-Lookup → oncePerDay-Check → Datei-Existenz → `playIntroForUser()` → DailyGreets speichern | REQ-CORE-001 bis REQ-CORE-003, REQ-CFG-001, REQ-CFG-002 |

#### Commands

| Command | Args | Rückgabe | REQ |
|---------|------|---------|-----|
| `/hero-enable` | — | Setzt `enabled=true`, Bestätigung | REQ-CMD-001 |
| `/hero-disable` | — | Setzt `enabled=false`, Bestätigung | REQ-CMD-002 |
| `/hero-stop` | — | Killt alle ffmpeg-Prozesse (SIGTERM), leert `activeProcesses` | REQ-CMD-003 |
| `/hero-set` | `displayName: string`, `mp3FileName: string` | Validiert `.mp3`-Endung + Datei-Existenz, speichert Mapping | REQ-CMD-004 |
| `/hero-remove` | `displayName: string` | Löscht Mapping aus MusicMap | REQ-CMD-005 |
| `/hero-list` | — | Listet alle DisplayName→MP3-Zuordnungen | REQ-CMD-006 |
| `/hero-files` | — | Listet alle `.mp3`-Dateien im music-Ordner | REQ-CMD-007 |

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
): Promise<void>
```

**REQ:** REQ-CORE-004, REQ-CORE-006, REQ-CORE-007

**Ablauf:**

1. Erster aktiver Channel aus `activeChannels` → kein Channel = Error-Log + Return (REQ-CORE-006)
2. `ctx.actions.voice.getRouter(channelId)` → mediasoup Router holen
3. `router.createPlainTransport()` mit UDP, `rtcpMux: true`, `comedia: true`, Port-Range 40100–40200
4. `plainTransport.produce()` → Opus-Producer (48kHz, stereo, SSRC = 11111111 + userId)
5. `ctx.actions.voice.createStream()` → Stream im Channel exponieren (Titel: `🎵 Intro: {username}`)
6. `spawn("ffmpeg", [...])` → MP3 decodieren → Opus-RTP an `rtp://{ip}:{port}?pkt_size=1316`
7. ffmpeg in `activeProcesses` registrieren
8. **Cleanup bei `close`-Event:** `activeProcesses.delete`, `stream.remove()`, `producer.close()`, `plainTransport.close()` (REQ-CORE-007)
9. **Cleanup bei `error`-Event:** Identisch, mit try/catch um close-Aufrufe

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
  ├─ enabled == false? → Debug-Log, return
  │
  ├─ MusicMap[username] nicht vorhanden? → Debug-Log, return
  │
  ├─ oncePerDay && bereits heute begrüßt? → Debug-Log, return
  │
  ├─ MP3-Datei existiert nicht? → Error-Log, return
  │
  └─ playIntroForUser()
       │
       ├─ Kein aktiver Channel? → Error-Log, return
       │
       ├─ Router holen → PlainTransport erstellen → Producer erstellen
       │
       ├─ createStream() → Channel-Stream exponieren
       │
       ├─ ffmpeg spawnen (MP3 → Opus RTP)
       │
       └─ Bei ffmpeg close/error:
            └─ Cleanup: activeProcesses, stream, producer, transport
```

### Flow 2: /hero-set → Mapping speichern

```
/hero-set <displayName> <mp3FileName>
  │
  ├─ Endung != .mp3? → Fehlermeldung
  │
  ├─ Datei nicht in music/? → Fehlermeldung
  │
  └─ readJsonFile(musicMap) → Map[displayName] = mp3FileName → writeJsonFile
```

### Flow 3: Build

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
| MusicMap | `<plugin-dir>/data/music-map.json` | JSON | `{ displayName: mp3FileName }` |
| DailyGreets | `<plugin-dir>/data/daily-greets.json` | JSON | `{ userId: "YYYY-MM-DD" }` |
| MP3-Dateien | `<plugin-dir>/music/*.mp3` | Binär | Intro-Musik-Dateien |

---

## Test-Abdeckung

| Test-Datei | Anzahl Tests | Themen |
|------------|-------------|--------|
| `tests/unit/server.test.ts` | 17 | Commands, Data-Persistenz, Lifecycle |
| `tests/unit/build.test.ts` | 4 | Build-Output, Externals |
| `tests/helpers/mock-plugin-context.ts` | — | PluginContext Mock-Factory |
