#!/usr/bin/env node
/*
 * Trophy Case — Steam-style achievements for Claude Code, plus a monthly
 * "Wrapped" with your coding archetype.
 *
 * Runs as a Claude Code hook: counts what actually happens in your sessions
 * (tools, commits, tests, night shifts, permission denials, compactions…),
 * unlocks achievements, and toasts them in the UI via `systemMessage`.
 *
 * Zero dependencies. Node >= 16. State lives in ~/.claude/trophy-case/.
 *
 * Modes:
 *   --hook <Event>     (internal) consume a hook event from stdin
 *   --cabinet          the trophy shelf, prettiest in a dark terminal
 *   --wrapped [YYYY-MM] month recap + archetype
 *   --json             machine-readable state snapshot
 *   --toast-test       fake unlock, to see what a toast looks like
 *   --install          wire hooks into ~/.claude/settings.json (standalone)
 *   --uninstall        remove them
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.TROPHY_CASE_DIR || path.join(os.homedir(), '.claude', 'trophy-case');
const STATE_FILE = path.join(DIR, 'state.json');
const UNLOCKED_FILE = path.join(DIR, 'unlocked.json');
const TOKEN_HUD_DAYS = path.join(os.homedir(), '.claude', 'token-hud', 'days');

// ----------------------------------------------------------------- utils ---
function readJSON(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function writeJSON(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o));
  fs.renameSync(tmp, f);
}
function localDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const NOW = () => Date.now();

// ----------------------------------------------------------------- color ---
const PAL = {
  faint: 238, dim: 245, text: 252, bright: 255, brand: 173,
  bronze: 137, silver: 251, gold: 179, plat: 117, ok: 114, danger: 174, empty: 237,
};
function paint(name, s, bold) {
  return `\x1b[38;5;${PAL[name] || 252}m` + (bold ? '\x1b[1m' : '') + s + '\x1b[0m';
}

// ----------------------------------------------------------------- state ---
function blankDay() { return { t: 0, p: 0, c: 0, push: 0, tests: 0, add: 0, del: 0, n: 0, e: 0, proj: [], fails: 0 }; }

function loadState() {
  const s = readJSON(STATE_FILE, {});
  s.tools = s.tools || 0; s.prompts = s.prompts || 0; s.sessions = s.sessions || 0;
  s.commits = s.commits || 0; s.pushes = s.pushes || 0; s.tests = s.tests || 0;
  s.reads = s.reads || 0; s.edits = s.edits || 0; s.subagents = s.subagents || 0;
  s.denials = s.denials || 0; s.compactions = s.compactions || 0; s.fails = s.fails || 0;
  s.polite = s.polite || 0; s.swears = s.swears || 0; s.tiny = s.tiny || 0; s.long = s.long || 0;
  s.langs = s.langs || {}; s.days = s.days || {}; s.sess = s.sess || {};
  s.streak = s.streak || { cur: 0, best: 0, last: '' };
  s.firstSeen = s.firstSeen || NOW();
  s.failTimes = s.failTimes || [];
  return s;
}

function day(s) {
  const d = localDate();
  if (!s.days[d]) s.days[d] = blankDay();
  return s.days[d];
}

function sess(s, sid) {
  sid = sid || 'unknown';
  if (!s.sess[sid]) s.sess[sid] = { start: NOW(), tools: 0, sub: 0, comp: 0, commits: 0 };
  return s.sess[sid];
}

function markDayStreak(s) {
  const today = localDate();
  if (s.streak.last === today) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  s.streak.cur = (s.streak.last === localDate(y)) ? s.streak.cur + 1 : 1;
  s.streak.last = today;
  if (s.streak.cur > s.streak.best) s.streak.best = s.streak.cur;
}

function pruneState(s) {
  // keep sessions 48h, days 400d, fail timestamps 15min
  const cut = NOW() - 48 * 3600e3;
  for (const [k, v] of Object.entries(s.sess)) if ((v.start || 0) < cut) delete s.sess[k];
  const keys = Object.keys(s.days).sort();
  while (keys.length > 400) delete s.days[keys.shift()];
  s.failTimes = s.failTimes.filter(t => t > NOW() - 15 * 60e3);
}

function tokenHudToday() {
  // synergy: if Token HUD is installed, read today's spend (USD)
  try {
    const dir = path.join(TOKEN_HUD_DAYS, localDate());
    let cost = 0;
    for (const f of fs.readdirSync(dir)) {
      const j = readJSON(path.join(dir, f), null);
      if (j && j.abs) cost += Math.max(0, (j.abs.cost || 0) - ((j.base && j.base.cost) || 0));
    }
    return cost;
  } catch { return null; }
}

// ---------------------------------------------------------- achievements ---
/*
 * pred(s, ev) — s: state (already updated for this event), ev: {event, input, hour, ...}
 * Tiers: bronze | silver | gold | plat.  Hidden ones show as ??? until unlocked.
 */
