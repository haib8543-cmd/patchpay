// Bounty policy. The AI only suggests; these rules decide the real amount.
export const BOUNTY_USD = { low: 2, medium: 5, high: 10, critical: 20 };
export const DAILY_CAP_USD = 50;
const ZERO_FLAGS = new Set(['prompt_injection', 'spam', 'not_a_bug']);

// Server-side check that runs even if the model misses a manipulation attempt.
const INJECTION = /ignore\s+(?:all\s+|any\s+|the\s+|previous\s+|prior\s+|your\s+)*(?:rules|instructions)|system\s+prompt|pay\s+me|send\s+me\s+\$|bounty\s*(?:of|=|:|is)\s*\$?\s*\d+|\$\s?\d{3,}/i;
export const detectInjection = (text) => INJECTION.test(String(text || ''));

export function policyAmount({ severity, flags = [], duplicate_of = null }) {
  if (duplicate_of) return 0; // the original report gets the bounty
  if (flags.some((f) => ZERO_FLAGS.has(f))) return 0;
  return BOUNTY_USD[severity] ?? 0;
}

// Applied at payout time, when today's total is known.
export const capAmount = (amount, paidToday, cap = DAILY_CAP_USD) =>
  Math.max(0, Math.min(amount, cap - paidToday));
