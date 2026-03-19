# Session-Erkenntnisse 2026-03-19

## BUG-001 ENDGÜLTIG GELÖST: Audio nicht hörbar

### Root Cause: `announcedAddress` in Sharkord `config.ini` war leer

Das Problem war **NICHT** im Plugin-Code, sondern in der **Sharkord-Server-Konfiguration**:

```ini
[webRtc]
port=40000
announcedAddress=          # ← LEER! Das war der Bug!
```

#### Warum das Audio verhindert

1. mediasoup nutzt `announcedAddress` als ICE-Candidate für WebRTC-Clients
2. Wenn leer, wird die **interne Docker-Container-IP** (z.B. `172.18.0.2`) mitgeteilt
3. Der Browser kann diese IP nicht erreichen → kein WebRTC-Media-Transport
4. Kein Consumer wird erstellt → kein Audio beim Client
5. Die gesamte Server-Pipeline (ffmpeg → RTP → Producer) funktionierte dabei perfekt

#### Fix

```ini
[webRtc]
announcedAddress=127.0.0.1   # Für lokales Testen
# announcedAddress=<public-ip>  # Für Remote-Zugriff
```

### Warum es so schwer zu finden war

- **Producer Score: 10** (perfekte Qualität) — Server-Seite zeigte keinen Fehler
- **Health-Check OK** mit hunderten Paketen — RTP-Daten flossen korrekt
- `createStream()` meldete Erfolg — Sharkord erstellte den Stream
- Alle Unit-Tests bestanden — Mocks können Netzwerkprobleme nicht erkennen
- Erst die `/hero-diagnose` Stage 5 zeigte: **0 Consumers** (kein Client verbunden)
- **Bestätigt durch A/B-Test**: Auch der bewiesenermaßen funktionierende `sharkord-music-bot` spielte im selben Container keinen Ton ab → bewies dass es kein Code-Problem war

### Debugged aber nicht ursächlich: Code-Änderungen für music-bot-Parität

Während der Fehlersuche wurden folgende Unterschiede zum `sharkord-music-bot` korrigiert:

- Codec `parameters: {}` statt `{ minptime: 10, useinbandfec: 1 }`
- PayloadType hardcoded `111` statt dynamisch vom Router
- ffmpeg-Extra-Flags entfernt (`-fflags +genpts`, `-probesize`, `-analyzeduration`, `-vbr off`, `-frame_duration 20`)
- Bitrate `192k` statt `128k`
- `avatarUrl` zu `createStream()` hinzugefügt
- Health-Check (`producer.getStats()` nach 5s) hinzugefügt

### Checkliste für zukünftiges Audio-Debugging

1. **Zuerst:** `config.ini` → `announcedAddress` gesetzt?
2. **Port:** UDP 40000 erreichbar? (Docker-Portmapping + Firewall)
3. **`/hero-diagnose`:** Stage 5 Consumer-Count — 0 = Client kann nicht verbinden
4. **A/B-Test:** `sharkord-music-bot` parallel installieren zum Vergleich
5. **Erst dann:** Plugin-Code debuggen

### Lektion

> Immer zuerst die Infrastruktur prüfen, bevor man den Applikations-Code debuggt.
> Ein funktionierendes Referenz-Plugin als A/B-Test spart Stunden.
