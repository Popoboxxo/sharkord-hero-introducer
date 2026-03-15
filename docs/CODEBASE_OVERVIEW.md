# Codebase Overview — sharkord-hero-introducer

> **Stand:** 15. Maerz 2026
> **Version:** 0.1.0

---

## Dateiuebersicht

| Datei | Zeilen | Rolle |
|-------|--------|-------|
| `src/server.ts` | ~836 | Plugin-Server-Entry-Point: Lifecycle, Commands, Events, Playback |
| `src/client.ts` | 2 | Leerer Client-Entry-Point (kein UI) |
| `build.ts` | ~63 | Bun Build-Script (Server + Client + package.json kopieren) |

---

## src/server.ts

### Types

| Type | Definition | REQ |
|------|-----------|-----|
| `MusicMap` | `Record<string, string>` — displayName -> audioFileName (.mp3 oder .mpeg) | REQ-DATA-001 |
| `DailyGreets` | `Record<string, string>` — userId -> ISO-Datum `"YYYY-MM-DD"` | REQ-DATA-002 |
| `ResolveResult` | `{ ok: true; fileName: string } \| { ok: false; message: string }` — Ergebnis der flexiblen Dateinamen-Aufloesung | REQ-CMD-004, REQ-CMD-009, REQ-CMD-013 |
| `PlaybackSession` | `{ ffmpeg: { kill(signal?: number): void }; cleanup: () => void }` — Laufende Playback-Session | REQ-CORE-004, REQ-CORE-008 |

### Konstanten

| Konstante | Wert | Beschreibung | REQ |
|-----------|------|-------------|-----|
| `SUPPORTED_EXTENSIONS` | `[".mp3", ".mpeg"]` | Unterstuetzte Audio-Dateiendungen | REQ-CMD-004, REQ-CMD-007 |
| `INTRO_DELAY_MS` | `5_000` | Verzoegerung (ms) vor Intro-Playback nach User-Join | REQ-CORE-001 |

### Interne Hilfsfunktionen (Modul-Ebene)

| Funktion | Signatur | Beschreibung | REQ |
|----------|----------|-------------|-----|
| `isSupportedAudioFile` | `(fileName: string) => boolean` | Prueft ob Dateiname auf unterstuetzte Endung endet (`.mp3` oder `.mpeg`) | REQ-CMD-004, REQ-CMD-007 |
| `todayISO` | `() => string` | Gibt heutiges Datum als `"YYYY-MM-DD"` zurueck | REQ-CFG-002 |
| `readJsonFile` | `<T>(filePath: string, fallback: T) => Promise<T>` | Liest JSON-Datei, bei Fehler -> `fallback` | REQ-DATA-004 |
| `writeJsonFile` | `(filePath: string, data: unknown) => Promise<void>` | Schreibt JSON mit `mkdir -p` fuer Parent-Dir | REQ-DATA-001, REQ-DATA-002 |

### Exportierte API

| Export | Signatur | REQ |
|--------|----------|-----|
| `onLoad` | `(ctx: PluginContext) => Promise<void>` | REQ-LIFE-001 |
| `onUnload` | `(ctx: PluginContext) => void` | REQ-LIFE-002 |

### onLoad — Registrierungen

#### Settings

| Key | Typ | Default | Beschreibung | REQ |
|-----|-----|---------|-------------|-----|
| `enabled` | `boolean` | `true` | Plugin ein/aus | REQ-CFG-001 |
| `oncePerDay` | `boolean` | `true` | Pro User max. einmal pro Kalendertag begruessen | REQ-CFG-002 |
| `debug` | `boolean` | `false` | Detailliertes Debug-Logging aktivieren | REQ-CFG-004 |
| `volume` | `number` | `25` | Playback-Lautstaerke (0-100%), angewendet via ffmpeg `-af volume=0.XX` | **Keine REQ-ID** (fehlt in REQUIREMENTS.md) |

#### Interne Hilfsfunktionen (in onLoad-Closure)

| Funktion | Signatur | Beschreibung | REQ |
|----------|----------|-------------|-----|
| `debugLog` | `(message: string) => void` | Loggt nur wenn `debug=true`, mit `[DEBUG]` Prefix via `ctx.log()` | REQ-DBG-001 |
| `resolveAudioFile` | `(input: string) => Promise<ResolveResult>` | Flexible Dateinamen-Aufloesung im music-Verzeichnis: mit/ohne Endung, case-insensitive, Duplikat-Erkennung. Wird von `/hero-set`, `/hero-set-me` und `/hero-play-song` verwendet. | REQ-CMD-004, REQ-CMD-009, REQ-CMD-013 |

