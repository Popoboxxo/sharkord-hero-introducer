# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime & Commands

**Runtime:** Bun (not Node.js). Use `Bun.spawn`, `bun:test`, and Bun APIs throughout.

```bash
bun run build          # Build plugin via build.ts
bun run build:zip      # Build + zip dist/
bun test               # All tests
bun test tests/unit/   # Unit tests only
bun test tests/integration/  # Integration tests only
bun test --test-name-pattern "<pattern>"  # Single test by name
```

## Architecture

This is a **Sharkord plugin** that plays personal MP3 intros when users join a voice channel.

**Plugin entry points** (`src/server.ts`):
- `onLoad` — registers settings, commands, and subscribes to voice-channel join events
- `onUnload` — tears down mediasoup transports and processes

**Audio pipeline:** User joins → `playIntroForUser()` → `Bun.spawn(ffmpeg)` → mediasoup WebRTC transport → voice channel

**Data persistence:** Two JSON files managed via helpers at the top of `server.ts`:
- Music map: `userId → mp3 filename`
- Daily greets: `userId → last-greeted date` (for `oncePerDay` setting)

**Plugin settings** (registered via `@sharkord/plugin-sdk`): `enabled`, `oncePerDay`, `debug`

**Slash commands** (12 total): `/hero-enable`, `/hero-disable`, `/hero-stop`, `/hero-set`, `/hero-remove`, `/hero-list`, `/hero-files`, `/hero-set-me`, `/hero-play-me`, `/hero-play`, `/hero-debug`, `/hero-dump-context`

## Agent Infrastructure

Specialized Claude Code agents live in `.claude/agents/`:
- `hero-introducer.md` — Orchestrator (coordinates all others)
- `hi-developer.md` — Implementation
- `hi-tester.md` — Tests
- `hi-validator.md` — Validation against requirements
- `hi-requirements.md` — Requirements engineering
- `hi-documenter.md` — Documentation

**`.github/agents/*.agent.md` files are auto-generated** from `.claude/agents/` via `scripts/sync-agents.sh`. Never edit them manually. The sync runs automatically as a pre-commit hook when `.claude/agents/*.md` files change. To sync manually: `bash scripts/sync-agents.sh`.

## Requirements & Commits

Requirements are tracked in `docs/REQUIREMENTS.md` with IDs in the format `REQ-xxx` (e.g., `REQ-CMD-001`, `REQ-CORE-003`).

Commit format: `<type>(REQ-xxx[,REQ-yyy]): <description>`

Example: `feat(REQ-CMD-004,REQ-DATA-006): add DisplayName mapping`

## Language Convention

- Code, comments, commit messages, and `REQUIREMENTS.md` → **English**
- `README.md` (user-facing) → **English**
- Internal agent coordination, `docs/conclusions/`, session notes → **Deutsch**
