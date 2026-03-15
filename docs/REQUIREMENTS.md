# Requirements – sharkord-hero-introducer

> **Version:** 0.1.0
> **Stand:** 14. März 2026
> **Alleinige Quelle der Wahrheit** für alle funktionalen und nichtfunktionalen Anforderungen.

---

## Legende

| Spalte | Bedeutung |
|--------|-----------|
| **REQ-ID** | Eindeutige, unveränderliche Anforderungs-ID |
| **Status** | `Implemented` / `Open` |
| **Priorität** | `Must` (Pflicht v0.1.0) · `Should` (angestrebt v0.1.0) · `Could` (Nice-to-have) |
| **Traceability** | Datei + Zeilennummern der Implementierung |

---

## 1 · Kernfunktionalität (REQ-CORE)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-CORE-001 | Wenn ein User dem Sharkord-Server beitritt (`user:joined`-Event), wird anhand des `username` aus dem Event in der MusicMap nach einem passenden Eintrag gesucht. Existiert ein Mapping, wird der Audio-Pfad als `path.join(pluginDir, "music", audioFileName)` aufgelöst und das Intro automatisch im ersten aktiven Voice-Channel abgespielt. Das Plugin unterstützt `.mp3` und `.mpeg` Dateien. | Implemented | Must | `src/server.ts` L139–L210 |
| REQ-CORE-002 | Wenn für einen User kein MP3-Mapping konfiguriert ist, erfolgt **keine** Audiowiedergabe und **kein** Fehler. | Implemented | Must | `src/server.ts` L163–L166 |
| REQ-CORE-003 | Die MP3-Datei wird vor der Wiedergabe auf Existenz geprüft; fehlt die Datei, wird ein Fehler geloggt und keine Wiedergabe gestartet. | Implemented | Must | `src/server.ts` L186–L195 |
| REQ-CORE-004 | Die Audiowiedergabe erfolgt über `ffmpeg` (MP3/MPEG → Opus-RTP) an einen mediasoup `PlainTransport`. Der Stream wird via `ctx.actions.voice.createStream` im Voice-Channel exponiert. | Implemented | Must | `src/server.ts` L556–L683 |
| REQ-CORE-005 | Das Plugin trackt aktive Voice-Channels über die Events `voice:runtime_initialized` und `voice:runtime_closed` in einem lokalen Set. | Implemented | Must | `src/server.ts` L108, L121–L129 |
| REQ-CORE-006 | Ist kein aktiver Voice-Channel vorhanden, wird ein Fehler geloggt und keine Wiedergabe gestartet. | Implemented | Must | `src/server.ts` L570–L573 |
| REQ-CORE-007 | Nach Ende der Wiedergabe (ffmpeg-Exit oder Fehler) werden Producer, PlainTransport und Stream automatisch aufgeräumt (`close`/`remove`). | Implemented | Must | `src/server.ts` L668–L684 |
| REQ-CORE-008 | Pro userId darf maximal ein Intro gleichzeitig aktiv sein. Ein neuer Wiedergabe-Request für denselben User beendet zuerst die laufende Wiedergabe (SIGTERM), bevor die neue gestartet wird. | Implemented | Should | `src/server.ts` L569–L574 |

### Abnahmekriterien REQ-CORE

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-CORE-001 | Ein User mit konfiguriertem Audio-Mapping (Matching über `username` aus `user:joined`-Event) joint → Audio-Pfad wird als `path.join(pluginDir, "music", audioFileName)` aufgelöst → alle Teilnehmer im Voice-Channel hören das Intro. |
| REQ-CORE-002 | Ein User ohne MP3-Mapping joint → keine hörbare Ausgabe, kein Fehler im Log. |
| REQ-CORE-003 | MP3 in music-map.json verweist auf nicht-existente Datei → Fehler-Log-Eintrag, keine Wiedergabe. |
| REQ-CORE-004 | Während der Wiedergabe ist ein ffmpeg-Prozess aktiv und sendet Opus-RTP an den konfigurierten Port. |
| REQ-CORE-005 | Nach `voice:runtime_initialized` enthält das interne Set die Channel-ID; nach `voice:runtime_closed` nicht mehr. |
| REQ-CORE-006 | User joint bei 0 aktiven Voice-Channels → Fehler-Log "No active voice channel found". |
| REQ-CORE-007 | Nach Wiedergabeende sind Producer und PlainTransport geschlossen und der Stream entfernt. |
| REQ-CORE-008 | User hat laufendes Intro → neuer Wiedergabe-Request → altes Intro wird gestoppt (SIGTERM), neues Intro startet. |

