#!/usr/bin/env python3
"""
Import all requirements from docs/REQUIREMENTS.md into Doorstop.

Creates one doorstop document per REQ category (CORE, CMD, CFG, DATA, LIFE, NF, DBG, AUTO)
and populates items with description, status, priority, traceability, and acceptance criteria.

Usage:
    py scripts/doorstop-import.py
"""

import os
import sys
import yaml
import shutil

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQS_DIR = os.path.join(REPO_ROOT, "reqs")

# ---------------------------------------------------------------------------
# Document definitions: prefix → directory
# ---------------------------------------------------------------------------
ROOT_DOCUMENT = {"prefix": "REQ", "path": "reqs"}

DOCUMENTS = {
    "REQ-CORE": "reqs/core",
    "REQ-CMD":  "reqs/cmd",
    "REQ-CFG":  "reqs/cfg",
    "REQ-DATA": "reqs/data",
    "REQ-LIFE": "reqs/life",
    "REQ-NF":   "reqs/nf",
    "REQ-DBG":  "reqs/dbg",
    "REQ-AUTO": "reqs/auto",
}

# Category label items for the root document (one per child document)
ROOT_ITEMS = [
    {"uid": "REQ-001", "header": "Kernfunktionalität (CORE)", "level": 1,
     "text": "Anforderungen an die Audio-Intro-Kernfunktionalität."},
    {"uid": "REQ-002", "header": "Slash-Commands (CMD)", "level": 2,
     "text": "Anforderungen an alle Slash-Commands."},
    {"uid": "REQ-003", "header": "Konfiguration / Settings (CFG)", "level": 3,
     "text": "Anforderungen an Plugin-Einstellungen."},
    {"uid": "REQ-004", "header": "Datenpersistenz (DATA)", "level": 4,
     "text": "Anforderungen an Datenhaltung und Persistenz."},
    {"uid": "REQ-005", "header": "Plugin Lifecycle (LIFE)", "level": 5,
     "text": "Anforderungen an onLoad/onUnload/Build."},
    {"uid": "REQ-006", "header": "Nichtfunktionale Anforderungen (NF)", "level": 6,
     "text": "Nichtfunktionale Anforderungen."},
    {"uid": "REQ-007", "header": "Debug / Diagnose (DBG)", "level": 7,
     "text": "Anforderungen an Debug-Logging und Diagnose."},
    {"uid": "REQ-008", "header": "GitHub-Automatisierung (AUTO)", "level": 8,
     "text": "Anforderungen an CI/CD und Issue-Automatisierung."},
]

