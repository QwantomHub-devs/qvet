#!/usr/bin/env python3
"""
Synthetic Fake Scenario Generator for AI Track Stage 3 (Milestone 4).
Per AGENTS.md and user instruction:
All data is clearly marked [FAKE SAMPLE - NOT REAL CONTENT].
Do not present as real assessment content.
"""

from __future__ import annotations

import csv
import io
import json
import os
import random
import zipfile

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "fake_scenario")


PRIORITIES = ["low", "medium", "high", "urgent"]

SUBJECT_TEMPLATES = {
    "low": [
        "Inquiry regarding theme dark mode toggle",
        "How to update invoice email address",
        "Feature request: export CSV button styling",
        "General feedback on dashboard typography",
        "Question about upcoming public holiday support hours",
    ],
    "medium": [
        "Slow query response on user reporting view",
        "Intermittent webhook delay of 2-3 minutes",
        "Pagination reset when filtering by tags",
        "Discrepancy in monthly usage graph totals",
        "CSV export takes 45 seconds to download",
    ],
    "high": [
        "Authentication token expired prematurely for team members",
        "Payment gateway webhook returning 500 error",
        "Database connection pool saturation during peak hours",
        "Sync worker paused due to memory exhaustion",
        "Customer portal throwing 502 Bad Gateway intermittently",
    ],
    "urgent": [
        "CRITICAL: Production API endpoint completely down with 503",
        "URGENT: Data corruption detected in tenant inventory table",
        "SECURITY: Unauthorized API key access suspected on primary cluster",
        "CRITICAL: Outbound email service locked, transactional emails stalled",
        "EMERGENCY: Automated billing charging customers twice",
    ],
}

KB_ARTICLES = [
    {
        "id": "kb_auth_01",
        "title": "API Authentication and Token Lifecycles",
        "content": "All API calls require a Bearer token generated via OAuth 2.0. Tokens expire strictly after 3600 seconds (1 hour). Refresh tokens are single-use and rotate on every renewal.",
    },
    {
        "id": "kb_rate_02",
        "title": "Rate Limiting and Throttling Policies",
        "content": "Standard tier allows 100 requests per minute per IP. Pro tier allows 1,000 requests per minute. Exceeding limits returns HTTP 429 with Retry-After header indicating wait seconds.",
    },
    {
        "id": "kb_webhook_03",
        "title": "Webhook Configuration and Retry Schedules",
        "content": "Webhooks must respond with HTTP 200 within 5 seconds. Failed deliveries retry using exponential backoff: 30s, 5m, 30m, 2h, and 12h before dropping to dead-letter queue.",
    },
    {
        "id": "kb_billing_04",
        "title": "Subscription Billing Cycles and Invoicing",
        "content": "Billing recurs on the 1st of each calendar month. Invoices are dispatched to the billing email on file. Payment retries occur automatically at 24h, 72h, and 120h intervals.",
    },
    {
        "id": "kb_export_05",
        "title": "Bulk Data Export Limits and Guidelines",
        "content": "Exports exceeding 50,000 rows are processed asynchronously via background workers. A signed download URL is emailed to the requester within 15 minutes of completion.",
    },
    {
        "id": "kb_security_06",
        "title": "API Key Rotation and Revocation",
        "content": "To rotate API keys without downtime, create a secondary key in the admin portal, update your application configs, and revoke the primary key once traffic migrates.",
    },
    {
        "id": "kb_database_07",
        "title": "Database Connection Pooling and Timeouts",
        "content": "Default connection pool max size is 20 connections per container instance. Idle connection timeout is 300 seconds. Pool exhaustion logs alert 'POOL_SATURATION'.",
    },
    {
        "id": "kb_tenancy_08",
        "title": "Multi-Tenant Data Isolation Architecture",
        "content": "Row-level tenant isolation is enforced through the tenant_id foreign key constraint. Cross-tenant queries are blocked at the database engine level via security definer policies.",
    },
    {
        "id": "kb_audit_09",
        "title": "System Audit Logging and Retention",
        "content": "Audit records are immutable and retained for 7 years to satisfy regulatory compliance. Event types include AUTH_LOGIN, ROLE_CHANGE, DATA_EXPORT, and API_KEY_CYCLE.",
    },
    {
        "id": "kb_status_10",
        "title": "Incident Escalation and Status Page Updates",
        "content": "P1 incidents trigger automated pager duty alerts to the primary on-call engineer within 60 seconds. Public status page updates are mandated within 15 minutes of confirmation.",
    },
    {
        "id": "kb_caching_11",
        "title": "Redis Cache Invalidation Policies",
        "content": "Cache invalidation uses TTL plus pub/sub key eviction. Master cache entries expire after 600 seconds unless refreshed by write mutations.",
    },
    {
        "id": "kb_ssl_12",
        "title": "Custom Domain SSL Certificate Provisioning",
        "content": "Custom domain certificates are auto-issued via Let's Encrypt using DNS-01 or HTTP-01 challenges. Renewals trigger automatically 30 days prior to expiration.",
    },
    {
        "id": "kb_roles_13",
        "title": "Role-Based Access Control Matrix",
        "content": "Roles available: Owner, Admin, Member, and Viewer. Only Owners can delete workspaces or modify billing details. Admins can invite and remove Members.",
    },
    {
        "id": "kb_backup_14",
        "title": "Disaster Recovery and Snapshot Schedules",
        "content": "Point-in-time recovery is supported up to 14 days in the past. Full database snapshots execute daily at 02:00 UTC and replicate across two secondary geographic zones.",
    },
    {
        "id": "kb_email_15",
        "title": "Transactional Email Deliverability and DKIM",
        "content": "Outbound emails pass SPF, DKIM, and DMARC verification. Dedicated sending IPs are monitored for spam complaints. High bounce rates result in protective sending pauses.",
    },
]

