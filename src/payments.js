// Money flows: fund the pool (Orders v2), pay bounties (Payouts v1), confirm via webhooks.
import { isSet, json } from './http.js';
import { paypal } from './paypal.js';
import { capAmount, DAILY_CAP_USD } from './policy.js';

// PayPal payout item states where the money came back to the sender.
const RETURNED = ['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED', 'CANCELED'];
const NOT_PAID = [...RETURNED, 'SEND_FAILED'];
const INELIGIBLE = ['prompt_injection', 'spam', 'not_a_bug', 'needs_manual_triage'];
const round = (n) => Math.round(n * 100) / 100;

export const paypalReady = (env) => isSet(env.PAYPAL_CLIENT_ID) && isSet(env.PAYPAL_CLIENT_SECRET);
const notConfigured = () => json({ error: 'PayPal sandbox keys are not configured on the server.' }, 503);

export async function poolSummary(env) {
  const ledger = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE kind WHEN 'payout' THEN -amount ELSE amount END), 0) AS balance FROM pool_ledger`
  ).first();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const today = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE created_at >= ? AND status NOT IN (${NOT_PAID.map(() => '?').join(',')})`
  ).bind(start.getTime(), ...NOT_PAID).first();
  return { balance: round(ledger.balance), paidToday: round(today.total), dailyCap: DAILY_CAP_USD };
}

const payoutRow = (env, id) => env.DB.prepare('SELECT * FROM payouts WHERE report_id = ?').bind(id).first();

export async function approvePayout(env, id) {
  if (!paypalReady(env)) return notConfigured();
  const r = await env.DB.prepare(
    `SELECT r.id, r.receiver_email, t.policy_amount, t.flags, t.duplicate_of
     FROM reports r JOIN triage t ON t.report_id = r.id WHERE r.id = ?`
  ).bind(id).first();
  if (!r) return json({ error: 'This report has not been triaged yet.' }, 409);
  const flags = JSON.parse(r.flags || '[]');
  if (r.duplicate_of || flags.some((f) => INELIGIBLE.includes(f)) || !(r.policy_amount > 0)) {
    return json({ error: 'This report is not eligible for a bounty.' }, 409);
  }
  if (!r.receiver_email) return json({ error: 'The reporter has not added a PayPal email yet.' }, 409);

  const existing = await payoutRow(env, id);
  if (existing && existing.status !== 'SEND_FAILED') return json({ payout: existing }); // already approved: never pay twice

  const amount = r.policy_amount;
  const { balance, paidToday } = await poolSummary(env);
  if (capAmount(amount, paidToday) < amount) return json({ error: `Daily bounty cap of $${DAILY_CAP_USD} reached.` }, 409);
  // shortcut: balance check and claim are not one transaction; two different reports approved at the same
  // instant could overdraw the demo pool. Fine for the sandbox; use a Durable Object or SQL guard for real money.
  if (balance < amount) return json({ error: 'The bounty pool is too low. Fund it first.' }, 409);

  // Claim the payout slot before calling PayPal. The primary key stops a second click.
  const now = Date.now();
  const claim = existing
    ? await env.DB.prepare(`UPDATE payouts SET status = 'SENDING', error = NULL, updated_at = ? WHERE report_id = ? AND status = 'SEND_FAILED'`).bind(now, id).run()
    : await env.DB.prepare(`INSERT OR IGNORE INTO payouts (report_id, amount, status, created_at, updated_at) VALUES (?, ?, 'SENDING', ?, ?)`).bind(id, amount, now, now).run();
  if (claim.meta.changes !== 1) return json({ payout: await payoutRow(env, id) });

  try {
    const p = await paypal(env, 'POST', '/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: `patchpay-${id}`,
        email_subject: 'You earned a PatchPay bug bounty',
        email_message: 'Thanks for reporting a bug. Your bounty is attached.',
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: amount.toFixed(2), currency: 'USD' },
        receiver: r.receiver_email,
        note: `Bug bounty for report #${id.slice(0, 8)}`,
        sender_item_id: id,
      }],
    });
    const batchId = p.batch_header.payout_batch_id;
    await env.DB.batch([
      env.DB.prepare('UPDATE payouts SET batch_id = ?, status = ?, updated_at = ? WHERE report_id = ?').bind(batchId, p.batch_header.batch_status, Date.now(), id),
      env.DB.prepare(`INSERT OR IGNORE INTO pool_ledger (kind, amount, paypal_ref, created_at) VALUES ('payout', ?, ?, ?)`).bind(amount, `payout:${batchId}`, Date.now()),
    ]);
  } catch (e) {
    if (e.status && e.status < 500) {
      // PayPal rejected the request, so no batch exists and a retry is safe.
      await env.DB.prepare(`UPDATE payouts SET status = 'SEND_FAILED', error = ?, updated_at = ? WHERE report_id = ?`).bind(e.message, Date.now(), id).run();
      return json({ error: `PayPal rejected the payout: ${e.message}` }, 502);
    }
    // Unknown outcome (timeout or 5xx): stay in SENDING so nobody retries into a double payment.
    await env.DB.prepare('UPDATE payouts SET error = ?, updated_at = ? WHERE report_id = ?').bind(e.message, Date.now(), id).run();
    return json({ error: 'PayPal did not confirm the payout. Check the sandbox account before doing anything else.' }, 502);
  }
  return json({ payout: await payoutRow(env, id) });
}

