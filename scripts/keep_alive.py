#!/usr/bin/env python3
"""
Housekeeping Script: keep_alive.py
Issues an authenticated health probe to Supabase PostgREST once every 24-72 hours
to prevent free-tier projects from pausing due to inactivity (Rule 8).

Usage:
  python3 scripts/keep_alive.py
"""

import os
import sys
import urllib.request
import json
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")


def ping_supabase() -> bool:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/settings?select=key&limit=1"
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            data = json.loads(content) if content else []
            print(f"[{datetime.now(timezone.utc).isoformat()}] Ping successful. Rows: {len(data)}")
            return True
    except Exception as e:
        print(f"[{datetime.now(timezone.utc).isoformat()}] Ping error: {e}", file=sys.stderr)
        return False


def main():
    if not ANON_KEY:
        print("Notice: NEXT_PUBLIC_SUPABASE_ANON_KEY not set, using unauthenticated probe.", file=sys.stderr)

    ok = ping_supabase()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