---

## 2 · Slash-Commands (REQ-CMD)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-CMD-001 | `/hero-enable` setzt die Einstellung `enabled` auf `true` und bestätigt die Aktivierung per Rückmeldung. | Implemented | Must | `src/server.ts` L217–L226 |
| REQ-CMD-002 | `/hero-disable` setzt die Einstellung `enabled` auf `false` und bestätigt die Deaktivierung per Rückmeldung. | Implemented | Must | `src/server.ts` L229–L238 |
| REQ-CMD-003 | `/hero-stop` beendet sofort alle laufenden ffmpeg-Prozesse (SIGTERM) und gibt eine Bestätigung zurück. Sind keine Intros aktiv, wird eine entsprechende Info-Meldung zurückgegeben. | Implemented | Must | `src/server.ts` L241–L256 |
| REQ-CMD-004 | `/hero-set <displayName> <audioFileName>` speichert ein DisplayName→Audio-Mapping. Der `audioFileName` kann **mit oder ohne Dateiendung** angegeben werden (z.B. `eisenbart` oder `eisenbart.mp3`). Die Suche ist case-insensitive. Bei Namens-Duplikaten (z.B. `song.mp3` und `song.mpeg`) wird der User aufgefordert, den vollständigen Dateinamen mit Endung anzugeben. Die Datei wird im festen Verzeichnis `<plugin-dir>/music/` gesucht. Wird keine passende Datei gefunden, wird eine Fehlermeldung mit der Liste verfügbarer Dateien angezeigt. | Implemented | Must | `src/server.ts` L335–L375 |
| REQ-CMD-005 | `/hero-remove <displayName>` entfernt das MP3-Mapping für den angegebenen DisplayName. Existiert kein Mapping, wird eine Info-Meldung zurückgegeben. | Implemented | Must | `src/server.ts` L302–L327 |
| REQ-CMD-006 | `/hero-list` gibt eine formatierte Liste aller DisplayName→Audio-Zuordnungen im Format `DisplayName: audioFileName` zurück. Sind keine Mappings vorhanden, wird eine entsprechende Info-Meldung angezeigt. | Implemented | Must | `src/server.ts` L330–L344 |
| REQ-CMD-007 | `/hero-files` listet alle verfügbaren Audio-Dateien (`.mp3` und `.mpeg`) auf, die im Verzeichnis `<plugin-dir>/music/` liegen. So kann der Admin sehen, welche Dateien zum Zuordnen verfügbar sind. | Implemented | Should | `src/server.ts` L347–L366 |
| REQ-CMD-008 | ~~`/hero-debug`~~ **Entfernt.** Debug-Modus wird ausschließlich über das Setting `debug` in der Plugin-Settings-UI gesteuert (siehe REQ-CFG-004). Kein separater Command mehr nötig. | Removed | — | — |
| REQ-CMD-009 | `/hero-set-me <audioFileName>` mappt den ausführenden User auf die angegebene Audio-Datei. Der `audioFileName` kann **mit oder ohne Dateiendung** angegeben werden (case-insensitive). Bei Namens-Duplikaten wird der User aufgefordert, den vollständigen Dateinamen mit Endung anzugeben. Der Username wird über `invokerCtx.userId` aus dem User-Cache (userId→username, befüllt durch `user:joined`-Events) ermittelt. Ist der Username nicht im Cache verfügbar, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L440–L490 |
| REQ-CMD-010 | `/hero-dump-context` gibt den vollständigen `invokerCtx` als JSON-Dump in die Server-Logs aus und zeigt ihn dem Aufrufer als formatiertes JSON an. Dient dem Reverse-Engineering der SDK-Typen. | Implemented | Could | `src/server.ts` L528–L546 |
| REQ-CMD-011 | `/hero-play-me` spielt das eigene Intro des ausführenden Users ab. Der Command ermittelt über `invokerCtx.userId` den `username` aus dem User-Cache (userId→username) und sucht das zugehörige Audio-Mapping in der MusicMap. Als Ziel-Voice-Channel wird `invokerCtx.currentVoiceChannelId` verwendet. Ist kein Mapping vorhanden, wird eine Info-Meldung zurückgegeben. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L417–L462 |
| REQ-CMD-012 | `/hero-play <displayName>` spielt das Intro einer anderen Person ab. Der Command akzeptiert ein Argument `displayName: string`, sucht diesen in der MusicMap und spielt die zugehörige Audio-Datei ab. Als Ziel-Voice-Channel wird `invokerCtx.currentVoiceChannelId` verwendet. Ist kein Mapping für den displayName vorhanden, wird eine Info-Meldung zurückgegeben. Existiert die zugeordnete Audio-Datei nicht, wird eine Fehlermeldung zurückgegeben. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L465–L511 |
| REQ-CMD-013 | `/hero-play-song <songName>` spielt eine beliebige Audio-Datei aus dem music-Verzeichnis im aktuellen Voice-Channel des Aufrufers ab. Der `songName` kann **mit oder ohne Dateiendung** angegeben werden (z.B. `eisenbart` oder `eisenbart.mp3`). Die Suche ist case-insensitive. Existieren mehrere Dateien mit gleichem Namen aber unterschiedlicher Endung (z.B. `song.mp3` und `song.mpeg`), wird der User darauf hingewiesen und muss den vollständigen Dateinamen mit Endung angeben. Wird kein passender Song gefunden, wird eine Fehlermeldung mit der Liste verfügbarer Dateien angezeigt. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L528–L595 |

