# PatchPay

**Found a bug? Get paid.** AI bug triage for indie and web games, with bounties paid through PayPal.

> Runs entirely in the **PayPal Sandbox**. No real money moves.

- Live demo: https://patchpay.cosmoscan-preview.workers.dev (game: `/play`, developer dashboard: `/dev`, fund the pool: `/fund`)
- Demo video: `https://youtu.be/<id>` (TODO)

## What it does

1. **Report** — Players tap *Report a bug · earn a bounty* inside the game. The widget attaches a canvas screenshot, console errors and game state; the player types one sentence.
2. **Triage (AI)** — An AI agent returns a title, category, severity, reproduction steps, a duplicate check against open reports, and a suggested bounty.
3. **Policy** — The server sets the real amount (Low $2, Medium $5, High $10, Critical $20, daily cap $50). Reports that try to manipulate the agent are flagged and set to $0.
4. **Approve & pay (PayPal)** — The developer clicks *Approve*. PatchPay sends the bounty with PayPal Payouts; a verified webhook marks it paid.
5. **Fund** — Fans top up the bounty pool with PayPal Checkout.

## How PayPal and AI are used

| Part | What we call | Why |
|---|---|---|
| Pool funding | PayPal JS SDK buttons + Orders v2 create/capture (server side) | Fans and devs add money to the bounty pool |
| Bounty payment | Payouts v1 (`sender_batch_id` = report id) | One approval pays the reporter; retries never pay twice |
| Confirmation | Webhooks + `verify-webhook-signature`, polling fallback | Paid status comes from PayPal, not from our UI |
| Triage | Claude `claude-haiku-5-5`, image input + structured JSON | Turns one-line reports into reproducible tickets, merges duplicates |
| Guardrails | Server-side policy + human approval | The AI suggests; it never sets the final amount |

## Run it locally

Requirements: Node 18+, a free [PayPal Developer](https://developer.paypal.com/) account, an Anthropic API key.

```bash
git clone https://github.com/haib8543-cmd/patchpay
cd patchpay
npm install
cp .dev.vars.example .dev.vars   # fill in the sandbox keys below
npx wrangler d1 migrations apply patchpay --local
npm run dev
```

`.dev.vars`:
```
PAYPAL_CLIENT_ID=<sandbox client id>
PAYPAL_CLIENT_SECRET=<sandbox secret>
PAYPAL_WEBHOOK_ID=<sandbox webhook id>
ANTHROPIC_API_KEY=<key>
```

Open `http://localhost:8787/play` (game), `/dev` (dashboard), `/fund` (pool).

No keys yet? `npm run dev:mock` runs the same app on `http://127.0.0.1:8797` with PayPal and Claude mocked (the PayPal checkout button on `/fund` still needs real sandbox keys).

Webhooks: in the PayPal Developer Dashboard, add a webhook for your sandbox app pointing to `https://<your-host>/api/paypal/webhook` with the `PAYMENT.PAYOUTS-ITEM.*` events, and put its id in `PAYPAL_WEBHOOK_ID`. Without it, payout status still updates by polling.

## Tests

```bash
npm test        # policy, triage parsing, injection guard
npm run e2e     # full money flow on a real local Worker + D1, PayPal and Claude mocked
npm run smoke   # real PayPal sandbox: token, order, payout (needs .dev.vars)
```

## Testing as a judge

No login is needed on the demo site; everything runs in the PayPal sandbox.

1. Open https://patchpay.cosmoscan-preview.workers.dev/dev and click **Reset demo**. Six sample reports load and go through live AI triage (a few seconds).
2. If the bounty pool is below $10, open `/fund` and pay with any **PayPal sandbox** buyer account, or the "Debit or Credit Card" button with a [PayPal sandbox test card](https://developer.paypal.com/tools/sandbox/card-testing/).
3. Back on `/dev`, open a **Ready to pay** row and click **Approve & pay**. Status moves to **Paid** once PayPal confirms the payout.
4. Try your own report: open `/play`, keep **Demo bug** on, move right until the game freezes, click **Report a bug**. Add your sandbox personal account email if you want to receive the bounty.

Sample reports pay a sandbox test account owned by the project, not a real person. Anyone can reset the hosted demo (rate-limited to once per 2 minutes) and the daily bounty cap is $50.

## Privacy

No accounts. A PayPal email is asked only when a bounty is paid and is masked in the dashboard. Screenshots cover the game canvas only. Raw IP addresses are not stored. The AI never receives email addresses.

## Built with

PayPal Orders v2, Payouts v1, Webhooks, JS SDK · Anthropic Claude · Cloudflare Workers + D1 · AG Grid Community

## Note on timing

Everything in this repository, including the small demo game, was built during the PayPal AI Hackathon submission period (Nov 2026).

## License

MIT
