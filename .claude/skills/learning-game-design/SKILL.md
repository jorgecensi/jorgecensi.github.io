---
description: Design principles for an app that teaches through play (a skill, a subject, a tool), learned the hard way building Cyber Quest. Use when the owner asks for a new learning game or educational app, or says an existing one feels like a course, is too hard to start, or is boring.
---

# Designing a learning game

Cyber Quest went through four rounds of owner feedback before it landed. Start
where it ended instead of where it started.

| Round | What was built | Owner's feedback |
|---|---|---|
| 1 | Quiz missions with explanations | "I wanted something more advanced" |
| 2 | Three tiers plus bosses | "I wanted terminals and command lines, fun like a game" |
| 3 | Hands-on terminal labs | "It requires prior knowledge, make it progressive" |
| 4 | Guided basics before the labs | "It still looks like a course: make it a mission with narrative, calm learning and fast-paced moments" |
| 5 | Story campaign | Merged as the main mode, then pixel art for the cast |

## Principles

1. **Hands-on first.** Let the player do the real thing in a safe simulation
   (a fake shell, a fake inbox) instead of answering questions about it.
   Quizzes are for practice, not the core.
2. **Assume zero prior knowledge, and progress.** Each step teaches one idea,
   explains it ("why"), then names the exact action. Later steps assume only what
   earlier ones taught. Show the lesson next to where the player acts.
3. **Wrap it in a story with stakes.** A place, a small cast (a mentor, a
   colleague, a boss, a villain), a deadline, and a villain who escalates. The
   player is the protagonist and is needed.
4. **Alternate calm and pressure.** Calm: dialogue, lessons, questions with no
   clock. Pressure: a live event with a meter and a clock that reacts to what
   the player does. Then a calm debrief that teaches with hindsight and moves
   the story on. Never test a skill under pressure before teaching it calmly.
5. **Live systems, not static questions.** The best moments are when the world
   pushes back: the miner respawns until you find its cron job; the attacker
   relaunches ransomware until you cut its line. Each pushback teaches the next
   concept.
6. **Failing is free and explains itself.** A loss says what happened and why,
   then offers an instant retry. No lives to buy, no lost progress.
7. **Save at every step.** People play in short sessions on phones.
8. **Check that it stuck.** Lessons and hints prove nothing: the owner asked for
   challenges with no tips, where the goal says what to achieve (not the command)
   and the scenario is randomised, so the player has to apply the skill.
9. **Keep practice mode separate.** The old quizzes and labs became the Training
   Grounds, collapsed under the campaign, so the main screen reads as a game.
10. **Mobile first.** Tappable shortcut chips for typed commands, big targets,
   and safe-area padding.
11. **Show progress and make the ending a reward.** A long chapter needs a bar
    that shows how far in the player is and where the pressure moments are. The
    end screen should reflect back what they did and learned (graded parts,
    first-try answers, the skills gained, rank), not just stars.
12. **Bring things back.** One question from an earlier chapter at the start of
    each new one, preferring what the player got wrong, is cheap and is what
    makes it stick. Never let a score depend on a single sitting: save the run.
13. **Accessibility.** Respect reduced motion, cap flashing (no more than 3 per
    second; slow pulses only), and offer a mute toggle.

## Before building, decide

- The setting, the cast and the villain's escalation path, one step per chapter.
- For each chapter: the skill it teaches calmly, and the live event that tests it.
- What the simulation must support so the player's real actions work (the
  commands, inputs and states).
- Where art comes from (the `pixel-art-assets` skill) and how to test it.

Build the first chapter end to end (story, training, incident, debrief, test),
show it, then do the rest. The engine and conventions are already in Cyber Quest
(`cyber-quest/index.html`; see the `cyber-quest-content` skill), so reuse its
patterns rather than starting over.