### Abnahmekriterien REQ-CMD

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-CMD-001 | Ausführung → Setting `enabled` ist `true`, Rückmeldung enthält Bestätigung. |
| REQ-CMD-002 | Ausführung → Setting `enabled` ist `false`, Rückmeldung enthält Bestätigung. |
| REQ-CMD-003 | Bei laufenden Intros: alle ffmpeg-Prozesse beendet, `activeProcesses`-Map leer. Ohne laufende Intros: Info-Meldung. |
| REQ-CMD-004-A | Eingabe ohne Endung + genau eine passende Datei → Mapping mit aufgelöstem Dateinamen gespeichert, Bestätigung. |
| REQ-CMD-004-B | Eingabe ohne Endung + mehrere passende Dateien → Warnung mit Duplikat-Liste, kein Mapping. |
| REQ-CMD-004-C | Eingabe mit Endung + Datei existiert → Mapping gespeichert, Bestätigung. |
| REQ-CMD-004-D | Keine passende Datei gefunden → Fehlermeldung mit Liste verfügbarer Dateien. |
| REQ-CMD-005-A | Bestehende Zuordnung für DisplayName → Eintrag entfernt, Bestätigung. |
| REQ-CMD-005-B | Keine Zuordnung für DisplayName vorhanden → Info-Meldung. |
| REQ-CMD-006-A | Mindestens ein Mapping vorhanden → formatierte Liste mit `DisplayName: audioFileName`. |
| REQ-CMD-006-B | Keine Mappings → Info-Meldung "No intro mappings configured yet." |
| REQ-CMD-007-A | Mindestens eine `.mp3` oder `.mpeg` Datei im music-Ordner → formatierte Liste der Dateinamen. |
| REQ-CMD-007-B | Keine Audio-Dateien (`.mp3`/`.mpeg`) im music-Ordner → Info-Meldung. |
| REQ-CMD-008 | **Entfernt.** Debug wird über Plugin-Settings-UI gesteuert (REQ-CFG-004). |
| REQ-CMD-009-A | Eingabe ohne Endung + genau eine passende Datei + Username im Cache → Mapping gespeichert, Bestätigung. |
| REQ-CMD-009-B | Eingabe ohne Endung + mehrere passende Dateien → Warnung mit Duplikat-Liste, kein Mapping. |
| REQ-CMD-009-C | Keine passende Datei gefunden → Fehlermeldung mit Liste verfügbarer Dateien. |
| REQ-CMD-009-D | Username ist nicht im User-Cache verfügbar → Fehlermeldung. |
| REQ-CMD-010 | Ausführung → Server-Log enthält JSON-Dump des `invokerCtx`, Rückmeldung enthält formatiertes JSON. |
| REQ-CMD-011-A | Ausführung durch User mit konfiguriertem Mapping + aktiver Voice-Channel → eigenes Intro wird im Voice-Channel des Aufrufers abgespielt. |
| REQ-CMD-011-B | Ausführung durch User ohne Mapping → Info-Meldung, keine Wiedergabe. |
| REQ-CMD-011-C | Ausführung ohne `currentVoiceChannelId` im Context → Fehlermeldung. |
| REQ-CMD-012-A | Ausführung mit existierendem displayName-Mapping + aktiver Voice-Channel → Intro der angegebenen Person wird im Voice-Channel des Aufrufers abgespielt. |
| REQ-CMD-012-B | Ausführung mit displayName ohne Mapping → Info-Meldung, keine Wiedergabe. |
| REQ-CMD-012-C | Ausführung mit displayName-Mapping, aber Audio-Datei existiert nicht → Fehlermeldung. |
| REQ-CMD-012-D | Ausführung ohne `currentVoiceChannelId` im Context → Fehlermeldung. |
| REQ-CMD-013-A | Ausführung mit `songName` ohne Endung + genau eine passende Datei vorhanden → Song wird im Voice-Channel abgespielt. |
| REQ-CMD-013-B | Ausführung mit `songName` mit Endung + Datei existiert → Song wird im Voice-Channel abgespielt. |
| REQ-CMD-013-C | Ausführung mit `songName` ohne Endung + mehrere Dateien mit gleichem Namen aber unterschiedlicher Endung → Warnung mit Liste der Duplikate, User muss vollständigen Dateinamen angeben. |
| REQ-CMD-013-D | Ausführung mit `songName` ohne Match → Fehlermeldung mit Liste aller verfügbaren Dateien. |
| REQ-CMD-013-E | Ausführung ohne `currentVoiceChannelId` im Context → Fehlermeldung. |

