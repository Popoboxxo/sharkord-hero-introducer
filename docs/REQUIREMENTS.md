# Requirements – sharkord-hero-introducer

> **Version:** 0.1.0
> **Stand:** 17. März 2026
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
| REQ-CORE-001 | Wenn ein User dem Sharkord-Server beitritt (`user:joined`-Event), wird anhand des `username` aus dem Event in der MusicMap nach einem passenden Eintrag gesucht. Existiert ein Mapping, wird der Audio-Pfad als `path.join(pluginDir, "music", audioFileName)` aufgelöst. Nach einer konfigurierbaren Verzögerung (`INTRO_DELAY_MS`, aktuell 5000 ms) wird das Intro automatisch im ersten aktiven Voice-Channel (Insertion-Order des `activeChannels`-Set) abgespielt. Das Plugin unterstützt `.mp3` und `.mpeg` Dateien. | Implemented | Must | `src/server.ts` L419–L491 |
| REQ-CORE-002 | Wenn für einen User kein MP3-Mapping konfiguriert ist, erfolgt **keine** Audiowiedergabe und **kein** Fehler. | Implemented | Must | `src/server.ts` L444–L447 |
| REQ-CORE-003 | Die MP3-Datei wird vor der Wiedergabe auf Existenz geprüft; fehlt die Datei, wird ein Fehler geloggt und keine Wiedergabe gestartet. | Implemented | Must | `src/server.ts` L462–L469 |
| REQ-CORE-004 | Die Audiowiedergabe erfolgt über `ffmpeg` (MP3/MPEG → Opus-RTP) an einen mediasoup `PlainTransport`. Der Stream wird via `ctx.actions.voice.createStream` im Voice-Channel exponiert. Die Pipeline verwendet `Bun.spawn` (nicht `child_process.spawn`) und orientiert sich am funktionierenden Referenz-Plugin `sharkord-music-bot`. **BEKANNTER BUG:** Audio ist trotz vollständig funktionierender Server-Pipeline (Producer Score 10, Consumer existiert, RTP-Pakete fließen) nicht hörbar — vermutete Ursache ist Client-seitig (siehe Sektion "Bekannte Bugs"). | Implemented | Must | `src/server.ts` L201–L391 |
| REQ-CORE-005 | Das Plugin trackt aktive Voice-Channels über die Events `voice:runtime_initialized` und `voice:runtime_closed` in einem lokalen Set. | Implemented | Must | `src/server.ts` L397–L413 |
| REQ-CORE-006 | Ist kein aktiver Voice-Channel vorhanden, wird ein Debug-Log-Eintrag erzeugt und keine Wiedergabe gestartet. | Implemented | Must | `src/server.ts` L476–L479 |
| REQ-CORE-007 | Nach Ende der Wiedergabe (ffmpeg-Exit oder Fehler) werden Producer, PlainTransport und Stream automatisch aufgeräumt (`close`/`remove`). | Implemented | Must | `src/server.ts` L351–L357 |
| REQ-CORE-008 | Pro userId darf maximal ein Intro gleichzeitig aktiv sein. Ein neuer Wiedergabe-Request für denselben User beendet zuerst die laufende Wiedergabe (SIGTERM), bevor die neue gestartet wird. | Implemented | Should | `src/server.ts` L210–L217 |
| REQ-CORE-009 | Der Bot joint Voice-Channels nicht dauerhaft. Transport, Producer und Stream werden ausschließlich on-demand für die Dauer einer einzelnen Wiedergabe erstellt. Nach Wiedergabeende (ffmpeg-Exit) werden alle Ressourcen (Transport, Producer) automatisch aufgeräumt. Es verbleibt kein persistenter Bot im Channel. | Implemented | Must | `src/server.ts` L201–L391 |
| REQ-CORE-010 | Zwischen dem `user:joined`-Event und dem Start der Intro-Wiedergabe wird eine konfigurierbare Verzögerung (`INTRO_DELAY_MS`, Default: 5000 ms) eingehalten, damit der User Zeit hat, einem Voice-Channel beizutreten. | Implemented | Must | `src/server.ts` L420, L472–L473 |
| REQ-CORE-011 | Wenn ein Voice-Channel geschlossen wird (`voice:runtime_closed`), werden alle aktiven Playback-Sessions für diesen Channel automatisch beendet (ffmpeg-Kill, Cleanup, Session-Entfernung). | Implemented | Must | `src/server.ts` L402–L413 |
| REQ-CORE-012 | Wenn mehrere User gleichzeitig oder kurz nacheinander einem Voice-Channel beitreten, werden die Intros über eine per-Channel-Warteschlange sequenziell abgespielt (nicht überlappend). Die Queue wird bei Channel-Schließung (`voice:runtime_closed`) automatisch geleert. | Implemented | Must | `src/server.ts` |
| REQ-CORE-013 | Der Bot betritt einen Voice-Channel ausschließlich in zwei Fällen: (a) ein `user:joined`-Event tritt ein und der auslösende User befindet sich zum Zeitpunkt der Wiedergabe in einem aktiven Voice-Channel, oder (b) ein Audio-Command (`/hero-play`, `/hero-play-me`, `/hero-play-song`, `/hero-diagnose`) wird von einem User ausgeführt, der sich in einem aktiven Voice-Channel befindet. In allen anderen Fällen wird kein Transport erstellt und keine Wiedergabe gestartet. Wenn `channelMembers` im Event vorhanden ist und `length <= 1`, wird kein Intro gespielt (BUG-002-Fix). | Implemented | Must | `src/server.ts` |
| REQ-CORE-014 | Im `user:joined`-Handler wird der Ziel-Voice-Channel anhand der `voiceChannelId` aus dem Event bestimmt, sofern diese vom SDK übermittelt wird. Fehlt die `voiceChannelId` im Event, wird der erste aktive Channel (Insertion-Order) als Fallback verwendet und ein Debug-Log-Eintrag mit dem Hinweis "voiceChannelId not provided, using first active channel" erzeugt. Ist der so ermittelte Channel nicht im `activeChannels`-Set vorhanden, wird keine Wiedergabe gestartet. | Implemented | Must | `src/server.ts` |

