// Minimal PayPal REST client (sandbox only). Works in Workers and Node 18+.
const BASE = 'https://api-m.sandbox.paypal.com';
let cached = null;

async function token(env) {
  if (cached && cached.exp > Date.now()) return cached.value;
  const r = await fetch(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal token request failed: HTTP ${r.status}`);
  const j = await r.json();
  cached = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.value;
}

// requestId makes POSTs idempotent on PayPal's side (PayPal-Request-Id).
export async function paypal(env, method, path, body, requestId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Authorization: 'Bearer ' + (await token(env)), 'Content-Type': 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && attempt === 0) { cached = null; continue; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(`PayPal ${method} ${path} -> ${r.status} ${data.name || ''} ${data.message || ''}`.trim());
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }
}
