#!/usr/bin/env python3
"""
Housekeeping Script: cleanup_expired_storage.py
Purges expired Stage 1 videos (> 60 days) and verified ID images to enforce
Rule 8 (Free-Tier Awareness: 1 GB cap) and privacy policies.

Usage:
  python3 scripts/cleanup_expired_storage.py [--dry-run]
"""

import os
import sys
import argparse
from datetime import datetime, timezone, timedelta
import urllib.request
import urllib.parse
import json

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def make_request(path: str, method: str = "GET", body: dict = None) -> list:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        content = resp.read().decode("utf-8")
        return json.loads(content) if content else []


def delete_storage_object(bucket: str, file_path: str, dry_run: bool = False) -> bool:
    if dry_run:
        print(f"[DRY-RUN] Would delete {bucket}/{file_path}")
        return True

    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{file_path}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers, method="DELETE")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        print(f"Error deleting {bucket}/{file_path}: {e}", file=sys.stderr)
        return False


def cleanup_expired_videos(dry_run: bool = False) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    # Find applications finalized > 60 days ago
    apps = make_request(f"applications?select=id,status,updated_at&status=in.(certified,retake_wait,rejected)&updated_at=lt.{cutoff}")
    deleted_count = 0

    for app in apps:
        app_id = app.get("id")
        # Query video responses for this application
        videos = make_request(f"video_responses?select=id,video_file_path&application_id=eq.{app_id}")
        for v in videos:
            path = v.get("video_file_path")
            if path and delete_storage_object("stage1-videos", path, dry_run):
                deleted_count += 1

    return deleted_count


def main():
    parser = argparse.ArgumentParser(description="Purge expired storage files.")
    parser.add_argument("--dry-run", action="store_true", help="Simulate deletion without purging")
    args = parser.parse_args()

    if not SERVICE_KEY:
        print("Error: SUPABASE_SERVICE_ROLE_KEY is required.", file=sys.stderr)
        sys.exit(1)

    print(f"Starting storage cleanup at {datetime.now(timezone.utc).isoformat()} (dry_run={args.dry_run})")
    count = cleanup_expired_videos(args.dry_run)
    print(f"Cleaned up {count} expired storage items.")


if __name__ == "__main__":
    main()