### Abnahmekriterien REQ-CORE

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-CORE-001 | Ein User mit konfiguriertem Audio-Mapping (Matching über `username` aus `user:joined`-Event) joint → nach `INTRO_DELAY_MS` (5s) Verzögerung → Audio-Pfad wird als `path.join(pluginDir, "music", audioFileName)` aufgelöst → alle Teilnehmer im Voice-Channel hören das Intro. |
| REQ-CORE-013-A | `user:joined`-Event ohne Voice-Channel-Zugehörigkeit des Users (kein aktiver Channel mit dem User) → kein Transport erstellt, keine Wiedergabe, Debug-Log. |
| REQ-CORE-013-B | `/hero-play` durch User ohne aktiven Voice-Channel → Fehlermeldung "You must be in a voice channel to use this command.", kein Transport erstellt. |
| REQ-CORE-014-A | `user:joined`-Event liefert `voiceChannelId` → Wiedergabe erfolgt exakt in diesem Channel, nicht in einem anderen aktiven Channel. |
| REQ-CORE-014-B | `user:joined`-Event ohne `voiceChannelId` → Fallback auf ersten aktiven Channel, Debug-Log enthält "voiceChannelId not provided, using first active channel". |
| REQ-CORE-014-C | `user:joined`-Event, `voiceChannelId` aus Event ist nicht im `activeChannels`-Set → keine Wiedergabe, Debug-Log. |
| REQ-CORE-002 | Ein User ohne MP3-Mapping joint → keine hörbare Ausgabe, kein Fehler im Log. |
| REQ-CORE-003 | MP3 in music-map.json verweist auf nicht-existente Datei → Fehler-Log-Eintrag, keine Wiedergabe. |
| REQ-CORE-004 | Während der Wiedergabe ist ein ffmpeg-Prozess aktiv und sendet Opus-RTP an den konfigurierten Port. `Bun.spawn` wird verwendet. |
| REQ-CORE-005 | Nach `voice:runtime_initialized` enthält das interne Set die Channel-ID; nach `voice:runtime_closed` nicht mehr. |
| REQ-CORE-006 | User joint bei 0 aktiven Voice-Channels → Debug-Log "No active voice channel", keine Wiedergabe. |
| REQ-CORE-007 | Nach Wiedergabeende sind Producer und PlainTransport geschlossen und der Stream entfernt. |
| REQ-CORE-008 | User hat laufendes Intro → neuer Wiedergabe-Request → altes Intro wird gestoppt (SIGTERM), neues Intro startet. |
| REQ-CORE-009 | Vor Wiedergabe: kein Transport/Producer fuer den Channel vorhanden. Waehrend Wiedergabe: Transport+Producer+Stream existieren. Nach Wiedergabe: alle drei Ressourcen sind geschlossen/entfernt. |
| REQ-CORE-010 | User joint → mindestens `INTRO_DELAY_MS` (5000 ms) vergehen bevor `playAudio` aufgerufen wird. |
| REQ-CORE-011 | Voice-Channel wird geschlossen → alle `activeSessions` mit passendem channelId-Prefix werden beendet (kill + cleanup + delete). |
| REQ-CORE-012-A | User A und User B joinen gleichzeitig → Intro A spielt zuerst, Intro B spielt nach Abschluss von A. |
| REQ-CORE-012-B | Voice-Channel wird während laufender Queue geschlossen → Queue wird geleert, verbleibende Intros werden nicht abgespielt. |

---

