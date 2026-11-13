"""Narration for the submission videos, with Kokoro (open-source neural text-to-speech, runs offline).

  python3 docs/video/voice.py synth <lines.json> <cache dir>     # speak each caption line, print durations
  python3 docs/video/voice.py mix <video.mp4> <captions.srt> <cache dir> <out.mp4>

Needs `pip install kokoro-onnx soundfile` and the model files kokoro-v1.0.onnx and voices-v1.0.bin
(github.com/thewh1teagle/kokoro-onnx releases) in $KOKORO_DIR.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

VOICE = os.environ.get('KOKORO_VOICE', 'af_heart')
RATE = 24000


def spoken(text: str) -> str:
    """How a caption line should be said: code names and numbers in words a listener follows."""
    t = text
    # Checked against the voice's phonemes; everything else (ParyonUSD, BCH, BIP68, 110%) already reads well.
    for a, b in [
        ('Backstop.cash', 'Backstop dot cash'), ('checkDataSig', 'check data sig'), ('ownerSpend', 'owner spend'),
        ('OP_RETURN', 'op return'), ('BCHN', 'B C H N'), ('3am', 'three AM'), ('CashScript', 'Cash Script'),
        ('chipnet', 'chip net'),
    ]:
        t = t.replace(a, b)
    return t


def key(text: str) -> str:
    return hashlib.sha1(f'{VOICE}|{spoken(text)}'.encode()).hexdigest()[:16]


def synth(lines_file: str, cache: str) -> None:
    from kokoro_onnx import Kokoro
    os.makedirs(cache, exist_ok=True)
    lines = json.load(open(lines_file))
    model_dir = os.environ['KOKORO_DIR']
    tts = None
    durations = {}
    for line in lines:
        path = os.path.join(cache, key(line) + '.wav')
        if not os.path.exists(path):
            if tts is None:
                tts = Kokoro(os.path.join(model_dir, 'kokoro-v1.0.onnx'), os.path.join(model_dir, 'voices-v1.0.bin'))
            samples, rate = tts.create(spoken(line), voice=VOICE, speed=1.0, lang='en-us')
            sf.write(path, samples, rate)
        info = sf.info(path)
        durations[line] = info.frames / info.samplerate
    json.dump(durations, sys.stdout)


def parse_srt(path: str):
    entries = []
    for block in open(path, encoding='utf-8').read().strip().split('\n\n'):
        rows = block.strip().split('\n')
        if len(rows) < 3:
            continue
        start = rows[1].split(' --> ')[0]
        h, m, rest = start.split(':')
        s, ms = rest.split(',')
        entries.append(((int(h) * 3600 + int(m) * 60 + int(s)) + int(ms) / 1000, '\n'.join(rows[2:])))
    return entries


def mix(video: str, srt: str, cache: str, out: str) -> None:
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]))
    track = np.zeros(int((duration + 1) * RATE), dtype=np.float32)
    for start, text in parse_srt(srt):
        samples, rate = sf.read(os.path.join(cache, key(text) + '.wav'), dtype='float32')
        assert rate == RATE, rate
        at = int((start + 0.12) * RATE)
        end = min(len(track), at + len(samples))
        track[at:end] += samples[: end - at]
    peak = float(np.max(np.abs(track))) or 1.0
    track *= 0.89 / peak
    wav = out + '.voice.wav'
    sf.write(wav, track[: int(duration * RATE)], RATE)
    subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
                           '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                           '-movflags', '+faststart', '-shortest', out])
    os.remove(wav)


if __name__ == '__main__':
    if sys.argv[1] == 'synth':
        synth(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'mix':
        mix(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