# ---------------------------------------------------------------------------
# All requirements data — extracted from docs/REQUIREMENTS.md
# ---------------------------------------------------------------------------
REQUIREMENTS = [
    # ===== REQ-CORE =====
    {
        "uid": "REQ-CORE-001",
        "header": "Auto-Intro bei Voice-Join",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts",
        "text": (
            "Wenn ein User einem Voice-Channel beitritt (`voice:user_joined`-Event), "
            "wird anhand des `username` aus dem Event (oder aus dem User-Cache) in der "
            "MusicMap nach einem passenden Eintrag gesucht. Existiert ein Mapping, wird "
            "der Audio-Pfad als `path.join(pluginDir, \"music\", audioFileName)` aufgelöst. "
            "Nach einer konfigurierbaren Verzögerung (`INTRO_DELAY_MS`, Default 5000 ms) "
            "wird das Intro automatisch im Event-Channel (`channelId`) abgespielt. "
            "Das Plugin unterstützt `.mp3` und `.mpeg` Dateien."
        ),
        "acceptance": (
            "Ein User mit konfiguriertem Audio-Mapping joint einen Voice-Channel "
            "(voice:user_joined) → nach INTRO_DELAY_MS wird Audio-Pfad als "
            "path.join(pluginDir, 'music', audioFileName) aufgelöst und im Event-Channel abgespielt."
        ),
    },
    {
        "uid": "REQ-CORE-002",
        "header": "Kein Fehler ohne Mapping",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L444-L447",
        "text": (
            "Wenn für einen User kein MP3-Mapping konfiguriert ist, erfolgt **keine** "
            "Audiowiedergabe und **kein** Fehler."
        ),
        "acceptance": "Ein User ohne MP3-Mapping joint → keine hörbare Ausgabe, kein Fehler im Log.",
    },
    {
        "uid": "REQ-CORE-003",
        "header": "Datei-Existenz-Prüfung",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L462-L469",
        "text": (
            "Die MP3-Datei wird vor der Wiedergabe auf Existenz geprüft; fehlt die Datei, "
            "wird ein Fehler geloggt und keine Wiedergabe gestartet."
        ),
        "acceptance": "MP3 in music-map.json verweist auf nicht-existente Datei → Fehler-Log-Eintrag, keine Wiedergabe.",
    },
    {
        "uid": "REQ-CORE-004",
        "header": "Audio-Pipeline ffmpeg→mediasoup",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L201-L391",
        "text": (
            "Die Audiowiedergabe erfolgt über `ffmpeg` (MP3/MPEG → Opus-RTP) an einen "
            "mediasoup `PlainTransport`. Der Stream wird via `ctx.actions.voice.createStream` "
            "im Voice-Channel exponiert. Die Pipeline verwendet `Bun.spawn` (nicht "
            "`child_process.spawn`) und orientiert sich am funktionierenden Referenz-Plugin "
            "`sharkord-music-bot`. **BEKANNTER BUG:** Audio ist trotz vollständig "
            "funktionierender Server-Pipeline nicht hörbar — vermutete Ursache ist Client-seitig."
        ),
        "acceptance": (
            "Während der Wiedergabe ist ein ffmpeg-Prozess aktiv und sendet Opus-RTP an "
            "den konfigurierten Port. Bun.spawn wird verwendet."
        ),
    },
    {
        "uid": "REQ-CORE-005",
        "header": "Voice-Channel-Tracking",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L397-L413",
        "text": (
            "Das Plugin trackt aktive Voice-Channels über die Events "
            "`voice:runtime_initialized` und `voice:runtime_closed` in einem lokalen Set."
        ),
        "acceptance": (
            "Nach voice:runtime_initialized enthält das interne Set die Channel-ID; "
            "nach voice:runtime_closed nicht mehr."
        ),
    },
    {
        "uid": "REQ-CORE-006",
        "header": "Kein Channel → kein Playback",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L476-L479",
        "text": (
            "Ist kein aktiver Voice-Channel vorhanden, wird ein Debug-Log-Eintrag "
            "erzeugt und keine Wiedergabe gestartet."
        ),
        "acceptance": "User joint bei 0 aktiven Voice-Channels → Debug-Log 'No active voice channel', keine Wiedergabe.",
    },
    {
        "uid": "REQ-CORE-007",
        "header": "Ressourcen-Cleanup nach Playback",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L351-L357",
        "text": (
            "Nach Ende der Wiedergabe (ffmpeg-Exit oder Fehler) werden Producer, "
            "PlainTransport und Stream automatisch aufgeräumt (close/remove)."
        ),
        "acceptance": "Nach Wiedergabeende sind Producer und PlainTransport geschlossen und der Stream entfernt.",
    },
    {
        "uid": "REQ-CORE-008",
        "header": "Concurrent-Playback-Schutz",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L210-L217",
        "text": (
            "Pro userId darf maximal ein Intro gleichzeitig aktiv sein. Ein neuer "
            "Wiedergabe-Request für denselben User beendet zuerst die laufende "
            "Wiedergabe (SIGTERM), bevor die neue gestartet wird."
        ),
        "acceptance": (
            "User hat laufendes Intro → neuer Wiedergabe-Request → altes Intro wird "
            "gestoppt (SIGTERM), neues Intro startet."
        ),
    },
    {
        "uid": "REQ-CORE-009",
        "header": "On-Demand Transport-Lifecycle",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L201-L391",
        "text": (
            "Der Bot joint Voice-Channels nicht dauerhaft. Transport, Producer und "
            "Stream werden ausschließlich on-demand für die Dauer einer einzelnen "
            "Wiedergabe erstellt. Nach Wiedergabeende werden alle Ressourcen automatisch "
            "aufgeräumt. Es verbleibt kein persistenter Bot im Channel."
        ),
        "acceptance": (
            "Vor Wiedergabe: kein Transport/Producer. Während: Transport+Producer+Stream. "
            "Nach: alle drei geschlossen/entfernt."
        ),
    },
    {
        "uid": "REQ-CORE-010",
        "header": "Konfigurierbare Intro-Verzögerung",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts",
        "text": (
            "Zwischen dem `voice:user_joined`-Event und dem Start der Intro-Wiedergabe "
            "wird eine konfigurierbare Verzögerung (`INTRO_DELAY_MS`, Default: 5000 ms) "
            "eingehalten."
        ),
        "acceptance": "User joint → mindestens INTRO_DELAY_MS (5000 ms) vergehen bevor playAudio aufgerufen wird.",
    },
    {
        "uid": "REQ-CORE-011",
        "header": "Cleanup bei Channel-Schließung",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L402-L413",
        "text": (
            "Wenn ein Voice-Channel geschlossen wird (`voice:runtime_closed`), werden "
            "alle aktiven Playback-Sessions für diesen Channel automatisch beendet "
            "(ffmpeg-Kill, Cleanup, Session-Entfernung)."
        ),
        "acceptance": (
            "Voice-Channel wird geschlossen → alle activeSessions mit passendem "
            "channelId-Prefix werden beendet (kill + cleanup + delete)."
        ),
    },
    {
        "uid": "REQ-CORE-012",
        "header": "Per-Channel Intro-Queue",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts",
        "text": (
            "Wenn mehrere User gleichzeitig oder kurz nacheinander einem Voice-Channel "
            "beitreten, werden die Intros über eine per-Channel-Warteschlange sequenziell "
            "abgespielt (nicht überlappend). Die Queue wird bei Channel-Schließung "
            "automatisch geleert."
        ),
        "acceptance": (
            "User A und User B joinen gleichzeitig → Intro A spielt zuerst, Intro B "
            "spielt nach Abschluss von A. Channel schließt → Queue geleert."
        ),
    },
    {
        "uid": "REQ-CORE-013",
        "header": "Event-Trennung voice:user_joined vs user:joined",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts",
        "text": (
            "Der Bot startet automatische Wiedergabe ausschließlich bei "
            "`voice:user_joined` (Sharkord >= 0.0.16). Das Event `user:joined` dient "
            "nur der User-Cache-Pflege und darf keine Wiedergabe auslösen."
        ),
        "acceptance": (
            "user:joined-Event löst keine Wiedergabe aus; nur Cache wird aktualisiert. "
            "/hero-play durch User ohne Voice-Channel → Fehlermeldung."
        ),
    },
    {
        "uid": "REQ-CORE-014",
        "header": "Channel-ID aus Payload",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts",
        "text": (
            "Der Ziel-Voice-Channel für Auto-Intro wird immer direkt aus dem "
            "`voice:user_joined`-Payload (`channelId`) bestimmt. Ein Fallback auf den "
            "ersten aktiven Channel ist nicht zulässig."
        ),
        "acceptance": (
            "voice:user_joined mit channelId → Wiedergabe in diesem Channel. "
            "Kein Fallback auf ersten aktiven Channel. channelId nicht aktiv → keine Wiedergabe."
        ),
    },
    {
        "uid": "REQ-CORE-015",
        "header": "Cleanup bei voice:user_left",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts",
        "text": (
            "Bei `voice:user_left` werden ausstehende Queue-Einträge des Users im "
            "betroffenen Channel entfernt. Läuft für denselben channelId-userId bereits "
            "eine aktive Session, wird sie beendet und bereinigt."
        ),
        "acceptance": (
            "voice:user_left während laufender/ausstehender Session → Queue-Einträge "
            "entfernt, laufende Session beendet und bereinigt."
        ),
    },

    # ===== REQ-CMD =====
    {
        "uid": "REQ-CMD-001",
        "header": "/hero-enable (Entfernt)",
        "status": "Removed",
        "priority": "",
        "traceability": "",
        "text": "~~`/hero-enable`~~ **Entfernt.** Aktivierung/Deaktivierung erfolgt über Sharkord Plugin-Management.",
        "acceptance": "Entfernt. Aktivierung über Plugin-Management in Sharkord.",
    },
    {
        "uid": "REQ-CMD-002",
        "header": "/hero-disable (Entfernt)",
        "status": "Removed",
        "priority": "",
        "traceability": "",
        "text": "~~`/hero-disable`~~ **Entfernt.** Aktivierung/Deaktivierung erfolgt über Sharkord Plugin-Management.",
        "acceptance": "Entfernt. Aktivierung über Plugin-Management in Sharkord.",
    },
    {
        "uid": "REQ-CMD-003",
        "header": "/hero-stop",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L519-L535",
        "text": (
            "`/hero-stop` beendet sofort alle laufenden ffmpeg-Prozesse (SIGTERM) und "
            "gibt eine Bestätigung zurück. Sind keine Intros aktiv, wird eine "
            "entsprechende Info-Meldung zurückgegeben."
        ),
        "acceptance": (
            "Bei laufenden Intros: alle ffmpeg-Prozesse beendet, activeSessions-Map leer. "
            "Ohne laufende Intros: Info-Meldung."
        ),
    },
    {
        "uid": "REQ-CMD-004",
        "header": "/hero-set <displayName> <audioFileName>",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L537-L575",
        "text": (
            "`/hero-set <displayName> <audioFileName>` speichert ein DisplayName→Audio-Mapping. "
            "Der audioFileName kann mit oder ohne Dateiendung angegeben werden (case-insensitive). "
            "Bei Namens-Duplikaten wird der User aufgefordert, den vollständigen Dateinamen "
            "anzugeben. Die Datei wird im festen Verzeichnis `<plugin-dir>/music/` gesucht."
        ),
        "acceptance": (
            "Ohne Endung + eine Datei → Mapping gespeichert. Ohne Endung + mehrere → Warnung. "
            "Mit Endung + existiert → gespeichert. Keine Datei → Fehler mit Dateiliste."
        ),
    },
    {
        "uid": "REQ-CMD-005",
        "header": "/hero-remove <displayName>",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L577-L602",
        "text": (
            "`/hero-remove <displayName>` entfernt das MP3-Mapping für den angegebenen "
            "DisplayName. Existiert kein Mapping, wird eine Info-Meldung zurückgegeben."
        ),
        "acceptance": "Bestehende Zuordnung → entfernt + Bestätigung. Keine → Info-Meldung.",
    },
    {
        "uid": "REQ-CMD-006",
        "header": "/hero-list",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L604-L618",
        "text": (
            "`/hero-list` gibt eine formatierte Liste aller DisplayName→Audio-Zuordnungen "
            "im Format `DisplayName: audioFileName` zurück."
        ),
        "acceptance": "Mappings vorhanden → Liste. Keine → Info-Meldung 'No intro mappings configured yet.'",
    },
    {
        "uid": "REQ-CMD-007",
        "header": "/hero-files",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L620-L639",
        "text": (
            "`/hero-files` listet alle verfügbaren Audio-Dateien (`.mp3` und `.mpeg`) im "
            "Verzeichnis `<plugin-dir>/music/`."
        ),
        "acceptance": "Audio-Dateien vorhanden → Liste. Keine → Info-Meldung.",
    },
    {
        "uid": "REQ-CMD-008",
        "header": "/hero-debug (Entfernt)",
        "status": "Removed",
        "priority": "",
        "traceability": "",
        "text": "~~`/hero-debug`~~ **Entfernt.** Debug-Modus wird über Setting `debug` gesteuert (REQ-CFG-004).",
        "acceptance": "Entfernt. Debug über Plugin-Settings-UI.",
    },
    {
        "uid": "REQ-CMD-009",
        "header": "/hero-set-me <audioFileName>",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L641-L680",
        "text": (
            "`/hero-set-me <audioFileName>` mappt den ausführenden User auf die angegebene "
            "Audio-Datei. Case-insensitive Suche. Username aus User-Cache via invokerCtx.userId."
        ),
        "acceptance": (
            "Ohne Endung + eine Datei + Username im Cache → gespeichert. Duplikate → Warnung. "
            "Keine Datei → Fehler. Username nicht im Cache → Fehler."
        ),
    },
    {
        "uid": "REQ-CMD-010",
        "header": "/hero-dump-context",
        "status": "Implemented",
        "priority": "Could",
        "traceability": "src/server.ts L1168-L1186",
        "text": (
            "`/hero-dump-context` gibt alle Command-Parameter als JSON-Dump aus. "
            "Akzeptiert optionales Argument `testArg: string`. Dient Reverse-Engineering der SDK-Typen."
        ),
        "acceptance": "Ausführung → Server-Log und Chat-Antwort enthalten formatiertes JSON aller Parameter.",
    },
    {
        "uid": "REQ-CMD-011",
        "header": "/hero-play-me",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L682-L719",
        "text": (
            "`/hero-play-me` spielt das eigene Intro ab. Ermittelt Username über "
            "invokerCtx.userId aus User-Cache. Voice-Channel aus invokerCtx.currentVoiceChannelId."
        ),
        "acceptance": (
            "Mit Mapping + Voice-Channel → eigenes Intro abgespielt. "
            "Ohne Mapping → Info. Ohne Voice-Channel → Fehler."
        ),
    },
    {
        "uid": "REQ-CMD-012",
        "header": "/hero-play <displayName>",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L721-L762",
        "text": (
            "`/hero-play <displayName>` spielt das Intro einer anderen Person ab. "
            "Voice-Channel aus invokerCtx.currentVoiceChannelId."
        ),
        "acceptance": (
            "DisplayName mit Mapping + Voice-Channel → Intro abgespielt. "
            "Ohne Mapping → Info. Datei fehlt → Fehler. Ohne Voice-Channel → Fehler."
        ),
    },
    {
        "uid": "REQ-CMD-013",
        "header": "/hero-play-song <songName>",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L764-L801",
        "text": (
            "`/hero-play-song <songName>` spielt beliebige Audio-Datei aus music-Verzeichnis. "
            "Case-insensitive, mit/ohne Endung. Bei Duplikaten Hinweis auf vollständigen Namen."
        ),
        "acceptance": (
            "Ohne Endung + eine Datei → abgespielt. Duplikate → Warnung. "
            "Kein Match → Fehler mit Dateiliste. Ohne Voice-Channel → Fehler."
        ),
    },
    {
        "uid": "REQ-CMD-014",
        "header": "/hero-diagnose",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L803-L1166",
        "text": (
            "`/hero-diagnose` führt vollständige Audio-Pipeline-Diagnose durch. "
            "Strukturierter Report mit PASS/FAIL/INFO pro Stage."
        ),
        "acceptance": (
            "In Voice-Channel → Report mit 7 Stages (0-6). "
            "Ohne Voice-Channel → Guard-Fehlermeldung. Danach Cleanup."
        ),
    },
    {
        "uid": "REQ-CMD-015",
        "header": "/hero-reset-me",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts",
        "text": (
            "`/hero-reset-me` setzt den täglichen Begrüßungszähler des Users zurück. "
            "Intro wird beim nächsten Join erneut abgespielt (auch bei oncePerDay=true)."
        ),
        "acceptance": (
            "Mit Daily-Greet-Eintrag → entfernt + Bestätigung. "
            "Ohne Eintrag → Info 'no entry to reset'. "
            "Nach Reset + Join bei oncePerDay=true → Intro erneut."
        ),
    },
    {
        "uid": "REQ-CMD-016",
        "header": "Voice-Channel-Guard für Audio-Commands",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts, tests/unit/channel-guard.test.ts",
        "text": (
            "Alle Audio-Commands (/hero-play-me, /hero-play, /hero-play-song, /hero-diagnose) "
            "prüfen vor Wiedergabe ob User in aktivem Voice-Channel ist. "
            "Sonst Abbruch mit Fehlermeldung, kein Transport erstellt."
        ),
        "acceptance": (
            "Ohne currentVoiceChannelId → Fehlermeldung, kein Transport. "
            "Mit channelId aber nicht in activeChannels → 'Voice channel is not active.'"
        ),
    },
    {
        "uid": "REQ-CMD-017",
        "header": "/hero-search-music",
        "status": "Implemented",
        "priority": "Could",
        "traceability": "src/server.ts",
        "text": (
            "`/hero-search-music` durchsucht SQLite-Datenbank des Sharkord-Servers nach "
            "Audio-Anhängen und kopiert sie ins music-Verzeichnis. Nur audio/mpeg bzw. "
            ".mp3/.mpeg Dateien. Zusammenfassung: gefunden/kopiert/übersprungen."
        ),
        "acceptance": (
            "DB mit 3 Audio-Dateien, 1 bereits vorhanden → 3 gefunden, 2 kopiert, 1 übersprungen. "
            "DB nicht erreichbar → Fehlermeldung, kein Crash."
        ),
    },

    # ===== REQ-CFG =====
    {
        "uid": "REQ-CFG-001",
        "header": "Setting enabled (Entfernt)",
        "status": "Removed",
        "priority": "",
        "traceability": "",
        "text": "~~Setting `enabled`~~ **Entfernt.** Aktivierung/Deaktivierung erfolgt über Sharkord Plugin-Management.",
        "acceptance": "Entfernt. Aktivierung über Plugin-Management.",
    },
    {
        "uid": "REQ-CFG-002",
        "header": "Setting oncePerDay",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L74-L81",
        "text": (
            "Setting `oncePerDay` (boolean, Default: true). Wenn true, wird jeder User "
            "maximal einmal pro Kalendertag begrüßt."
        ),
        "acceptance": (
            "oncePerDay=true + heute begrüßt → kein erneutes Intro. "
            "oncePerDay=true + heute nicht begrüßt → Intro. "
            "oncePerDay=false → Intro bei jedem Join."
        ),
    },
    {
        "uid": "REQ-CFG-003",
        "header": "Settings-UI Aktivierung",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L1188",
        "text": "Das Plugin aktiviert die Settings-UI im Sharkord-Frontend via `ctx.ui.enable()`.",
        "acceptance": "Im Sharkord-Frontend unter Plugins → Hero Introducer → Settings sind Einstellungen sichtbar.",
    },
    {
        "uid": "REQ-CFG-004",
        "header": "Setting debug",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L82-L89",
        "text": "Setting `debug` (boolean, Default: false). Wenn true, detailliertes Debug-Logging über debugLog.",
        "acceptance": "debug=true → [DEBUG]-Einträge im Log. debug=false → keine [DEBUG]-Einträge.",
    },
    {
        "uid": "REQ-CFG-005",
        "header": "Setting volume",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L90-L97, L255-L256, L267",
        "text": (
            "Setting `volume` (number, Default: 25). Lautstärke 0-100%. "
            "Server-seitig über ffmpeg `-af volume=<dezimalwert>`. Clamp auf 0-100."
        ),
        "acceptance": (
            "volume=50 → -af volume=0.5. volume=0 → -af volume=0.0. "
            "volume=100 → -af volume=1.0. volume=150 → auf 100 begrenzt."
        ),
    },

    # ===== REQ-DATA =====
    {
        "uid": "REQ-DATA-001",
        "header": "music-map.json Persistenz",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L55",
        "text": "DisplayName→Audio-Zuordnungen persistent als JSON in `<plugin-data-dir>/data/music-map.json`.",
        "acceptance": "Nach /hero-set TestUser intro.mp3 enthält music-map.json den Eintrag.",
    },
    {
        "uid": "REQ-DATA-002",
        "header": "daily-greets.json Persistenz",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L56",
        "text": "Daily-Greet-Einträge (User-ID → ISO-Datum) persistent als JSON in `<plugin-data-dir>/data/daily-greets.json`.",
        "acceptance": "Nach Begrüßung enthält daily-greets.json den Eintrag mit heutigem Datum.",
    },
    {
        "uid": "REQ-DATA-003",
        "header": "Auto-Erstellung data-Verzeichnis",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L60",
        "text": "Das Datenverzeichnis `<plugin-data-dir>/data/` wird beim Plugin-Start automatisch erstellt.",
        "acceptance": "Plugin startet in leerem Verzeichnis → data/-Ordner wird angelegt.",
    },
    {
        "uid": "REQ-DATA-004",
        "header": "JSON-Fallback bei fehlendem File",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L31-L38",
        "text": "Fehlt eine JSON-Datei beim Lesen, wird Fallback-Wert ({}) verwendet statt Fehler.",
        "acceptance": "Plugin startet ohne music-map.json → leeres Objekt verwendet, kein Crash.",
    },
    {
        "uid": "REQ-DATA-005",
        "header": "Auto-Erstellung music-Verzeichnis",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L61",
        "text": "Verzeichnis `<plugin-dir>/music/` wird beim Plugin-Start automatisch erstellt.",
        "acceptance": "Plugin startet ohne music/-Ordner → Ordner wird angelegt.",
    },
    {
        "uid": "REQ-DATA-006",
        "header": "Docker Test-Music-Mount",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "docker-compose.dev.yml L31",
        "text": "Beim Docker-Testsystem werden Testdateien aus tests/test_music/ in den Plugin-music-Ordner gemountet.",
        "acceptance": "Docker-Testsystem gestartet → Dateien aus tests/test_music/ sind im music-Ordner.",
    },
    {
        "uid": "REQ-DATA-007",
        "header": "User-Cache Persistenz",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L57, L188-L192, L425-L429",
        "text": (
            "userId→username-Zuordnungen persistent in `<plugin-data-dir>/data/user-cache.json`. "
            "Beim Start in Memory-Cache geladen, bei user:joined aktualisiert."
        ),
        "acceptance": (
            "Plugin startet → user-cache.json geladen. Nach user:joined mit userId=42/"
            "username='Alice' → Cache enthält '42': 'Alice' und wird persistiert."
        ),
    },

    # ===== REQ-LIFE =====
    {
        "uid": "REQ-LIFE-001",
        "header": "onLoad Plugin-Initialisierung",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L49-L50, L1188-L1189, L1200",
        "text": (
            "onLoad registriert Settings, Events, Commands und aktiviert UI. "
            "Loggt 'Hero Introducer loaded' und 'Hero Introducer ready'."
        ),
        "acceptance": "Nach onLoad: alle Commands registriert, Settings vorhanden, Events gebunden, UI aktiviert.",
    },
    {
        "uid": "REQ-LIFE-002",
        "header": "onUnload Plugin-Cleanup",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "src/server.ts L1196-L1198, L1200",
        "text": "onUnload loggt 'Hero Introducer unloaded'.",
        "acceptance": "Nach onUnload wird 'Hero Introducer unloaded' geloggt.",
    },
    {
        "uid": "REQ-LIFE-003",
        "header": "Build-Prozess",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "build.ts L1-L61",
        "text": (
            "bun build.ts erzeugt dist/sharkord-hero-introducer/server.js (ESM, target bun), "
            "client.js (ESM, target browser) und package.json."
        ),
        "acceptance": "bun build.ts → dist/ enthält server.js, client.js und package.json mit export-Marker.",
    },
    {
        "uid": "REQ-LIFE-004",
        "header": "Leerer Client-Entry-Point",
        "status": "Implemented",
        "priority": "Could",
        "traceability": "src/client.ts L1-L2",
        "text": "client.ts exportiert keine UI-Komponenten (leerer Entry-Point).",
        "acceptance": "client.js enthält keine React-Komponenten oder UI-Logik.",
    },

    # ===== REQ-NF =====
    {
        "uid": "REQ-NF-001",
        "header": "TypeScript typsicher",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "tsconfig.json, src/server.ts",
        "text": "Der gesamte Plugin-Code ist in TypeScript geschrieben und typsicher kompilierbar.",
        "acceptance": "tsc --noEmit meldet keine Typfehler.",
    },
    {
        "uid": "REQ-NF-002",
        "header": "Bun Runtime",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "package.json L6",
        "text": "Das Plugin verwendet Bun als Runtime (nicht Node.js).",
        "acceptance": "Build-Target ist bun (server) bzw. browser (client); kein Node.js-Code.",
    },
    {
        "uid": "REQ-NF-003",
        "header": "mediasoup external",
        "status": "Implemented",
        "priority": "Must",
        "traceability": "build.ts L48",
        "text": "Externe Abhängigkeit mediasoup wird beim Build als external markiert.",
        "acceptance": "server.js enthält kein gebündeltes mediasoup.",
    },
    {
        "uid": "REQ-NF-004",
        "header": "React als Client-Global",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "build.ts L7-L39",
        "text": "React und React-DOM werden als Client-Globals aufgelöst (Sharkord stellt sie bereit).",
        "acceptance": "client.js enthält window.__SHARKORD_REACT__-Referenzen statt gebündeltem React.",
    },

    # ===== REQ-DBG =====
    {
        "uid": "REQ-DBG-001",
        "header": "debugLog Hilfsfunktion",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L100-L105",
        "text": "debugLog(message) loggt nur bei debug=true mit Prefix [DEBUG] über ctx.log().",
        "acceptance": "debug=true → debugLog('test') erzeugt '[DEBUG] test'. debug=false → kein Log.",
    },
    {
        "uid": "REQ-DBG-002",
        "header": "Debug-Log bei voice:user_joined",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts",
        "text": (
            "Im voice:user_joined-Handler werden userId, username, channelId, Mapping-Ergebnis, "
            "oncePerDay-Status, Datei-Existenz und aktive Channels geloggt."
        ),
        "acceptance": "User joint bei debug=true → Log enthält alle relevanten Informationen.",
    },
    {
        "uid": "REQ-DBG-003",
        "header": "Debug-Log bei playAudio",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L201-L391",
        "text": "In playAudio werden Router-Erstellung, Transport-Config und ffmpeg-Kommando geloggt.",
        "acceptance": "Wiedergabe bei debug=true → Log enthält Router-Info, IP/Port und ffmpeg-Kommando.",
    },
    {
        "uid": "REQ-DBG-004",
        "header": "Debug-Log bei Channel-Events",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L397-L413",
        "text": "Bei voice:runtime_initialized/closed wird aktuelle Channel-Anzahl geloggt.",
        "acceptance": "Channel-Event bei debug=true → Log enthält Channel-ID und Anzahl.",
    },
    {
        "uid": "REQ-DBG-005",
        "header": "Debug-Log bei Commands",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts",
        "text": "Bei jedem Command werden Name, userId und Argumente geloggt.",
        "acceptance": "Command bei debug=true → Log enthält Command-Name, userId und Argumente.",
    },
    {
        "uid": "REQ-DBG-006",
        "header": "Debug-Log bei User-Cache-Update",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L425-L429",
        "text": "Bei User-Cache-Update wird die aktualisierte userId→username-Zuordnung geloggt.",
        "acceptance": "Cache-Update bei debug=true → Log enthält persistierte Zuordnung.",
    },
    {
        "uid": "REQ-DBG-007",
        "header": "State-Dump in playAudio",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L208",
        "text": "playAudio loggt State-Dump mit activeSessions.size und activeChannels-Liste.",
        "acceptance": "playAudio bei debug=true → Log enthält State-Dump.",
    },
    {
        "uid": "REQ-DBG-008",
        "header": "Pipeline-Diagnose Stages",
        "status": "Implemented",
        "priority": "Should",
        "traceability": "src/server.ts L803-L1166",
        "text": (
            "/hero-diagnose: Stage 0 Pre-flight, Stage 1 Transport, Stage 2 Producer, "
            "Stage 3 ffmpeg, Stage 4 Stream+Consumer, Stage 5 Router-State, Stage 6 Client-Transport."
        ),
        "acceptance": "Diagnose in Voice-Channel → Report mit 7 Stages und PASS/FAIL/INFO pro Stage.",
    },

    # ===== REQ-AUTO =====
    {
        "uid": "REQ-AUTO-001",
        "header": "GitHub Issue Auto-Analyse",
        "status": "Implemented",
        "priority": "Should",
        "traceability": ".github/workflows/issue-auto-analysis.yml, scripts/github-autofix/analyze-issue.ts, scripts/github-autofix/lib.ts",
        "text": (
            "Bei Issue-Erstellung/Wiedereröffnung startet unprivilegierter Analyse-Workflow. "
            "Nur Read-Berechtigungen, keine Secrets, JSON-Artefakt als Ergebnis."
        ),
        "acceptance": (
            "Neues Issue → Analyse-Workflow startet mit Read-Berechtigungen. "
            "JSON-Artefakt wird erzeugt. Shell-Metazeichen werden als Daten behandelt."
        ),
    },
    {
        "uid": "REQ-AUTO-002",
        "header": "GitHub Issue Auto-Fix",
        "status": "Implemented",
        "priority": "Should",
        "traceability": ".github/workflows/issue-auto-fix.yml, scripts/github-autofix/request-autofix.ts, scripts/github-autofix/lib.ts",
        "text": (
            "Separater Workflow startet bei neuem Issue, versucht Fix auf temporärem Branch. "
            "Bei Erfolg+Diff+Validierung → Draft-PR. Sonst kein PR."
        ),
        "acceptance": (
            "Fix erfolgreich + Diff + Tests/Build OK → Draft-PR. "
            "Kein Diff oder Validierung fehlgeschlagen → kein PR."
        ),
    },
    {
        "uid": "REQ-AUTO-003",
        "header": "Sicherheit: Untrusted Issue-Daten",
        "status": "Implemented",
        "priority": "Must",
        "traceability": ".github/workflows/issue-auto-analysis.yml, .github/workflows/issue-auto-fix.yml, scripts/github-autofix/lib.ts, tests/unit/github-autofix.test.ts",
        "text": (
            "Untrusted Issue-Daten dürfen nie als Code/Refs/Pfade ausgeführt werden. "
            "Nur serialisiert an versionierte Scripts übergeben. "
            "Patches nur in src/, docs/ oder README.md."
        ),
        "acceptance": (
            "Issue mit Shell-Befehlen/Pfad-Traversal → kein Einfluss auf Ref/Branch/Scripts. "
            "Analyse-Workflow hat keine Write-Berechtigungen. "
            "Patches außerhalb erlaubter Pfade werden verworfen."
        ),
    },
]


