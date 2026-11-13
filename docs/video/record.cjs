// Records the two submission videos: a two-minute pitch and a technical walkthrough.
//
//   npm run web:build
//   node docs/video/record.cjs <output dir> [pitch|technical]
//
// It drives docs/video/deck.html (slides) and the built web app's local preview in Chromium,
// with a visible cursor and on-screen captions taken from docs/video/narration.json, visits the
// real chipnet transactions on the explorer, and writes <name>.mp4 plus <name>.srt (caption
// timings, for recording a voice-over). Needs Playwright with Chromium and ffmpeg.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.join(__dirname, '..', '..');
const site = path.join(repo, 'web', 'out');
const outDir = path.resolve(process.argv[2] ?? path.join(repo, 'docs', 'video', 'out'));
const only = process.argv[3];
const narration = JSON.parse(fs.readFileSync(path.join(__dirname, 'narration.json'), 'utf8'));
const source = fs.readFileSync(path.join(repo, 'contracts', 'Backstop.cash'), 'utf8');
const testsFile = process.env.TESTS_OUTPUT; // verbose vitest output, optional
const tests = testsFile && fs.existsSync(testsFile)
  ? fs.readFileSync(testsFile, 'utf8').split('\n').filter((l) => l.trim().startsWith('✓')).map((l) => '✓ ' + l.trim().replace(/^✓\s*/, '').split(' > ').pop())
  : [];
const explorer = (txid) => `https://chipnet.imaginary.cash/tx/${txid}`;
const RESCUE_TX = '24aa5b20a23bcf3910cc72b004307127ee18460c1e5f1f8eb9f7a67a2dc0d399';

// Captions show numbers and code names the way they are written, not the way they are spoken.
const display = (text) => text
  .replace(/Backstop dot cash/g, 'Backstop.cash')
  .replace(/check data sig/g, 'checkDataSig')
  .replace(/Owner spend/g, 'ownerSpend').replace(/Owner withdraw/g, 'ownerWithdraw')
  .replace(/one hundred and ten percent/g, '110%').replace(/one hundred and fifteen percent/g, '115%')
  .replace(/one hundred and fifty percent/g, '150%').replace(/one hundred and three/g, '103')
  .replace(/three a\.m\./g, '3am.').replace(/inputs four and five/g, 'inputs 4 and 5')
  .replace(/positions four and five/g, 'positions 4 and 5').replace(/zero to four/g, '0 to 4')
  .replace(/index five/g, 'index 5').replace(/input zero/g, 'input 0');

/**
 * Splits narration into caption lines of at most ~15 words: one per sentence, and a long sentence
 * into even parts, cut at a comma, semicolon or colon near each part's end where there is one.
 */
