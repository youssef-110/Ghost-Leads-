CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  event_url TEXT,
  source_url TEXT,
  company_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  -- written by scraping
  impressum_url TEXT,
  owner_name TEXT,
  owner_title TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  -- written by backend
  in_aiark INTEGER,            -- 0 = ghost (not in AI Ark), 1 = already in AI Ark, NULL = not checked
  aiark_checked_at TEXT,
  linkedin_url TEXT,
  email TEXT,
  email_status TEXT,           -- valid | invalid | unknown
  phone TEXT,
  enrichment_source TEXT,      -- blitz | lusha | impressum
  message TEXT,
  needle_status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | accepted | replied | failed
  needle_ref TEXT,
  reply_text TEXT,
  reply_class TEXT,            -- interested | not_interested | question | later
  meeting_start TEXT,          -- ISO 8601 with timezone
  meeting_location TEXT,       -- event name and booth or meeting point
  calendar_event_id TEXT,
  stage TEXT NOT NULL DEFAULT 'scraped',          -- scraped | deduped | enriched | verified | drafted | sent | replied | booked
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_name, domain)
);