---

## 3 · Konfiguration / Settings (REQ-CFG)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-CFG-001 | Das Plugin registriert eine Einstellung `enabled` (Typ: `boolean`, Default: `true`). Wenn `false`, wird bei keinem User-Join ein Intro abgespielt. | Implemented | Must | `src/server.ts` L68–L74 |
| REQ-CFG-002 | Das Plugin registriert eine Einstellung `oncePerDay` (Typ: `boolean`, Default: `true`). Wenn `true`, wird jeder User maximal einmal pro Kalendertag begrüßt. | Implemented | Must | `src/server.ts` L75–L82 |
| REQ-CFG-003 | Das Plugin aktiviert die Settings-UI im Sharkord-Frontend via `ctx.ui.enable()`, sodass Einstellungen im Frontend bearbeitet werden können. | Implemented | Should | `src/server.ts` L548 |
| REQ-CFG-004 | Das Plugin registriert eine Einstellung `debug` (Typ: `boolean`, Default: `false`). Wenn `true`, wird detailliertes Debug-Logging über die interne `debugLog`-Funktion aktiviert. | Implemented | Should | `src/server.ts` L83–L91 |

### Abnahmekriterien REQ-CFG

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-CFG-001 | Setting `enabled=false` → User joint → kein Intro, Debug-Log "Hero Introducer disabled". |
| REQ-CFG-002-A | Setting `oncePerDay=true`, User wurde heute bereits begrüßt → kein erneutes Intro. |
| REQ-CFG-002-B | Setting `oncePerDay=true`, User wurde heute noch nicht begrüßt → Intro wird abgespielt. |
| REQ-CFG-002-C | Setting `oncePerDay=false` → User hört Intro bei jedem Join, unabhängig wie oft. |
| REQ-CFG-003 | Im Sharkord-Frontend unter Plugins → Hero Introducer → Settings sind die Einstellungen sichtbar und editierbar. |
| REQ-CFG-004-A | Setting `debug=true` → Debug-Logging ist aktiv, `[DEBUG]`-Einträge erscheinen im Log. |
| REQ-CFG-004-B | Setting `debug=false` → keine `[DEBUG]`-Einträge im Log. |

---