const LANG_NAMES = { js: 'JS', ts: 'TS', tsx: 'TSX', jsx: 'JSX', py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', c: 'C', h: 'C', cpp: 'C++', cs: 'C#', php: 'PHP', swift: 'Swift', sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL', html: 'HTML', css: 'CSS', scss: 'CSS', md: 'Markdown', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', vue: 'Vue', svelte: 'Svelte', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', lua: 'Lua', r: 'R', jl: 'Julia', zig: 'Zig', dart: 'Dart', scala: 'Scala', clj: 'Clojure', ml: 'OCaml', nim: 'Nim' };

const ACH = [
  // --- bronze: first steps ---
  { id: 'first-contact', tier: 'bronze', name: 'First Contact', how: 'send your first prompt',
    flavor: 'You said hello. It computed.', pred: s => s.prompts >= 1 },
  { id: 'first-blood', tier: 'bronze', name: 'First Blood', how: 'first tool call',
    flavor: 'The machine touched your filesystem. Nothing was ever the same.', pred: s => s.tools >= 1 },
  { id: 'ship-it', tier: 'bronze', name: 'Ship It', how: 'first git commit together',
    flavor: 'Co-authored-by: destiny.', pred: s => s.commits >= 1 },
  { id: 'centurion', tier: 'bronze', name: 'Centurion', how: '100 tool calls',
    flavor: 'A hundred small favors.', pred: s => s.tools >= 100 },
  { id: 'bookworm', tier: 'bronze', name: 'Bookworm', how: '500 files read',
    flavor: 'It has read more of your code than you have.', pred: s => s.reads >= 500 },
  { id: 'polyglot', tier: 'bronze', name: 'Polyglot', how: 'edit files in 5 languages',
    flavor: 'Fluent in everything, opinionated in nothing.', pred: s => Object.keys(s.langs).length >= 5 },

  // --- silver: habits form ---
  { id: 'night-shift', tier: 'silver', name: 'Night Shift', how: 'work between 02:00 and 05:00',
    flavor: 'Committing crimes against sleep.', pred: (s, ev) => ev.hour >= 2 && ev.hour < 5 },
  { id: 'dawn-patrol', tier: 'silver', name: 'Dawn Patrol', how: 'work before 07:00',
    flavor: 'The bugs never saw it coming.', pred: (s, ev) => ev.hour >= 5 && ev.hour < 7 },
  { id: 'streak-7', tier: 'silver', name: 'One Week Wonder', how: '7-day streak',
    flavor: 'Seven days. It is starting to recognize your typos.', pred: s => s.streak.cur >= 7 },
  { id: 'marathon', tier: 'silver', name: 'Marathon', how: 'a 4-hour session',
    flavor: 'Hydration is a tool you have not called in a while.',
    pred: (s, ev) => { const x = s.sess[ev.sid]; return x && x.tools >= 40 && NOW() - x.start > 4 * 3600e3; } },
  { id: 'test-believer', tier: 'silver', name: 'Test Believer', how: 'run tests 25 times',
    flavor: 'Red, green, refactor, repeat.', pred: s => s.tests >= 25 },
  { id: 'net-negative', tier: 'silver', name: 'Net Negative', how: 'delete 200+ more lines than you add in a day',
    flavor: 'The best code is the code that is gone.', pred: s => { const d = day(s); return d.del - d.add >= 200; } },
  { id: 'speedrun', tier: 'silver', name: 'Speedrun', how: 'commit within 5 minutes of session start',
    flavor: 'Any%. No warmup. Straight to prod.',
    pred: (s, ev) => { const x = s.sess[ev.sid]; return x && x.real && x.commits >= 1 && NOW() - x.start < 5 * 60e3; } },
  { id: 'multiverse', tier: 'silver', name: 'Multiverse', how: 'work in 3 projects in one day',
    flavor: 'Same you, three timelines.', pred: s => day(s).proj.length >= 3 },
  { id: 'sorcerer', tier: 'silver', name: "Sorcerer's Apprentice", how: 'spawn 5 subagents in one session',
    flavor: 'The brooms are carrying water. What could go wrong.',
    pred: (s, ev) => { const x = s.sess[ev.sid]; return x && x.sub >= 5; } },

  // --- gold: dedication ---
  { id: 'streak-30', tier: 'gold', name: 'The Regular', how: '30-day streak',
    flavor: 'At this point it should pay rent in your terminal.', pred: s => s.streak.cur >= 30 },
  { id: 'millennium', tier: 'gold', name: 'Millennium', how: '1,000 tool calls',
    flavor: 'A thousand hands, one keyboard.', pred: s => s.tools >= 1000 },
  { id: 'novelist', tier: 'gold', name: 'The Novelist', how: 'write a 2,000-character prompt',
    flavor: 'Chapter one: the requirements. Chapter two: the real requirements.',
    pred: (s, ev) => ev.promptLen >= 2000 },
  { id: 'shipping-season', tier: 'gold', name: 'Shipping Season', how: '10 commits in one day',
    flavor: 'The changelog fears you.', pred: s => day(s).c >= 10 },
  { id: 'deep-focus', tier: 'gold', name: 'Deep Focus', how: '150 tool calls in one session',
    flavor: 'One session. One hundred and fifty moves. Checkmate.',
    pred: (s, ev) => { const x = s.sess[ev.sid]; return x && x.tools >= 150; } },
  { id: 'token-furnace', tier: 'gold', name: 'Token Furnace', how: 'burn $25 in a day (needs Token HUD)',
    flavor: 'Somewhere, a GPU is warm because of you.',
    pred: () => { const c = tokenHudToday(); return c != null && c >= 25; } },

  // --- hidden: found, not sought ---
  { id: 'yolo', tier: 'gold', hidden: true, name: 'YOLO', how: 'run in bypass-permissions mode',
    flavor: 'Permissions are for the weak. Godspeed.', pred: (s, ev) => ev.permissionMode === 'bypassPermissions' },
  { id: 'friday-deploy', tier: 'gold', hidden: true, name: 'Friday Deploy', how: 'git push on Friday evening',
    flavor: 'What could possibly go wrong?', pred: (s, ev) => ev.isPush && ev.dow === 5 && ev.hour >= 18 },
  { id: 'courtesy', tier: 'silver', hidden: true, name: 'Please & Thank You', how: 'be polite 10 times',
    flavor: 'Manners maketh the prompt.', pred: s => s.polite >= 10 },
  { id: 'watch-your-language', tier: 'silver', hidden: true, name: 'Watch Your Language', how: 'well… you know what you said',
    flavor: 'It forgives you. It also remembers.', pred: s => s.swears >= 3 },
  { id: 'minimalist', tier: 'silver', hidden: true, name: 'The Minimalist', how: '15 one-word prompts',
    flavor: 'да. ok. go. fix. Poetry.', pred: s => s.tiny >= 15 },
  { id: 'trust-issues', tier: 'silver', hidden: true, name: 'Trust Issues', how: 'deny 25 permission requests',
    flavor: 'It only wanted to run one little script.', pred: s => s.denials >= 25 },
  { id: 'rage', tier: 'silver', hidden: true, name: 'Rage Against the Machine', how: '5 tool failures in 10 minutes',
    flavor: 'Breathe. The stack trace cannot hurt you now.', pred: s => s.failTimes.length >= 5 },
  { id: 'trash-compactor', tier: 'silver', hidden: true, name: 'Trash Compactor', how: '3 compactions in one session',
    flavor: 'Context is a suggestion.', pred: (s, ev) => { const x = s.sess[ev.sid]; return x && x.comp >= 3; } },
  { id: 'archaeologist', tier: 'gold', hidden: true, name: 'Archaeologist', how: 'open a file untouched for 3 years',
    flavor: 'It belongs in a museum.', pred: (s, ev) => ev.oldFile === true },

  // --- meta ---
  { id: 'collector', tier: 'gold', name: 'Trophy Hunter', how: 'unlock 10 achievements',
    flavor: 'You are not here for the code anymore, are you.', meta: true, pred: (s, ev) => ev.unlockedCount >= 10 },
  { id: 'completionist', tier: 'plat', name: 'The Completionist', how: 'unlock every visible achievement',
    flavor: 'There is nothing left to prove. There never was.', meta: true,
    pred: (s, ev) => ACH.filter(a => !a.hidden && !a.meta).every(a => ev.unlockedIds.has(a.id)) },
];

// ------------------------------------------------------------ event intake -
const TEST_RE = /\b(pytest|jest|vitest|go test|cargo test|npm (run )?test|npx (jest|vitest|playwright)|make test|rspec|phpunit|bun test|mix test|ctest)\b/;
const POLITE_RE = /\b(please|thanks|thank you|спасибо|пожалуйста|merci|mulțumesc|mersi)\b/i;
const SWEAR_RE = /(\bfuck|\bshit\b|\bdammit|блять|бля\b|сука\b|нахуй|хуйн|пиздец)/i;

function countLines(str) { return str ? String(str).split('\n').length : 0; }

function applyEvent(s, event, input) {
  const ev = {
    event, input, sid: input.session_id, hour: new Date().getHours(), dow: new Date().getDay(),
    promptLen: 0, isPush: false, oldFile: false,
    permissionMode: input.permission_mode || (input.tool_input && input.tool_input.permission_mode),
  };
  const d = day(s);
  const x = sess(s, ev.sid);
  markDayStreak(s);
  if (ev.hour >= 2 && ev.hour < 5) d.n = 1;
  if (ev.hour >= 5 && ev.hour < 7) d.e = 1;
  const proj = (input.cwd || '').split(path.sep).slice(-1)[0];
  if (proj && !d.proj.includes(proj)) d.proj.push(proj);

  if (event === 'SessionStart') { s.sessions += 1; x.start = NOW(); x.real = true; }
  if (event === 'UserPromptSubmit') {
    s.prompts += 1; d.p += 1;
    const p = String(input.prompt || '');
    ev.promptLen = p.length;
    if (p.length >= 2000) s.long += 1;
    if (p.trim().length > 0 && p.trim().length <= 4 && !p.includes(' ')) s.tiny += 1;
    if (POLITE_RE.test(p)) s.polite += 1;
    if (SWEAR_RE.test(p)) s.swears += 1;
  }
  if (event === 'PostToolUse') {
    s.tools += 1; d.t += 1; x.tools += 1;
    const tn = input.tool_name || '';
    const ti = input.tool_input || {};
    if (tn === 'Read') {
      s.reads += 1;
      try {
        const st = fs.statSync(ti.file_path);
        if (NOW() - st.mtimeMs > 3 * 365 * 864e5) ev.oldFile = true;
      } catch { /* gone already */ }
    }
    if (tn === 'Edit' || tn === 'Write' || tn === 'NotebookEdit') {
      s.edits += 1;
      const ext = (path.extname(ti.file_path || '').slice(1) || '').toLowerCase();
      if (LANG_NAMES[ext]) s.langs[LANG_NAMES[ext]] = (s.langs[LANG_NAMES[ext]] || 0) + 1;
      const add = countLines(ti.new_string || ti.content);
      const del = tn === 'Write' ? 0 : countLines(ti.old_string);
      d.add += add; d.del += del;
    }
    if (tn === 'Bash') {
      const cmd = String(ti.command || '');
      if (/\bgit\b[^&|;]*\bcommit\b/.test(cmd)) { s.commits += 1; d.c += 1; x.commits += 1; }
      if (/\bgit\b[^&|;]*\bpush\b/.test(cmd)) { s.pushes += 1; d.push += 1; ev.isPush = true; }
      if (TEST_RE.test(cmd)) { s.tests += 1; d.tests += 1; }
    }
  }
  if (event === 'PostToolUseFailure') { s.fails += 1; d.fails += 1; s.failTimes.push(NOW()); }
  if (event === 'SubagentStart') { s.subagents += 1; x.sub += 1; }
  if (event === 'PermissionDenied') { s.denials += 1; }
  if (event === 'PreCompact') { s.compactions += 1; x.comp += 1; }
  return ev;
}

// ------------------------------------------------------------- unlocking ---
function evaluate(s, ev) {
  const unlocked = readJSON(UNLOCKED_FILE, {});
  const ids = new Set(Object.keys(unlocked));
  const fresh = [];
  const ctx = { ...ev, unlockedCount: ids.size, unlockedIds: ids };
  for (const a of ACH) {
    if (ids.has(a.id) || a.meta) continue;
    let hit = false;
    try { hit = !!a.pred(s, ctx); } catch { /* predicate never crashes the hook */ }
    if (hit) { unlocked[a.id] = { t: NOW() }; ids.add(a.id); fresh.push(a); }
  }
  // meta achievements see the updated set
  ctx.unlockedCount = ids.size; ctx.unlockedIds = ids;
  for (const a of ACH) {
    if (!a.meta || ids.has(a.id)) continue;
    let hit = false;
    try { hit = !!a.pred(s, ctx); } catch { /* ditto */ }
    if (hit) { unlocked[a.id] = { t: NOW() }; ids.add(a.id); fresh.push(a); }
  }
  if (fresh.length) writeJSON(UNLOCKED_FILE, unlocked);
  return fresh;
}

const TIER_ICON = { bronze: '🥉', silver: '🥈', gold: '🥇', plat: '🏆' };

function toast(fresh) {
  const total = ACH.length;
  const count = Object.keys(readJSON(UNLOCKED_FILE, {})).length;
  const lines = fresh.map(a =>
    `${TIER_ICON[a.tier]} Achievement unlocked — ${a.name}: ${a.flavor} (${count}/${total} · /trophy-case)`);
  return { systemMessage: lines.join('\n'), suppressOutput: true };
}

function runHook(event) {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* still count what we can */ }
  const s = loadState();
  const ev = applyEvent(s, event, input);
  const fresh = evaluate(s, ev);
  pruneState(s);
  writeJSON(STATE_FILE, s);
  if (fresh.length) process.stdout.write(JSON.stringify(toast(fresh)) + '\n');
}