def create_document_config(prefix: str, doc_dir: str, parent: str = None):
    """Create the .doorstop.yml config for a doorstop document."""
    abs_dir = os.path.join(REPO_ROOT, doc_dir)
    os.makedirs(abs_dir, exist_ok=True)

    config = {
        "settings": {
            "digits": 3,
            "prefix": prefix,
            "sep": "-",
        }
    }
    if parent:
        config["settings"]["parent"] = parent

    config_path = os.path.join(abs_dir, ".doorstop.yml")
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
    print(f"  Created document: {prefix} → {doc_dir}" + (f" (parent: {parent})" if parent else " (ROOT)"))


def create_item(req: dict, doc_dir: str, level: int = 1, links: list = None):
    """Create a single doorstop item YAML file."""
    uid = req["uid"]
    abs_dir = os.path.join(REPO_ROOT, doc_dir)
    item_path = os.path.join(abs_dir, f"{uid}.yml")

    is_active = req.get("status", "Implemented") not in ("Removed",)

    item_data = {
        "active": is_active,
        "derived": False,
        "header": req.get("header", ""),
        "level": level,
        "links": links or [],
        "normative": True,
        "reviewed": None,
        "text": req["text"],
    }

    # Custom attributes
    if req.get("status"):
        item_data["status"] = req["status"]
    if req.get("priority"):
        item_data["priority"] = req["priority"]
    if req.get("traceability"):
        item_data["traceability"] = req["traceability"]
    if req.get("acceptance"):
        item_data["acceptance"] = req["acceptance"]

    with open(item_path, "w", encoding="utf-8") as f:
        yaml.dump(item_data, f, default_flow_style=False, allow_unicode=True, sort_keys=True)


