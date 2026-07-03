#!/usr/bin/env node
/* Builds assets/preview.html and assets/cover.html from real renderer output. */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ansiToHtml, esc } = require('./ansi2html');

const HERE = __dirname;
const T = path.join(HERE, '..', 'ach', 'trophy.js');
const STATE = path.join(HERE, 'tmp-assets');
const env = { ...process.env, TROPHY_CASE_DIR: STATE };
const run = (cmd, input) => execSync(cmd, { input: input || '', env, encoding: 'utf8' });
const hook = (event, obj) => run(`node "${T}" --hook ${event}`, JSON.stringify(obj));

// ---- craft a photogenic state: a month of activity, nice unlock spread ----
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });

const SID = { session_id: 'demo', cwd: '/home/dev/my-app' };
hook('SessionStart', { ...SID, source: 'startup' });
hook('UserPromptSubmit', { ...SID, prompt: 'please fix the flaky login test, thanks' });
for (let i = 0; i < 120; i++) hook('PostToolUse', { ...SID, tool_name: 'Grep', tool_input: {} });
for (const ext of ['ts', 'py', 'go', 'rs', 'css', 'sql']) {
  hook('PostToolUse', { ...SID, tool_name: 'Edit', tool_input: { file_path: '/app/x.' + ext, old_string: 'a', new_string: 'b\nc\nd' } });
}
hook('PostToolUse', { ...SID, tool_name: 'Bash', tool_input: { command: 'git commit -m "fix login"' } });
for (let i = 0; i < 26; i++) hook('PostToolUse', { ...SID, tool_name: 'Bash', tool_input: { command: 'npx vitest run' } });
for (let i = 0; i < 9; i++) hook('UserPromptSubmit', { ...SID, prompt: 'спасибо! please continue ' + i });

// hand-tune state for a month-long story
const stateFile = path.join(STATE, 'state.json');
const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const ym = new Date().toISOString().slice(0, 7);
const daysInMonth = new Date().getDate();
for (let d = 1; d <= daysInMonth; d++) {
  const key = ym + '-' + String(d).padStart(2, '0');
  if (d % 4 === 1 && s.days[key] == null) continue; // a few rest days
  const v = s.days[key] || { t: 0, p: 0, c: 0, push: 0, tests: 0, add: 0, del: 0, n: 0, e: 0, proj: [], fails: 0 };
  v.t += 40 + (d * 7) % 90; v.p += 8 + (d * 3) % 20; v.c += d % 3 === 0 ? 2 : 1; v.push += d % 3 === 0 ? 1 : 0;
  v.tests += d % 2 ? 3 : 1; v.add += 120 + (d * 13) % 300; v.del += 90 + (d * 17) % 260;
  if (d % 5 === 0) v.n = 1;
  ['my-app', 'landing', 'bot'].slice(0, 1 + (d % 3)).forEach(p => { if (!v.proj.includes(p)) v.proj.push(p); });
  s.days[key] = v;
}
s.streak = { cur: 9, best: 14, last: Object.keys(s.days).sort().pop() };
s.tools = 1240; s.commits = 34; s.pushes = 12; s.tests = 41; s.reads = 380;
fs.writeFileSync(stateFile, JSON.stringify(s));

// backdate some unlocks so the shelf looks lived-in
const unlockedFile = path.join(STATE, 'unlocked.json');
const u = JSON.parse(fs.readFileSync(unlockedFile, 'utf8'));
const daysAgo = n => Date.now() - n * 864e5;
Object.assign(u, {
  'night-shift': { t: daysAgo(12) }, 'streak-7': { t: daysAgo(3) },
  'millennium': { t: daysAgo(1) }, 'marathon': { t: daysAgo(8) },
  'friday-deploy': { t: daysAgo(6) }, 'watch-your-language': { t: daysAgo(9) },
});
for (const k of Object.keys(u)) if (u[k].t > daysAgo(2)) u[k].t = daysAgo(2 + (k.length % 14));
fs.writeFileSync(unlockedFile, JSON.stringify(u));

const cabinet = run(`node "${T}" --cabinet`);
const wrapped = run(`node "${T}" --wrapped`);

// a toast, as Claude Code shows it mid-session
const toastLine = '🥈 Achievement unlocked — Night Shift: Committing crimes against sleep. (11/32 · /trophy-case)';
const toastHtml = `<span style="color:#8a8a8a">● Bash(npm run build)…  ⎿ done</span>

<span style="color:#d7af5f">⚠ ${esc(toastLine)}</span>

<span style="color:#8a8a8a">✳ Compiling the fix…</span>`;

function windowHtml(title, body) {
  return `
  <section class="term">
    <header><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><em>${esc(title)}</em></header>
    <pre>${body}</pre>
  </section>`;
}