## 2 · Slash-Commands (REQ-CMD)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-CMD-001 | `/hero-enable` setzt die Einstellung `enabled` auf `true` und bestätigt die Aktivierung per Rückmeldung. | Implemented | Must | `src/server.ts` L497–L506 |
| REQ-CMD-002 | `/hero-disable` setzt die Einstellung `enabled` auf `false` und bestätigt die Deaktivierung per Rückmeldung. | Implemented | Must | `src/server.ts` L508–L517 |
| REQ-CMD-003 | `/hero-stop` beendet sofort alle laufenden ffmpeg-Prozesse (SIGTERM) und gibt eine Bestätigung zurück. Sind keine Intros aktiv, wird eine entsprechende Info-Meldung zurückgegeben. | Implemented | Must | `src/server.ts` L519–L535 |
| REQ-CMD-004 | `/hero-set <displayName> <audioFileName>` speichert ein DisplayName→Audio-Mapping. Der `audioFileName` kann **mit oder ohne Dateiendung** angegeben werden (z.B. `eisenbart` oder `eisenbart.mp3`). Die Suche ist case-insensitive. Bei Namens-Duplikaten (z.B. `song.mp3` und `song.mpeg`) wird der User aufgefordert, den vollständigen Dateinamen mit Endung anzugeben. Die Datei wird im festen Verzeichnis `<plugin-dir>/music/` gesucht. Wird keine passende Datei gefunden, wird eine Fehlermeldung mit der Liste verfügbarer Dateien angezeigt. | Implemented | Must | `src/server.ts` L537–L575 |
| REQ-CMD-005 | `/hero-remove <displayName>` entfernt das MP3-Mapping für den angegebenen DisplayName. Existiert kein Mapping, wird eine Info-Meldung zurückgegeben. | Implemented | Must | `src/server.ts` L577–L602 |
| REQ-CMD-006 | `/hero-list` gibt eine formatierte Liste aller DisplayName→Audio-Zuordnungen im Format `DisplayName: audioFileName` zurück. Sind keine Mappings vorhanden, wird eine entsprechende Info-Meldung angezeigt. | Implemented | Must | `src/server.ts` L604–L618 |
| REQ-CMD-007 | `/hero-files` listet alle verfügbaren Audio-Dateien (`.mp3` und `.mpeg`) auf, die im Verzeichnis `<plugin-dir>/music/` liegen. So kann der Admin sehen, welche Dateien zum Zuordnen verfügbar sind. | Implemented | Should | `src/server.ts` L620–L639 |
| REQ-CMD-008 | ~~`/hero-debug`~~ **Entfernt.** Debug-Modus wird ausschließlich über das Setting `debug` in der Plugin-Settings-UI gesteuert (siehe REQ-CFG-004). Kein separater Command mehr nötig. | Removed | — | — |
| REQ-CMD-009 | `/hero-set-me <audioFileName>` mappt den ausführenden User auf die angegebene Audio-Datei. Der `audioFileName` kann **mit oder ohne Dateiendung** angegeben werden (case-insensitive). Bei Namens-Duplikaten wird der User aufgefordert, den vollständigen Dateinamen mit Endung anzugeben. Der Username wird über `invokerCtx.userId` aus dem User-Cache (userId→username, befüllt durch `user:joined`-Events) ermittelt. Ist der Username nicht im Cache verfügbar, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L641–L680 |
| REQ-CMD-010 | `/hero-dump-context` gibt alle übergebenen Command-Parameter (einschließlich `invokerCtx` und `args`) als JSON-Dump in die Server-Logs aus und zeigt sie dem Aufrufer als formatiertes JSON an. Akzeptiert ein optionales Argument `testArg: string`. Dient dem Reverse-Engineering der SDK-Typen. | Implemented | Could | `src/server.ts` L1168–L1186 |
| REQ-CMD-011 | `/hero-play-me` spielt das eigene Intro des ausführenden Users ab. Der Command ermittelt über `invokerCtx.userId` den `username` aus dem User-Cache (userId→username) und sucht das zugehörige Audio-Mapping in der MusicMap. Als Ziel-Voice-Channel wird `invokerCtx.currentVoiceChannelId` verwendet. Ist kein Mapping vorhanden, wird eine Info-Meldung zurückgegeben. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L682–L719 |
| REQ-CMD-012 | `/hero-play <displayName>` spielt das Intro einer anderen Person ab. Der Command akzeptiert ein Argument `displayName: string`, sucht diesen in der MusicMap und spielt die zugehörige Audio-Datei ab. Als Ziel-Voice-Channel wird `invokerCtx.currentVoiceChannelId` verwendet. Ist kein Mapping für den displayName vorhanden, wird eine Info-Meldung zurückgegeben. Existiert die zugeordnete Audio-Datei nicht, wird eine Fehlermeldung zurückgegeben. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L721–L762 |
| REQ-CMD-013 | `/hero-play-song <songName>` spielt eine beliebige Audio-Datei aus dem music-Verzeichnis im aktuellen Voice-Channel des Aufrufers ab. Der `songName` kann **mit oder ohne Dateiendung** angegeben werden (z.B. `eisenbart` oder `eisenbart.mp3`). Die Suche ist case-insensitive. Existieren mehrere Dateien mit gleichem Namen aber unterschiedlicher Endung (z.B. `song.mp3` und `song.mpeg`), wird der User darauf hingewiesen und muss den vollständigen Dateinamen mit Endung angeben. Wird kein passender Song gefunden, wird eine Fehlermeldung mit der Liste verfügbarer Dateien angezeigt. Ist keine `currentVoiceChannelId` im Context vorhanden, wird eine Fehlermeldung zurückgegeben. | Implemented | Should | `src/server.ts` L764–L801 |
| REQ-CMD-014 | `/hero-diagnose` führt eine vollständige Audio-Pipeline-Diagnose durch und gibt einen strukturierten Report mit PASS/FAIL/INFO pro Stage zurück. Der Aufrufer muss sich in einem Voice-Channel befinden. Details der Diagnose-Stages sind in REQ-DBG-008 spezifiziert. | Implemented | Should | `src/server.ts` L803–L1166 |
| REQ-CMD-015 | `/hero-reset-me` setzt den täglichen Begrüßungszähler des ausführenden Users zurück, sodass das Intro beim nächsten Voice-Channel-Beitritt erneut abgespielt wird (auch wenn `oncePerDay` aktiviert ist und der User heute bereits begrüßt wurde). Die userId wird über `invokerCtx.userId` ermittelt. Existiert kein Eintrag in den Daily-Greets, wird eine Info-Meldung zurückgegeben. | Implemented | Should | `src/server.ts` |
| REQ-CMD-016 | Alle Commands, die eine Audio-Wiedergabe auslösen (`/hero-play-me`, `/hero-play`, `/hero-play-song`, `/hero-diagnose`), prüfen vor dem Start der Wiedergabe, ob der ausführende User sich in einem aktiven Voice-Channel befindet (`invokerCtx.currentVoiceChannelId` ist gesetzt und im `activeChannels`-Set vorhanden). Ist dies nicht der Fall, wird die Ausführung ohne Wiedergabe abgebrochen und eine Fehlermeldung "You must be in a voice channel to use this command." zurückgegeben. Es wird kein Transport oder Producer erstellt. | Open | Must | — |
| REQ-CMD-017 | `/hero-search-music` durchsucht die SQLite-Datenbank des Sharkord-Servers (`<ctx.path>/../../db.sqlite`) nach Audio-Anhängen in Text-Kanälen und kopiert alle gefundenen Audio-Dateien in das Music-Verzeichnis des Plugins (`<ctx.path>/music/`). Als Audio-Dateien gelten Einträge in der `files`-Tabelle, bei denen `mimeType` = `audio/mpeg` oder `extension` = `.mp3` / `.mpeg` ist. Der `name`-Wert der Quell-Datei wird relativ zu `<ctx.path>/../../public/` aufgelöst. Als Ziel-Dateiname wird `originalName` aus der `files`-Tabelle verwendet; fehlt `originalName`, wird `name` als Fallback genutzt. Existiert im Zielverzeichnis bereits eine Datei mit demselben Namen, wird diese übersprungen und der User erhält einen Hinweis auf den Konflikt. Der Command gibt eine Zusammenfassung zurück: Anzahl gefundener, kopierter und übersprungener Dateien. Ist die Datenbank nicht erreichbar (Datei nicht vorhanden, keine Leseberechtigung), wird eine aussagekräftige Fehlermeldung zurückgegeben; der Plugin-Prozess darf dabei nicht abstürzen. Der Command erfordert keinen aktiven Voice-Channel. | Implemented | Could | `src/server.ts` |