## 4 · Datenpersistenz (REQ-DATA)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-DATA-001 | Die DisplayName→Audio-Zuordnungen (`displayName → audioFileName`, kann `.mp3` oder `.mpeg` sein) werden persistent als JSON in `<plugin-data-dir>/data/music-map.json` gespeichert. | Implemented | Must | `src/server.ts` L56 |
| REQ-DATA-002 | Die Daily-Greet-Einträge (User-ID → ISO-Datum `YYYY-MM-DD`) werden persistent als JSON in `<plugin-data-dir>/data/daily-greets.json` gespeichert. | Implemented | Must | `src/server.ts` L57 |
| REQ-DATA-003 | Das Datenverzeichnis `<plugin-data-dir>/data/` wird beim Plugin-Start automatisch erstellt, falls es nicht existiert. | Implemented | Must | `src/server.ts` L61 |
| REQ-DATA-004 | Fehlt eine JSON-Datei beim Lesen (z.B. erster Start), wird ein definierter Fallback-Wert (`{}`) verwendet, statt einen Fehler zu werfen. | Implemented | Must | `src/server.ts` L32–L39 |
| REQ-DATA-005 | Das Verzeichnis `<plugin-dir>/music/` wird beim Plugin-Start automatisch erstellt, falls es nicht existiert. Dies ist der feste Ablageordner für alle Audio-Dateien (`.mp3`, `.mpeg`). | Implemented | Must | `src/server.ts` L62 |
| REQ-DATA-006 | Beim Start des Docker-Testsystems werden die Testdateien aus `tests/test_music/` automatisch in den Plugin-music-Ordner gemountet, sodass sie sofort zum Testen verfügbar sind. | Implemented | Should | `docker-compose.dev.yml` L31 |
| REQ-DATA-007 | Die userId→username-Zuordnungen werden persistent als JSON in `<plugin-data-dir>/data/user-cache.json` gespeichert und beim Plugin-Start in einen In-Memory-Cache geladen. Der Cache wird bei jedem `user:joined`-Event aktualisiert und erneut persistiert. Er ist essentiell für `/hero-set-me` und `/hero-play-me`. | Implemented | Must | `src/server.ts` L58, L111–L115, L143–L145 |

### Abnahmekriterien REQ-DATA

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-DATA-001 | Nach `/hero-set TestUser intro.mp3` enthält `music-map.json` den Eintrag `"TestUser": "intro.mp3"`. |
| REQ-DATA-002 | Nach erfolgreicher Begrüßung enthält `daily-greets.json` den Eintrag `"<userId>": "YYYY-MM-DD"` mit heutigem Datum. |
| REQ-DATA-003 | Plugin startet in leerem Verzeichnis → `data/`-Ordner wird angelegt. |
| REQ-DATA-004 | Plugin startet ohne vorhandene `music-map.json` → leeres Objekt `{}` wird verwendet, kein Crash. |
| REQ-DATA-005 | Plugin startet in Umgebung ohne `music/`-Ordner → Ordner `<plugin-dir>/music/` wird automatisch angelegt. |
| REQ-DATA-006 | Docker-Testsystem gestartet → Dateien aus `tests/test_music/` sind im Plugin-music-Ordner verfügbar. |
| REQ-DATA-007 | Plugin startet → `user-cache.json` wird geladen (oder `{}` als Fallback). Nach `user:joined` mit userId=42/username="Alice" → Cache enthält `"42": "Alice"` und wird persistiert. |

---

## 5 · Plugin Lifecycle (REQ-LIFE)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-LIFE-001 | Das Plugin exportiert eine `onLoad`-Funktion, die beim Laden des Plugins durch Sharkord aufgerufen wird. `onLoad` registriert Settings, Events, Commands und aktiviert die UI. | Implemented | Must | `src/server.ts` L50, L693 |
| REQ-LIFE-002 | Das Plugin exportiert eine `onUnload`-Funktion, die beim Entladen des Plugins durch Sharkord aufgerufen wird und einen Log-Eintrag erzeugt. | Implemented | Must | `src/server.ts` L689–L691, L693 |
| REQ-LIFE-003 | Der Build-Prozess (`bun build.ts`) erzeugt `dist/sharkord-hero-introducer/server.js` (ESM, target bun) und `dist/sharkord-hero-introducer/client.js` (ESM, target browser) sowie eine Kopie der `package.json`. | Implemented | Must | `build.ts` L1–L61 |
| REQ-LIFE-004 | `client.ts` exportiert keine UI-Komponenten (leerer Client-Entry-Point). | Implemented | Could | `src/client.ts` L1–L2 |

### Abnahmekriterien REQ-LIFE

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-LIFE-001 | Nach Aufruf von `onLoad(ctx)` sind alle Commands registriert, Settings vorhanden, Events gebunden und UI aktiviert. |
| REQ-LIFE-002 | Nach Aufruf von `onUnload(ctx)` wird "Hero Introducer unloaded" geloggt. |
| REQ-LIFE-003 | `bun build.ts` → `dist/sharkord-hero-introducer/` enthält `server.js`, `client.js` und `package.json`. `server.js` enthält `export`-Marker. |
| REQ-LIFE-004 | `client.js` enthält keine React-Komponenten oder UI-Logik. |

---

