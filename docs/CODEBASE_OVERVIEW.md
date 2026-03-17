# Codebase Overview — sharkord-hero-introducer

> **Stand:** 17. Maerz 2026
> **Version:** 0.1.0

---

## Dateiuebersicht

| Datei | Zeilen | Rolle |
|-------|--------|-------|
| `src/server.ts` | ~1201 | Plugin-Server-Entry-Point: Lifecycle, Commands, Events, Playback, Diagnose |
| `src/client.ts` | 2 | Leerer Client-Entry-Point (kein UI) |
| `build.ts` | ~62 | Bun Build-Script (Server + Client + package.json kopieren) |

---

## src/server.ts

### Types

| Type | Definition | REQ |
|------|-----------|-----|
| `MusicMap` | `Record<string, string>` — displayName -> audioFileName (.mp3 oder .mpeg) | REQ-DATA-001 |
| `DailyGreets` | `Record<string, string>` — userId -> ISO-Datum `"YYYY-MM-DD"` | REQ-DATA-002 |
| `ResolveResult` | `{ ok: true; fileName: string } \| { ok: false; message: string }` — Ergebnis der flexiblen Dateinamen-Aufloesung | REQ-CMD-004, REQ-CMD-009, REQ-CMD-013 |
| `PlaybackSession` | `{ ffmpeg: { kill(signal?: number): void }; cleanup: () => void }` — Laufende Playback-Session (Interface, in onLoad-Closure definiert) | REQ-CORE-004, REQ-CORE-008 |

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
| `volume` | `number` | `25` | Playback-Lautstaerke (0-100%), angewendet via ffmpeg `-af volume=0.XX` | REQ-CFG-005 |

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
| `/hero-diagnose` | -- | Fuehrt vollstaendige Audio-Pipeline-Diagnose durch (7 Stages, PASS/FAIL Report). Nutzt `invokerCtx.currentVoiceChannelId`. | REQ-DBG-008 |
| `/hero-dump-context` | `testArg?: string` | Dumpt alle Command-Parameter als JSON ins Server-Log und zeigt sie dem Aufrufer | REQ-CMD-010 |

Abschliessend: `ctx.ui.enable()` (REQ-CFG-003), `ctx.log("Hero Introducer ready")`.

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

**REQ:** REQ-CORE-004, REQ-CORE-006, REQ-CORE-007, REQ-CORE-008, REQ-CORE-009, REQ-DBG-003

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

### /hero-diagnose (interne Funktion, L803-L1166)

**REQ:** REQ-DBG-008

Vollstaendige Audio-Pipeline-Diagnose mit strukturiertem PASS/FAIL-Report. Erstellt temporaere Ressourcen (Transport, Producer, ffmpeg, Stream) und inspiziert die gesamte Pipeline.

**7 Stages:**

| Stage | Name | Beschreibung |
|-------|------|-------------|
| 0 | Pre-flight | `currentVoiceChannelId`-Check, ffmpeg-Verfuegbarkeit (`Bun.spawn(["ffmpeg", "-version"])`), aktive Channels auflisten |
| 1 | Transport | `getRouter()`, `getListenInfo()`, `createPlainTransport()` erstellen. Bei Fehler: sofortiger Abbruch mit FAIL. |
| 2 | Producer | `transport.produce()` mit Opus-Codec (48kHz, stereo, PT 111, zufaelliger SSRC). Prueft `producer.paused`. |
| 3 | ffmpeg | Test-Audio-Datei oder Stille-Generator (`anullsrc`), 2s warten, Producer-Stats pruefen (packetCount > 0?). |
| 4 | Stream + Consumer Discovery | `ctx.actions.voice.createStream()`, `producer.observer.on("newconsumer", ...)` Hook, 5s warten auf SDK-Consumer. Prueft Consumer-`paused`-Status. |
| 5 | Router State Dump | `router.dump()`, Consumer-Zaehlung, `router.transportsForTesting` Inspektion, Consumer-Status (paused/resumed), Consumer-Stats und Score. |
| 6 | Client Transport Deep Inspection | ICE-State (`completed`?), DTLS-State (`connected`?), `iceSelectedTuple`, Consumer outbound-rtp Stats (packetCount > 0?), vollstaendiger Transport-Dump. |