**resolveAudioFile Ablauf (L120-L171):**
1. Alle Dateien im music-Verzeichnis lesen, nach unterstuetzten Endungen filtern
2. Keine Dateien vorhanden? -> `{ ok: false, message: "No audio files found..." }`
3. Eingabe hat Endung? -> Case-insensitive exakter Match -> Treffer oder Fehlermeldung mit Liste
4. Eingabe ohne Endung? -> Match auf Basisname ohne Endung (case-insensitive)
   - 0 Treffer -> Fehlermeldung mit Liste verfuegbarer Dateien
   - 1 Treffer -> `{ ok: true, fileName: ... }`
   - >1 Treffer -> Duplikat-Warnung, User muss vollstaendigen Namen angeben

#### State (lokal in onLoad-Closure)

| Variable | Typ | Zweck |
|----------|-----|-------|
| `activeSessions` | `Map<string, PlaybackSession>` | Laufende Playback-Sessions, keyed by `"channelId-userId"`. PlaybackSession enthaelt `ffmpeg` (mit `kill()`-Methode) und `cleanup`-Funktion. |
| `activeChannels` | `Set<number>` | Aktive Voice-Channel-IDs |
| `userNameCache` | `Map<number, string>` | userId -> username Cache, persistiert zu `data/user-cache.json`. Beim Start aus Datei geladen, bei jedem `user:joined` Event aktualisiert und auf Disk geschrieben. |

**Startup-Logging:** Beim Laden wird die User-Cache-Groesse geloggt (`User cache loaded: N entries`).

#### Events

| Event | Handler-Logik | REQ |
|-------|--------------|-----|
| `voice:runtime_initialized` | `activeChannels.add(channelId)`, `debugLog()` | REQ-CORE-005, REQ-DBG-004 |
| `voice:runtime_closed` | `activeChannels.delete(channelId)`, alle `activeSessions` fuer diesen Channel aufraumen (kill + cleanup + delete), `debugLog()` | REQ-CORE-005, REQ-CORE-007, REQ-DBG-004 |
| `user:joined` | Intro-Logik: `userNameCache` aktualisieren + persistieren -> enabled-Check -> MusicMap-Lookup -> oncePerDay-Check -> Datei-Existenz -> `INTRO_DELAY_MS` warten -> erster aktiver Channel -> `playAudio()` -> DailyGreets speichern. `debugLog()` an vielen Stellen. | REQ-CORE-001 bis REQ-CORE-003, REQ-CFG-001, REQ-CFG-002, REQ-DBG-002, REQ-DBG-006 |

#### Commands

| Command | Args | Rueckgabe | REQ |
|---------|------|---------|-----|
| `/hero-enable` | -- | Setzt `enabled=true`, Bestaetigung | REQ-CMD-001 |
| `/hero-disable` | -- | Setzt `enabled=false`, Bestaetigung | REQ-CMD-002 |
| `/hero-stop` | -- | Killt alle `activeSessions` (ffmpeg.kill + cleanup), leert Map | REQ-CMD-003 |
| `/hero-set` | `displayName: string`, `audioFileName: string` | Nutzt `resolveAudioFile()` fuer flexible Dateinamen-Aufloesung (mit/ohne Endung, case-insensitive, Duplikat-Erkennung), speichert Mapping | REQ-CMD-004 |
| `/hero-remove` | `displayName: string` | Loescht Mapping aus MusicMap | REQ-CMD-005 |
| `/hero-list` | -- | Listet alle DisplayName->audioFileName-Zuordnungen | REQ-CMD-006 |
| `/hero-files` | -- | Listet alle `.mp3`- und `.mpeg`-Dateien im music-Ordner | REQ-CMD-007 |
| `/hero-set-me` | `audioFileName: string` | Nutzt `resolveAudioFile()` fuer flexible Aufloesung, mappt den ausfuehrenden User via `invokerCtx.userId` -> `userNameCache` -> displayName | REQ-CMD-009 |
| `/hero-play-me` | -- | Spielt das eigene Intro des aufrufenden Users ab. Nutzt `invokerCtx.userId` -> `userNameCache` -> MusicMap-Lookup. Spielt im Channel von `invokerCtx.currentVoiceChannelId`. | REQ-CMD-011 |
| `/hero-play` | `displayName: string` | Spielt das Intro einer anderen Person ab. MusicMap-Lookup ueber `displayName`. Spielt im Channel von `invokerCtx.currentVoiceChannelId`. | REQ-CMD-012 |
| `/hero-play-song` | `songName: string` | Spielt eine beliebige Audio-Datei aus dem music-Verzeichnis. Nutzt `resolveAudioFile()` fuer flexible Aufloesung. Spielt im Channel von `invokerCtx.currentVoiceChannelId`. | REQ-CMD-013 |
| `/hero-dump-context` | `testArg?: string` | Dumpt alle Command-Parameter als JSON ins Server-Log und zeigt sie dem Aufrufer | REQ-CMD-010 |

