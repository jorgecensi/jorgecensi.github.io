---
description: Add or change Cyber Quest content (a story chapter, scene, question, terminal training, live incident, phishing rush, Terminal lab or quiz mission) with ready skeletons, the save-format rules, and the test updates each one needs. Use for any change to cyber-quest/index.html content, before writing a single beat.
---

# Cyber Quest content

Read the Cyber Quest section of AGENTS.md first (data model and progress keys).
This skill is the how-to: skeletons, steps and the mistakes we already made.

## Rules that protect saves and the teaching

- **Never rename** a chapter id (`ch1`…), mission id or lab id: they are
  `localStorage` progress keys. **Never reorder or insert beats in a released
  chapter**: `progress.storyAt` stores a beat index. Add a new chapter at the
  end instead.
- **Teach before you test.** Every skill an incident needs must appear first in
  a calm beat of the same or an earlier chapter: a `train` lesson, a scene or
  an `ask`. Incident lessons and tips point back to where the skill was taught.
- **Rhythm per chapter:** calm scene → train → ask(s) → alarm scene → incident
  or triage → calm debrief that moves the story on.
- **Defensive and fictional only.** The player defends; never script attacking
  someone, exploit payloads or real malware code. IPs come from the RFC 5737
  ranges (192.0.2.x, 198.51.100.x, 203.0.113.x), credentials are fake, and
  companies, people and domains are invented.
- Dialogue text is plain text (backticks become `<code>`). `lesson`, `intro`
  and quiz `explain` are raw HTML, so write `&lt;` for a literal `<`.
- Describe characters without gendered pronouns.

## Skeletons

Story beats live in `CHAPTERS[n].beats`. Incident and long training beats are
`const`s above `CHAPTERS` (see `INC_BRUTE`, `TRAIN_RM`).

```js
// Scene: [who, text, face?]; who is a CHARS key or null for narration.
{ type: 'scene', mood: 'calm' /* calm | night | alarm */, bg: 'flat' /* optional, /img/cq/bg-<bg>.webp */,
  loc: 'Brightside Games HQ · Sat 10:00', art: '☕', lines: [
    [null, 'Narration, in italics.'],
    ['mira', 'A line.', 'happy'],        // face: neutral | talk | worried | happy (SIEM: alarm)
] },

// Question with no clock (the asker smiles or frowns automatically)
{ type: 'ask', who: 'mira', q: 'Question?', options: ['Right answer', 'Wrong', 'Wrong', 'Wrong'], answer: 0,
  explain: 'Why it\'s right, and why the tempting wrong one is wrong.' },

// Training that reuses a Terminal lab (it also clears that lab in the Training Grounds)
{ type: 'train', lab: 'reading-logs', host: 'web-01', intro: '🧑🏾‍💻 Mira: “…”' },

// Live incident: a terminal beat with an incident block
const INC_X = {
  type: 'incident', title: 'Short name', icon: '🔥', host: 'web-01',
  intro: 'Mira says what to do, in HTML.', chips: ['ps aux', 'hint'],
  debrief: 'What the player just did, in security terms.',
  build() { return { fs: d({ … }), cwd: '/home/alex', procs: baseProcs(), net: [ … ], services: { … } }; },
  tasks: [{ id: 'kill', desc: 'Kill it', hint: 'Type: kill <PID>', check: (T) => T.killedCmds.has('name') }],
  incident: {
    label: 'What the meter measures',
    rate: (T) => (fixed(T) ? 0 : 1.25),      // threat per second (1.25 ≈ 80 s to breach), or danger: (T) => 0-100
    every: [{ period: 1.5, fn: (c) => c.log('/var/log/auth.log', '…') }],
    events: [{ at: 30, fn: (c) => { if (!done) c.say('mira', 'A tip, not the answer.'); } }],
    failText: 'What happened, and what to do differently.'
  }
};
```

A phishing rush is `{ type: 'triage', gap: 4.5, window: 13, mails: [{ name, addr, subject, preview, attach?, phish, why, hit? }] }`.

## Mistakes we already made

- **An objective that the attack can undo must include the root fix.** "No
  miner running" ticked complete after the first `kill`, then cron respawned the
  miner. The check must also require the cron job gone, or the C2 blocked for
  ransomware. Make objectives true only when the threat truly can't return.
- **Interval timing is real time** and pauses while the tab is hidden. A
  beginner needs about 10 s per command, so give them 60-90 s before a breach.
- **Disabled buttons swallow taps.** After a question is answered, an explicit
  Continue button (`data-story-tap`) advances, not a tap on the dialog box.
- **Non-scene beats take the setting of the previous scene** (`play()` handles
  this). Keep a scene before any question or terminal beat.
- **New shell behaviour belongs in `Ops.runCmd`/`pipe`**, stays forgiving
  (quotes, combined flags, helpful errors), and gets a `MAN` entry and a `HELP`
  line if players should discover it.

## Steps

1. Write the content (skeletons above). New art: use the `pixel-art-assets` skill.
   A new chapter also needs a node on the map: add `{ id, ch, x, y, place, via? }`
   to its world in `WORLDS`, or start a new world (see AGENTS.md) and point the
   previous world's gate `to` it. Screenshot the map afterwards.
2. Bump `SW_VERSION`/`CACHE_VERSION` together; add any new asset to `PRECACHE_URLS`.
3. Update the e2e specs in `tools/cyber-quest-e2e/specs/`:
   - `story.spec.js`: add the commands for a new `train` lab to `TRAIN`, and a
     branch in `playTerminal()` for a new incident (by `title`) that exercises
     its live mechanic and asserts it fired.
   - `labs.spec.js`: add a new lab's commands to `LABS`.
   - `missions.spec.js` picks up new missions automatically.
4. `jekyll build`, then `tools/cyber-quest-e2e/run.sh` (about 6 min), then
   screenshots of the new scenes with the `mobile-ui-check` skill.
5. Update AGENTS.md if a convention changed, and the in-app "How to play" page
   if a mechanic did.
