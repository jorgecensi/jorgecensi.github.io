---
description: Persist a newly-discovered gotcha (a surprising bug, timing quirk, silent failure, or workaround) into the most relevant skill file so future sessions don't burn time rediscovering it. Invoke this proactively right after you figure out something non-obvious that cost you real time or a wrong turn — don't wait to be asked.
---

# Capture a gotcha into the relevant skill

The skills in this repo (`.claude/skills/*/SKILL.md`) are read fresh at the start of every session — they're the only thing that survives between sessions, since the container itself is ephemeral. If you just spent several tool calls debugging something surprising (a silent failure, a timing assumption that was wrong, an API that behaves differently than expected), and you don't write it down, the next session pays the same cost again.

**Trigger this whenever**, without being asked:
- You discover that something *looks* like it should work but silently doesn't (e.g., a value gets clobbered, an event doesn't fire, a check matches the wrong thing).
- You hit a timing/race assumption that turned out wrong (something needed a longer wait, or needed to happen in a different order than seemed natural).
- You find a workaround for a library/browser/tool quirk that isn't obvious from its docs.
- You'd genuinely want a warning about this if a colleague were about to do the same task.

**Skip it when**: the mistake was a one-off typo, a problem specific to this exact task's data (not a repeatable environment/API quirk), or something already documented.

## Procedure

1. **Find the right home.** Look for an existing skill whose subject matter matches (e.g., anything about testing/rendering/recording the worldcup-2026 app belongs in `screenshot-worldcup`). Prefer adding to an existing skill's `## Notes` section (or the most relevant step) over creating a new file — a pile of one-gotcha skill files is harder to discover than a few well-maintained ones.
2. **No relevant skill exists?** Only create a new one if this class of gotcha is likely to recur for a distinct enough workflow to deserve its own file (see other `SKILL.md` files for the expected frontmatter + structure). Otherwise a note in the closest-matching skill, or in this repo's root `CLAUDE.md` if it's truly general, is enough.
3. **Write it terse and actionable** — what breaks, why, and the fix/workaround. Not a narrative of how you found it. One or two sentences plus a code snippet if the fix isn't obvious. Match the tone already in that skill's Notes section.
4. **Commit it** as part of whatever branch/PR you're already working on — don't create a separate PR just for a one-line doc note unless there's no open PR to attach it to (in which case, batch it with the next real change, or open a small doc-only PR if it's been a while and several gotchas have piled up unrecorded).
5. **Don't duplicate.** If the skill already mentions this quirk (even phrased differently), skip it or tighten the existing note instead of adding a near-duplicate.