# 20 Hidden evaluation queries: 15 answerable from KB, 5 unanswerable
EVAL_QUERIES = [
    {"query_id": "eval_q01", "query": "What is the expiration time for OAuth Bearer tokens?", "target": "kb_auth_01", "answerable": True},
    {"query_id": "eval_q02", "query": "How many requests per minute are allowed on the Pro tier?", "target": "kb_rate_02", "answerable": True},
    {"query_id": "eval_q03", "query": "What are the retry delays for failed webhooks?", "target": "kb_webhook_03", "answerable": True},
    {"query_id": "eval_q04", "query": "When does monthly subscription billing occur?", "target": "kb_billing_04", "answerable": True},
    {"query_id": "eval_q05", "query": "What happens when an export exceeds 50,000 rows?", "target": "kb_export_05", "answerable": True},
    {"query_id": "eval_q06", "query": "How do you rotate API keys without downtime?", "target": "kb_security_06", "answerable": True},
    {"query_id": "eval_q07", "query": "What is the maximum database connection pool size per instance?", "target": "kb_database_07", "answerable": True},
    {"query_id": "eval_q08", "query": "How is multi-tenant isolation enforced in the database?", "target": "kb_tenancy_08", "answerable": True},
    {"query_id": "eval_q09", "query": "How long are system audit log records retained?", "target": "kb_audit_09", "answerable": True},
    {"query_id": "eval_q10", "query": "Within how many minutes must the public status page be updated for P1?", "target": "kb_status_10", "answerable": True},
    {"query_id": "eval_q11", "query": "What is the default TTL for Redis master cache entries?", "target": "kb_caching_11", "answerable": True},
    {"query_id": "eval_q12", "query": "When do custom domain SSL certificates auto-renew?", "target": "kb_ssl_12", "answerable": True},
    {"query_id": "eval_q13", "query": "Who is authorized to delete a workspace?", "target": "kb_roles_13", "answerable": True},
    {"query_id": "eval_q14", "query": "What time does the daily full database snapshot run?", "target": "kb_backup_14", "answerable": True},
    {"query_id": "eval_q15", "query": "What triggers a protective sending pause on outbound emails?", "target": "kb_email_15", "answerable": True},
    # 5 Unanswerable queries (not covered anywhere in KB)
    {"query_id": "eval_q16", "query": "What is the recommended hyperparameter configuration for fine-tuning Llama-3?", "target": None, "answerable": False},
    {"query_id": "eval_q17", "query": "How do I configure quantum cryptography on our edge routers?", "target": None, "answerable": False},
    {"query_id": "eval_q18", "query": "What is the refund policy for annual enterprise on-premise hardware?", "target": None, "answerable": False},
    {"query_id": "eval_q19", "query": "How can I deploy a Kubernetes cluster on AWS GovCloud using Terraform?", "target": None, "answerable": False},
    {"query_id": "eval_q20", "query": "Does the platform support real-time audio translation in Swahili?", "target": None, "answerable": False},
]


