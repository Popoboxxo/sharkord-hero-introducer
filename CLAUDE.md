# sharkord-hero-introducer

> Projektbeschreibung für Claude-Agenten. Diese Datei ist die **einzige Quelle**
> für projektspezifischen Kontext — Agenten lesen sie, statt eigenen Kontext zu haben.
>
> Generiert von agent-meta v0.13.1 — `2026-04-04`
> Plattform-Layer: {{PLATFORM_LAYER}}

---

## Projekt

**Name:** sharkord-hero-introducer
**Präfix:** hi
**Plattform:** Sharkord Plugin SDK
**Beschreibung:** Plays a personal MP3 intro for each user when they join a voice channel.

---

## Tech-Stack

- **Runtime:** Bun (NICHT Node.js)
- **Sprache:** TypeScript (ES6+, strict)
- **Key-Dependencies:** {{KEY_DEPENDENCIES}}
- **Ziel-Plattform:** {{TARGET_PLATFORM}}

---

## Architektur

```
src/
  server.ts      # Plugin-Server-Entry (onLoad, onUnload, Commands, Events, Playback)
  client.ts      # Leerer Client-Entry
build.ts         # Bun Build-Script
tests/
  unit/          # Unit-Tests (bun:test)
  integration/   # Integration-Tests
  helpers/       # Test-Hilfsmittel (MockPluginContext)
  test_music/    # Test-Audio-Dateien
docs/
  REQUIREMENTS.md
  CODEBASE_OVERVIEW.md
  conclusions/
scripts/
  github-autofix/  # Automatische Issue-Analyse und Fix-PRs
  sync-agents.sh   # Sync .claude/agents/ → .github/agents/
.claude/agents/    # Claude Code Agents
.github/
  agents/          # GitHub Copilot Agents (auto-generiert)
  workflows/       # CI/CD Workflows
```

**Entry-Point:**
```
src/server.ts — Plugin-Server-Entry (onLoad, onUnload)
src/client.ts — Plugin-Client-Entry (leer)
```

**Besondere Patterns:**
- onLoad/onUnload als Plugin-Lifecycle-Hooks (Sharkord SDK)
- Alle Commands via ctx.commands.register() in onLoad registriert
- Audio-Pipeline: ffmpeg → mediasoup PlainTransport → ctx.voice.createStream
- Per-Channel-Playback-Queue für sequenzielle Intro-Wiedergabe
- Flexible Dateinamen-Auflösung (mit/ohne Extension, case-insensitive)
- userId→username Cache via user:joined Events
- resolveVoiceActions() Fallback: ctx.voice (SDK 0.0.16) oder ctx.actions.voice (legacy)

---

## Code-Konventionen

- TypeScript ES6+, kein `require`, kein `var`, kein `any`
- Named Exports only (`export { onLoad, onUnload }`) — kein default export
- kebab-case Dateinamen: `module-name.ts`, Tests: `<module>.test.ts`
- Bun APIs: `Bun.spawn`, `bun:test`, `bun:sqlite` (kein Node.js)
- Commit-Format: `<type>(REQ-xxx[,REQ-yyy]): <description>`
- Sprache Code/Commits/Tests: Englisch; interne Doku: Deutsch

---

## Build & Development

```bash
# Build
bun run build

# Tests
bun test

# Dev-Stack starten
docker compose -f docker-compose.dev.yml up -d

# Nach Änderungen neu laden
bun run build && docker compose -f docker-compose.dev.yml restart sharkord
```

---

## Anforderungs-Kategorien

Kategorien für `docs/REQUIREMENTS.md`:

- **Kernfunktionalität (REQ-CORE)** — Audio-Intro-Playback, Voice-Event-Handling, Queue-Management
- **Slash-Commands (REQ-CMD)** — /hero-set, /hero-remove, /hero-list, /hero-files, /hero-set-me, /hero-play-me, /hero-play, /hero-stop, /hero-dump-context
- **Konfiguration (REQ-CFG)** — Plugin-Settings: enabled, oncePerDay, debug
- **Datenpersistenz (REQ-DATA)** — music-map.json, daily-greets.json, SQLite Datei-Index
- **Lifecycle (REQ-LIFE)** — onLoad, onUnload, Transport-Cleanup
- **Debug (REQ-DBG)** — Debug-Logging, Context-Dump

---

## Agenten-Konfiguration

<!-- agent-meta:managed-begin -->
<!-- This block is automatically updated by sync.py on every sync. -->
<!-- Manual changes here will be overwritten. -->

Generiert von agent-meta v0.14.0 — `2026-04-05`

> **Einstiegspunkt:** Starte mit dem `orchestrator`-Agenten für alle Entwicklungsaufgaben.

| Agent | Zuständigkeit |
|-------|--------------|
| `agent-meta-manager` | agent-meta verwalten: Upgrade, Sync, Feedback, projektspezifische Agenten anlegen |
| `developer` | Feature-Implementierung und Bugfixes nach REQ-IDs |
| `docker` | Sharkord Dev-Stack: Plugin-Mount, Access-Token, Mediasoup-Ports, Compose |
| `documenter` | Doku pflegen: CODEBASE_OVERVIEW, ARCHITECTURE, README, Erkenntnisse |
| `feature` | Neues Feature end-to-end durchführen: Branch → REQ → TDD → Dev → Validate → PR |
| `git` | Commits, Branches, Tags, Push/Pull und alle Git-Operationen |
| `ideation` | Neue Ideen explorieren, Vision schärfen, Übergabe an requirements |
| `meta-feedback` | Verbesserungsvorschläge für agent-meta als GitHub Issues einreichen |
| `orchestrator` | Einstiegspunkt für alle Entwicklungsaufgaben — koordiniert alle anderen Agenten |
| `release` | Sharkord Plugin Release: Bun-Build, ZIP/TAR, GitHub Release via gh CLI |
| `requirements` | Anforderungen aufnehmen, REQ-IDs vergeben, REQUIREMENTS.md pflegen |
| `tester` | Tests schreiben (TDD), Test-Suite ausführen, Coverage sicherstellen |
| `validator` | Code gegen REQs prüfen, DoD-Checkliste, Traceability-Audit |
<!-- agent-meta:managed-end -->

---

## Sprachregeln

- `README.md` → **Englisch**
- Alle anderen Dokumente → **Deutsch**
- Code-Kommentare, Commit-Messages → **Englisch**
- Kommunikation mit dem Nutzer → **Deutsch**
