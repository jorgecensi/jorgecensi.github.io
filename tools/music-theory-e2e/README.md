# Music Theory e2e specs

Playwright specs for the Music Theory PWA (`/music-theory`): the Learn path,
progress persistence, and the free-play tabs' basic wiring.

## Running

```sh
cd tools/music-theory-e2e
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # first time only
./run.sh                     # every spec
./run.sh smoke.spec.js       # just the named one(s)
```

`run.sh` builds the site with jekyll, serves `_site/` on port 4003 (override
with `PORT=`), runs each spec as a plain Node script, and exits non-zero if
any fail. Failing specs print their last 20 log lines; full logs land in a
temp directory named at the end of the run. A fresh container also needs
`bundle install` once, otherwise `run.sh` reports "could not locate the
jekyll binary".

## Environment caveats

- **Playwright is pinned to exactly `1.56.0`** (no caret) to match the
  pre-installed Chromium in `/opt/pw-browsers`. Never run `playwright install`
  and always install with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. A newer
  Playwright dies with `Executable doesn't exist at .../chromium_headless_shell-<N>`.
- **Jekyll binstub**: `bundle exec jekyll` may not resolve in a fresh
  container; `run.sh` falls back to the binary from `gem environment`.
- **Piano samples**: the app loads Tone.js Salamander samples from
  `tonejs.github.io`, which the sandbox may block. That failure is expected;
  `specs/_helpers.js` filters console errors mentioning samples / salamander /
  "Failed to load" / `tonejs.github.io` / `ERR_`. The learn flow must work with
  `samplerReady === false`.
- **SW self-reload**: `sw.js` calls `clients.claim()` and `index.html` reloads
  on the resulting controller change. `_helpers.js` waits for navigations to
  go quiet before driving the page (same trick as auto-runner-e2e).
- `specs/_helpers.js` is shared plumbing (launch, error collection, `open()`,
  `reload()`); it is not a spec and `run.sh` ignores it.

## The `?debug=1` API

Only when the URL has `?debug=1`, `music-theory/index.html` exposes
`window.__musicTheory`:

- `state` (getter) - the live `state` object (`mode`, `quizType`,
  `quizLevel`, learn fields).
- `progress` (getter) - parsed `localStorage['music-theory-progress-v1']`
  (or defaults).
- `units` - `[{ id, title, steps: ['hear','play','why'] }]` in order. Ids:
  `pulse`, `perfect-intervals`, `thirds`, `major-minor-chords`,
  `seconds`, `sixths`, `sevenths`, `all-intervals`, `major-scale`,
  `dominant-7th`, `minor-and-modes`.
  (`pulse` has no play step.)
- `currentQuestion()` - the active learn/quiz question (`answer` for button
  rounds, `answerPcs` Set for keyboard rounds).
- `answerCorrect()` / `answerWrong()` - answer the current learn round;
  `answerCorrect()` then advances after 0 ms (so specs `waitForTimeout(~30)`).
- `gotIt()` - completes the current `why` step.
- `switchMode(mode)` - same as tapping a tab (`learn`, `scales`, `chords`,
  `intervals`, `quiz`).
- `resetProgress()` - clears storage and state (no `confirm()`). The
  `settings` object is kept, since it is a preference rather than progress.
- `useHint()` - the Learn Hint button: marks the current interval hear round
  as hinted (it then does not count towards passing) and shows the song card.
  Returns `false` outside an unanswered interval round.
- `setKeyContext(on)` - the "Play the key first" setting.
- `instrument` (getter) - the instrument sounding now (a Learn round's random
  pick, or the picker's choice). `instrumentIds` lists every id.
- `chooseInstrument(id)` - same as the header picker (an id or `'random'`).
- `setLearnMix(on)` - the Learn "Mix instruments" toggle.
- `loadInstrument(id)` - resolves `true` once that instrument's samples have
  loaded, `false` if they failed.
- `instrumentRange(id)` - `[lo, hi]` MIDI notes a random pick will use it for.
- `playChord(midis)` - plays through the active instrument, so specs can
  exercise each sound without the keyboard.
- `promptEvents()` - what the current interval question's prompt plays:
  2 events normally, 6 (four I–IV–V–I triads, then the two notes) with key
  context on. `null` for other question kinds.
- `intervalRefs` - the `INTERVAL_REFS` table (`up`/`down` by semitones).
- `showRefs(dir, semis)` - render the song card for that interval into the
  visible panel (used to test entries the random rounds rarely reach).

Persistence blob (`music-theory-progress-v1`):
`{ v: 1, quiz: { level, streak, majorScaleRootsDone }, learn: { unitIdx, layout,
units: { [id]: { step: 'hear'|'play'|'why'|'done', hear: { correct, total,
recent }, play: { ... } } } }, settings: { keyContext, instrument, learnMix } }`.
`instrument` is an instrument id or `'random'`; `learnMix` defaults to `true`.

Step rule: a hear/play step passes when `total >= 10` and the last 10 answers
(`recent`) contain >= 8 correct. Passing `why` (`gotIt()`) marks the unit
done and increments `unitIdx`.

## What each spec covers

- **instruments.spec.js** - every self-hosted sample set loads and plays a
  chord; Learn with "Mix instruments" varies the sound across rounds and only
  picks instruments whose range covers the question's notes; explore tabs and
  Quiz follow the picker, and its Random option varies Quiz rounds; with mixing
  off Learn uses the picker; both settings persist across reload and reset; an
  unknown saved instrument falls back to piano.
- **smoke.spec.js** - loads with `?debug=1`, no page errors, debug API
  present, Learn is the active tab with `#panel-learn` visible, the 11 unit ids
  in order, `switchMode('scales')` shows `#panel-scales`.
- **learn-flow.spec.js** - unit 1 hear (10 correct) -> why -> `gotIt()` ->
  unit 2; unit 2's hear threshold (3 wrong then correct: passes at the 11th
  answer, when the last-10 window first holds 8 correct, never earlier); unit
  2's play step; reload and check `unitIdx === 2` and that the DOM marks
  `[data-unit="thirds"]` active.
- **persistence.spec.js** - the free-play Quiz level (`#quiz-level-btn`)
  survives a reload; the stored progress blob parses and has `v === 1`. A
  `unitIdx` past the end clamps to the last unit. Progress saved before the
  2nds/6ths/7ths units existed (no `layout`) maps by unit id to the first
  unfinished unit; finished units stay open past the frontier, and finishing
  the new units moves the frontier past units already done.
- **interval-hints.spec.js** - every `INTERVAL_REFS` tune contains its own
  interval as a 0 -> ±n step and every video id is well formed; the Learn
  Hint button shows the song card and makes the round not count; the song
  card appears after answering, and Watch embeds the video only on demand
  (YouTube is stubbed with `page.route`); the key-context setting changes the
  prompt, survives a reload and a progress reset; the free-play Intervals quiz
  shows the toggle and the song card.