def generate_ticket_row(ticket_num: int, priority: str, prefix: str = "T") -> Dict[str, str]:
    sub = random.choice(SUBJECT_TEMPLATES[priority])
    tid = f"{prefix}_{ticket_num:04d}"
    body = (
        f"[FAKE SAMPLE - NOT REAL CONTENT] Customer support ticket regarding: {sub.lower()}. "
        f"Reporter mentions impact level corresponding to operational priority '{priority}'. "
        f"System generated sample ticket for Talent Vetting Platform M4 evaluation testing."
    )
    return {"ticket_id": tid, "subject": f"[FAKE SAMPLE] {sub}", "body": body, "priority": priority}


def build_scenario_assets() -> None:
    random.seed(42)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1. Generate train.csv (200 tickets)
    train_tickets = []
    t_id = 1
    for p in PRIORITIES:
        for _ in range(50):
            train_tickets.append(generate_ticket_row(t_id, p, prefix="TRAIN"))
            t_id += 1
    random.shuffle(train_tickets)

    # 2. Generate practice.csv (40 tickets) and ground truth
    practice_tickets = []
    p_gt: Dict[str, str] = {}
    p_id = 1
    for p in PRIORITIES:
        for _ in range(10):
            row = generate_ticket_row(p_id, p, prefix="PRAC")
            practice_tickets.append(row)
            p_gt[row["ticket_id"]] = p
            p_id += 1
    random.shuffle(practice_tickets)

    # 3. Generate test.csv (60 tickets) and ground truth
    test_tickets = []
    hidden_gt: Dict[str, str] = {}
    test_id = 1
    for p in PRIORITIES:
        for _ in range(15):
            row = generate_ticket_row(test_id, p, prefix="TEST")
            test_tickets.append(row)
            hidden_gt[row["ticket_id"]] = p
            test_id += 1
    random.shuffle(test_tickets)

    # 4. Save ground truths (for grader)
    with open(os.path.join(OUTPUT_DIR, "ai-stage3-practice-predictions-gt.json"), "w") as f:
        json.dump(p_gt, f, indent=2)

    with open(os.path.join(OUTPUT_DIR, "ai-stage3-hidden-predictions-gt.json"), "w") as f:
        json.dump(hidden_gt, f, indent=2)

    # Retrieval ground truth
    retrieval_gt = {
        "answerable": [
            {"query_id": q["query_id"], "target_article_id": q["target"]}
            for q in EVAL_QUERIES if q["answerable"]
        ],
        "unanswerable": [
            {"query_id": q["query_id"]}
            for q in EVAL_QUERIES if not q["answerable"]
        ],
    }
    with open(os.path.join(OUTPUT_DIR, "ai-stage3-hidden-retrieval-gt.json"), "w") as f:
        json.dump(retrieval_gt, f, indent=2)

    # Combined hidden ground truth
    combined_hidden = {
        "predictions": hidden_gt,
        "retrieval": retrieval_gt,
    }
    with open(os.path.join(OUTPUT_DIR, "ai-stage3-hidden-ground-truth.json"), "w") as f:
        json.dump(combined_hidden, f, indent=2)

    with open(os.path.join(OUTPUT_DIR, "ai-stage3-practice-ground-truth.json"), "w") as f:
        json.dump({"predictions": p_gt, "retrieval": retrieval_gt}, f, indent=2)

    # 5. Build starter_kit.zip
    zip_path = os.path.join(OUTPUT_DIR, "ai-stage3-starter-kit.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Instructions README
        readme_content = """# AI Track Stage 3: Practical Project Starter Kit
[FAKE SAMPLE - NOT REAL CONTENT FOR PRODUCTION TESTING]

## Overview
You have 5 hours (with up to 30 minutes of optional paused break) to complete:
- **Part A:** Multi-class priority classifier on customer support tickets (40 pts)
  - Submit `predictions.csv` with columns: `ticket_id,priority`
- **Part B:** RAG pipeline over internal knowledge base articles (40 pts)
  - Submit `retrieval.json` matching the provided template
- **Part C:** Codebase & Jupyter Notebook reproducibility (10 pts)
  - Submit `notebook.ipynb` and `code.zip`
- **Part D:** Technical Write-up (10 pts)
  - Submit `writeup.pdf` or `writeup.md` (maximum 2 pages / 1,000 words)

## Datasets Provided
- `data/train.csv`: 200 labeled support tickets (`ticket_id,subject,body,priority`)
- `data/practice_tickets.csv`: 40 unlabeled tickets for testing practice grading runs (up to 10 runs)
- `data/test_tickets.csv`: 60 unlabeled tickets for final evaluation
- `knowledge_base/`: 15 Markdown knowledge base articles
- `evaluation_queries.json`: 20 evaluation queries for Part B RAG pipeline

## Submission Templates
See `templates/predictions_template.csv` and `templates/retrieval_template.json`.
"""
        zf.writestr("README.md", readme_content)

        # Train CSV
        train_buf = io.StringIO()
        w = csv.DictWriter(train_buf, fieldnames=["ticket_id", "subject", "body", "priority"])
        w.writeheader()
        w.writerows(train_tickets)
        zf.writestr("data/train.csv", train_buf.getvalue())

        # Practice CSV (without label)
        prac_buf = io.StringIO()
        w = csv.DictWriter(prac_buf, fieldnames=["ticket_id", "subject", "body"])
        w.writeheader()
        for r in practice_tickets:
            w.writerow({"ticket_id": r["ticket_id"], "subject": r["subject"], "body": r["body"]})
        zf.writestr("data/practice_tickets.csv", prac_buf.getvalue())

        # Test CSV (without label)
        test_buf = io.StringIO()
        w = csv.DictWriter(test_buf, fieldnames=["ticket_id", "subject", "body"])
        w.writeheader()
        for r in test_tickets:
            w.writerow({"ticket_id": r["ticket_id"], "subject": r["subject"], "body": r["body"]})
        zf.writestr("data/test_tickets.csv", test_buf.getvalue())

        # Knowledge Base Articles
        for article in KB_ARTICLES:
            art_md = f"# {article['title']}\n[FAKE SAMPLE - NOT REAL CONTENT]\nArticle ID: {article['id']}\n\n{article['content']}\n"
            zf.writestr(f"knowledge_base/{article['id']}.md", art_md)

        # Evaluation queries
        eval_queries_clean = [
            {"query_id": q["query_id"], "query": q["query"]}
            for q in EVAL_QUERIES
        ]
        zf.writestr("evaluation_queries.json", json.dumps(eval_queries_clean, indent=2))

        # Templates
        pred_template = "ticket_id,priority\nTEST_0001,low\nTEST_0002,medium\n"
        zf.writestr("templates/predictions_template.csv", pred_template)

        retrieval_template = {
            "queries": [
                {
                    "query_id": "eval_q01",
                    "retrieved_articles": ["kb_auth_01", "kb_security_06", "kb_roles_13"],
                    "declined": False,
                    "answer": "OAuth Bearer tokens expire strictly after 3600 seconds (1 hour).",
                },
                {
                    "query_id": "eval_q16",
                    "retrieved_articles": [],
                    "declined": True,
                    "answer": "This question cannot be answered from the provided knowledge base corpus.",
                }
            ]
        }
        zf.writestr("templates/retrieval_template.json", json.dumps(retrieval_template, indent=2))

    print(f"Generated fake scenario assets in {OUTPUT_DIR}:")
    print(f"  - Starter kit: {zip_path} ({os.path.getsize(zip_path)} bytes)")
    print(f"  - Hidden GT: {os.path.join(OUTPUT_DIR, 'ai-stage3-hidden-ground-truth.json')}")
    print(f"  - Practice GT: {os.path.join(OUTPUT_DIR, 'ai-stage3-practice-ground-truth.json')}")


if __name__ == "__main__":
    build_scenario_assets()