function chunk(text) {
  const out = [];
  for (const sentence of display(text).match(/[^.!?]+[.!?]+/g) ?? [text]) {
    const words = sentence.trim().split(/\s+/);
    const parts = Math.ceil(words.length / 15);
    if (parts <= 1) { out.push(words.join(' ')); continue; }
    const size = Math.ceil(words.length / parts);
    let start = 0;
    while (start < words.length) {
      let end = Math.min(words.length, start + size);
      if (end < words.length) {
        for (let d = 0; d <= 4; d++) {
          if (end - d > start + 4 && /[,;:]$/.test(words[end - d - 1])) { end = end - d; break; }
          if (end + d < words.length && /[,;:]$/.test(words[end + d - 1])) { end = end + d; break; }
        }
        if (words.length - end < 4) end = words.length; // no tiny last line
      }
      out.push(words.slice(start, end).join(' '));
      start = end;
    }
  }
  return out;
}
const readSeconds = (line) => Math.max(2.0, line.split(/\s+/).length * 0.34 + 0.55);
const text = (video, id) => narration[video].find((s) => s.id === id).text;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = pathname === '/deck.html' ? path.join(__dirname, 'deck.html') : path.join(site, pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Injected into every page: a cursor that follows the mouse, click ripples, and the caption bar.
const overlay = `
  window.__BACKSTOP_SOURCE = ${JSON.stringify(source)};
  window.__BACKSTOP_TESTS = ${JSON.stringify(tests)};
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = \`
      #__cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -3px 0 0 -3px; pointer-events: none;
        transition: transform 0.12s; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); left: -100px; top: -100px; }
      #__cursor.down { transform: scale(0.85); }
      .__ripple { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
        border: 3px solid #34d399; pointer-events: none; animation: __rip 0.6s ease-out forwards; }
      @keyframes __rip { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
      #__cap { position: fixed; z-index: 2147483645; left: 50%; bottom: 26px; transform: translateX(-50%); max-width: 1060px; width: max-content;
        padding: 12px 24px; border-radius: 16px; background: rgba(5,9,13,0.86); border: 1px solid rgba(255,255,255,0.14);
        color: #f2f6fa; font: 600 22px/1.4 Inter, system-ui, sans-serif; text-align: center; letter-spacing: -0.01em;
        box-shadow: 0 18px 50px -12px rgba(0,0,0,0.7); backdrop-filter: blur(10px); opacity: 0; transition: opacity 0.25s; pointer-events: none; }
      #__cap.on { opacity: 1; }
    \`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 L4 19 L9 14.5 L12.5 22 L15.5 20.6 L12 13.3 L18.5 13.3 Z" fill="#fff" stroke="#0b1015" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const cap = document.createElement('div');
    cap.id = '__cap';
    document.body.appendChild(cap);
    addEventListener('mousemove', (e) => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      cursor.classList.add('down');
      const r = document.createElement('div'); r.className = '__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
    window.__caption = (t) => { cap.textContent = t; cap.classList.toggle('on', !!t); };
  });
`;

async function record(name, scenes) {
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
  });
  // Pages are laid out at 1280x720 and rendered at 1.5x, so frames are a sharp 1920x1080.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: 'dark', ignoreHTTPSErrors: true,
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  const t0 = Date.now();

  // Capture frames with Chromium's screencast at full device resolution. Frames arrive only when
  // the page changes; each one is shown until the next.
  const framesDir = path.join(outDir, `${name}-frames`);
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const file = path.join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: Date.now() - t0 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const startCast = async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  };
  await startCast();
  const srt = [];
  const base = `http://127.0.0.1:${server.address().port}/`;
  let mouse = { x: 640, y: 400 };

  const wait = (ms) => page.waitForTimeout(ms);
  const say = async (video, id, onLine) => {
    const lines = chunk(text(video, id));
    for (let i = 0; i < lines.length; i++) {
      const start = Date.now() - t0;
      await page.evaluate((l) => window.__caption?.(l), lines[i]).catch(() => {});
      if (onLine) await onLine(i, lines.length);
      await wait(readSeconds(lines[i]) * 1000);
      srt.push({ start, end: Date.now() - t0, text: lines[i] });
    }
    await page.evaluate(() => window.__caption?.('')).catch(() => {});
  };
  const sayLines = async (lines, onLine) => {
    for (let i = 0; i < lines.length; i++) {
      const start = Date.now() - t0;
      await page.evaluate((l) => window.__caption?.(l), lines[i]).catch(() => {});
      if (onLine) await onLine(i);
      await wait(readSeconds(lines[i]) * 1000);
      srt.push({ start, end: Date.now() - t0, text: lines[i] });
    }
    await page.evaluate(() => window.__caption?.('')).catch(() => {});
  };
  const moveTo = async (x, y) => { await page.mouse.move(x, y, { steps: 28 }); mouse = { x, y }; };
  const point = async (locator) => {
    // Scroll it into view smoothly if needed; no "stable" wait, since some elements animate forever.
    let box = await locator.first().boundingBox();
    if (box && (box.y < 60 || box.y + box.height > 700)) {
      await locator.first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await wait(900);
      box = await locator.first().boundingBox();
    }
    await moveTo(box.x + box.width / 2, box.y + box.height / 2);
    return box;
  };
  const click = async (locator) => { await point(locator); await wait(250); await page.mouse.down(); await wait(90); await page.mouse.up(); };
  const scrollTo = async (selectorOrY) => {
    await page.evaluate((s) => {
      const y = typeof s === 'number' ? s : (document.querySelector(s)?.getBoundingClientRect().top ?? 0) + scrollY - 80;
      scrollTo({ top: y, behavior: 'smooth' });
    }, selectorOrY);
    await wait(900);
  };
  const deck = async (slide) => {
    if (!page.url().includes('deck.html')) await gap(async () => { await page.goto(`${base}deck.html`); await wait(300); });
    await page.evaluate((s) => window.show(s), slide);
  };
  // Loading time (page loads, the preview chain starting) is cut out of the final video.
  const cuts = [];
  // A new page (another site) can stop the screencast, so it restarts after every load.
  const gap = async (fn) => { const a = Date.now() - t0; await fn(); await startCast(); await wait(200); cuts.push([a, Date.now() - t0 - 150]); };
  const tools = { page, wait, say, sayLines, moveTo, point, click, scrollTo, deck, base, gap, mouse: () => mouse };
  await gap(async () => { await page.goto('about:blank'); await wait(400); });
  for (const scene of scenes) await scene(tools);
  await wait(600);
  const tEnd = Date.now() - t0;
  await cdp.send('Page.stopScreencast').catch(() => {});
  await context.close();
  await browser.close();

  // Each frame lasts until the next one, minus any loading time that is cut.
  const keep = cuts.filter(([a, b]) => b > a);
  const overlap = (a, b) => keep.reduce((sum, [c, d]) => sum + Math.max(0, Math.min(b, d) - Math.max(a, c)), 0);
  const removedBefore = (ms) => overlap(0, ms);
  const list = [];
  let last;
  for (let i = 0; i < frames.length; i++) {
    const start = frames[i].t, end = i + 1 < frames.length ? frames[i + 1].t : tEnd;
    const shown = (end - start) - overlap(start, end);
    if (shown <= 0) continue;
    list.push(`file '${frames[i].file}'`, `duration ${(shown / 1000).toFixed(3)}`);
    last = frames[i].file;
  }
  list.push(`file '${last}'`);
  const listFile = path.join(framesDir, 'frames.txt');
  fs.writeFileSync(listFile, list.join('\n') + '\n');
  const mp4 = path.join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(framesDir, { recursive: true, force: true });
  const stamp = (ms) => { ms = Math.max(0, Math.round(ms - removedBefore(ms))); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(path.join(outDir, `${name}.srt`), srt.map((e, i) => `${i + 1}\n${stamp(e.start)} --> ${stamp(e.end)}\n${e.text}\n`).join('\n'));
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
  console.log(`${name}: ${mp4} (${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')})`);
}