const preview = `<!doctype html>
<html><head><meta charset="utf-8"><title>Trophy Case — preview</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh;
    background: radial-gradient(1100px 700px at 75% -10%, #2b2417 0%, #171310 45%, #0e0c0a 100%);
    font-family: -apple-system, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; align-items: center; padding: 56px 24px 72px; }
  h1 { color: #f0ede8; font-size: 40px; letter-spacing: -0.02em; font-weight: 700; }
  h1 .spark { color: #d7af5f; }
  p.tag { color: #a89c8e; margin: 10px 0 44px; font-size: 17px; }
  .stack { display: flex; flex-direction: column; gap: 26px; width: min(920px, 100%); }
  .term { background: #17140f; border: 1px solid #2e2a20; border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0,0,0,.55); overflow: hidden; }
  .term header { display: flex; align-items: center; gap: 7px; padding: 11px 14px;
    background: #1d1913; border-bottom: 1px solid #2e2a20; }
  .term header em { color: #857a68; font-style: normal; font-size: 12.5px; margin-left: 8px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot.r { background: #ff5f57; } .dot.y { background: #febc2e; } .dot.g { background: #28c840; }
  .term pre { padding: 18px 20px;
    font: 500 14px/1.6 "JetBrains Mono", Menlo, Consolas, monospace; color: #d0d0d0; overflow-x: auto; }
  .foot { color: #6f6657; font-size: 13.5px; margin-top: 46px; }
  .foot code { color: #c0b393; font-family: "JetBrains Mono", Menlo, monospace; }
</style></head>
<body>
  <h1><span class="spark">✦</span> Trophy Case</h1>
  <p class="tag">Steam-style achievements for Claude Code — live toasts, hidden trophies, and a monthly Wrapped.</p>
  <div class="stack">
    ${windowHtml('mid-session — an achievement lands', toastHtml)}
    ${windowHtml('/trophy-case', ansiToHtml(cabinet.trimEnd()))}
    ${windowHtml('/trophy-case wrapped', ansiToHtml(wrapped.trimEnd()))}
  </div>
  <p class="foot">zero dependencies · all local · <code>/plugin install trophy-case</code></p>
</body></html>`;

// ---- cover 1280×640 ----
const shelfExcerpt = cabinet.split('\n').filter(l =>
  /Trophy Case|GOLD|Millennium|Friday Deploy|\?\?\?|SILVER|Night Shift|One Week/.test(l)).slice(0, 9).join('\n');

const cover = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #0e0c0a; overflow: hidden; }
  #cover { position: relative; width: 1280px; height: 640px; overflow: hidden;
    background:
      radial-gradient(900px 520px at 84% 116%, rgba(215,175,95,.17), transparent 60%),
      radial-gradient(700px 400px at -8% -20%, rgba(217,119,87,.10), transparent 55%),
      linear-gradient(160deg, #191510 0%, #110e0b 55%, #0e0c0a 100%);
    font-family: 'Fraunces', Georgia, serif; }
  #cover::before { content: ''; position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(800px 500px at 30% 20%, #000 30%, transparent 75%); }
  .wordmark { position: absolute; top: 88px; left: 96px; }
  .spark { color: #d7af5f; font-size: 54px; vertical-align: 12px; margin-right: 18px;
    font-family: 'JetBrains Mono', monospace; }
  h1 { display: inline; color: #f3ede6; font-size: 92px; font-weight: 600;
    letter-spacing: -0.015em; font-variation-settings: 'opsz' 80; }
  h1 .case { font-family: 'JetBrains Mono', Menlo, monospace; font-weight: 700;
    color: #d7af5f; font-size: 78px; letter-spacing: 0.01em; margin-left: 10px; }
  .tag { position: absolute; top: 214px; left: 100px; width: 900px;
    color: #a89c8e; font-size: 24px; line-height: 1.4; font-weight: 500; }
  .tag b { color: #e8ddd2; font-weight: 600; }
  .for { position: absolute; top: 252px; right: 92px; text-align: right;
    font-family: 'JetBrains Mono', monospace; font-size: 14px; letter-spacing: .14em;
    color: #d7af5f; text-transform: uppercase; }
  .for::before { content: ''; display: inline-block; width: 34px; height: 1px;
    background: #d7af5f; vertical-align: 4px; margin-right: 12px; opacity: .7; }
  .toast { position: absolute; right: 88px; top: 96px; width: 400px;
    background: #1c1812; border: 1px solid #3a3222; border-radius: 12px; padding: 16px 18px;
    font-family: 'JetBrains Mono', Menlo, monospace; font-size: 14px; line-height: 1.6;
    color: #d7af5f; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
  .toast small { color: #857a68; display: block; margin-top: 6px; font-size: 12px; }
  .term { position: absolute; left: 96px; right: 96px; bottom: 64px;
    background: #16130e; border: 1px solid #2e2a20; border-radius: 16px;
    box-shadow: 0 40px 90px rgba(0,0,0,.6), 0 0 0 1px rgba(215,175,95,.06); }
  .term header { display: flex; align-items: center; gap: 8px; padding: 13px 18px;
    border-bottom: 1px solid #26221a; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #2e2a20; }
  .dot:first-child { background: #d7af5f; opacity: .85; }
  .term header em { color: #6f6657; font-style: normal;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; margin-left: 10px; }
  .term pre { padding: 18px 26px 20px; font: 500 15.5px/1.65 'JetBrains Mono', Menlo, monospace; }
</style></head>
<body>
<div id="cover">
  <div class="wordmark"><span class="spark">✦</span><h1>Trophy <span class="case">CASE</span></h1></div>
  <p class="tag">Steam-style achievements for <b>Claude Code</b> — and a monthly Wrapped.</p>
  
  <div class="toast">🥈 Achievement unlocked — Night Shift<small>Committing crimes against sleep.</small></div>
  <section class="term">
    <header><span class="dot"></span><span class="dot"></span><span class="dot"></span><em>/trophy-case</em></header>
    <pre>${ansiToHtml(shelfExcerpt)}</pre>
  </section>
</div>
</body></html>`;

const assets = path.join(HERE, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'preview.html'), preview);
fs.writeFileSync(path.join(assets, 'cover.html'), cover);
console.log('assets written');
