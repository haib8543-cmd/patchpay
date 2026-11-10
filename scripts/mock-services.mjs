// Local stand-in for the PayPal sandbox and the Anthropic API, used only by the e2e test.
import http from 'node:http';

export function startMock(port) {
  const orders = new Map();
  const captures = new Map(); // PayPal-Request-Id -> response (idempotent retries)
  const payouts = new Map(); // sender_batch_id -> { batch, item }
  let n = 0;

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* oauth body is form-encoded */ }
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const { url, method } = req;
    let m;

    if (url === '/v1/oauth2/token') return send(200, { access_token: 'mock-token', expires_in: 3600 });

    if (url === '/v1/messages') {
      return send(200, { content: [{ type: 'tool_use', name: 'record_triage', input: {
        title: 'Paddle freezes at the right wall', category: 'freeze', severity: 'high',
        repro_steps: ['Enable the demo bug', 'Hold the right arrow'], duplicate_of: null,
        suggested_bounty_usd: 999, flags: [], reasoning: 'Mock triage.',
      } }] });
    }

    if (url === '/v2/checkout/orders' && method === 'POST') {
      const id = `ORDER${++n}`;
      orders.set(id, { value: data.purchase_units[0].amount.value, captured: false });
      return send(201, { id, status: 'CREATED' });
    }
    if ((m = url.match(/^\/v2\/checkout\/orders\/(\w+)\/capture$/))) {
      const rid = req.headers['paypal-request-id'];
      if (captures.has(rid)) return send(201, captures.get(rid));
      const order = orders.get(m[1]);
      if (!order) return send(404, { name: 'RESOURCE_NOT_FOUND', message: 'Order not found' });
      if (order.captured) return send(422, { name: 'UNPROCESSABLE_ENTITY', message: 'ORDER_ALREADY_CAPTURED' });
      order.captured = true;
      const out = { id: m[1], status: 'COMPLETED', purchase_units: [{ payments: { captures: [
        { id: `CAP${m[1]}`, status: 'COMPLETED', amount: { currency_code: 'USD', value: order.value } },
      ] } }] };
      captures.set(rid, out);
      return send(201, out);
    }

    if (url === '/v1/payments/payouts' && method === 'POST') {
      const sb = data.sender_batch_header.sender_batch_id;
      if (payouts.has(sb)) return send(400, { name: 'USER_BUSINESS_ERROR', message: 'Batch with given sender_batch_id already exists' });
      const batch = `BATCH${++n}`;
      payouts.set(sb, { batch, item: data.items[0] });
      return send(201, { batch_header: { payout_batch_id: batch, batch_status: 'PENDING' } });
    }
    if ((m = url.match(/^\/v1\/payments\/payouts\/(\w+)$/)) && method === 'GET') {
      return send(200, { batch_header: { payout_batch_id: m[1], batch_status: 'SUCCESS' },
        items: [{ payout_item_id: `ITEM-${m[1]}`, transaction_status: 'SUCCESS' }] });
    }

    if (url === '/v1/notifications/verify-webhook-signature') {
      return send(200, { verification_status: data.transmission_sig === 'valid' ? 'SUCCESS' : 'FAILURE' });
    }

    if (url === '/__state') return send(200, { payouts: [...payouts.values()].map((p) => p.item) });
    return send(404, { name: 'NOT_FOUND', message: `${method} ${url}` });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
