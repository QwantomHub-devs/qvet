"""
Part A1 Predictions Grader - Macro-F1 Metric on Support Ticket Priorities.
Computes multi-class Macro-F1 score and maps it linearly to points (0 to 15).
Uses standard library only.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Set, Tuple


DEFAULT_F1_MIN = 0.40
DEFAULT_F1_MAX = 0.85
DEFAULT_MAX_POINTS = 15.0


def parse_predictions_csv(csv_text: str) -> Dict[str, str]:
    """
    Parses candidate prediction CSV text.
    Expected header: ticket_id,priority (or prediction).
    Returns mapping of ticket_id -> normalized lower-case priority string.
    """
    reader = csv.reader(io.StringIO(csv_text.strip()))
    header = next(reader, None)
    if not header:
        raise ValueError("Submitted CSV is empty or has no header row")

    header_clean = [col.strip().lower() for col in header]
    if "ticket_id" not in header_clean:
        raise ValueError("Missing 'ticket_id' column in predictions CSV header")

    pred_col = None
    for candidate_name in ("priority", "prediction", "label", "target"):
        if candidate_name in header_clean:
            pred_col = candidate_name
            break

    if not pred_col:
        raise ValueError("Missing 'priority' column in predictions CSV header")

    id_idx = header_clean.index("ticket_id")
    pred_idx = header_clean.index(pred_col)

    preds: Dict[str, str] = {}
    for row_num, row in enumerate(reader, start=2):
        if not row or not any(row):
            continue
        if len(row) <= max(id_idx, pred_idx):
            raise ValueError(f"Row {row_num} has fewer columns than header")
        tid = row[id_idx].strip()
        val = row[pred_idx].strip().lower()
        if not tid:
            continue
        preds[tid] = val

    if not preds:
        raise ValueError("Submitted CSV contained no valid prediction rows")

    return preds


def compute_macro_f1(
    y_true: Dict[str, str],
    y_pred: Dict[str, str],
    classes: Set[str] | None = None,
) -> Tuple[float, Dict[str, float]]:
    """
    Calculates Macro-F1 score across all classes.
    Only tickets present in y_true are evaluated.
    Unpredicted tickets default to an empty string (counted as false negative).
    """
    if classes is None:
        classes = set(y_true.values())

    class_f1: Dict[str, float] = {}

    for c in sorted(classes):
        tp = 0
        fp = 0
        fn = 0

        for tid, true_val in y_true.items():
            pred_val = y_pred.get(tid, "")
            is_true = (true_val == c)
            is_pred = (pred_val == c)

            if is_true and is_pred:
                tp += 1
            elif not is_true and is_pred:
                fp += 1
            elif is_true and not is_pred:
                fn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
        class_f1[c] = round(f1, 4)

    macro_f1 = sum(class_f1.values()) / len(classes) if classes else 0.0
    return round(macro_f1, 4), class_f1


def score_predictions(
    candidate_csv_text: str,
    ground_truth: Dict[str, str],
    f1_min: float = DEFAULT_F1_MIN,
    f1_max: float = DEFAULT_F1_MAX,
    max_points: float = DEFAULT_MAX_POINTS,
) -> Dict[str, Any]:
    """
    Evaluates candidate predictions against ground truth dictionary {ticket_id: label}.
    Calculates Macro-F1 and maps to points [0, max_points].
    """
    preds = parse_predictions_csv(candidate_csv_text)
    classes = set(ground_truth.values())

    macro_f1, class_f1 = compute_macro_f1(ground_truth, preds, classes)

    # Linear interpolation between f1_min and f1_max
    if macro_f1 <= f1_min:
        points = 0.0
    elif macro_f1 >= f1_max:
        points = float(max_points)
    else:
        points = ((macro_f1 - f1_min) / (f1_max - f1_min)) * max_points

    points = round(points, 2)
    matched_count = sum(1 for tid in ground_truth if tid in preds)

    feedback = (
        f"Macro-F1: {macro_f1:.4f} (baseline: {f1_min:.2f}, ceiling: {f1_max:.2f}). "
        f"Awarded {points:.2f} / {max_points:.1f} points. "
        f"Evaluated {matched_count}/{len(ground_truth)} tickets."
    )

    return {
        "macro_f1": macro_f1,
        "class_f1": class_f1,
        "points": points,
        "max_points": max_points,
        "matched_tickets": matched_count,
        "total_tickets": len(ground_truth),
        "feedback": feedback,
    }