## 6 · Nichtfunktionale Anforderungen (REQ-NF)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-NF-001 | Der gesamte Plugin-Code ist in TypeScript geschrieben und typsicher kompilierbar. | Implemented | Must | `tsconfig.json`, `src/server.ts` |
| REQ-NF-002 | Das Plugin verwendet Bun als Runtime (nicht Node.js). | Implemented | Must | `package.json` L6 |
| REQ-NF-003 | Externe Abhängigkeit `mediasoup` wird beim Build als `external` markiert und nicht gebündelt. | Implemented | Must | `build.ts` L48 |
| REQ-NF-004 | React und React-DOM werden als Client-Globals aufgelöst, nicht gebündelt (Sharkord stellt sie bereit). | Implemented | Should | `build.ts` L7–L39 |

### Abnahmekriterien REQ-NF

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-NF-001 | `tsc --noEmit` meldet keine Typfehler. |
| REQ-NF-002 | Build-Target ist `bun` (server) bzw. `browser` (client); kein Node.js-spezifischer Code. |
| REQ-NF-003 | `server.js` enthält kein gebündeltes mediasoup. |
| REQ-NF-004 | `client.js` enthält `window.__SHARKORD_REACT__`-Referenzen statt gebündeltem React. |

---

## 7 · Debug / Diagnose (REQ-DBG)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-DBG-001 | Die interne Hilfsfunktion `debugLog(message)` loggt ausschließlich dann, wenn das Setting `debug` auf `true` steht. Jede Ausgabe wird mit dem Prefix `[DEBUG]` über `ctx.log()` geschrieben. | Implemented | Should | `src/server.ts` L94–L98 |
| REQ-DBG-002 | Im `user:joined`-Handler werden folgende Informationen via Debug-Log ausgegeben: userId, username, Anzahl und Keys der MusicMap, Lookup-Ergebnis (Match oder verfügbare Mappings zum Vergleich), oncePerDay-Status mit letztem Greet-Datum, aufgelöster Audio-Pfad mit Datei-Existenz, aktive Voice-Channels vor der Wiedergabe. | Implemented | Should | `src/server.ts` L140–L200 |
| REQ-DBG-003 | In der Funktion `playIntroForUser` werden Router-Erstellung, PlainTransport-Konfiguration (rtpIp, rtpPort) und ffmpeg-Spawn-Kommando via Debug-Log ausgegeben. | Implemented | Should | `src/server.ts` L566, L580, L587, L606, L635, L641 |
| REQ-DBG-004 | Bei Voice-Channel Events (`voice:runtime_initialized`, `voice:runtime_closed`) wird die aktuelle Anzahl aktiver Channels via Debug-Log ausgegeben. | Implemented | Should | `src/server.ts` L123, L128 |
| REQ-DBG-005 | Bei jedem Command-Aufruf werden Command-Name, userId und übergebene Argumente via Debug-Log geloggt. | Implemented | Should | `src/server.ts` L222, L234, L246, L283, L318, L335, L352, L388, L424, L484 |
| REQ-DBG-006 | Beim User-Cache-Update (Persistierung der userId→username-Zuordnung) wird ein Debug-Log-Eintrag mit der aktualisierten Zuordnung erzeugt. | Implemented | Should | `src/server.ts` L146–L147 |
| REQ-DBG-007 | In der Funktion `playIntroForUser` wird ein vollständiger State-Dump geloggt, der mindestens die Anzahl aktiver Prozesse (`activeProcesses.size`) und die Liste aktiver Voice-Channels (`activeChannels`) enthält. | Implemented | Should | `src/server.ts` L566 |

### Abnahmekriterien REQ-DBG

| REQ-ID | Abnahmekriterium |
|--------|------------------|
| REQ-DBG-001 | `debug=true` → Aufruf von `debugLog("test")` erzeugt Log-Eintrag `[DEBUG] test`. `debug=false` → kein Log-Eintrag. |
| REQ-DBG-002 | User joint bei `debug=true` → Log enthält Einträge zu userId, username, MusicMap-Keys, Lookup-Ergebnis, oncePerDay-Status, Audio-Pfad und Voice-Channel-Anzahl. |
| REQ-DBG-003 | Wiedergabe startet bei `debug=true` → Log enthält Router-Info, Transport-IP/Port und ffmpeg-Kommando. |
| REQ-DBG-004 | Voice-Channel wird geöffnet/geschlossen bei `debug=true` → Log enthält Channel-ID und aktuelle Anzahl. |
| REQ-DBG-005 | Command wird ausgeführt → Log enthält Command-Name, userId des Aufrufers und alle übergebenen Argumente. |
| REQ-DBG-006 | User-Cache wird aktualisiert → Log enthält die persistierte userId→username-Zuordnung. |
| REQ-DBG-007 | `playIntroForUser` wird aufgerufen → Log enthält State-Dump mit `activeProcesses`-Anzahl und `activeChannels`-Liste. |

