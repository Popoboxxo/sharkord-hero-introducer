# Changelog

All notable changes to sharkord-hero-introducer are documented here.

## [0.3.0] — 2026-07-13

### Features

- `/hero-volume` command — shows current volume or sets it (0–100, validated, persisted)

### Bug Fixes

- Fix race condition in `voice:user_joined` — `introInFlight` set prevents double-intro on parallel joins
- Add async error handlers in `voice-events.ts` and `user-events.ts`
- Fix queue stale-reference bug — `processQueue()` re-reads queue on every iteration
- Fix `jsx` option in `tsconfig.json` + add `vendor/sharkord-plugin-sdk.d.ts` for correct SDK 0.0.22 types

## [0.2.0]

Initial release.