def main():
    print("=" * 60)
    print("Doorstop Import — sharkord-hero-introducer Requirements")
    print("=" * 60)

    # Clean existing reqs directory
    if os.path.exists(REQS_DIR):
        print(f"\nRemoving existing {REQS_DIR}...")
        shutil.rmtree(REQS_DIR)

    # 1. Create root document and child document configs
    print("\n[1/4] Creating doorstop documents...")
    create_document_config(ROOT_DOCUMENT["prefix"], ROOT_DOCUMENT["path"])
    for prefix, doc_dir in DOCUMENTS.items():
        create_document_config(prefix, doc_dir, parent=ROOT_DOCUMENT["prefix"])

    # 2. Create root category items
    print("\n[2/4] Creating root category items...")
    root_dir = ROOT_DOCUMENT["path"]
    for root_item in ROOT_ITEMS:
        create_item(root_item, root_dir, level=root_item["level"])
        print(f"  {root_item['uid']}: {root_item['header']}")

    # Map categories to their root parent item UID for linking
    CATEGORY_TO_ROOT = {
        "REQ-CORE": "REQ-001",
        "REQ-CMD":  "REQ-002",
        "REQ-CFG":  "REQ-003",
        "REQ-DATA": "REQ-004",
        "REQ-LIFE": "REQ-005",
        "REQ-NF":   "REQ-006",
        "REQ-DBG":  "REQ-007",
        "REQ-AUTO": "REQ-008",
    }

    # 3. Create items with sequential levels and parent links
    print("\n[3/4] Creating requirement items...")
    counts = {}
    level_counters = {}  # track level per document
    for req in REQUIREMENTS:
        uid = req["uid"]
        parts = uid.split("-")
        prefix = f"{parts[0]}-{parts[1]}"
        doc_dir = DOCUMENTS.get(prefix)

        if not doc_dir:
            print(f"  WARNING: No document for {uid} (prefix {prefix})")
            continue

        # Sequential level per document
        level_counters[prefix] = level_counters.get(prefix, 0) + 1
        level = level_counters[prefix]

        # Link to parent root item
        parent_uid = CATEGORY_TO_ROOT.get(prefix)
        links = [parent_uid] if parent_uid else []

        create_item(req, doc_dir, level=level, links=links)
        counts[prefix] = counts.get(prefix, 0) + 1
        print(f"  {uid}: {req.get('header', '')}")

    # 4. Summary
    print("\n[4/4] Summary:")
    total = sum(counts.values())
    for prefix, count in sorted(counts.items()):
        print(f"  {prefix}: {count} items")
    print(f"  TOTAL: {total} requirements imported")

    # Verify
    print(f"\nDoorstop documents created in: {REQS_DIR}/")
    print("Run 'doorstop' to validate the tree.")
    print("Run 'doorstop publish docs/requirements-doorstop.html' to export as HTML.")
    print("Run 'doorstop publish docs/requirements-doorstop.md' to export as Markdown.")


if __name__ == "__main__":
    main()