---

## Traceability-Matrix (Zusammenfassung)

| REQ-ID | Implementiert in | Getestet in |
|--------|-----------------|-------------|
| REQ-CORE-001 | `src/server.ts` L139–L210 | `tests/unit/server.test.ts` |
| REQ-CORE-002 | `src/server.ts` L163–L166 | — (offen) |
| REQ-CORE-003 | `src/server.ts` L186–L195 | — (offen) |
| REQ-CORE-004 | `src/server.ts` L556–L683 | — (offen) |
| REQ-CORE-005 | `src/server.ts` L108, L121–L129 | — (offen) |
| REQ-CORE-006 | `src/server.ts` L570–L573 | — (offen) |
| REQ-CORE-007 | `src/server.ts` L668–L684 | — (offen) |
| REQ-CORE-008 | `src/server.ts` L569–L574 | — (offen) |
| REQ-CMD-001 | `src/server.ts` L217–L226 | — (offen) |
| REQ-CMD-002 | `src/server.ts` L229–L238 | — (offen) |
| REQ-CMD-003 | `src/server.ts` L241–L256 | — (offen) |
| REQ-CMD-004 | `src/server.ts` L259–L299 | `tests/unit/server.test.ts` |
| REQ-CMD-005 | `src/server.ts` L302–L327 | `tests/unit/server.test.ts` |
| REQ-CMD-006 | `src/server.ts` L330–L344 | `tests/unit/server.test.ts` |
| REQ-CMD-007 | `src/server.ts` L347–L366 | `tests/unit/server.test.ts` |
| REQ-CMD-008 | **Entfernt** (Debug über Settings-UI, REQ-CFG-004) | — |
| REQ-CMD-009 | `src/server.ts` L369–L414 | `tests/unit/server.test.ts` |
| REQ-CMD-010 | `src/server.ts` L528–L546 | — (offen) |
| REQ-CMD-011 | `src/server.ts` L417–L462 | `tests/unit/server.test.ts` |
| REQ-CMD-012 | `src/server.ts` L465–L511 | `tests/unit/server.test.ts` |
| REQ-CMD-013 | `src/server.ts` L528–L595 | — (offen) |
| REQ-CFG-001 | `src/server.ts` L68–L74 | `tests/unit/server.test.ts` |
| REQ-CFG-002 | `src/server.ts` L75–L82 | — (offen) |
| REQ-CFG-003 | `src/server.ts` L548 | — (offen) |
| REQ-CFG-004 | `src/server.ts` L83–L91 | — (offen) |
| REQ-DATA-001 | `src/server.ts` L56 | — (offen) |
| REQ-DATA-002 | `src/server.ts` L57 | — (offen) |
| REQ-DATA-003 | `src/server.ts` L61 | `tests/unit/server.test.ts` |
| REQ-DATA-004 | `src/server.ts` L32–L39 | — (offen) |
| REQ-DATA-005 | `src/server.ts` L62 | `tests/unit/server.test.ts` |
| REQ-DATA-006 | `docker-compose.dev.yml` L31 | — (offen) |
| REQ-DATA-007 | `src/server.ts` L58, L111–L115, L143–L145 | — (offen) |
| REQ-LIFE-001 | `src/server.ts` L50, L693 | `tests/unit/server.test.ts` |
| REQ-LIFE-002 | `src/server.ts` L689–L693 | `tests/unit/server.test.ts` |
| REQ-LIFE-003 | `build.ts` L1–L61 | `tests/unit/build.test.ts` |
| REQ-LIFE-004 | `src/client.ts` L1–L2 | — (offen) |
| REQ-NF-001 | `tsconfig.json`, `src/server.ts` | — (offen) |
| REQ-NF-002 | `package.json` L6 | — (offen) |
| REQ-NF-003 | `build.ts` L48 | `tests/unit/build.test.ts` |
| REQ-NF-004 | `build.ts` L7–L39 | — (offen) |
| REQ-DBG-001 | `src/server.ts` L94–L98 | `tests/unit/server.test.ts` |
| REQ-DBG-002 | `src/server.ts` L140–L200 | — (offen) |
| REQ-DBG-003 | `src/server.ts` L566, L580, L587, L606, L635, L641 | — (offen) |
| REQ-DBG-004 | `src/server.ts` L123, L128 | — (offen) |
| REQ-DBG-005 | `src/server.ts` L222, L234, L246, L283, L318, L335, L352, L388, L424, L484 | — (offen) |
| REQ-DBG-006 | `src/server.ts` L146–L147 | — (offen) |
| REQ-DBG-007 | `src/server.ts` L566 | — (offen) |