### Abnahmekriterien REQ-CMD

| REQ-ID | Abnahmekriterium |
|--------|-----------------|
| REQ-CMD-001 | Ausführung → Setting `enabled` ist `true`, Rückmeldung enthält Bestätigung. |
| REQ-CMD-002 | Ausführung → Setting `enabled` ist `false`, Rückmeldung enthält Bestätigung. |
| REQ-CMD-003 | Bei laufenden Intros: alle ffmpeg-Prozesse beendet, `activeSessions`-Map leer. Ohne laufende Intros: Info-Meldung. |
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
| REQ-CMD-010 | Ausführung → Server-Log enthält JSON-Dump aller Command-Parameter (Anzahl + Inhalt pro Parameter), Rückmeldung enthält formatiertes JSON. |
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
| REQ-CMD-014-A | Ausführung in Voice-Channel → strukturierter Report mit PASS/FAIL/INFO pro Stage (0-6) wird zurückgegeben und geloggt. |
| REQ-CMD-014-B | Ausführung ohne Voice-Channel → FAIL in Stage 0, Report enthält Fehlermeldung. |
| REQ-CMD-014-C | Nach Diagnose-Abschluss → Transport, Producer und ffmpeg-Prozess werden aufgeräumt. |
| REQ-CMD-015-A | Ausführung durch User mit bestehendem Daily-Greet-Eintrag → Eintrag wird entfernt, Bestätigung. |
| REQ-CMD-015-B | Ausführung durch User ohne Daily-Greet-Eintrag → Info-Meldung "no entry to reset". |
| REQ-CMD-015-C | Nach Reset + erneutem Voice-Channel-Beitritt (bei `oncePerDay=true`) → Intro wird erneut abgespielt. |
| REQ-CMD-016-A | `/hero-play-me` ohne `currentVoiceChannelId` im Context → Fehlermeldung, kein Transport erstellt. |
| REQ-CMD-016-B | `/hero-play <displayName>` ohne `currentVoiceChannelId` im Context → Fehlermeldung, kein Transport erstellt. |
| REQ-CMD-016-C | `/hero-play-song <songName>` ohne `currentVoiceChannelId` im Context → Fehlermeldung, kein Transport erstellt. |
| REQ-CMD-016-D | `/hero-diagnose` ohne `currentVoiceChannelId` im Context → Fehlermeldung, kein Transport erstellt. |
| REQ-CMD-016-E | Jeder der vier Commands mit `currentVoiceChannelId` gesetzt, aber Channel nicht im `activeChannels`-Set → Fehlermeldung "Voice channel is not active.", kein Transport erstellt. |
| REQ-CMD-017-A | Datenbank enthält 3 Audio-Dateien (`audio/mpeg`), davon 1 bereits im music-Verzeichnis vorhanden → Command meldet: 3 gefunden, 2 kopiert, 1 übersprungen. |
| REQ-CMD-017-B | Datenbank enthält keine Audio-Dateien → Command meldet: 0 gefunden, 0 kopiert, 0 übersprungen, kein Fehler. |
| REQ-CMD-017-C | Datei mit `originalName` gesetzt → Zieldatei erhält `originalName` als Dateinamen. |
| REQ-CMD-017-D | Datei ohne `originalName` (NULL oder leer) → Zieldatei erhält `name` als Dateinamen. |
| REQ-CMD-017-E | Zieldatei existiert bereits im music-Verzeichnis → Datei wird nicht überschrieben, Rückmeldung enthält Hinweis auf den Namenskonflikt. |
| REQ-CMD-017-F | `db.sqlite` unter `<ctx.path>/../../db.sqlite` nicht vorhanden oder nicht lesbar → Fehlermeldung mit Pfad und Fehlerursache, kein Plugin-Crash. |
| REQ-CMD-017-G | Ausführung ohne aktiven Voice-Channel → Command wird trotzdem ausgeführt, keine Fehlermeldung wegen fehlendem Voice-Channel. |
| REQ-CMD-017-H | Nur Dateien mit `mimeType = audio/mpeg` oder `extension IN ('.mp3', '.mpeg')` werden übernommen; Dateien anderer Typen (z. B. `image/jpeg`) bleiben unberücksichtigt. |

---

## 3 · Konfiguration / Settings (REQ-CFG)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-CFG-001 | Das Plugin registriert eine Einstellung `enabled` (Typ: `boolean`, Default: `true`). Wenn `false`, wird bei keinem User-Join ein Intro abgespielt. | Implemented | Must | `src/server.ts` L67–L73 |
| REQ-CFG-002 | Das Plugin registriert eine Einstellung `oncePerDay` (Typ: `boolean`, Default: `true`). Wenn `true`, wird jeder User maximal einmal pro Kalendertag begrüßt. | Implemented | Must | `src/server.ts` L74–L81 |
| REQ-CFG-003 | Das Plugin aktiviert die Settings-UI im Sharkord-Frontend via `ctx.ui.enable()`, sodass Einstellungen im Frontend bearbeitet werden können. | Implemented | Should | `src/server.ts` L1188 |
| REQ-CFG-004 | Das Plugin registriert eine Einstellung `debug` (Typ: `boolean`, Default: `false`). Wenn `true`, wird detailliertes Debug-Logging über die interne `debugLog`-Funktion aktiviert. | Implemented | Should | `src/server.ts` L82–L89 |
| REQ-CFG-005 | Das Plugin registriert eine Einstellung `volume` (Typ: `number`, Default: `25`). Der Wert definiert die Lautstärke der Intro-Musik in Prozent (0–100%). Die Lautstärke wird server-seitig über den ffmpeg-Audiofilter `-af volume=<dezimalwert>` angewendet, wobei der Prozentwert in einen Dezimalwert (0.0–1.0) umgerechnet wird. Werte außerhalb des Bereichs werden auf 0 bzw. 100 begrenzt. | Implemented | Should | `src/server.ts` L90–L97, L255–L256, L267 |

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
| REQ-CFG-005-A | Setting `volume=50` → ffmpeg wird mit `-af volume=0.5` gestartet. |
| REQ-CFG-005-B | Setting `volume=0` → ffmpeg wird mit `-af volume=0.0` gestartet (kein Audio hörbar). |
| REQ-CFG-005-C | Setting `volume=100` → ffmpeg wird mit `-af volume=1.0` gestartet (volle Lautstärke). |
| REQ-CFG-005-D | Setting `volume=150` (über Maximum) → Wert wird auf 100 begrenzt, ffmpeg erhält `-af volume=1.0`. |