**Cleanup:** ffmpeg.kill(), producer.close(), transport.close() nach allen Stages.

**Verdict:** Zaehlt alle `[FAIL]`-Eintraege. Bei 0 Failures: "All stages passed". Bei Failures: Liste der Fehler.

### onUnload (L1196-L1198)

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

### Flow 2: playAudio -> On-demand Streaming

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

### Flow 3: /hero-set -> Mapping speichern

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

### Flow 6: /hero-play-song -> Song abspielen

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

### Flow 7: /hero-diagnose -> Pipeline-Diagnose

```
/hero-diagnose
  |
  +- Stage 0: Pre-flight
  |   +- voiceChannelId vorhanden? -> sonst FAIL, Abbruch
  |   +- ffmpeg verfuegbar? (Bun.spawn ["ffmpeg", "-version"])
  |   +- activeChannels auflisten
  |
  +- Stage 1: Transport
  |   +- getRouter(voiceChannelId)
  |   +- getListenInfo()
  |   +- createPlainTransport() -> PASS/FAIL
  |
  +- Stage 2: Producer
  |   +- transport.produce(Opus, 48kHz, stereo)
  |   +- producer.paused Check
  |
  +- Stage 3: ffmpeg
  |   +- Test-Audiodatei oder anullsrc als Input
  |   +- Bun.spawn(ffmpeg ...) -> 2s warten
  |   +- producer.getStats() -> packetCount > 0?
  |
  +- Stage 4: Stream + Consumer Discovery
  |   +- producer.observer.on("newconsumer") Hook
  |   +- createStream() -> 5s warten
  |   +- SDK-Consumer gefunden? Paused-Status pruefen
  |
  +- Stage 5: Router State Dump
  |   +- router.dump() -> Consumer-Zaehlung
  |   +- router.transportsForTesting -> Consumer-Inspektion
  |   +- Consumer paused/resumed, Stats, Score
  |
  +- Stage 6: Client Transport Deep Inspection
  |   +- ICE State (completed?)
  |   +- DTLS State (connected?)
  |   +- Consumer outbound-rtp Stats
  |   +- Vollstaendiger Transport-Dump
  |
  +- Cleanup: ffmpeg.kill(), producer.close(), transport.close()
  |
  +- Verdict: FAIL-Zaehlung, Zusammenfassung
```

### Flow 8: Build

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
| Audio nicht hoerbar | Die Server-seitige Audio-Pipeline funktioniert technisch (Producer Score 10, Consumer existiert, ffmpeg sendet RTP-Pakete), aber der Audio-Output ist fuer Clients im Voice-Channel nicht hoerbar. `/hero-diagnose` wurde zur Diagnose implementiert. | Wird untersucht |

---

## Test-Abdeckung

**Gesamt: 74 Tests in 5 Dateien**

