const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const LIMITS = { text: 500, screenshot: 300_000, console: 4_000, state: 4_000 };

async function createReport(req, env) {
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
  return json({ id, token }, 201);
}

async function listReports(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, game, text FROM reports ORDER BY created_at DESC LIMIT 100'
  ).all();
  return json({ reports: results });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/health') return json({ ok: true, sandbox: true });
    if (pathname === '/api/reports' && req.method === 'POST') return createReport(req, env);
    if (pathname === '/api/reports' && req.method === 'GET') return listReports(env);
    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