---

## 4 · Datenpersistenz (REQ-DATA)

| REQ-ID | Beschreibung | Status | Priorität | Traceability |
|--------|-------------|--------|-----------|--------------|
| REQ-DATA-001 | Die DisplayName→Audio-Zuordnungen (`displayName → audioFileName`, kann `.mp3` oder `.mpeg` sein) werden persistent als JSON in `<plugin-data-dir>/data/music-map.json` gespeichert. | Implemented | Must | `src/server.ts` L55 |
| REQ-DATA-002 | Die Daily-Greet-Einträge (User-ID → ISO-Datum `YYYY-MM-DD`) werden persistent als JSON in `<plugin-data-dir>/data/daily-greets.json` gespeichert. | Implemented | Must | `src/server.ts` L56 |
| REQ-DATA-003 | Das Datenverzeichnis `<plugin-data-dir>/data/` wird beim Plugin-Start automatisch erstellt, falls es nicht existiert. | Implemented | Must | `src/server.ts` L60 |
| REQ-DATA-004 | Fehlt eine JSON-Datei beim Lesen (z.B. erster Start), wird ein definierter Fallback-Wert (`{}`) verwendet, statt einen Fehler zu werfen. | Implemented | Must | `src/server.ts` L31–L38 |
| REQ-DATA-005 | Das Verzeichnis `<plugin-dir>/music/` wird beim Plugin-Start automatisch erstellt, falls es nicht existiert. Dies ist der feste Ablageordner für alle Audio-Dateien (`.mp3`, `.mpeg`). | Implemented | Must | `src/server.ts` L61 |
| REQ-DATA-006 | Beim Start des Docker-Testsystems werden die Testdateien aus `tests/test_music/` automatisch in den Plugin-music-Ordner gemountet, sodass sie sofort zum Testen verfügbar sind. | Implemented | Should | `docker-compose.dev.yml` L31 |
| REQ-DATA-007 | Die userId→username-Zuordnungen werden persistent als JSON in `<plugin-data-dir>/data/user-cache.json` gespeichert und beim Plugin-Start in einen In-Memory-Cache geladen. Der Cache wird bei jedem `user:joined`-Event aktualisiert und erneut persistiert. Er ist essentiell für `/hero-set-me` und `/hero-play-me`. | Implemented | Must | `src/server.ts` L57, L188–L192, L425–L429 |

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
| REQ-LIFE-001 | Das Plugin exportiert eine `onLoad`-Funktion, die beim Laden des Plugins durch Sharkord aufgerufen wird. `onLoad` registriert Settings, Events, Commands und aktiviert die UI. Beim Laden wird "Hero Introducer loaded" und bei Abschluss "Hero Introducer ready" geloggt. | Implemented | Must | `src/server.ts` L49–L50, L1188–L1189, L1200 |
| REQ-LIFE-002 | Das Plugin exportiert eine `onUnload`-Funktion, die beim Entladen des Plugins durch Sharkord aufgerufen wird und "Hero Introducer unloaded" loggt. | Implemented | Must | `src/server.ts` L1196–L1198, L1200 |
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
| REQ-DBG-001 | Die interne Hilfsfunktion `debugLog(message)` loggt ausschließlich dann, wenn das Setting `debug` auf `true` steht. Jede Ausgabe wird mit dem Prefix `[DEBUG]` über `ctx.log()` geschrieben. | Implemented | Should | `src/server.ts` L100–L105 |
| REQ-DBG-002 | Im `user:joined`-Handler werden folgende Informationen via Debug-Log ausgegeben: userId, username, Anzahl und Keys der MusicMap, Lookup-Ergebnis (Match oder verfügbare Mappings zum Vergleich), oncePerDay-Status mit letztem Greet-Datum, aufgelöster Audio-Pfad mit Datei-Existenz, aktive Voice-Channels vor der Wiedergabe. | Implemented | Should | `src/server.ts` L422–L491 |
| REQ-DBG-003 | In der Funktion `playAudio` werden Router-Erstellung, PlainTransport-Konfiguration (rtpIp, rtpPort) und ffmpeg-Spawn-Kommando via Debug-Log ausgegeben. | Implemented | Should | `src/server.ts` L201–L391 |
| REQ-DBG-004 | Bei Voice-Channel Events (`voice:runtime_initialized`, `voice:runtime_closed`) wird die aktuelle Anzahl aktiver Channels via Debug-Log ausgegeben. | Implemented | Should | `src/server.ts` L397–L413 |
| REQ-DBG-005 | Bei jedem Command-Aufruf werden Command-Name, userId und übergebene Argumente via Debug-Log geloggt. | Implemented | Should | `src/server.ts` (diverse Command-Handler) |
| REQ-DBG-006 | Beim User-Cache-Update (Persistierung der userId→username-Zuordnung) wird ein Debug-Log-Eintrag mit der aktualisierten Zuordnung erzeugt. | Implemented | Should | `src/server.ts` L425–L429 |
| REQ-DBG-007 | In der Funktion `playAudio` wird ein vollständiger State-Dump geloggt, der mindestens die Anzahl aktiver Prozesse (`activeSessions.size`) und die Liste aktiver Voice-Channels (`activeChannels`) enthält. | Implemented | Should | `src/server.ts` L208 |
| REQ-DBG-008 | `/hero-diagnose` führt eine vollständige Pipeline-Diagnose durch: Stage 0: Pre-flight (ffmpeg-Verfügbarkeit, aktive Channels), Stage 1: Transport-Erstellung, Stage 2: Producer-Erstellung mit paused-Check, Stage 3: ffmpeg-Spawn mit Stats-Prüfung (2s Wartezeit), Stage 4: Stream-Registration mit Consumer-Discovery via `producer.observer.on("newconsumer")` (5s Wartezeit), Stage 5: Router-State-Dump mit Consumer-Inspektion via `transportsForTesting`, Stage 6: Client-Transport Deep Inspection (ICE-State, DTLS-State, Consumer Outbound-RTP Stats). Gibt strukturierten Report mit PASS/FAIL/INFO pro Stage zurück. Räumt nach Abschluss Transport, Producer und ffmpeg-Prozess auf. | Implemented | Should | `src/server.ts` L803–L1166 |