// ---------------------------------------------------------------- the pitch (about two minutes)

const pitch = [
  async ({ deck, say, wait }) => { await deck('title-pitch'); await wait(1600); await say('pitch', 'p1-title'); },
  async ({ deck, say, wait }) => { await deck('problem'); await wait(600); await say('pitch', 'p2-problem'); await wait(400); },
  async ({ page, base, say, wait, point, scrollTo, gap }) => {
    await gap(async () => {
      await page.goto(base);
      await page.getByRole('heading', { name: 'Connect your wallet' }).waitFor({ timeout: 30000 });
      await wait(1200);
    });
    await Promise.all([
      say('pitch', 'p3-idea'),
      (async () => {
        await wait(3500); await point(page.locator('.scene'));
        await wait(5000); await scrollTo('.section'); await wait(4500);
        await scrollTo(0); await point(page.getByText('Connect with WizardConnect'));
      })(),
    ]);
  },
  async ({ page, base, say, wait, point, click, scrollTo, moveTo, gap }) => {
    await gap(async () => {
      await page.goto(`${base}?preview`);
      await page.getByRole('heading', { name: 'Your loan' }).waitFor({ timeout: 60000 });
      await wait(1200);
    });
    await Promise.all([
      say('pitch', 'p4-setup'),
      (async () => {
        await point(page.locator('.gauge'));
        await wait(2200);
        await scrollTo('.protect-card');
        // Drag the reserve slider: the price scale redraws live.
        const slider = page.locator('.slider');
        const box = await slider.boundingBox();
        const at = (f) => box.x + box.width * f;
        await moveTo(at(0.25), box.y + box.height / 2);
        await page.mouse.down();
        for (const f of [0.35, 0.5, 0.42, 0.3]) { await page.mouse.move(at(f), box.y + box.height / 2, { steps: 22 }); await wait(500); }
        await page.mouse.up();
        await point(page.locator('.scale'));
        await wait(2500);
        await click(page.getByText('More settings'));
        await page.locator('#cooldown').selectOption('1');
        await wait(800);
        await click(page.getByRole('button', { name: 'Protect my loan' }));
        await page.getByRole('heading', { name: 'Your loan is protected' }).waitFor({ timeout: 60000 });
        await scrollTo(0);
      })(),
    ]);
    await wait(1500);
  },
  async ({ page, say, wait, click, scrollTo, point }) => {
    await Promise.all([
      say('pitch', 'p5-rescue'),
      (async () => {
        await click(page.getByRole('button', { name: 'Price to $265' }));
        await page.getByRole('heading', { name: 'Your loan is below your rescue level' }).waitFor({ timeout: 60000 });
        await scrollTo(0); await point(page.locator('.status-badge')); await wait(3800);
        await click(page.getByRole('button', { name: 'Run a keeper' }));
        await page.getByText('Rescued:', { exact: true }).waitFor({ timeout: 60000 });
        await scrollTo(0); await wait(3000);
        await scrollTo('.vault'); await point(page.locator('.vault'));
      })(),
    ]);
    await wait(1500);
  },
  async ({ page, say, wait, click, scrollTo }) => {
    await Promise.all([
      say('pitch', 'p6-withdraw'),
      (async () => {
        await click(page.getByRole('button', { name: 'Withdraw everything' }));
        await wait(1200);
        await click(page.getByRole('button', { name: 'Withdraw everything' }));
        await page.getByRole('heading', { name: 'Protect it' }).waitFor({ timeout: 60000 });
        await scrollTo(0);
      })(),
    ]);
    await wait(1200);
  },
  async (tools) => { await chipnetProof(tools, 'pitch', 'p7-chipnet'); },
  async ({ deck, say, wait }) => { await deck('close'); await wait(800); await say('pitch', 'p8-close'); await wait(2500); },
];

