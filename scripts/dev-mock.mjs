// Run the app locally with PayPal and Claude mocked, to click through the full flow without keys.
// Run: npm run dev:mock  → http://127.0.0.1:8797
import { execSync, spawn } from 'node:child_process';
import { startMock } from './mock-services.mjs';

const MOCK = 8790;
const base = `http://127.0.0.1:${MOCK}`;
const persist = '.wrangler/mock-state';
const vars = { PAYPAL_CLIENT_ID: 'mock', PAYPAL_CLIENT_SECRET: 'mock', PAYPAL_WEBHOOK_ID: 'mock', PAYPAL_API_BASE: base,
  ANTHROPIC_API_KEY: 'mock', ANTHROPIC_API_BASE: base };

await startMock(MOCK);
execSync(`npx wrangler d1 migrations apply patchpay --local --persist-to ${persist}`, { stdio: 'ignore' });
const varArgs = Object.entries(vars).map(([k, v]) => `--var ${k}:${v}`).join(' ');
spawn(`npx wrangler dev --port 8797 --ip 127.0.0.1 --persist-to ${persist} ${varArgs}`, { shell: true, stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0));
console.log('Mock PayPal + Claude on', base, '- the PayPal checkout button on /fund needs real sandbox keys.');
