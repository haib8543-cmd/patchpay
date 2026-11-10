# PatchPay

**Found a bug? Get paid.** AI bug triage for indie and web games, with bounties paid through PayPal.

> Runs entirely in the **PayPal Sandbox**. No real money moves.

- Live demo: `https://<your-worker>.workers.dev` (TODO)
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
git clone https://github.com/<you>/patchpay
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

## Testing as a judge

1. Open the live demo and click **Reset demo** on `/dev`.
2. On `/play`, toggle **Demo bug**, trigger it, and submit a report. Use the sandbox receiver email below.
3. On `/dev`, open the new row, read the AI triage, click **Approve**.
4. Sign in to [sandbox.paypal.com](https://www.sandbox.paypal.com) with the sandbox receiver account to see the payout.

Sandbox receiver (test account, not a real person): `TODO`

## Privacy

No accounts. A PayPal email is asked only when a bounty is paid and is masked in the dashboard. Screenshots cover the game canvas only. Raw IP addresses are not stored. The AI never receives email addresses.

## Built with

PayPal Orders v2, Payouts v1, Webhooks, JS SDK · Anthropic Claude · Cloudflare Workers + D1 · AG Grid Community

## Note on timing

Everything in this repository, including the small demo game, was built during the PayPal AI Hackathon submission period (Nov 2026).

## License

MIT