| Test-Datei | Anzahl Tests | Themen |
|------------|-------------|--------|
| `tests/unit/server.test.ts` | 29 | Lifecycle-Exports, MockPluginContext, Commands (/hero-set, /hero-remove, /hero-list, /hero-files, /hero-set-me, /hero-play-me, /hero-play), user:joined-Handler (Username-Lookup), Debug-Logging ein/aus, MPEG-Akzeptanz, Data-Persistenz |
| `tests/unit/missing-coverage.test.ts` | 29 | REQ-CORE-002 (kein Mapping), REQ-CORE-003 (Datei-Existenz), REQ-CORE-005 (Channel-Tracking), REQ-CORE-006 (kein aktiver Channel), REQ-CMD-001/002/003 (Enable/Disable/Stop), REQ-CMD-010 (Dump-Context), REQ-CMD-013 (Play-Song mit/ohne Endung, Duplikate, Fehler), REQ-CFG-001 (disabled), REQ-CFG-002 (oncePerDay), REQ-CFG-003 (UI-Aktivierung), REQ-CFG-004 (Debug-Setting-Registrierung), REQ-DATA-001/002/004/007 (Persistenz, Fallback, User-Cache), flexible Dateinamen-Aufloesung fuer /hero-set und /hero-set-me |
| `tests/unit/play-audio.test.ts` | 8 | playAudio-Pipeline: Transport-Config, Producer-RTP, SSRC-Konsistenz, ffmpeg-Args, Volume, Stream-Registration, Cleanup, Concurrent-Playback |
| `tests/unit/play-audio-comparison.test.ts` | 4 | Referenz-Paritaetstests: Transport-, Codec-, ffmpeg-, createStream-Konfiguration vs. sharkord-music-bot |
| `tests/unit/build.test.ts` | 4 | Build-Output, Externals |
| `tests/helpers/mock-plugin-context.ts` | -- | PluginContext Mock-Factory (MockSettings, MockProducer, MockConsumer, MockPlainTransport, MockRouter, MockStream, MockCaptures) |

---

## Lueckenanalyse

### Tests fehlen fuer:
- **REQ-CORE-009** — On-demand Playback (keine persistente Bot-Praesenz) nicht dediziert getestet.
- **REQ-CORE-010** — Intro-Delay (INTRO_DELAY_MS) vor Wiedergabe nicht explizit getestet.
- **REQ-CORE-011** — Session-Cleanup bei Voice-Channel-Schliessung nicht getestet.
- **REQ-CMD-014** — /hero-diagnose Command nicht getestet.
- **REQ-DATA-006** — Docker-Testdateien-Mount nicht getestet.
- **REQ-DBG-002 bis REQ-DBG-008** — Detailliertes Debug-Logging und Diagnose-Command nicht als eigenstaendige Tests (Debug-Logging nur indirekt ueber user:joined getestet).
- **REQ-LIFE-004** — Leerer Client-Entry-Point nicht getestet.
- **REQ-NF-001, REQ-NF-002, REQ-NF-004** — Nichtfunktionale Anforderungen nicht getestet.

