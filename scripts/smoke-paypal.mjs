// Sandbox smoke test: token -> create order -> payout -> payout status.
// Reads keys from .dev.vars; never prints them.
import { readFileSync } from 'node:fs';
import { paypal } from '../src/paypal.js';

let vars;
try { vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'); }
catch { console.error('No .dev.vars found. Copy .dev.vars.example to .dev.vars and fill in sandbox keys.'); process.exit(1); }
const env = Object.fromEntries(
  vars
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'SANDBOX_RECEIVER_EMAIL']) {
  if (!env[k] || env[k].startsWith('<')) { console.error(`Missing ${k} in .dev.vars`); process.exit(1); }
}

const run = Date.now().toString(36);
const step = async (name, fn) => {
  try { const out = await fn(); console.log(`OK   ${name}`, out); return out; }
  catch (e) { console.log(`FAIL ${name}: ${e.message}`); return null; }
};

const order = await step('Orders v2 create', async () => {
  const o = await paypal(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' }, description: 'PatchPay smoke test' }],
  }, `smoke-order-${run}`);
  return { id: o.id, status: o.status };
});

const batch = await step('Payouts v1 create', async () => {
  const p = await paypal(env, 'POST', '/v1/payments/payouts', {
    sender_batch_header: { sender_batch_id: `smoke-${run}`, email_subject: 'PatchPay smoke test' },
    items: [{
      recipient_type: 'EMAIL',
      amount: { value: '1.00', currency: 'USD' },
      receiver: env.SANDBOX_RECEIVER_EMAIL,
      note: 'Sandbox smoke test',
      sender_item_id: `smoke-item-${run}`,
    }],
  });
  return { batch_id: p.batch_header.payout_batch_id, status: p.batch_header.batch_status };
});

if (batch) {
  await new Promise((r) => setTimeout(r, 5000));
  await step('Payouts v1 status (after 5 s)', async () => {
    const s = await paypal(env, 'GET', `/v1/payments/payouts/${batch.batch_id}`);
    return { batch: s.batch_header.batch_status, item: s.items?.[0]?.transaction_status };
  });
}

process.exit(order && batch ? 0 : 1);