---

## Lückenanalyse

### Tests fehlen für:
- **REQ-CORE-002 bis REQ-CORE-008** — Kernszenarios (No-Mapping, Datei-Check, Streaming, Channel-Tracking, Cleanup, Concurrent Playback) sind nicht unit-getestet.
- **REQ-CMD-001 bis REQ-CMD-003** — Enable/Disable/Stop-Commands nicht getestet.
- **REQ-CMD-008, REQ-CMD-010** — Debug-Toggle und Dump-Context Commands nicht getestet.
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
1. **Höchste Priorität:** Unit-Tests für REQ-CORE-002, REQ-CORE-003, REQ-CFG-002.
2. **Hohe Priorität:** Tests für REQ-CMD-001 bis REQ-CMD-003 (Enable/Disable/Stop).
3. **Mittlere Priorität:** Persistenz-Tests (REQ-DATA-001, REQ-DATA-002, REQ-DATA-004).

---

## Änderungshistorie

| Datum | Änderung | Autor |
|-------|----------|-------|
| 2026-03-11 | Initiale Erfassung aller Requirements aus Implementierungsstand v0.1.0 | Requirements Engineer |
| 2026-03-11 | DisplayName-Refactoring: REQ-CORE-001, REQ-CMD-004/005/006, REQ-DATA-001 auf DisplayName→Audio-Logik umgestellt. REQ-CMD-007 (`/hero-files`) und REQ-DATA-005 (music-Ordner) hinzugefügt. | Requirements Engineer |
| 2026-03-11 | MPEG-Support: REQ-CORE-001/004, REQ-CMD-004/007, REQ-DATA-001 um `.mpeg` Unterstützung erweitert. REQ-DATA-006 (Docker-Test-Musik-Mount) hinzugefügt. | Requirements Engineer |
| 2026-03-13 | Debug-Features: REQ-CFG-004 (Debug-Setting), REQ-CMD-008/009/010 (hero-debug, hero-set-me, hero-dump-context), REQ-DBG-001–004 (Debug-Logging) hinzugefügt. | Requirements Engineer |
| 2026-03-13 | Play-Commands: REQ-CMD-011 (`/hero-play-me`), REQ-CMD-012 (`/hero-play <displayName>`) hinzugefügt. Erweitertes Logging: REQ-DBG-005 (Command-Logging), REQ-DBG-006 (User-Cache-Logging), REQ-DBG-007 (playIntroForUser State-Dump) hinzugefügt. | Requirements Engineer |
| 2026-03-14 | Audit & Korrektur: REQ-CMD-008 implementiert (fehlte). REQ-CMD-011/012 Status → Implemented. REQ-DBG-005/006/007 Status → Implemented. REQ-CMD-009 Beschreibung korrigiert (userId→Cache statt invokerCtx.username). REQ-CMD-010 zeigt jetzt JSON dem Aufrufer. Alle Zeilennummern aktualisiert. Sektionsreihenfolge korrigiert (6 vor 7). | Validator |
| 2026-03-14 | Neue Requirements: REQ-DATA-007 (User-Cache Persistenz), REQ-CORE-008 (Concurrent Playback Protection). Concurrent-Playback-Bug behoben. | Requirements Engineer |
| 2026-03-15 | REQ-CMD-008 (`/hero-debug`) entfernt — Debug wird ausschließlich über Settings-UI gesteuert (REQ-CFG-004). REQ-CMD-013 (`/hero-play-song`) hinzugefügt: Song-Wiedergabe mit optionaler Dateiendung und Duplikat-Erkennung. Audio-Playback-Timing korrigiert (Stream vor ffmpeg, Consumer-Setup-Delay). | Developer |
| 2026-03-15 | Flexible Dateinamen-Suche: REQ-CMD-004 (`/hero-set`) und REQ-CMD-009 (`/hero-set-me`) akzeptieren jetzt Dateinamen mit oder ohne Endung (case-insensitive, Duplikat-Erkennung). Gemeinsame `resolveAudioFile`-Hilfsfunktion extrahiert und in allen 3 betroffenen Commands verwendet. Abnahmekriterien aktualisiert. | Developer |
