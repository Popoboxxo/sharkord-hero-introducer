# Erkenntnisse — 20. März 2026

## Session-Zusammenfassung

Session fokussiert auf: Identifikation eines neuen Bugs (BUG-002) im Join-Handler,
Spezifikation einer neuen Feature-Anforderung (Command-Guard), sowie erfolgreiche
End-to-End-Validierung der Audio-Pipeline im Docker-Dev-Stack.

---

## 1. BUG-002 Identifiziert: Intro spielt obwohl User alleine im Channel

### Symptom

Bot betritt Voice-Channel und spielt Intro-Musik, obwohl kein anderer Nutzer im Channel
anwesend war.

**Log-Beweis aus Testlauf:**
- Voice Channels 3 und 4 waren beim Start als "active" registriert (`voice:runtime_initialized`)
- `userId=2` joined Channel 3
- Intro wurde gespielt — obwohl der User alleine im Channel war

### Root Cause

Im `user:joined`-Handler wird nach dem `INTRO_DELAY_MS`-Warten lediglich geprüft ob
**irgendein aktiver Voice-Channel** in `activeChannels` existiert. Es gibt keine Prüfung,
ob der Channel tatsächlich weitere echte Nutzer enthält, also ob die Intro-Wiedergabe
sinnvoll ist.

**Betroffene Stelle:** `src/server.ts`, `user:joined`-Handler, nach dem `INTRO_DELAY_MS`-Wait:

```typescript
// Aktueller Code — BUGGY:
const channelId = [...activeChannels][0];
if (channelId === undefined) {
  ctx.error(`No active voice channel – cannot play intro for "${username}"`);
  return;
}
// Fehlend: Prüfung ob echter Nutzer im Channel ist
```

### Erwartetes Verhalten

Intro soll nur abgespielt werden, wenn der Channel tatsächlich weitere Nutzer enthält
(nicht nur der Bot selbst, nicht leer). "Bot spielt sich selbst ein Intro vor" ist
unerwünscht.

### Status

Offen — Anforderung muss durch `hi-requirements` formalisiert werden, Implementierung
durch `hi-developer`.

### Wichtige Referenzen

- Betroffene Datei: `src/server.ts`, `user:joined`-Handler (~L466-L538)
- Zuständiger Agent für Anforderung: `hi-requirements`
- Zuständiger Agent für Fix: `hi-developer`

---

## 2. Neue Feature-Anforderung: Command-Guard (User muss im Voice-Channel sein)

### Beschreibung

Audio-Commands sollen nur ausgeführt werden können, wenn der aufrufende Nutzer sich
aktiv in einem Voice-Channel befindet. Bei fehlender Channel-Zugehörigkeit soll eine
klare Fehlermeldung zurückgegeben werden.

### Fehlermeldung (spezifiziert)

```
"You must be in a voice channel to use this command."
```

### Betroffene Commands

| Command | Guard bereits vorhanden? |
|---------|------------------------|
| `/hero-play-me` | Ja — `currentVoiceChannelId`-Prüfung vorhanden |
| `/hero-play` | Ja — `currentVoiceChannelId`-Prüfung vorhanden |
| `/hero-play-song` | Ja — `currentVoiceChannelId`-Prüfung vorhanden |

**Hinweis:** Im aktuellen Code sind die Guards bereits implementiert — sie geben
`"You are not in a voice channel. Join one first, then try again."` zurück.
Die neue Anforderung spezifiziert eine abweichende, einheitlichere Fehlermeldung.
Ob dies eine Änderung oder eine Bestätigung des bestehenden Verhaltens ist,
muss `hi-requirements` klären.

### Status

Anforderung identifiziert — REQ-ID noch nicht vergeben. Zur Formalisierung an
`hi-requirements` weiterleiten.

---

## 3. Docker-Dev-Stack: Audio-Pipeline End-to-End validiert

### Ergebnis

Testlauf im Docker-Dev-Stack war erfolgreich. Die gesamte Audio-Pipeline
(ffmpeg → RTP → mediasoup PlainTransport → createStream → WebRTC-Client) funktioniert
end-to-end.

### Bedeutung

BUG-001 (fehlende `announcedAddress` in `config.ini`) gilt als vollständig behoben und
im Docker-Setup verifiziert. Der Docker-Dev-Stack ist als Testumgebung einsatzbereit.

### Referenz

- Root Cause BUG-001: `docs/conclusions/conclusions-2026-03-19.md`
- Config-Fix: `announcedAddress=127.0.0.1` in `config.ini` → `[webRtc]`

---

## 4. Codebase-Diskrepanzen entdeckt (Doku-Korrekturen)

Beim Abgleich von `src/server.ts` mit `docs/CODEBASE_OVERVIEW.md` wurden folgende
Abweichungen festgestellt und in der Übersicht korrigiert:

| Diskrepanz | Alt (falsch) | Neu (korrekt) |
|-----------|--------------|---------------|
| Playback-Queue-System | Nicht dokumentiert | `enqueuePlayback()`, `processQueue()`, `playAudioAndWait()` ergänzt |
| `PlaybackSession` Interface | `done`-Feld fehlte | `done: Promise<void>` ergänzt |
| State-Variablen | `playbackQueues`, `queueProcessing` fehlten | Dokumentiert |
| Codec-Parameter | Dynamischer PayloadType + `minptime`/`useinbandfec` | Hardcoded `payloadType: 111`, `parameters: {}` (leer) |
| `/hero-reset-me` Command | Fehlte komplett | Dokumentiert |
| `voice:runtime_closed` | Queue-Cleanup fehlte | `playbackQueues.delete()`, `queueProcessing.delete()` ergänzt |
| Zeilenzahl `src/server.ts` | ~1237 | ~1334 |

---

## Offene Punkte / Nächste Schritte

1. **BUG-002 beheben:** Channel-Member-Check vor Intro-Wiedergabe implementieren
   - Anforderung formalisieren → `hi-requirements`
   - Implementierung → `hi-developer`
   - Tests schreiben → `hi-tester`

2. **Command-Guard Fehlermeldung vereinheitlichen:** Klären ob neue Fehlermeldung
   `"You must be in a voice channel to use this command."` die bestehende ablöst
   → `hi-requirements`

3. **Lückenanalyse aus CODEBASE_OVERVIEW.md:** Tests für REQ-CORE-011 (Channel-Close
   Session-Cleanup) haben höchste Priorität — `hi-tester`
