import { triageReport } from './triage.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const LIMITS = { text: 500, screenshot: 300_000, console: 4_000, state: 4_000 };

async function runTriage(env, id) {
  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return null;
  const { results: open } = await env.DB.prepare(
    `SELECT r.id, r.text, t.title FROM reports r LEFT JOIN triage t ON t.report_id = r.id
     WHERE r.id != ? AND t.duplicate_of IS NULL ORDER BY r.created_at DESC LIMIT 20`
  ).bind(id).all();
  const t = env.ANTHROPIC_API_KEY
    ? await triageReport(env, report, open)
    : { flags: ['needs_manual_triage'], reasoning: 'ANTHROPIC_API_KEY is not set.', repro_steps: [], policy_amount: 0, model: null };
  await env.DB.prepare(
    `INSERT OR REPLACE INTO triage (report_id, title, category, severity, repro_steps, duplicate_of, ai_amount, policy_amount, flags, model, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, t.title ?? null, t.category ?? null, t.severity ?? null, JSON.stringify(t.repro_steps), t.duplicate_of ?? null,
    t.ai_amount ?? null, t.policy_amount, JSON.stringify(t.flags), t.model, JSON.stringify({ reasoning: t.reasoning })).run();
  return t;
}

const SUMMARY = `SELECT r.id, r.created_at, r.game, r.text, t.title, t.category, t.severity, t.repro_steps, t.duplicate_of,
  t.ai_amount, t.policy_amount, t.flags, t.model, t.raw_json FROM reports r LEFT JOIN triage t ON t.report_id = r.id`;

function shape(row) {
  if (!row) return row;
  const { raw_json, repro_steps, flags, ...rest } = row;
  const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
  return { ...rest, repro_steps: parse(repro_steps, []), flags: parse(flags, []), reasoning: parse(raw_json, {}).reasoning ?? null,
    triaged: row.model !== undefined && (row.title !== null || parse(flags, []).length > 0) };
}

async function createReport(req, env, ctx) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const text = String(body.text || '').trim();
  const screenshot = body.screenshot ? String(body.screenshot) : null;
  const consoleLog = String(body.console || '').slice(0, LIMITS.console);
  const state = JSON.stringify(body.state ?? null);
  if (!text || text.length > LIMITS.text) return json({ error: `Describe the bug in 1-${LIMITS.text} characters.` }, 400);
  if (screenshot && (!screenshot.startsWith('data:image/jpeg;base64,') || screenshot.length > LIMITS.screenshot))
    return json({ error: 'Screenshot must be a JPEG under 300 KB.' }, 400);
  if (state.length > LIMITS.state) return json({ error: 'Game state too large.' }, 400);

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO reports (id, created_at, game, text, screenshot, console, state_json, reporter_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, Date.now(), String(body.game || 'demo').slice(0, 40), text, screenshot, consoleLog, state, token).run();
  ctx.waitUntil(runTriage(env, id).catch((e) => console.error('triage failed', id, e.message)));
  return json({ id, token }, 201);
}

async function listReports(env) {
  const { results } = await env.DB.prepare(`${SUMMARY} ORDER BY r.created_at DESC LIMIT 100`).all();
  return json({ reports: results.map(shape) });
}

async function getReport(env, id) {
  const row = await env.DB.prepare(`${SUMMARY} WHERE r.id = ?`).bind(id).first();
  if (!row) return json({ error: 'Report not found' }, 404);
  const extra = await env.DB.prepare('SELECT screenshot, console, state_json FROM reports WHERE id = ?').bind(id).first();
  return json({ report: { ...shape(row), ...extra } });
}

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/health') return json({ ok: true, sandbox: true, ai: Boolean(env.ANTHROPIC_API_KEY) });
    if (pathname === '/api/reports' && req.method === 'POST') return createReport(req, env, ctx);
    if (pathname === '/api/reports' && req.method === 'GET') return listReports(env);
    const m = pathname.match(/^\/api\/reports\/([0-9a-f-]{36})(\/triage)?$/);
    if (m && !m[2] && req.method === 'GET') return getReport(env, m[1]);
    if (m && m[2] && req.method === 'POST') {
      // shortcut: unauthenticated re-triage, fine for the sandbox demo; gate behind dev auth before real use.
      const t = await runTriage(env, m[1]);
      return t ? getReport(env, m[1]) : json({ error: 'Report not found' }, 404);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
