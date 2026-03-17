# Erkenntnisse — 17. Maerz 2026

## Session-Zusammenfassung

Vollstaendiges Dokumentations-Update aller Projektdateien, um den aktuellen Code-Stand korrekt abzubilden.

---

## 1. CODEBASE_OVERVIEW.md — Umfassende Aktualisierung

### Neue Inhalte
- `/hero-diagnose` Command vollstaendig dokumentiert (7 Stages: 0-6)
- Zeilenzahl aktualisiert: ~836 -> ~1201 (Wachstum durch Diagnose-Command)
- Test-Abdeckung erweitert: 2 neue Test-Dateien (`play-audio.test.ts` mit 8 Tests, `play-audio-comparison.test.ts` mit 4 Tests)
- Flow 7 (Diagnose) und Flow 8 (Build, umbenannt) hinzugefuegt
- Lueckenanalyse aktualisiert (REQ-CORE-004, REQ-CORE-007, REQ-CORE-008, REQ-CFG-005 nun als getestet markiert)

### Wichtige Referenzen
- `/hero-diagnose` Implementation: `src/server.ts` L803-L1166
- playAudio Pipeline: `src/server.ts` L201-L391

---

## 2. README.md — Grundlegende Ueberarbeitung

### Vorher-Nachher
- **Commands:** 6 -> 13 (alle aktuellen Commands dokumentiert)
- **Settings:** 2 -> 4 (`debug` und `volume` ergaenzt)
- **Mapping-Format:** userId -> absolutePath **geaendert zu** displayName -> audioFileName
- **Features:** MPEG-Support, flexible Dateiaufloesung, Volume-Kontrolle, Pipeline-Diagnostics, Self-Service-Mapping ergaenzt
- **How it works:** Auf On-demand-Architektur und displayName-basiertes Lookup aktualisiert
- **Development-Sektion** hinzugefuegt (Build/Test-Befehle)

---

## 3. ARCHITECTURE.md — Neu erstellt

Erstmalige Erstellung mit:
- Modul-Architektur (logische Bereiche innerhalb server.ts)
- Audio-Pipeline-Diagramm (ffmpeg -> PlainTransport -> Producer -> Stream -> Consumer -> Client)
- Datenfluss (Persistenz + In-Memory State)
- Build-Pipeline
- Architektur-Entscheidungen mit Begruendungen

### Wichtige Referenz
- `docs/ARCHITECTURE.md`

---

## 4. REQUIREMENTS.md Quercheck — Inkonsistenzen gefunden

Folgende Inkonsistenzen zwischen `docs/REQUIREMENTS.md` und dem aktuellen Code wurden identifiziert. Die Behebung liegt beim Requirements Engineer (`hi-requirements`):

### 4.1 Veraltete Zeilennummern
Alle Traceability-Zeilennummern in REQUIREMENTS.md beziehen sich auf einen aelteren Code-Stand (~835 Zeilen). Der Code ist durch den `/hero-diagnose` Command auf ~1201 Zeilen gewachsen. Betroffen: alle REQ-IDs mit Traceability-Angaben.

### 4.2 REQ-DBG-008 — Stage-Anzahl
- REQUIREMENTS.md beschreibt 6 Stages (0-5) fuer `/hero-diagnose`
- Code implementiert 7 Stages (0-6), Stage 6 = "Client Transport Deep Inspection" (ICE/DTLS State, Consumer outbound-rtp Stats)
- Empfehlung: Stage 6 in REQ-DBG-008 ergaenzen

### 4.3 REQ-CMD-003 — Veraltete Referenz
- Abnahmekriterium referenziert `activeProcesses`-Map
- Im Code heisst es `activeSessions`
- Empfehlung: `activeProcesses` -> `activeSessions` korrigieren

### 4.4 Test-Abdeckung
- REQUIREMENTS.md Lueckenanalyse erwaehnt Tests fuer REQ-CORE-004, REQ-CORE-007, REQ-CORE-008, REQ-CFG-005 korrekt als vorhanden
- Keine weiteren Inkonsistenzen in der Test-Zuordnung gefunden

---

## 5. Zusammenfassung der aktualisierten Dateien

| Datei | Aktion |
|-------|--------|
| `docs/CODEBASE_OVERVIEW.md` | Aktualisiert (Commands, Flows, Tests, Lueckenanalyse) |
| `README.md` | Grundlegend ueberarbeitet (Commands, Settings, Mapping-Format, Features) |
| `docs/ARCHITECTURE.md` | Neu erstellt |
| `docs/conclusions/conclusions-2026-03-17.md` | Neu erstellt (diese Datei) |