Abschliessend: `ctx.ui.enable()` (REQ-CFG-003).

**Hinweis:** `/hero-debug` existiert nicht mehr. Der Debug-Modus wird ausschliesslich ueber die Settings-UI gesteuert (REQ-CFG-004).

### playAudio (interne Funktion, L201-L391)

```typescript
async function playAudio(
  channelId: number,
  userId: number,
  label: string,
  mp3Path: string,
): Promise<void>
```

**REQ:** REQ-CORE-004, REQ-CORE-006, REQ-CORE-007, REQ-CORE-008, REQ-DBG-003

**Architektur:** On-demand Playback. Bot joint nicht dauerhaft -- erstellt alles pro Playback, raeumt danach vollstaendig auf.

**Ablauf:**

1. `procKey = "${channelId}-${userId}"` als Session-Key
2. Existierende Session fuer diesen Key? -> `ffmpeg.kill()` + `cleanup()` + `activeSessions.delete()` (REQ-CORE-008)
3. `ctx.actions.voice.getRouter(channelId)` -> mediasoup Router holen
4. `ctx.actions.voice.getListenInfo()` -> IP/announcedAddress
5. `router.createPlainTransport()` mit `rtcpMux: true`, `comedia: true`, `enableSrtp: false`
6. SSRC = `Math.floor(Math.random() * 1e9)` (zufaellig pro Playback)
7. `transport.produce()` -> Opus-Producer (48kHz, stereo, payloadType 111)
8. Volume-Berechnung: `settings.get("volume")` (0-100) -> `/100` -> ffmpeg `-af volume=X.XX`
9. `Bun.spawn(["ffmpeg", ...])` -> MP3/MPEG decodieren -> libopus -> RTP an `rtp://{ip}:{port}?pkt_size=1200`
   - ffmpeg Loglevel: `verbose` wenn debug=true, sonst `warning`
   - stdout: `"ignore"`, stderr: `"pipe"`, stdin: `"ignore"`
10. `ctx.actions.voice.createStream()` -> Stream im Channel exponieren (Titel: `Hero Intro: {label}`, Key: `hero-intro-{channelId}-{userId}`)
11. Producer-Score-Monitoring via `producer.on("score", ...)`
12. Debug-only: Test-Consumer erstellen (eigener PlainTransport + consume + resume) mit periodischem Stats-Logging (5s Intervall) und Router-Dump nach 3s
13. `cleanup`-Funktion definiert: `clearInterval(consumerCheckInterval)`, `producer.close()`, `transport.close()`
14. Session in `activeSessions` registrieren: `{ ffmpeg, cleanup }`
15. ffmpeg stderr async auslesen und zeilenweise via `debugLog()` loggen
16. `ffmpeg.exited.then(code => ...)`: Log-Eintrag, `activeSessions.delete(procKey)`, `cleanup()`

### onUnload (L831-L833)

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

Kopiert `package.json` -> `dist/sharkord-hero-introducer/package.json`.

Output-Verzeichnis: `dist/sharkord-hero-introducer/`

---

## Flows

### Flow 1: User-Join -> Intro-Playback

```
user:joined(userId, username)
  |
  +- debugLog: userId, username
  |
  +- userNameCache.set(userId, username) -> writeJsonFile(user-cache.json)
  |   +- debugLog: Cache-Update mit Gesamtzahl
  |
  +- enabled == false? -> debugLog, return
  |
  +- MusicMap laden -> debugLog (Anzahl Eintraege, Keys)
  |
  +- MusicMap[username] nicht vorhanden? -> debugLog, return
  |
  +- oncePerDay && bereits heute begruesst? -> debugLog, return
  |
  +- Audio-Datei existiert nicht? -> Error-Log, return
  |
  +- INTRO_DELAY_MS (5s) warten
  |
  +- Erster aktiver Channel aus activeChannels
  |   +- Kein Channel? -> debugLog, return
  |
  +- playAudio(channelId, userId, username, audioPath)
  |
  +- oncePerDay? -> DailyGreets speichern
```

### Flow 2: playAudio -> On-demand Streaming (NEU)

