# Submission videos

Two videos, recorded from the real web app and real chain data:

| Video | Length | What it shows |
|---|---|---|
| `backstop-pitch.mp4` | about 2:10 | The borrower and the 3am liquidation; the app's local preview: setup with one signature, the price crash, a keeper's rescue landing, withdraw; the real rescue on the chipnet explorer |
| `backstop-technical-walkthrough.mp4` | about 4:10 | The vault, loan, oracle and keeper; the setup and rescue transactions; `Backstop.cash` walked through `require` by `require`; withdraw; the tests; the chipnet transactions; known limitations |

Both are 1920×1080 with captions burned in, so they work muted. The app scenes run in the **local preview** (a test chain inside the page, labelled on screen); the chipnet proof is the real rescue transaction on `chipnet.imaginary.cash`.

## Adding your own voice

Each video comes with an `.srt` file: the captions with their exact timings. To narrate:

1. Read `narration.json` (the same words as the captions, written to be spoken).
2. Record yourself reading it while the video plays, for example in Clipchamp (Windows), iMovie or DaVinci Resolve. The `.srt` tells you when each line starts.
3. Export with your voice as the audio track. The burned-in captions stay.

## Re-recording

Needs Playwright with Chromium, and ffmpeg.

```bash
npm run web:build
```

```bash
node docs/video/record.cjs docs/video/out
```

Add `pitch` or `technical` to record only one. Set `TESTS_OUTPUT` to a file with `npx vitest run --reporter=verbose` output (run in `test/`) to show the real test run in the technical video.

- `narration.json`: the words, scene by scene.
- `deck.html`: the slides (title, problem, diagram, transactions, code walkthrough, tests, limits).
- `record.cjs`: drives the slides and the app in Chromium with a visible cursor, captures frames at full resolution, cuts loading time, and writes the MP4 and SRT.
