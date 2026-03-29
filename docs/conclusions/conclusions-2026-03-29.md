# Erkenntnisse - 29. Maerz 2026

## Session-Zusammenfassung

Session-Fokus war die Stabilisierung der Runtime fuer Audio-Commands im Docker-Dev-Stack,
insbesondere fuer /hero-play-me und /hero-play.

Kernprobleme in dieser Session:
1. Runtime-Fehler bei /hero-play-me: undefined is not an object (evaluating 'Y.actions.voice.getRouter').
2. Verwirrung bei /hero-play durch Erwartung Dateiname vs. tatsaechliches Mapping auf DisplayName.
3. Wiederkehrende Docker-Port-Kollision auf 40000/udp durch parallelen Container sharkord-dev.

---

## 1. Root Cause und Fix fuer /hero-play-me Runtime-Fehler

### Symptom

Bei /hero-play-me wurde im Log zwar playAudio aufgerufen, danach aber ein Runtime-Fehler geworfen:

- Error executing command 'hero-play-me': undefined is not an object (evaluating 'Y.actions.voice.getRouter')

### Ursache

Im Command-Ausfuehrungskontext war der Zugriff auf Voice-Actions nicht in allen Faellen stabil,
wenn nur auf den Plugin-Context vertraut wurde.

### Umsetzung

In src/server.ts wurde eine robuste Voice-Action-Aufloesung implementiert:

1. Neues Interface VoiceActionsLike fuer benoetigte Methoden.
2. Neue Funktion resolveVoiceActions(runtimeCtx?) mit Fallback-Reihenfolge:
   - zuerst runtimeCtx.actions.voice
   - danach ctx.actions.voice
3. Harte Validierung, dass getRouter/getListenInfo/createStream vorhanden sind.
4. playAudio erhielt einen optionalen runtimeCtx-Parameter.
5. Audio-Commands uebergeben jetzt den invokerCtx bis in playAudio:
   - /hero-play-me
   - /hero-play
   - /hero-play-song

Effekt: Der Audio-Pfad kann jetzt auch im Command-Execution-Kontext stabil auf Voice-Actions zugreifen.

---

## 2. Verbesserung fuer /hero-play (DisplayName vs. Dateiname)

### Beobachtung

Aktueller Music-Map-Zustand im Container:
- SharkordUser46797 -> dottin.mpeg

Wenn /hero-play mit dottin oder vibecodin aufgerufen wurde, gab es kein Mapping ueber DisplayName,
obwohl die Datei in music/ existierte.

### Umsetzung

/hero-play wurde erweitert:

1. Frueher Exit bei fehlendem Argument:
   - Please provide a display name. Usage: /hero-play <displayName>
2. Wenn kein DisplayName-Mapping existiert, wird automatisch resolveAudioFile(displayName) versucht.
3. Falls Datei aufgeloest werden kann, wird diese abgespielt (Fallback auf Dateinamen-Modus).
4. Falls nicht aufloesbar, bleibt die Rueckmeldung klar:
   - No intro configured for <displayName>. Use /hero-play-song <songName> to play by file name.

Effekt: /hero-play ist nutzerfreundlicher, weil Dateinameingaben jetzt ohne extra Command funktionieren,
sofern eine passende Datei im music-Verzeichnis existiert.

---

## 3. Test- und Verifikationsstatus

### Laufende Verifikation in dieser Session

Erfolgreich ausgefuehrte Tests:
1. bun test tests/unit/channel-guard.test.ts
   - Ergebnis: 10 pass, 0 fail
2. bun test tests/unit/server.test.ts --test-name-pattern "/hero-play"
   - Ergebnis: pass
   - inklusive neuem Fallback-Test fuer /hero-play mit Dateiname ohne Mapping

### Neue/angepasste Testabdeckung

In tests/unit/server.test.ts wurde ein Fall ergaenzt:
- /hero-play faellt auf Dateiaufloesung zurueck, wenn kein DisplayName-Mapping existiert
- Erwarteter Erfolg fuer Eingabe vibecodin bei vorhandener vibecodin.mpeg

---

## 4. Docker/Runtime Erkenntnisse

### Wichtiger Ablauf fuer Code-Aenderungen

Bei diesem Setup reicht Container-Restart allein nicht immer als mentale Checkliste.
Sicherer Ablauf fuer neue Plugin-Aenderungen:

1. bun run build
2. docker compose -f docker-compose.dev.yml restart sharkord

Hintergrund:
- Das Plugin wird aus dist/sharkord-hero-introducer gemountet.
- Ohne frischen Build laeuft alter server.js-Code weiter.

### Wiederkehrender Betriebsblocker

Port 40000 war mehrfach durch sharkord-dev belegt.
Dadurch schlug hero-introducer-dev beim Start/Restart fehl.

Konsequenz fuer lokale Sessions:
- sharkord-dev stoppen, bevor hero-introducer-dev mit Medienports gestartet wird.

---

## 5. Aktueller Stand am Session-Ende

1. Die implementierten Fixes sind im Code vorhanden.
2. Tests fuer die geaenderten Pfade laufen erfolgreich.
3. Container wurde mehrfach neu gestartet; Port-Konflikte wurden identifiziert und aufgeloest.
4. Der externe Fehler von sharkord-music-bot (manifest.json not found) ist weiterhin separat und
   betrifft nicht den hero-introducer-Codepfad.

---

## 6. Offene Punkte fuer die naechste Session

1. Live-End-to-End-Bestaetigung direkt nach einem frischen /hero-play-me Aufruf auf dem neuesten Containerlauf,
   inklusive Log-Linien fuer Transport/ffmpeg/Stream.
2. Optional: docker-compose.dev.yml oder lokales Startskript so absichern, dass Port-Kollisionen frueh erkannt
   oder automatisch aufgeloest werden.
3. Optional: kurze README-Notiz ergaenzen, dass /hero-play primaer DisplayName nutzt und nun Datei-Fallback hat.