// ---------------------------------------------------------------- cabinet --
function bar(frac, w, color) {
  frac = Math.max(0, Math.min(1, frac));
  const full = Math.round(frac * w);
  return paint(color, '█'.repeat(full)) + paint('empty', '░'.repeat(w - full));
}

function progressFor(a, s) {
  // best-effort progress fractions for locked visible achievements
  const P = {
    'centurion': s.tools / 100, 'millennium': s.tools / 1000, 'bookworm': s.reads / 500,
    'polyglot': Object.keys(s.langs).length / 5, 'test-believer': s.tests / 25,
    'streak-7': s.streak.cur / 7, 'streak-30': s.streak.cur / 30,
    'shipping-season': day(s).c / 10,
  };
  return P[a.id] != null ? Math.min(1, P[a.id]) : null;
}

function cabinet() {
  const s = loadState();
  const unlocked = readJSON(UNLOCKED_FILE, {});
  const n = Object.keys(unlocked).length;
  const out = [];
  const rule = paint('faint', '─'.repeat(56));
  out.push('');
  out.push(' ' + paint('brand', '✦', true) + ' ' + paint('bright', 'Trophy Case', true) +
    paint('dim', `  ${n} / ${ACH.length} unlocked`));
  out.push(' ' + rule);
  const tiers = [['plat', 'PLATINUM'], ['gold', 'GOLD'], ['silver', 'SILVER'], ['bronze', 'BRONZE']];
  for (const [tier, label] of tiers) {
    const rows = ACH.filter(a => a.tier === tier);
    if (!rows.length) continue;
    out.push(' ' + paint(tier, label.padEnd(9), true));
    for (const a of rows) {
      const u = unlocked[a.id];
      const W = 26;
      if (u) {
        const when = new Date(u.t).toDateString().slice(4, 10);
        out.push('   ' + paint(tier, '●') + ' ' + paint('bright', a.name.padEnd(W), true) +
          paint('dim', a.flavor.length > 42 ? a.flavor.slice(0, 41) + '…' : a.flavor) +
          paint('faint', '  ' + when));
      } else if (a.hidden) {
        out.push('   ' + paint('faint', '◌ ' + '???'.padEnd(W) + 'keep playing — it will find you'));
      } else {
        const frac = progressFor(a, s);
        const tail = frac != null && frac > 0
          ? bar(frac, 10, 'dim') + paint('faint', ' ' + Math.round(frac * 100) + '%')
          : paint('faint', a.how);
        out.push('   ' + paint('faint', '○ ') + paint('dim', a.name.padEnd(W)) + tail);
      }
    }
  }
  out.push(' ' + rule);
  out.push(' ' + paint('faint', `streak ${s.streak.cur}d (best ${s.streak.best}) · ${s.tools} tool calls · ${s.commits} commit${s.commits === 1 ? '' : 's'} · /trophy-case wrapped`));
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------- wrapped --
const ARCHETYPES = [
  { id: 'night-surgeon', name: 'The Night Surgeon', line: 'Precision work while the city sleeps.',
    score: m => m.nightDays * 3 },
  { id: 'dawn-patrol', name: 'The Dawn Patrol', line: 'First light, first commit.',
    score: m => m.earlyDays * 3 },
  { id: 'shipmaster', name: 'The Shipmaster', line: 'Cargo leaves the port daily.',
    score: m => m.commits * 1.5 },
  { id: 'test-whisperer', name: 'The Test Whisperer', line: 'Nothing merges until the suite sings.',
    score: m => m.tests * 2 },
  { id: 'demolitionist', name: 'The Demolitionist', line: 'Deletes more than they add. The codebase thanks them.',
    score: m => m.del > m.add ? 40 + (m.del - m.add) / 100 : 0 },
  { id: 'machine', name: 'The Machine', line: 'Every. Single. Day.',
    score: m => m.activeDays * 2.2 },
  { id: 'explorer', name: 'The Explorer', line: 'No repo is safe from curiosity.',
    score: m => m.projects * 4 },
  { id: 'marathon-monk', name: 'The Marathon Monk', line: 'One prompt, four hours, total silence.',
    score: m => m.toolsPerDay > 80 ? 45 : m.toolsPerDay / 2 },
];

function monthMetrics(s, ym) {
  const m = { activeDays: 0, tools: 0, prompts: 0, commits: 0, pushes: 0, tests: 0, add: 0, del: 0,
    nightDays: 0, earlyDays: 0, projects: 0, busiest: ['—', 0], toolsPerDay: 0 };
  const projSet = new Set();
  for (const [d, v] of Object.entries(s.days)) {
    if (!d.startsWith(ym)) continue;
    m.activeDays += 1; m.tools += v.t; m.prompts += v.p; m.commits += v.c; m.pushes += v.push || 0;
    m.tests += v.tests; m.add += v.add; m.del += v.del;
    if (v.n) m.nightDays += 1;
    if (v.e) m.earlyDays += 1;
    (v.proj || []).forEach(p => projSet.add(p));
    if (v.t > m.busiest[1]) m.busiest = [d, v.t];
  }
  m.projects = projSet.size;
  m.toolsPerDay = m.activeDays ? m.tools / m.activeDays : 0;
  return m;
}

function wrapped(ym) {
  ym = ym || localDate().slice(0, 7);
  const s = loadState();
  const m = monthMetrics(s, ym);
  const unlocked = readJSON(UNLOCKED_FILE, {});
  const monthUnlocks = ACH.filter(a => unlocked[a.id] &&
    new Date(unlocked[a.id].t).toISOString().slice(0, 7) === ym);
  const arch = ARCHETYPES.map(a => [a, a.score(m)]).sort((x, y) => y[1] - x[1])[0];
  const monthName = new Date(ym + '-15T00:00:00').toLocaleString('en', { month: 'long', year: 'numeric' });
  const rule = paint('faint', '─'.repeat(52));
  const label = t => paint('dim', t.padEnd(11));
  const out = [];
  out.push('');
  out.push(' ' + paint('brand', '✦', true) + ' ' + paint('bright', 'Claude Code Wrapped', true) + paint('dim', '  ·  ' + monthName));
  out.push(' ' + rule);
  if (!m.activeDays) {
    out.push(' ' + paint('dim', 'No activity recorded this month (yet).'));
  } else {
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : (w.endsWith('sh') ? 'es' : 's')}`;
    out.push(' ' + label('you two') + paint('bright', pl(m.activeDays, 'day') + ' together', true) +
      paint('dim', ` · ${pl(m.prompts, 'prompt')} · ${m.tools} tool calls`));
    out.push(' ' + label('shipped') + paint('text', `${pl(m.commits, 'commit')}, ${pl(m.pushes, 'push')}`) +
      paint('dim', ` · +${m.add} / −${m.del} lines`));
    if (m.tests) out.push(' ' + label('tests') + paint('text', `${m.tests} runs`));
    out.push(' ' + label('worlds') + paint('text', `${m.projects} project${m.projects === 1 ? '' : 's'}`) +
      paint('dim', ` · busiest day ${m.busiest[0].slice(8)}.${m.busiest[0].slice(5, 7)} (${m.busiest[1]} calls)`));
    if (m.nightDays) out.push(' ' + label('after dark') + paint('text', `${m.nightDays} night${m.nightDays === 1 ? '' : 's'} past 2am`));
    const cost = tokenHudTotalMonth(ym);
    if (cost != null) out.push(' ' + label('burned') + paint('text', '$' + cost.toFixed(2) + ' in tokens') + paint('faint', '  (via Token HUD)'));
    out.push(' ' + rule);
    out.push(' ' + label('archetype') + paint('brand', arch[0].name, true));
    out.push(' ' + label('') + paint('dim', arch[0].line));
  }
  if (monthUnlocks.length) {
    out.push(' ' + rule);
    out.push(' ' + label('unlocked') + monthUnlocks.slice(0, 5).map(a => TIER_ICON[a.tier] + ' ' + paint('text', a.name)).join(paint('faint', ' · ')));
  }
  out.push(' ' + rule);
  out.push(' ' + paint('faint', ' share a screenshot · github.com/Dumys/trophy-case'));
  out.push('');
  return out.join('\n');
}

function tokenHudTotalMonth(ym) {
  try {
    let cost = 0, found = false;
    for (const d of fs.readdirSync(TOKEN_HUD_DAYS)) {
      if (!d.startsWith(ym)) continue;
      for (const f of fs.readdirSync(path.join(TOKEN_HUD_DAYS, d))) {
        const j = readJSON(path.join(TOKEN_HUD_DAYS, d, f), null);
        if (j && j.abs) { cost += Math.max(0, (j.abs.cost || 0) - ((j.base && j.base.cost) || 0)); found = true; }
      }
    }
    return found ? cost : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- install --
const HOOK_EVENTS = ['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SessionStart', 'SubagentStart', 'PermissionDenied', 'PreCompact'];

function hookEntries(self) {
  const o = {};
  for (const e of HOOK_EVENTS) {
    o[e] = [{ hooks: [{ type: 'command', command: `node "${self}" --hook ${e}`, timeout: 15 }] }];
  }
  return o;
}

function settingsPath() { return path.join(os.homedir(), '.claude', 'settings.json'); }

function install() {
  const sp = settingsPath();
  const settings = readJSON(sp, {});
  const self = fs.realpathSync(__filename);
  settings.hooks = settings.hooks || {};
  const mine = hookEntries(self);
  for (const [e, entries] of Object.entries(mine)) {
    const existing = (settings.hooks[e] || []).filter(x =>
      !JSON.stringify(x).includes('trophy.js'));
    settings.hooks[e] = existing.concat(entries);
  }
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
  fs.mkdirSync(DIR, { recursive: true });
  console.log(paint('ok', '✓', true) + ' Trophy Case hooks installed for ' + HOOK_EVENTS.length + ' events');
  console.log(paint('dim', '  new sessions start earning immediately · try: node "' + self + '" --cabinet'));
}

function uninstall() {
  const sp = settingsPath();
  const settings = readJSON(sp, {});
  if (settings.hooks) {
    for (const e of Object.keys(settings.hooks)) {
      settings.hooks[e] = settings.hooks[e].filter(x => !JSON.stringify(x).includes('trophy.js'));
      if (!settings.hooks[e].length) delete settings.hooks[e];
    }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n');
  console.log('✓ Trophy Case hooks removed (trophies kept in ' + DIR + ')');
}

// ------------------------------------------------------------------- main --
function main() {
  const [, , mode, a] = process.argv;
  if (mode === '--hook') { try { runHook(a); } catch { /* hooks must never break the session */ } return; }
  if (mode === '--cabinet' || !mode) return console.log(cabinet());
  if (mode === '--wrapped') return console.log(wrapped(a));
  if (mode === '--json') {
    const s = loadState();
    return console.log(JSON.stringify({ state: s, unlocked: readJSON(UNLOCKED_FILE, {}), total: ACH.length }, null, 2));
  }
  if (mode === '--toast-test') {
    return console.log(JSON.stringify(toast([ACH.find(x => x.id === 'night-shift')]), null, 2));
  }
  if (mode === '--install') return install();
  if (mode === '--uninstall') return uninstall();
  console.log('Trophy Case — achievements for Claude Code\n' +
    'usage: trophy.js [--cabinet | --wrapped [YYYY-MM] | --json | --install | --uninstall]');
}

main();
