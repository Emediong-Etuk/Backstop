# Submission videos

Two videos, recorded from the real web app and real chain data:

| Video | Length | What it shows |
|---|---|---|
| [`media/backstop-pitch.mp4`](media/backstop-pitch.mp4) | 1:59 | The borrower and the 3am liquidation; the app's local preview: setup with one signature, an attack refused, the price crash, a keeper's rescue landing, withdraw; the real rescue on the chipnet explorer |
| [`media/backstop-technical-walkthrough.mp4`](media/backstop-technical-walkthrough.mp4) | 4:15 | The vault, loan, oracle and keeper; the setup and rescue transactions; `Backstop.cash` walked through `require` by `require`; withdraw; the tests and the mutation result; the chipnet transactions; known limitations |

Both are 1920×1080, with a voice-over and captions burned in; the `.srt` files next to them hold the caption timings. The app scenes run in the **local preview** (a test chain inside the page, labelled on screen); the chipnet proof is the real rescue transaction on `chipnet.imaginary.cash`.

## The voice

The narration is synthesized with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), an open-source (Apache-2.0) text-to-speech model that runs offline, voice `af_heart`. Each caption line is spoken, and the video waits for each line to finish, so picture, captions and voice stay in step. `voice.py` turns on-screen forms into spoken ones (`Backstop.cash` → "Backstop dot cash", `3am` → "three AM").

To use your own voice instead: record the video without `KOKORO_DIR` (captions only), then read `narration.json` over it in Clipchamp, iMovie or DaVinci Resolve. The `.srt` file gives each line's start time.

## Re-recording

Needs Playwright with Chromium and ffmpeg; for the voice, `pip install kokoro-onnx soundfile` and the model files `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx releases in one folder.

```bash
npm run web:build
```

```bash
KOKORO_DIR=<model folder> node docs/video/record.cjs docs/video/out
```

Add `pitch` or `technical` to record only one. Set `TESTS_OUTPUT` to a file with `npx vitest run --reporter=verbose` output (run in `test/`) to show the real test run in the technical video. `KOKORO_VOICE` picks another Kokoro voice.

- `narration.json`: the words, scene by scene.
- `deck.html`: the slides (title, problem, diagram, transactions, code walkthrough, tests, limits).
- `record.cjs`: drives the slides and the app in Chromium with a visible cursor, captures frames at full resolution, cuts loading time, and writes the MP4 and SRT.
- `voice.py`: speaks each caption line and mixes the voice track into the video.