async function applyItemStatus(env, id, itemId, status) {
  const row = await payoutRow(env, id);
  if (!row || !status) return;
  const stmts = [env.DB.prepare('UPDATE payouts SET status = ?, item_id = COALESCE(?, item_id), updated_at = ? WHERE report_id = ?').bind(status, itemId ?? null, Date.now(), id)];
  if (RETURNED.includes(status)) {
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO pool_ledger (kind, amount, paypal_ref, created_at) VALUES ('refund', ?, ?, ?)`).bind(row.amount, `refund:${id}`, Date.now()));
  }
  await env.DB.batch(stmts);
}

// Polling fallback for when a webhook is late or missing.
export async function refreshPayout(env, id) {
  const row = await payoutRow(env, id);
  if (!row) return json({ error: 'No payout for this report.' }, 404);
  if (row.batch_id && paypalReady(env) && !['SUCCESS', ...RETURNED].includes(row.status)) {
    try {
      const b = await paypal(env, 'GET', `/v1/payments/payouts/${row.batch_id}`);
      const item = b.items?.[0];
      await applyItemStatus(env, id, item?.payout_item_id, item?.transaction_status || b.batch_header?.batch_status);
    } catch { /* keep the stored status; the next poll retries */ }
  }
  return json({ payout: await payoutRow(env, id) });
}

export async function createFundOrder(req, env) {
  if (!paypalReady(env)) return notConfigured();
  const { amount } = await req.json().catch(() => ({}));
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 1 || value > 100 || round(value) !== value) {
    return json({ error: 'Choose an amount between $1 and $100.' }, 400);
  }
  const o = await paypal(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: 'USD', value: value.toFixed(2) }, description: 'PatchPay bug bounty pool' }],
  }, crypto.randomUUID());
  return json({ id: o.id });
}

export async function captureFundOrder(env, orderId) {
  if (!paypalReady(env)) return notConfigured();
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) return json({ error: 'Invalid order id.' }, 400);
  let c;
  try {
    c = await paypal(env, 'POST', `/v2/checkout/orders/${orderId}/capture`, {}, `capture-${orderId}`);
  } catch (e) {
    return json({ error: `PayPal could not capture the payment: ${e.message}` }, 502);
  }
  const cap = c.purchase_units?.[0]?.payments?.captures?.[0];
  if (c.status !== 'COMPLETED' || cap?.status !== 'COMPLETED' || cap.amount?.currency_code !== 'USD') {
    return json({ error: 'The payment was not completed.' }, 402);
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO pool_ledger (kind, amount, paypal_ref, created_at) VALUES ('fund', ?, ?, ?)`)
    .bind(Number(cap.amount.value), `capture:${cap.id}`, Date.now()).run();
  return json({ captured: Number(cap.amount.value), pool: await poolSummary(env) });
}

export async function handleWebhook(req, env) {
  if (!paypalReady(env) || !isSet(env.PAYPAL_WEBHOOK_ID)) return notConfigured();
  let event;
  try { event = JSON.parse(await req.text()); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const h = (k) => req.headers.get(k);
  let verified;
  try {
    verified = await paypal(env, 'POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
    });
  } catch { return json({ error: 'Could not verify webhook' }, 400); }
  if (verified.verification_status !== 'SUCCESS') return json({ error: 'Invalid signature' }, 400);

  const fresh = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)')
    .bind(String(event.id), String(event.event_type), Date.now()).run();
  if (fresh.meta.changes === 0) return json({ ok: true, duplicate: true });

  if (String(event.event_type).startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    const res = event.resource || {};
    const id = res.payout_item?.sender_item_id;
    if (id) await applyItemStatus(env, id, res.payout_item_id, res.transaction_status);
  }
  return json({ ok: true });
}