```
playAudio(channelId, userId, label, mp3Path)
  |
  +- procKey = "channelId-userId"
  |
  +- Existierende Session? -> ffmpeg.kill() + cleanup() + delete
  |
  +- Router holen (getRouter)
  +- ListenInfo holen (getListenInfo)
  |
  +- PlainTransport erstellen (rtcpMux, comedia, kein SRTP)
  +- Opus-Producer erstellen (48kHz, stereo, zufaelliger SSRC)
  |
  +- Volume berechnen: settings.get("volume") / 100
  |
  +- Bun.spawn(ffmpeg) -> MP3/MPEG -> libopus -> RTP an Transport-Port
  |   +- stderr: pipe -> async zeilenweise debugLog
  |
  +- createStream() -> Channel-Stream exponieren
  |
  +- Producer-Score-Monitoring
  +- (Debug) Test-Consumer + periodische Stats
  |
  +- cleanup-Funktion: producer.close(), transport.close()
  +- Session in activeSessions registrieren
  |
  +- ffmpeg.exited -> Log + activeSessions.delete + cleanup()
```

### Flow 3: /hero-set -> Mapping speichern (AKTUALISIERT)

```
/hero-set <displayName> <audioFileName>
  |
  +- resolveAudioFile(audioFileName)
  |   +- Endung vorhanden? -> case-insensitive exakter Match
  |   +- Ohne Endung? -> Basisname-Match
  |   +- 0 Treffer -> Fehlermeldung mit Datei-Liste
  |   +- >1 Treffer -> Duplikat-Warnung
  |   +- 1 Treffer -> ok
  |
  +- readJsonFile(musicMap) -> Map[displayName] = resolved.fileName -> writeJsonFile
```

### Flow 4: /hero-play-me -> Eigenes Intro abspielen

```
/hero-play-me
  |
  +- invokerCtx.userId auslesen
  |   +- undefined? -> Fehlermeldung
  |
  +- invokerCtx.currentVoiceChannelId auslesen
  |   +- Nicht im Channel? -> Fehlermeldung
  |
  +- userNameCache.get(userId) -> username aufloesen
  |   +- Nicht gecached? -> Fehlermeldung
  |
  +- MusicMap[username] -> audioFileName
  |   +- Kein Mapping? -> Fehlermeldung
  |
  +- Audio-Datei existiert nicht? -> Fehlermeldung
  |
  +- playAudio(voiceChannelId, invokerUserId, invokerName, audioPath)
```

### Flow 5: /hero-play -> Fremdes Intro abspielen

```
/hero-play <displayName>
  |
  +- invokerCtx.currentVoiceChannelId -> voiceChannelId
  |   +- Nicht im Channel? -> Fehlermeldung
  |
  +- MusicMap[displayName] -> audioFileName
  |   +- Kein Mapping? -> Fehlermeldung
  |
  +- Audio-Datei existiert nicht? -> Fehlermeldung
  |
  +- playAudio(voiceChannelId, invokerUserId ?? 0, displayName, audioPath)
```

### Flow 6: /hero-play-song -> Song abspielen (NEU)

```
/hero-play-song <songName>
  |
  +- songName leer? -> Fehlermeldung
  |
  +- invokerCtx.currentVoiceChannelId -> voiceChannelId
  |   +- Nicht im Channel? -> Fehlermeldung
  |
  +- resolveAudioFile(songName)
  |   +- Fehler? -> Fehlermeldung (mit Datei-Liste oder Duplikat-Warnung)
  |
  +- playAudio(voiceChannelId, invokerUserId ?? 0, resolved.fileName, audioPath)
```

### Flow 7: Build

```
bun build.ts
  |
  +-- parallel:
  |     +- Bun.build(server.ts -> dist/.../server.js)
  |     +- Bun.build(client.ts -> dist/.../client.js)
  |
  +-- fs.copyFile(package.json -> dist/.../package.json)
```

---

## Persistenz

| Datei | Pfad | Format | Inhalt |
|-------|------|--------|--------|
| MusicMap | `<plugin-dir>/data/music-map.json` | JSON | `{ displayName: audioFileName }` |
| DailyGreets | `<plugin-dir>/data/daily-greets.json` | JSON | `{ userId: "YYYY-MM-DD" }` |
| UserCache | `<plugin-dir>/data/user-cache.json` | JSON | `{ userId: username }` — Persistenter userId->username Cache |
| Audio-Dateien | `<plugin-dir>/music/*.mp3, *.mpeg` | Binaer | Intro-Musik-Dateien |

---

## Docker-Testsystem

| Datei | Zweck |
|-------|-------|
| `docker-compose.dev.yml` | Mountet `tests/test_music/` nach Plugin-music-Ordner fuer Integrationstests |

