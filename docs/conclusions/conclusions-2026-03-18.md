# Erkenntnisse — 18. Maerz 2026

## Session-Zusammenfassung

Anwendung des BUG-001 Fixes: Die Audio-Pipeline in `playAudio()` und `/hero-diagnose` wurde an das funktionierende Referenz-Plugin `sharkord-music-bot` angeglichen. Der manuelle Consumer-Hack wurde als Hauptursache identifiziert und entfernt.

---

## 1. BUG-001 Fix: Audio nicht hoerbar

### Ursachenanalyse

Der Audio-Output war trotz funktionierender Server-Pipeline (Producer Score 10, Consumer existiert, RTP-Pakete fliessen) nicht hoerbar. Die Ursache lag in mehreren Abweichungen vom funktionierenden Referenz-Plugin `sharkord-music-bot`:

1. **Manueller Consumer-Hack**: Der Code erstellte manuell Consumer auf Client-Transports ueber `router.transportsForTesting`. Dies interferierte mit der automatischen Consumer-Erstellung durch das SDK (`createStream()`). Im funktionierenden `sharkord-music-bot` wird `createStream()` verwendet und die Consumer-Erstellung vollstaendig dem SDK ueberlassen.

2. **Fehlende Codec-Parameters**: Die Opus-Codec-Parameters `minptime: 10` und `useinbandfec: 1` fehlten. Diese sind im Referenz-Plugin vorhanden und stellen sicher, dass der Codec korrekt konfiguriert ist.

3. **Hardcoded PayloadType**: Der PayloadType war auf 111 hardcoded, anstatt dynamisch vom Router ueber `router.rtpCapabilities.codecs` aufgeloest zu werden. Ein Mismatch zwischen ffmpeg-PayloadType und Router-Erwartung kann dazu fuehren, dass RTP-Pakete verworfen werden.

4. **Fehlende ffmpeg-Flags**: Die Flags `-fflags +genpts`, `-vbr off` und `-frame_duration 20` fehlten. Diese stellen korrekte Timestamps, konsistente Bitrate und eine passende Frame-Dauer fuer WebRTC sicher.

### Durchgefuehrte Aenderungen

**In `playAudio()` (L201-L361):**
- Codec-Parameters: `parameters: {}` -> `parameters: { "minptime": 10, "useinbandfec": 1 }`
- PayloadType: Dynamische Aufloesung via `router.rtpCapabilities.codecs` (Fallback 111)
- ffmpeg-Flags: `-fflags +genpts`, `-vbr off`, `-frame_duration 20` hinzugefuegt
- ffmpeg `-payload_type`: dynamischer Wert statt hardcoded "111"
- Manueller Consumer-Hack komplett entfernt (~60 Zeilen)
- cleanup() vereinfacht: kein `clearInterval(consumerCheckInterval)` mehr noetig

**In `/hero-diagnose` (L784-L1201):**
- Gleiche Codec-Parameter-Aenderungen
- Gleiche PayloadType-Aufloesung vom Router
- Gleiche ffmpeg-Flag-Ergaenzungen

### Ergebnis

- `src/server.ts`: ~1237 Zeilen (vorher ~1255, ca. 18 Zeilen netto weniger durch Consumer-Hack-Entfernung)
- BUG-001 Status: Fix angewendet, Verifikation ausstehend (muss im laufenden System getestet werden)

### Wichtige Referenzen

- Referenz-Plugin: `sharkord-music-bot` (funktionierender Vergleichscode)
- Betroffene Datei: `src/server.ts`
- Betroffene Funktion: `playAudio()` (L201-L361)
- Betroffener Command: `/hero-diagnose` (L784-L1201)

---

## 2. Dokumentations-Updates

### Aktualisierte Dateien

| Datei | Aenderung |
|-------|----------|
| `docs/CODEBASE_OVERVIEW.md` | playAudio-Beschreibung aktualisiert (dynamischer PT, Codec-Params, kein Consumer-Hack), hero-diagnose aktualisiert, Flow 2 aktualisiert, BUG-001 Status geaendert, Zeilennummern korrigiert |
| `docs/ARCHITECTURE.md` | Audio-Pipeline-Diagramm aktualisiert (dynamischer PT, Codec-Params, ffmpeg-Flags), neue Architektur-Entscheidungen dokumentiert |
| `docs/conclusions/conclusions-2026-03-18.md` | Diese Datei — Session-Erkenntnisse zum BUG-001 Fix |

---

## 3. Offene Punkte

- **Verifikation**: BUG-001 Fix muss im laufenden System getestet werden (Audio tatsaechlich hoerbar?)
- **Tests**: Die Unit-Tests in `play-audio.test.ts` und `play-audio-comparison.test.ts` muessen moeglicherweise an die neuen Codec-Parameter und den dynamischen PayloadType angepasst werden -> Verweis an `hi-tester`
- **REQUIREMENTS.md**: Die Zeilennummern in der Traceability-Matrix von `docs/REQUIREMENTS.md` sind durch die Code-Aenderungen verschoben -> Verweis an `hi-requirements`
