CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  game TEXT NOT NULL,
  text TEXT NOT NULL,
  screenshot TEXT,
  console TEXT,
  state_json TEXT,
  reporter_token TEXT NOT NULL,
  receiver_email TEXT
);

CREATE TABLE triage (
  report_id TEXT PRIMARY KEY REFERENCES reports(id),
  title TEXT,
  category TEXT,
  severity TEXT,
  repro_steps TEXT,
  duplicate_of TEXT,
  ai_amount REAL,
  policy_amount REAL,
  flags TEXT,
  model TEXT,
  raw_json TEXT
);

CREATE TABLE payouts (
  report_id TEXT PRIMARY KEY REFERENCES reports(id),
  batch_id TEXT,
  item_id TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pool_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fund', 'payout', 'refund')),
  amount REAL NOT NULL,
  paypal_ref TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