### Abnahmekriterien REQ-DBG

| REQ-ID | Abnahmekriterium |
|--------|------------------|
| REQ-DBG-001 | `debug=true` → Aufruf von `debugLog("test")` erzeugt Log-Eintrag `[DEBUG] test`. `debug=false` → kein Log-Eintrag. |
| REQ-DBG-002 | User joint bei `debug=true` → Log enthält Einträge zu userId, username, MusicMap-Keys, Lookup-Ergebnis, oncePerDay-Status, Audio-Pfad und Voice-Channel-Anzahl. |
| REQ-DBG-003 | Wiedergabe startet bei `debug=true` → Log enthält Router-Info, Transport-IP/Port und ffmpeg-Kommando. |
| REQ-DBG-004 | Voice-Channel wird geöffnet/geschlossen bei `debug=true` → Log enthält Channel-ID und aktuelle Anzahl. |
| REQ-DBG-005 | Command wird ausgeführt → Log enthält Command-Name, userId des Aufrufers und alle übergebenen Argumente. |
| REQ-DBG-006 | User-Cache wird aktualisiert → Log enthält die persistierte userId→username-Zuordnung. |
| REQ-DBG-007 | `playAudio` wird aufgerufen → Log enthält State-Dump mit `activeSessions`-Anzahl und `activeChannels`-Liste. |
| REQ-DBG-008 | `/hero-diagnose` ausgeführt in Voice-Channel → Report mit 7 Stages (0-6), PASS/FAIL/INFO-Markierungen und Verdict wird als Chat-Antwort und Server-Log ausgegeben. |

---

## Bekannte Bugs

| ID | Bereich | Beschreibung | Status |
|----|---------|-------------|--------|
| BUG-001 | Audio-Playback | Die Server-seitige Playback-Pipeline funktioniert vollständig: Producer Score erreicht 10, Consumer wird erstellt, 1539+ RTP-Pakete werden gesendet. Audio ist dennoch nicht hörbar. Die Implementierung wurde an das funktionierende Referenz-Plugin `sharkord-music-bot` angeglichen (gleiche ffmpeg-Flags, `Bun.spawn`, kein Delay). Vermutete Ursache liegt Client-seitig: Consumer-Resume, WebRTC-Transport-Setup oder Audio-Element im Browser. Betrifft REQ-CORE-004. | Wird untersucht |
| BUG-002 | Channel-Join-Logik | Der Bot ist einem Voice-Channel beigetreten (channelId=3) und hat Musik abgespielt (userId=2, SharkordUser46797), obwohl sich zu diesem Zeitpunkt kein User im Channel befand. Ursache: Der `user:joined`-Handler wählt nach dem `INTRO_DELAY_MS`-Timeout blind den ersten Eintrag aus dem `activeChannels`-Set, ohne zu prüfen, ob der auslösende User tatsächlich in diesem Channel sitzt. Zudem liefert das `user:joined`-Event möglicherweise keine `voiceChannelId`. Betrifft REQ-CORE-001 (präzisiert durch REQ-CORE-013 und REQ-CORE-014). | Behoben — REQ-CORE-013 und REQ-CORE-014 implementiert |

---

## Traceability-Matrix (Zusammenfassung)