**Test-Audiodateien** (`tests/test_music/`):
`dottin.mpeg`, `eisenbart.mpeg`, `icemage.mpeg`, `maintank.mpeg`, `vibecodin.mpeg`

---

## Bekannte Probleme

| Problem | Beschreibung | Status |
|---------|-------------|--------|
| Audio nicht hoerbar | Die Server-seitige Audio-Pipeline funktioniert technisch (Producer Score 10, Consumer existiert, ffmpeg sendet RTP-Pakete), aber der Audio-Output ist fuer Clients im Voice-Channel nicht hoerbar. | Wird untersucht |

---

## Test-Abdeckung

| Test-Datei | Anzahl Tests | Themen |
|------------|-------------|--------|
| `tests/unit/server.test.ts` | 18 | Commands, Data-Persistenz, Lifecycle, MPEG-Datei-Akzeptanz |
| `tests/unit/build.test.ts` | 4 | Build-Output, Externals |
| `tests/helpers/mock-plugin-context.ts` | -- | PluginContext Mock-Factory |

---

## Lueckenanalyse

### Tests fehlen fuer:
- **REQ-CORE-002 bis REQ-CORE-008** — Kernszenarios (No-Mapping, Datei-Check, Streaming, Channel-Tracking, Cleanup, Concurrent Playback) sind nicht unit-getestet.
- **REQ-CMD-001 bis REQ-CMD-003** — Enable/Disable/Stop-Commands nicht getestet.
- **REQ-CMD-010, REQ-CMD-013** — Dump-Context und Play-Song Commands nicht getestet.
- **REQ-CFG-002, REQ-CFG-003, REQ-CFG-004** — Settings `oncePerDay`, UI-Aktivierung und `debug` nicht getestet.
- **REQ-DATA-001, REQ-DATA-002, REQ-DATA-004, REQ-DATA-007** — JSON-Persistenz (Pfade, Daily-Greets, Fallback, User-Cache) nicht getestet.
- **REQ-DATA-006** — Docker-Testdateien-Mount nicht getestet.
- **REQ-DBG-002 bis REQ-DBG-007** — Detailliertes Debug-Logging nicht getestet.
- **REQ-LIFE-004** — Leerer Client-Entry-Point nicht getestet.
- **REQ-NF-001 bis REQ-NF-004** — Nichtfunktionale Anforderungen nicht getestet.

### Bereits getestet:
- **REQ-CORE-001** — Auto-Play bei Join (`tests/unit/server.test.ts`)
- **REQ-CMD-004 bis REQ-CMD-007** — Set, Remove, List, Files Commands (`tests/unit/server.test.ts`)
- **REQ-CMD-009** — Set-Me Command (`tests/unit/server.test.ts`)
- **REQ-CMD-011** — Play-Me Command (`tests/unit/server.test.ts`)
- **REQ-CMD-012** — Play Command (`tests/unit/server.test.ts`)
- **REQ-CFG-001** — Enabled-Setting (`tests/unit/server.test.ts`)
- **REQ-DATA-003, REQ-DATA-005** — Verzeichnis-Erstellung (`tests/unit/server.test.ts`)
- **REQ-LIFE-001, REQ-LIFE-002** — onLoad/onUnload (`tests/unit/server.test.ts`)
- **REQ-LIFE-003, REQ-NF-003** — Build-Prozess (`tests/unit/build.test.ts`)
- **REQ-DBG-001** — Debug-Logging ein/aus (`tests/unit/server.test.ts`)

### Empfehlung:
1. **Hoechste Prioritaet:** Unit-Tests fuer REQ-CORE-002, REQ-CORE-003, REQ-CFG-002.
2. **Hohe Prioritaet:** Tests fuer REQ-CMD-001 bis REQ-CMD-003 (Enable/Disable/Stop).
3. **Mittlere Prioritaet:** Persistenz-Tests (REQ-DATA-001, REQ-DATA-002, REQ-DATA-004).

---

## Aenderungshistorie

| Datum | Aenderung |
|-------|----------|
| 2026-03-11 | Initiale Erfassung aller src/ Dateien |
| 2026-03-13 | Debug-Features, Play-Commands, erweitertes Logging dokumentiert |
| 2026-03-15 | Vollstaendige Aktualisierung: playAudio-Architektur (on-demand, Bun.spawn, activeSessions statt activeProcesses), resolveAudioFile-Funktion, volume-Setting, /hero-play-song Command, /hero-debug entfernt, Flows aktualisiert, bekannter Audio-Bug dokumentiert |
