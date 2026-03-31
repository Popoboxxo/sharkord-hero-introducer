# Sharkord SDK 0.0.16 - Uebersicht und neue Moeglichkeiten

## Ziel dieses Dokuments

Dieses Dokument fasst die fuer dieses Projekt relevanten Neuerungen von Sharkord SDK `0.0.16` zusammen.
Der Fokus liegt auf **verifizierten** Moeglichkeiten, die in diesem Repository bereits umgesetzt oder getestet sind.

Referenz-Kontext:
- Plugin-Implementierung: `src/server.ts`
- Anforderungen: `docs/REQUIREMENTS.md`
- Historie Feature Request: `docs/FEATURE_REQUEST_VOICE_EVENTS.md`

---

## Kurzfassung

Mit Sharkord `0.0.16` ist ein sauberer Voice-Event-Flow moeglich geworden:

1. `voice:user_joined` liefert den **echten Ziel-Channel** fuer Auto-Logik.
2. `voice:user_left` ermoeglicht **deterministisches Cleanup** pro User/Channel.
3. `voice:runtime_initialized` und `voice:runtime_closed` erlauben robustes Tracking aktiver Voice-Runtimes.
4. Audio-Pipelines lassen sich on-demand ueber `ctx.voice` aufbauen:
   - `getRouter(channelId)`
   - `getListenInfo()`
   - `createStream(...)`
5. Audio-Commands koennen ueber `invokerCtx.currentVoiceChannelId` hart auf aktive Voice-Channels begrenzt werden.

Ergebnis: weniger Guessing, weniger Fallback-Hacks, deutlich stabilere Voice-Plugins.

---

## Was ist neu bzw. praktisch nutzbar in 0.0.16

## 1) Event: voice:user_joined

### Nutzen

- Trigger fuer Auto-Aktionen bei Voice-Join.
- Channel kommt direkt aus dem Event-Payload (`channelId`) statt aus indirekten Heuristiken.

### Typisches Payload (im Projekt genutzt)

```ts
{ channelId: number, userId: number, username?: string }
```

### Typische Patterns

1. Mapping-Lookup auf `username`.
2. Delay/Rate-Limits (z. B. oncePerDay).
3. Start Playback genau im Event-Channel.
4. Kein Fallback auf "first active channel".

---

## 2) Event: voice:user_left

### Nutzen

- Cleanup fuer ausstehende und laufende Aktionen pro User/Channel.
- Verhindert Geister-Sessions und stale Queue-Eintraege.

### Typisches Payload (im Projekt genutzt)

```ts
{ channelId: number, userId: number }
```

### Typische Patterns

1. Queue-Eintraege fuer `channelId + userId` entfernen.
2. Laufende Session fuer `channelId-userId` abbrechen.
3. Ressourcen freigeben (ffmpeg, Producer, Transport, Stream).

---

## 3) Events: voice:runtime_initialized und voice:runtime_closed

### Nutzen

- Lifecycle-Signale fuer Voice-Runtimes.
- Grundlage fuer ein lokales `activeChannels`-Set.

### Typische Patterns

1. Bei `voice:runtime_initialized`:
   - Channel in `activeChannels` aufnehmen.
2. Bei `voice:runtime_closed`:
   - Channel aus `activeChannels` entfernen.
   - Session-Cleanup fuer Channel.
   - Queue fuer Channel leeren.

---

## 4) Voice Actions in ctx.voice

Im Projekt werden folgende Actions genutzt:

1. `ctx.voice.getRouter(channelId)`
2. `ctx.voice.getListenInfo()`
3. `ctx.voice.createStream({...})`

### Praktischer Einsatz

1. Router holen.
2. PlainTransport erzeugen.
3. Producer fuer Audio erstellen.
4. ffmpeg (Bun.spawn) sendet Opus/RTP auf Transport-Port.
5. Stream ueber `createStream` im Ziel-Voice-Channel exposen.
6. Nach Ende: Stream/Producer/Transport sauber entfernen.

---

## 5) Command-Context fuer Voice-Guards

Mit `invokerCtx.currentVoiceChannelId` sind robuste Command-Guards moeglich:

1. Kein Channel im Context:
   - `You must be in a voice channel to use this command.`
2. Channel nicht aktiv:
   - `Voice channel is not active.`
3. Nur bei gueltigem Context Playback starten.

Das ist zentral fuer Commands wie:
- `/hero-play-me`
- `/hero-play`
- `/hero-play-song`
- `/hero-diagnose`

---

## Migration: von pre-0.0.16 auf 0.0.16

## Vorher (problematisch)

- Trigger oft ueber `user:joined` (Server-Login, nicht Voice-Join).
- Channel-Ziel musste geraten werden.
- Falsche Channel-Wahl und "empty channel"-Effekte waren wahrscheinlich.

## Nachher (empfohlen)

1. Auto-Playback nur ueber `voice:user_joined` triggern.
2. `user:joined` nur noch fuer Cache/Metadaten nutzen.
3. Ziel-Channel ausschliesslich aus Event-Payload `channelId` nehmen.
4. `activeChannels` ueber runtime-events pflegen.
5. Bei `voice:user_left` und `voice:runtime_closed` aggressiv cleanupen.

---

## Neue Plugin-Ideen, die durch 0.0.16 einfacher werden

1. Personalisierte Join-Intros pro User (dieses Plugin).
2. Voice-Aktivitaets-basierte Automationen:
   - Begruessung
   - Queueing
   - Auto-Diagnose
3. Kanalgenaue Audio-Features ohne Channel-Raten.
4. Session-konsistente Cleanup-Strategien bei Leave/Close.
5. Sichere Audio-Commands mit Context-Guards.

---

## Grenzen / nicht verifiziert in diesem Repo

Dieses Dokument deckt nur Features ab, die in diesem Repository sichtbar verifiziert sind.
Es ist **kein** vollstaendiges offizielles Changelog des gesamten Sharkord-SDK.

Wenn du eine "vollstaendige Offizielle" Matrix willst (alle APIs, alle Payload-Felder, Breaking Changes),
bitte gegen die offiziellen Sharkord-Release-Notes gegenpruefen.

---

## Quick Reference

## Event-Flow

```text
voice:runtime_initialized -> channel aktiv
voice:user_joined         -> auto logic (mapping, delay, playback)
voice:user_left           -> user/channel cleanup
voice:runtime_closed      -> channel cleanup
```

## Voice-Actions

```text
getRouter(channelId)
getListenInfo()
createStream(...)
```

## Command-Voice-Guard

```text
invokerCtx.currentVoiceChannelId vorhanden?
channelId in activeChannels?
```

---

## Traceability in diesem Repo

- Event- und Voice-Flow Implementierung: `src/server.ts`
- Core-Anforderungen (0.0.16-bezogen): `docs/REQUIREMENTS.md`
- Historische Einordnung Voice-Events: `docs/FEATURE_REQUEST_VOICE_EVENTS.md`
- Ueberblick Architektur/Eventbaum: `docs/ARCHITECTURE.md`