| REQ-ID | Implementiert in | Getestet in |
|--------|-----------------|-------------|
| REQ-CORE-001 | `src/server.ts` L419–L491 | `tests/unit/server.test.ts` |
| REQ-CORE-002 | `src/server.ts` L444–L447 | — (offen) |
| REQ-CORE-003 | `src/server.ts` L462–L469 | — (offen) |
| REQ-CORE-004 | `src/server.ts` L201–L391 | `tests/unit/play-audio.test.ts`, `tests/unit/play-audio-comparison.test.ts` |
| REQ-CORE-005 | `src/server.ts` L397–L413 | — (offen) |
| REQ-CORE-006 | `src/server.ts` L476–L479 | — (offen) |
| REQ-CORE-007 | `src/server.ts` L351–L357 | `tests/unit/play-audio.test.ts` |
| REQ-CORE-008 | `src/server.ts` L210–L217 | `tests/unit/play-audio.test.ts` |
| REQ-CORE-009 | `src/server.ts` L201–L391 | — (offen) |
| REQ-CORE-010 | `src/server.ts` L420, L472–L473 | — (offen) |
| REQ-CORE-011 | `src/server.ts` L402–L413 | — (offen) |
| REQ-CORE-012 | `src/server.ts` L204–L237 | — (offen) |
| REQ-CORE-013 | — (offen) | — (offen) |
| REQ-CORE-014 | — (offen) | — (offen) |
| REQ-CMD-001 | `src/server.ts` L497–L506 | — (offen) |
| REQ-CMD-002 | `src/server.ts` L508–L517 | — (offen) |
| REQ-CMD-003 | `src/server.ts` L519–L535 | — (offen) |
| REQ-CMD-004 | `src/server.ts` L537–L575 | `tests/unit/server.test.ts` |
| REQ-CMD-005 | `src/server.ts` L577–L602 | `tests/unit/server.test.ts` |
| REQ-CMD-006 | `src/server.ts` L604–L618 | `tests/unit/server.test.ts` |
| REQ-CMD-007 | `src/server.ts` L620–L639 | `tests/unit/server.test.ts` |
| REQ-CMD-008 | **Entfernt** (Debug über Settings-UI, REQ-CFG-004) | — |
| REQ-CMD-009 | `src/server.ts` L641–L680 | `tests/unit/server.test.ts` |
| REQ-CMD-010 | `src/server.ts` L1168–L1186 | — (offen) |
| REQ-CMD-011 | `src/server.ts` L682–L719 | `tests/unit/server.test.ts` |
| REQ-CMD-012 | `src/server.ts` L721–L762 | `tests/unit/server.test.ts` |
| REQ-CMD-013 | `src/server.ts` L764–L801 | — (offen) |
| REQ-CMD-014 | `src/server.ts` L803–L1166 | — (offen) |
| REQ-CMD-015 | `src/server.ts` L862–L887 | — (offen) |
| REQ-CMD-016 | — (offen) | — (offen) |
| REQ-CMD-017 | `src/server.ts` | — (offen) |
| REQ-CFG-001 | `src/server.ts` L67–L73 | `tests/unit/server.test.ts` |
| REQ-CFG-002 | `src/server.ts` L74–L81 | — (offen) |
| REQ-CFG-003 | `src/server.ts` L1188 | — (offen) |
| REQ-CFG-004 | `src/server.ts` L82–L89 | — (offen) |
| REQ-CFG-005 | `src/server.ts` L90–L97, L254–L256, L267 | `tests/unit/play-audio.test.ts` |
| REQ-DATA-001 | `src/server.ts` L55 | — (offen) |
| REQ-DATA-002 | `src/server.ts` L56 | — (offen) |
| REQ-DATA-003 | `src/server.ts` L60 | `tests/unit/server.test.ts` |
| REQ-DATA-004 | `src/server.ts` L31–L38 | — (offen) |
| REQ-DATA-005 | `src/server.ts` L61 | `tests/unit/server.test.ts` |
| REQ-DATA-006 | `docker-compose.dev.yml` L31 | — (offen) |
| REQ-DATA-007 | `src/server.ts` L57, L188–L192, L425–L429 | — (offen) |
| REQ-LIFE-001 | `src/server.ts` L49–L50, L1188–L1189, L1200 | `tests/unit/server.test.ts` |
| REQ-LIFE-002 | `src/server.ts` L1196–L1198, L1200 | `tests/unit/server.test.ts` |
| REQ-LIFE-003 | `build.ts` L1–L61 | `tests/unit/build.test.ts` |
| REQ-LIFE-004 | `src/client.ts` L1–L2 | — (offen) |
| REQ-NF-001 | `tsconfig.json`, `src/server.ts` | — (offen) |
| REQ-NF-002 | `package.json` L6 | — (offen) |
| REQ-NF-003 | `build.ts` L48 | `tests/unit/build.test.ts` |
| REQ-NF-004 | `build.ts` L7–L39 | — (offen) |
| REQ-DBG-001 | `src/server.ts` L100–L105 | `tests/unit/server.test.ts` |
| REQ-DBG-002 | `src/server.ts` L422–L491 | — (offen) |
| REQ-DBG-003 | `src/server.ts` L201–L391 | — (offen) |
| REQ-DBG-004 | `src/server.ts` L397–L413 | — (offen) |
| REQ-DBG-005 | `src/server.ts` (diverse Command-Handler) | — (offen) |
| REQ-DBG-006 | `src/server.ts` L425–L429 | — (offen) |
| REQ-DBG-007 | `src/server.ts` L208 | — (offen) |
| REQ-DBG-008 | `src/server.ts` L803–L1166 | — (offen) |

---

## Lückenanalyse

### Tests fehlen für:
- **REQ-CORE-013, REQ-CORE-014** — Channel-Join-Guard und Event-basierte Channel-Auswahl nicht implementiert und nicht getestet (BUG-002).
- **REQ-CMD-016** — Übergreifende Voice-Channel-Prüfung für Audio-Commands nicht als eigenständige Anforderung getestet.
- **REQ-CMD-017** — `/hero-search-music` implementiert, aber noch nicht getestet.
- **REQ-CORE-002, REQ-CORE-003** — No-Mapping-Szenario und Datei-Existenz-Check nicht unit-getestet.
- **REQ-CORE-005** — Voice-Channel-Tracking (Add/Remove) nicht getestet.
- **REQ-CORE-006** — Verhalten bei 0 aktiven Channels nicht getestet.
- **REQ-CORE-009** — On-Demand Playback-Lifecycle nicht als eigenständiger Test.
- **REQ-CORE-010** — Intro-Delay vor Wiedergabe nicht getestet.
- **REQ-CORE-011** — Session-Cleanup bei Channel-Schließung nicht getestet.
- **REQ-CMD-001 bis REQ-CMD-003** — Enable/Disable/Stop-Commands nicht getestet.
- **REQ-CMD-010** — Dump-Context Command nicht getestet.
- **REQ-CMD-013** — Play-Song Command nicht getestet.
- **REQ-CMD-014** — Diagnose Command nicht getestet.
- **REQ-CFG-002, REQ-CFG-003, REQ-CFG-004** — Settings `oncePerDay`, UI-Aktivierung und `debug` nicht getestet.
- **REQ-DATA-001, REQ-DATA-002, REQ-DATA-004, REQ-DATA-007** — JSON-Persistenz (MusicMap-Pfad, Daily-Greets, Fallback, User-Cache) nicht getestet.
- **REQ-DATA-006** — Docker-Testdateien-Mount nicht getestet.
- **REQ-DBG-002 bis REQ-DBG-008** — Detailliertes Debug-Logging und Diagnose nicht getestet.
- **REQ-LIFE-004** — Leerer Client-Entry-Point nicht getestet.
- **REQ-NF-001, REQ-NF-002, REQ-NF-004** — Nichtfunktionale Anforderungen nicht getestet.