### Bereits getestet:
- **REQ-CORE-001** — Auto-Play bei Join (`tests/unit/server.test.ts`)
- **REQ-CORE-002** — Kein Playback ohne Mapping (`tests/unit/missing-coverage.test.ts`)
- **REQ-CORE-003** — Datei-Existenz-Check vor Playback (`tests/unit/missing-coverage.test.ts`)
- **REQ-CORE-004** — Transport-Config, Producer-RTP-Parameter, SSRC-Konsistenz, ffmpeg-Args, Stream-Registration (`tests/unit/play-audio.test.ts`, `tests/unit/play-audio-comparison.test.ts`)
- **REQ-CORE-005** — Channel-Tracking via voice:runtime_initialized/closed (`tests/unit/missing-coverage.test.ts`)
- **REQ-CORE-006** — Kein aktiver Channel -> kein Playback (`tests/unit/missing-coverage.test.ts`)
- **REQ-CORE-007** — Cleanup nach ffmpeg-Exit (`tests/unit/play-audio.test.ts`)
- **REQ-CORE-008** — Concurrent Playback Protection (`tests/unit/play-audio.test.ts`)
- **REQ-CFG-001** — Enabled-Setting, disabled-Verhalten (`tests/unit/server.test.ts`, `tests/unit/missing-coverage.test.ts`)
- **REQ-CFG-002** — oncePerDay-Setting: bereits begruesst und oncePerDay=false (`tests/unit/missing-coverage.test.ts`)
- **REQ-CFG-003** — Settings-UI via ctx.ui.enable() (`tests/unit/missing-coverage.test.ts`)
- **REQ-CFG-004** — Debug-Setting-Registrierung (boolean, default false) (`tests/unit/missing-coverage.test.ts`)
- **REQ-CFG-005** — Volume-Setting in ffmpeg-Args (`tests/unit/play-audio.test.ts`)
- **REQ-CMD-001** — /hero-enable (`tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-002** — /hero-disable (`tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-003** — /hero-stop (`tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-004 bis REQ-CMD-007** — Set, Remove, List, Files Commands inkl. flexibler Dateinamen-Aufloesung (`tests/unit/server.test.ts`, `tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-009** — Set-Me Command inkl. flexibler Aufloesung (`tests/unit/server.test.ts`, `tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-010** — Dump-Context Command (`tests/unit/missing-coverage.test.ts`)
- **REQ-CMD-011** — Play-Me Command (`tests/unit/server.test.ts`)
- **REQ-CMD-012** — Play Command (`tests/unit/server.test.ts`)
- **REQ-CMD-013** — Play-Song Command (mit/ohne Endung, Duplikate, Fehler, kein Voice-Channel) (`tests/unit/missing-coverage.test.ts`)
- **REQ-DATA-001** — MusicMap-Persistenz (`tests/unit/missing-coverage.test.ts`)
- **REQ-DATA-002** — Daily-Greets-Persistenz (`tests/unit/missing-coverage.test.ts`)
- **REQ-DATA-003, REQ-DATA-005** — Verzeichnis-Erstellung (`tests/unit/server.test.ts`)
- **REQ-DATA-004** — JSON-Fallback bei fehlender Datei (`tests/unit/missing-coverage.test.ts`)
- **REQ-DATA-007** — User-Cache Persistenz, Laden, Fallback (`tests/unit/missing-coverage.test.ts`)
- **REQ-LIFE-001, REQ-LIFE-002** — onLoad/onUnload (`tests/unit/server.test.ts`)
- **REQ-LIFE-003, REQ-NF-003** — Build-Prozess (`tests/unit/build.test.ts`)
- **REQ-DBG-001** — Debug-Logging ein/aus (`tests/unit/server.test.ts`)

### Empfehlung:
1. **Hoechste Prioritaet:** Unit-Tests fuer REQ-CORE-011 (Channel-Close Session-Cleanup).
2. **Hohe Prioritaet:** REQ-CMD-014 (/hero-diagnose), REQ-CORE-010 (Intro-Delay).
3. **Mittlere Prioritaet:** REQ-CORE-009 (On-Demand Lifecycle), REQ-DBG-002 bis REQ-DBG-008 (detailliertes Debug-Logging).

---

## Aenderungshistorie

| Datum | Aenderung |
|-------|----------|
| 2026-03-11 | Initiale Erfassung aller src/ Dateien |
| 2026-03-13 | Debug-Features, Play-Commands, erweitertes Logging dokumentiert |
| 2026-03-15 | Vollstaendige Aktualisierung: playAudio-Architektur (on-demand, Bun.spawn, activeSessions statt activeProcesses), resolveAudioFile-Funktion, volume-Setting, /hero-play-song Command, /hero-debug entfernt, Flows aktualisiert, bekannter Audio-Bug dokumentiert |
| 2026-03-17 | Vollstaendige Aktualisierung: /hero-diagnose Command (7 Stages) hinzugefuegt, Zeilennummern aktualisiert (~1201 Zeilen), Test-Abdeckung erweitert (play-audio.test.ts: 8 Tests, play-audio-comparison.test.ts: 4 Tests), Lueckenanalyse aktualisiert, REQ-CFG-005 korrekt zugeordnet, Flow 7 (Diagnose) und Flow 8 (Build) hinzugefuegt |
| 2026-03-17 | Test-Abdeckung aktualisiert: missing-coverage.test.ts (29 Tests) und server.test.ts (29 Tests, vorher faelschlich als 18 dokumentiert) aufgenommen. Gesamtzahl: 74 Tests in 5 Dateien. Lueckenanalyse vollstaendig ueberarbeitet — viele REQ-IDs jetzt durch missing-coverage.test.ts abgedeckt (REQ-CORE-002/003/005/006, REQ-CMD-001/002/003/010/013, REQ-CFG-001/002/003/004, REQ-DATA-001/002/004/007). |