// The rescue on the real chipnet explorer, with the transaction list slide as a fallback.
async function chipnetProof({ page, deck, say, wait, gap }, video, id) {
  let reached = false;
  await gap(async () => {
    try {
      const response = await page.goto(explorer(RESCUE_TX), { timeout: 30000 });
      reached = !!response && response.ok() && !(await page.content()).includes('No such mempool');
      await wait(1000);
    } catch { reached = false; }
  });
  if (!reached) { await deck('chipnet'); await say(video, id); return; }
  await wait(800);
  await Promise.all([
    say(video, id),
    (async () => {
      await wait(1500);
      await page.evaluate(() => scrollTo({ top: 260, behavior: 'smooth' })); await wait(3500);
    })(),
  ]);
}

// ---------------------------------------------------------------- the technical walkthrough

const rescueTopics = ['Transaction shape', 'Vault at inputs 4 and 5', 'Cooldown (BIP68)', 'Genuine price contract', 'This loan, state unchanged',
  "Paryon's manage function", 'Top-up limits', 'Key comes straight back', 'Reserve back, fee capped', 'Ratio rules'];
const rescueLines = [
  ['Every guarantee is a require in Backstop.cash.', null],
  ['The rescue path checks the exact transaction shape;', [58, 62, 0]],
  ['that the vault sits at positions 4 and 5;', [64, 70, 1]],
  ['a relative timelock cooldown;', [72, 75, 2]],
  ['the genuine price contract;', [77, 89, 3]],
  ['that the loan belongs to this key, and its debt, state and interest manager are unchanged;', [91, 111, 4]],
  ["that the manage function is Paryon's;", [113, 121, 5]],
  ['that the top-up is positive and within the limit;', [123, 130, 6]],
  ['that the key comes straight back with its minting capability;', [132, 137, 7]],
  ['that the reserve returns, minus at most the top-up and a capped fee;', [139, 150, 8]],
  ['and the ratio rules: below the trigger, never above the target, and no draining through tiny rescues.', [152, 165, 9]],
  ['The ratio maths is cross-multiplied, with no division.', [153, 158, 9]],
];
const withdrawTopics = ['ownerSpend: key + signature', 'ownerWithdraw: an owner coin', 'Every output pays the owner', 'Fee capped'];
const withdrawLines = [
  ['There are two ways out, both only for the borrower.', null],
  ["ownerSpend checks the owner's key and signature.", [169, 174, 0]],
  ['ownerWithdraw exists because WizardConnect wallets sign only their own coins:', [176, 180, 1]],
  ['the owner spends one of their own coins in the same transaction,', [179, 183, 1]],
  ["the contract checks it sits at the owner's address,", [181, 183, 1]],
  ['every output pays the owner,', [185, 192, 2]],
  ['and the fee is capped.', [194, 204, 3]],
];