### Bereits getestet:
- **REQ-CORE-001** — Auto-Play bei Join (`tests/unit/server.test.ts`)
- **REQ-CORE-004** — Transport-Config, Producer-RTP-Parameter, SSRC-Konsistenz, ffmpeg-Args, Stream-Registration (`tests/unit/play-audio.test.ts`, `tests/unit/play-audio-comparison.test.ts`)
- **REQ-CORE-007** — Cleanup nach ffmpeg-Exit (`tests/unit/play-audio.test.ts`)
- **REQ-CORE-008** — Concurrent Playback Protection (`tests/unit/play-audio.test.ts`)
- **REQ-CFG-001** — Enabled-Setting (`tests/unit/server.test.ts`)
- **REQ-CFG-005** — Volume-Setting in ffmpeg-Args (`tests/unit/play-audio.test.ts`)
- **REQ-CMD-004 bis REQ-CMD-007** — Set, Remove, List, Files Commands (`tests/unit/server.test.ts`)
- **REQ-CMD-009** — Set-Me Command (`tests/unit/server.test.ts`)
- **REQ-CMD-011** — Play-Me Command (`tests/unit/server.test.ts`)
- **REQ-CMD-012** — Play Command (`tests/unit/server.test.ts`)
- **REQ-DATA-003, REQ-DATA-005** — Verzeichnis-Erstellung (`tests/unit/server.test.ts`)
- **REQ-LIFE-001, REQ-LIFE-002** — onLoad/onUnload (`tests/unit/server.test.ts`)
- **REQ-LIFE-003, REQ-NF-003** — Build-Prozess (`tests/unit/build.test.ts`)
- **REQ-DBG-001** — Debug-Logging ein/aus (`tests/unit/server.test.ts`)

### Empfehlung:
1. **Hoechste Prioritaet:** Implementierung von REQ-CORE-013 und REQ-CORE-014 (BUG-002 — Bot joint Channel ohne User). Danach REQ-CMD-016 (Voice-Channel-Prüfung konsolidieren).
2. **Hohe Prioritaet:** Unit-Tests fuer REQ-CORE-002, REQ-CORE-003, REQ-CFG-002.
3. **Hohe Prioritaet:** Tests fuer REQ-CMD-001 bis REQ-CMD-003 (Enable/Disable/Stop), REQ-CORE-011 (Channel-Cleanup).
4. **Mittlere Prioritaet:** Persistenz-Tests (REQ-DATA-001, REQ-DATA-002, REQ-DATA-004), REQ-CORE-010 (Delay), REQ-CMD-013 (Play-Song).

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
| 2026-03-15 | REQ-CFG-005 (Volume-Setting) hinzugefügt. REQ-CORE-009 (On-Demand Playback ohne persistenten Bot) hinzugefügt. REQ-CORE-004 aktualisiert (Bun.spawn, Referenz-Plugin-Angleichung, bekannter Audio-Bug dokumentiert). Alle Traceability-Zeilennummern aktualisiert. Sektion "Bekannte Bugs" (BUG-001) hinzugefügt. Lückenanalyse erweitert um REQ-CORE-009 und REQ-CFG-005. | Requirements Engineer |
| 2026-03-15 | REQ-DBG-008 (`/hero-diagnose`) hinzugefügt: Pipeline-Diagnose-Command mit 6 Stages (Pre-flight, Transport, Producer, ffmpeg, Stream+Consumer-Discovery, Router-Dump). Unit-Tests fuer playAudio-Pipeline (8 Tests) und Referenz-Paritaetstests (4 Tests) erstellt. Mock-Infrastruktur erweitert (Producer, Consumer, Router, Bun.spawn). | Developer |
| 2026-03-17 | **Vollstaendige Requirements-Analyse** gegen aktuellen Codestand (server.ts 1201 Zeilen). Neue REQs: REQ-CORE-010 (Intro-Delay), REQ-CORE-011 (Channel-Close Session-Cleanup), REQ-CMD-014 (`/hero-diagnose` als Command-REQ). Korrekturen: REQ-CORE-001 um Delay und Channel-Auswahl praezisiert, REQ-CORE-006 von "Fehler geloggt" auf "Debug-Log" korrigiert, REQ-CMD-010 Beschreibung an tatsaechliche Implementierung angepasst (alle Parameter statt nur invokerCtx), REQ-DBG-008 auf 7 Stages (0-6) aktualisiert. Alle Traceability-Zeilennummern gegen server.ts abgeglichen und aktualisiert (REQ-LIFE-001/002, REQ-CFG-003, REQ-CMD-010, REQ-DBG-008). Traceability-Matrix: REQ-CORE-004/007/008/CFG-005 Test-Abdeckung nachgetragen (play-audio.test.ts, play-audio-comparison.test.ts). Lueckenanalyse vollstaendig ueberarbeitet. | Requirements Engineer |
| 2026-03-20 | **BUG-002:** Bot betritt Voice-Channel ohne anwesenden User dokumentiert. Neue REQs: REQ-CORE-013 (Channel-Join nur bei legitimem Trigger), REQ-CORE-014 (Channel-Auswahl anhand voiceChannelId aus user:joined-Event mit Fallback-Logik), REQ-CMD-016 (Voice-Channel-Pflichtprüfung vor Wiedergabe fuer alle Audio-Commands). Traceability-Matrix und Lueckenanalyse aktualisiert. Empfehlung: REQ-CORE-013/014 haben hoechste Implementierungsprioritaet. | Requirements Engineer |
| 2026-03-20 | REQ-CMD-017 (`/hero-search-music`) hinzugefuegt: Command durchsucht Sharkord-SQLite-DB nach Audio-Anhaengen und kopiert gefundene Dateien ins Plugin-Music-Verzeichnis. Prioritaet: Could. 8 Abnahmekriterien (REQ-CMD-017-A bis -H) definiert. Traceability-Matrix und Lueckenanalyse aktualisiert. Feasibility bestaetigt (Bun SQLite, bekanntes DB-Schema, Dateisystem-Zugriff). | Requirements Engineer |
