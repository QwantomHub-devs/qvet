"""
Part B Retrieval & Refusal Grader (B1 and B3 Metrics).
B1: Retrieval accuracy (correct article in top-3) on answerable queries (15 points).
B3: Hallucination resistance (correct refusal) on unanswerable queries (10 points).
Uses standard library only.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple, Union


REFUSAL_KEYWORDS = {
    "declined",
    "cannot be answered",
    "cannot answer",
    "not enough information",
    "unanswerable",
    "not found in corpus",
    "no relevant article",
    "not covered",
    "insufficient information",
}


def normalize_candidate_retrieval(raw_data: Union[str, Dict[str, Any], List[Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Normalizes candidate submission into a dictionary keyed by query_id.
    Accepts raw JSON string, list of query dicts, or nested dicts.
    """
    if isinstance(raw_data, str):
        try:
            data = json.loads(raw_data)
        except Exception as e:
            raise ValueError(f"Malformed JSON in retrieval submission: {e}")
    else:
        data = raw_data

    normalized: Dict[str, Dict[str, Any]] = {}

    if isinstance(data, dict):
        if "queries" in data and isinstance(data["queries"], list):
            items = data["queries"]
        elif "results" in data and isinstance(data["results"], list):
            items = data["results"]
        else:
            # Maybe { "q1": {...}, "q2": {...} }
            items = []
            for k, v in data.items():
                if isinstance(v, dict):
                    v_copy = dict(v)
                    v_copy.setdefault("query_id", k)
                    items.append(v_copy)

    elif isinstance(data, list):
        items = data
    else:
        raise ValueError("Retrieval submission must be a JSON object or array")

    for item in items:
        if not isinstance(item, dict):
            continue
        qid = str(item.get("query_id", "")).strip()
        if not qid:
            continue

        raw_articles = item.get("retrieved_articles", item.get("articles", item.get("sources", [])))
        if isinstance(raw_articles, list):
            retrieved = [str(a).strip().lower() for a in raw_articles if str(a).strip()]
        elif isinstance(raw_articles, str) and raw_articles.strip():
            retrieved = [a.strip().lower() for a in raw_articles.split(",") if a.strip()]
        else:
            retrieved = []

        declined = bool(item.get("declined", item.get("refused", False)))
        answer = str(item.get("answer", item.get("response", ""))).strip()

        # If answer explicitly mentions standard refusal keywords, treat as declined
        if not declined and any(kw in answer.lower() for kw in REFUSAL_KEYWORDS):
            declined = True

        normalized[qid] = {
            "query_id": qid,
            "retrieved_articles": retrieved,
            "declined": declined,
            "answer": answer,
        }

    return normalized


def score_retrieval(
    candidate_submission: Union[str, Dict[str, Any], List[Any]],
    ground_truth: Union[str, Dict[str, Any], List[Any]],
    b1_max_points: float = 15.0,
    b3_max_points: float = 10.0,
) -> Dict[str, Any]:
    """
    Evaluates candidate retrieval and refusal against ground truth.
    Returns scores for B1 (retrieval) and B3 (refusal), total points, and feedback.
    """
    if isinstance(ground_truth, str):
        gt = json.loads(ground_truth)
    else:
        gt = ground_truth

    # Parse answerable & unanswerable lists
    answerable: List[Dict[str, str]] = []
    unanswerable: List[str] = []

    if isinstance(gt, dict):
        if "answerable" in gt:
            for item in gt["answerable"]:
                qid = str(item.get("query_id", "")).strip()
                target = str(item.get("target_article_id", item.get("target_id", ""))).strip().lower()
                if qid and target:
                    answerable.append({"query_id": qid, "target": target})
        if "unanswerable" in gt:
            for item in gt["unanswerable"]:
                if isinstance(item, dict):
                    qid = str(item.get("query_id", "")).strip()
                else:
                    qid = str(item).strip()
                if qid:
                    unanswerable.append(qid)
    elif isinstance(gt, list):
        for item in gt:
            if not isinstance(item, dict):
                continue
            qid = str(item.get("query_id", "")).strip()
            is_ans = bool(item.get("is_answerable", True))
            target = str(item.get("target_article_id", item.get("target_id", ""))).strip().lower()
            if not is_ans or not target:
                unanswerable.append(qid)
            else:
                answerable.append({"query_id": qid, "target": target})

    candidate_preds = normalize_candidate_retrieval(candidate_submission)

    # Evaluate B1: Retrieval accuracy (target in top-3)
    b1_hits = 0
    total_answerable = len(answerable)
    b1_details: List[Dict[str, Any]] = []

    for item in answerable:
        qid = item["query_id"]
        target = item["target"]
        cand = candidate_preds.get(qid)
        top3 = cand["retrieved_articles"][:3] if cand else []
        hit = target in top3
        if hit:
            b1_hits += 1
        b1_details.append({
            "query_id": qid,
            "target": target,
            "top3": top3,
            "hit": hit,
        })

    b1_hit_rate = (b1_hits / total_answerable) if total_answerable > 0 else 0.0
    b1_points = round(b1_hit_rate * b1_max_points, 2)

    # Evaluate B3: Refusal on unanswerable queries
    b3_refusals = 0
    total_unanswerable = len(unanswerable)
    b3_details: List[Dict[str, Any]] = []

    for qid in unanswerable:
        cand = candidate_preds.get(qid)
        declined = cand.get("declined", False) if cand else False
        # Also count as correct refusal if empty retrieved articles and no made-up answer
        if not declined and cand and not cand.get("retrieved_articles") and not cand.get("answer"):
            declined = True

        if declined:
            b3_refusals += 1
        b3_details.append({
            "query_id": qid,
            "declined": declined,
        })

    b3_refusal_rate = (b3_refusals / total_unanswerable) if total_unanswerable > 0 else 0.0
    b3_points = round(b3_refusal_rate * b3_max_points, 2)

    total_points = round(b1_points + b3_points, 2)

    feedback = (
        f"B1 Retrieval: {b1_hits}/{total_answerable} top-3 hits ({b1_points:.2f}/{b1_max_points:.1f} pts). "
        f"B3 Refusal: {b3_refusals}/{total_unanswerable} unanswerable queries correctly declined "
        f"({b3_points:.2f}/{b3_max_points:.1f} pts). "
        f"Total Part B Auto: {total_points:.2f}/{b1_max_points + b3_max_points:.1f} pts."
    )

    return {
        "b1_hits": b1_hits,
        "b1_total": total_answerable,
        "b1_hit_rate": round(b1_hit_rate, 4),
        "b1_points": b1_points,
        "b3_refusals": b3_refusals,
        "b3_total": total_unanswerable,
        "b3_refusal_rate": round(b3_refusal_rate, 4),
        "b3_points": b3_points,
        "total_points": total_points,
        "feedback": feedback,
        "b1_details": b1_details,
        "b3_details": b3_details,
    }

