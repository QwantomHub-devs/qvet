#!/usr/bin/env python3
"""
Housekeeping Script: export_database.py
Dumps critical tables (applications, profiles, stage_results, credentials, audit_log, settings)
to a timestamped JSON file in backups/ for disaster recovery (Rule 8).

Usage:
  python3 scripts/export_database.py [--out-dir backups/]
"""

import os
import sys
import argparse
import json
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

CRITICAL_TABLES = [
    "applications",
    "profiles",
    "institutions",
    "questions",
    "rubric_criteria",
    "stage_results",
    "credentials",
    "audit_log",
    "settings",
    "outbound_webhooks",
]


def fetch_table(table_name: str) -> list:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table_name}?select=*"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else []
    except Exception as e:
        print(f"Warning: Could not export {table_name}: {e}", file=sys.stderr)
        return []


def main():
    parser = argparse.ArgumentParser(description="Export critical tables to backup file.")
    parser.add_argument("--out-dir", default="backups", help="Target output directory")
    args = parser.parse_args()

    if not SERVICE_KEY:
        print("Error: SUPABASE_SERVICE_ROLE_KEY is required to export database data.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out_dir, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_file = os.path.join(args.out_dir, f"talent_vetting_export_{timestamp}.json")

    backup_payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tables": {},
    }

    for tbl in CRITICAL_TABLES:
        rows = fetch_table(tbl)
        backup_payload["tables"][tbl] = rows
        print(f"Exported {len(rows)} rows from {tbl}")

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(backup_payload, f, indent=2)

    print(f"Backup successfully written to: {out_file}")


if __name__ == "__main__":
    main()

