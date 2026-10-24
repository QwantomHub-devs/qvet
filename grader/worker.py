"""
Talent Vetting Platform - Python 3 Grader Worker (Milestone 4)
Per AGENTS.md:
- Outbound-only connections
- Polling via atomic DB queue (claim_next_job uses SELECT ... FOR UPDATE SKIP LOCKED)
- Python 3 standard library only (no external pip dependencies)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple

from grader.graders.predictions import score_predictions
from grader.graders.retrieval import score_retrieval


DEFAULT_SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
DEFAULT_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
DEFAULT_GRADER_EMAIL = os.environ.get("GRADER_EMAIL", "grader@vetting.local")
DEFAULT_GRADER_PASSWORD = os.environ.get("GRADER_PASSWORD", "Password123!")


class GraderClient:
    def __init__(self, base_url: str, anon_key: str):
        self.base_url = base_url.rstrip("/")
        self.anon_key = anon_key
        self.access_token: Optional[str] = None

    def _request(
        self,
        endpoint: str,
        method: str = "GET",
        payload: Optional[Dict[str, Any]] = None,
        token: Optional[str] = None,
    ) -> Any:
        url = f"{self.base_url}{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "apikey": self.anon_key,
        }
        auth_token = token or self.access_token or self.anon_key
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                if not body:
                    return None
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return body
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} on {endpoint}: {err_body}")
        except Exception as e:
            raise RuntimeError(f"Network error on {endpoint}: {e}")

    def authenticate(self, email: str, password: str) -> str:
        """Authenticates grader user and stores access token."""
        payload = {"email": email, "password": password}
        resp = self._request(
            "/auth/v1/token?grant_type=password",
            method="POST",
            payload=payload,
            token=self.anon_key,
        )
        token = resp.get("access_token")
        if not token:
            raise RuntimeError("Authentication failed: missing access_token in response")
        self.access_token = token
        return token

    def rpc(self, fn_name: str, args: Dict[str, Any]) -> Any:
        return self._request(f"/rest/v1/rpc/{fn_name}", method="POST", payload=args)

    def download_storage_file(self, bucket: str, path: str) -> str:
        url = f"{self.base_url}/storage/v1/object/authenticated/{bucket}/{path.lstrip('/')}"
        headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.access_token or self.anon_key}",
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")


def grade_job_payload(
    part: str,
    mode: str,
    candidate_content: str,
    ground_truth_content: str,
) -> Tuple[Dict[str, Any], str, Dict[str, float]]:
    """
    Executes the appropriate grader and determines component points.
    Returns: (result_dict, candidate_feedback, component_points_dict)
    """
    if part == "predictions":
        if isinstance(ground_truth_content, str):
            try:
                gt = json.loads(ground_truth_content)
            except Exception:
                # If ground truth was stored as CSV: ticket_id,priority
                import csv, io
                reader = csv.reader(io.StringIO(ground_truth_content.strip()))
                header = next(reader, None)
                gt = {row[0].strip(): row[1].strip().lower() for row in reader if len(row) >= 2}
        else:
            gt = ground_truth_content

        res = score_predictions(candidate_content, gt)
        feedback = res["feedback"]
        component_points = {"A1": res["points"]} if mode == "final" else {}
        return res, feedback, component_points

    elif part == "retrieval":
        gt = json.loads(ground_truth_content) if isinstance(ground_truth_content, str) else ground_truth_content
        res = score_retrieval(candidate_content, gt)
        feedback = res["feedback"]
        component_points = {
            "B1": res["b1_points"],
            "B3": res["b3_points"],
        } if mode == "final" else {}
        return res, feedback, component_points

    else:
        raise ValueError(f"Unsupported grader part: {part}")


def process_claimed_job(client: GraderClient, job: Dict[str, Any]) -> None:
    job_id = job["job_id"]
    part = job["part"]
    mode = job["mode"]
    file_path = job.get("file_path", "")
    practice_data_path = job.get("practice_data_path")
    hidden_test_path = job.get("hidden_test_path")

    print(f"[{job_id}] Processing {mode} job for part '{part}' (file: {file_path})")

    try:
        # Download candidate submission
        candidate_content = client.download_storage_file("project-submissions", file_path)

        # Download ground truth
        if mode == "practice":
            gt_bucket = "scenario-kits"
            gt_path = practice_data_path
        else:
            gt_bucket = "scenario-hidden"
            gt_path = hidden_test_path

        if not gt_path:
            raise ValueError(f"Missing ground truth path for mode '{mode}'")

        gt_content = client.download_storage_file(gt_bucket, gt_path)

        # Grade
        result, feedback, component_points = grade_job_payload(
            part, mode, candidate_content, gt_content
        )

        # Save success
        client.rpc("save_job_result", {
            "p_job_id": job_id,
            "p_status": "done",
            "p_result": result,
            "p_candidate_feedback": feedback,
            "p_component_points": component_points,
            "p_error": None,
        })
        print(f"[{job_id}] Successfully graded. Feedback: {feedback}")

    except Exception as e:
        err_msg = str(e)
        print(f"[{job_id}] Grading failed: {err_msg}", file=sys.stderr)
        try:
            client.rpc("save_job_result", {
                "p_job_id": job_id,
                "p_status": "failed",
                "p_result": {},
                "p_candidate_feedback": "Automated evaluation encountered an error. Please verify submission format.",
                "p_component_points": {},
                "p_error": err_msg,
            })
        except Exception as save_err:
            print(f"[{job_id}] Error saving failed status: {save_err}", file=sys.stderr)


def run_worker_loop(
    client: GraderClient,
    worker_id: str,
    poll_interval: float = 3.0,
    once: bool = False,
) -> None:
    print(f"Grader worker '{worker_id}' active. Polling {client.base_url}...")

    while True:
        try:
            # 1. Requeue stuck jobs
            client.rpc("requeue_stuck_jobs", {"p_timeout_seconds": 300})

            # 2. Expire overdue attempts
            client.rpc("expire_overdue_project_attempts", {})

            # 3. Atomically claim next job
            claimed = client.rpc("claim_next_job", {"p_worker_id": worker_id})

            if claimed and claimed.get("claimed"):
                process_claimed_job(client, claimed)
                if once:
                    break
                continue

        except Exception as e:
            print(f"Worker iteration notice: {e}", file=sys.stderr)

        if once:
            print("Single-pass mode complete. Exiting.")
            break

        time.sleep(poll_interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Talent Vetting Platform Grader Worker")
    parser.add_argument("--url", default=DEFAULT_SUPABASE_URL, help="Supabase project URL")
    parser.add_argument("--anon-key", default=DEFAULT_ANON_KEY, help="Supabase Anon API key")
    parser.add_argument("--email", default=DEFAULT_GRADER_EMAIL, help="Grader account email")
    parser.add_argument("--password", default=DEFAULT_GRADER_PASSWORD, help="Grader account password")
    parser.add_argument("--worker-id", default=f"worker-{os.getpid()}", help="Worker identity")
    parser.add_argument("--once", action="store_true", help="Run a single poll pass and exit")
    parser.add_argument("--interval", type=float, default=3.0, help="Polling interval in seconds")

    args = parser.parse_args()

    client = GraderClient(args.url, args.anon_key)
    try:
        if args.email and args.password:
            client.authenticate(args.email, args.password)
            print(f"Authenticated as {args.email}")
    except Exception as e:
        print(f"Warning: Auth check failed ({e}). Attempting unauthenticated / anon key RPC...", file=sys.stderr)

    run_worker_loop(client, args.worker_id, poll_interval=args.interval, once=args.once)


if __name__ == "__main__":
    main()