const technical = [
  async ({ deck, say, wait }) => { await deck('title-tech'); await wait(1500); await say('technical', 't1-title'); },
  async ({ deck, say, wait }) => { await deck('pieces'); await wait(1200); await say('technical', 't2-pieces'); await wait(800); },
  async ({ deck, say, wait }) => { await deck('setup-tx'); await wait(1000); await say('technical', 't3-setup'); await wait(600); },
  async ({ deck, say, wait }) => { await deck('rescue-tx'); await wait(1200); await say('technical', 't4-rescue'); await wait(600); },
  async ({ page, deck, sayLines, wait }) => {
    await deck('code-rescue');
    await page.evaluate((t) => window.setTopics(t), rescueTopics);
    await wait(900);
    await sayLines(rescueLines.map(([l]) => l), async (i) => {
      const f = rescueLines[i][1];
      if (f) await page.evaluate(([a, b, t]) => window.focusLines(a, b, t), f);
    });
    await wait(600);
  },
  async ({ page, deck, sayLines, wait }) => {
    await deck('code-withdraw');
    await page.evaluate((t) => window.setTopics(t), withdrawTopics);
    await wait(900);
    await sayLines(withdrawLines.map(([l]) => l), async (i) => {
      const f = withdrawLines[i][1];
      if (f) await page.evaluate(([a, b, t]) => window.focusLines(a, b, t), f);
    });
    await wait(600);
  },
  async ({ page, deck, say, wait }) => {
    await deck('tests');
    await wait(600);
    const lines = chunk(text('technical', 't7-tests'));
    const total = lines.reduce((s, l) => s + readSeconds(l), 0) * 1000;
    await page.evaluate((ms) => { window.playTests(ms); setTimeout(() => window.countTo(103, 2500), ms * 0.25); }, total * 0.85);
    await say('technical', 't7-tests');
    await wait(1200);
  },
  async (tools) => {
    const { deck, say, wait, page } = tools;
    await deck('chipnet');
    await wait(1200);
    const lines = chunk(text('technical', 't8-chipnet'));
    // First half on the transaction list, then the rescue itself on the explorer.
    await tools.sayLines(lines.slice(0, 2));
    try {
      let response;
      await tools.gap(async () => { response = await page.goto(explorer(RESCUE_TX), { timeout: 30000 }); await wait(1000); });
      if (response?.ok()) {
        await Promise.all([tools.sayLines(lines.slice(2)), (async () => { await wait(1200); await page.evaluate(() => scrollTo({ top: 260, behavior: 'smooth' })); })()]);
      } else { await tools.sayLines(lines.slice(2)); }
    } catch { await tools.sayLines(lines.slice(2)); }
    await wait(800);
  },
  async ({ deck, say, wait }) => { await deck('limits'); await wait(900); await say('technical', 't9-limits'); await wait(600); },
  async ({ deck, wait }) => { await deck('close'); await wait(5000); },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  if (!only || only === 'pitch') await record('backstop-pitch', pitch);
  if (!only || only === 'technical') await record('backstop-technical-walkthrough', technical);
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
