---
name: trophy-case
description: >-
  Trophy Case — Steam-style achievements for Claude Code. Use when the user
  asks about achievements, trophies, unlocks, "show my trophy case", their
  coding stats recap, "wrapped", coding archetype, or wants to
  install/remove/reset Trophy Case.
---

# Trophy Case

Achievements for Claude Code sessions, tracked by hooks. One script drives
everything: `ach/trophy.js` (Node, no dependencies).

## Locate the script

`$CLAUDE_PLUGIN_ROOT/ach/trophy.js` when installed as a plugin; otherwise
resolve `../../ach/trophy.js` relative to this skill file.

## What to run

| User intent | Command |
| --- | --- |
| Show trophies / achievements | `node "$T" --cabinet` |
| Monthly recap / "my wrapped" | `node "$T" --wrapped` (or `--wrapped 2026-06`) |
| Raw state for analysis | `node "$T" --json` |
| Install (standalone, no plugin) | `node "$T" --install` |
| Remove hooks | `node "$T" --uninstall` |

## Behavior notes

- Show `--cabinet` / `--wrapped` output as-is (already formatted and colored);
  it is designed to be screenshotted and shared. Add one playful sentence —
  e.g. which locked achievement is closest.
- Never spoil hidden achievements (the `???` rows). If the user asks what
  they are, tease: they unlock through ordinary (and less ordinary) behavior.
- When installed as a plugin, hooks are active automatically — no setup step.
  `--install` is only for people who cloned the repo without the plugin.
- All tracking is local (`~/.claude/trophy-case/`); nothing is uploaded.
  If Token HUD is installed, Wrapped also shows the month's token spend.
