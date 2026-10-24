"""
Unit tests for Grader metrics:
- Multi-class Macro-F1 and points mapping (predictions)
- Top-3 Retrieval accuracy and refusal scoring (retrieval)
Uses Python standard library unittest only.
"""

from __future__ import annotations

import unittest

from grader.graders.predictions import compute_macro_f1, parse_predictions_csv, score_predictions
from grader.graders.retrieval import normalize_candidate_retrieval, score_retrieval


class TestPredictionsGrader(unittest.TestCase):
    def setUp(self) -> None:
        self.ground_truth = {
            "T1": "low",
            "T2": "medium",
            "T3": "high",
            "T4": "urgent",
            "T5": "low",
            "T6": "medium",
            "T7": "high",
            "T8": "urgent",
        }

    def test_parse_valid_csv(self) -> None:
        csv_text = """ticket_id,priority
T1,low
T2,medium
T3,high
T4,urgent
"""
        parsed = parse_predictions_csv(csv_text)
        self.assertEqual(parsed["T1"], "low")
        self.assertEqual(parsed["T4"], "urgent")

    def test_parse_alternative_headers_and_whitespace(self) -> None:
        csv_text = """ ticket_id , prediction 
  T1  ,  LOW 
  T2  , Medium  
"""
        parsed = parse_predictions_csv(csv_text)
        self.assertEqual(parsed["T1"], "low")
        self.assertEqual(parsed["T2"], "medium")

    def test_parse_missing_header_fails(self) -> None:
        with self.assertRaises(ValueError):
            parse_predictions_csv("id,value\nT1,low")

    def test_perfect_predictions_macro_f1(self) -> None:
        # All correct
        f1, class_f1 = compute_macro_f1(self.ground_truth, self.ground_truth)
        self.assertEqual(f1, 1.0)
        for c in ["low", "medium", "high", "urgent"]:
            self.assertEqual(class_f1[c], 1.0)

        # Scored against defaults: f1 >= 0.85 gives max 15.0 points
        result = score_predictions(
            "ticket_id,priority\n" + "\n".join(f"{k},{v}" for k, v in self.ground_truth.items()),
            self.ground_truth,
        )
        self.assertEqual(result["points"], 15.0)
        self.assertEqual(result["macro_f1"], 1.0)

    def test_zero_or_low_score_mapping(self) -> None:
        # Predict everything as 'urgent' (only 2 out of 8 correct, precision low, recall 0 on others)
        all_urgent = {k: "urgent" for k in self.ground_truth}
        f1, class_f1 = compute_macro_f1(self.ground_truth, all_urgent)
        self.assertEqual(class_f1["low"], 0.0)
        self.assertEqual(class_f1["medium"], 0.0)
        self.assertEqual(class_f1["high"], 0.0)
        # urgent: TP=2, FP=6, FN=0 -> Precision=0.25, Recall=1.0 -> F1 = 2*0.25*1 / 1.25 = 0.40
        # Macro F1 = (0 + 0 + 0 + 0.40) / 4 = 0.10
        self.assertEqual(f1, 0.10)

        # Below baseline (0.40) gives 0.0 points
        result = score_predictions(
            "ticket_id,priority\n" + "\n".join(f"{k},urgent" for k in self.ground_truth),
            self.ground_truth,
        )
        self.assertEqual(result["points"], 0.0)

    def test_linear_interpolation_worked_example(self) -> None:
        # If macro_f1 = 0.625, with min=0.40, max=0.85, max_pts=15:
        # (0.625 - 0.40) / (0.85 - 0.40) * 15 = 0.225 / 0.45 * 15 = 0.5 * 15 = 7.50
        # Let's craft a prediction that hits this:
        # T1..T8: correct on low and medium (F1=1.0 each), wrong on high and urgent (F1=0.25 each)
        # Macro-F1 = (1.0 + 1.0 + 0.25 + 0.25) / 4 = 0.625
        preds = {
            "T1": "low", "T5": "low",
            "T2": "medium", "T6": "medium",
            "T3": "urgent", "T7": "urgent", # high predicted as urgent
            "T4": "high", "T8": "high",     # urgent predicted as high
        }
        # For high: TP=0, FP=2, FN=2 -> F1=0
        # For urgent: TP=0, FP=2, FN=2 -> F1=0
        # If both are 0, macro F1 is (1+1+0+0)/4 = 0.50
        # Points = (0.50 - 0.40) / 0.45 * 15 = 0.10 / 0.45 * 15 = 3.33
        result = score_predictions(
            "ticket_id,priority\n" + "\n".join(f"{k},{v}" for k, v in preds.items()),
            self.ground_truth,
        )
        self.assertEqual(result["macro_f1"], 0.5)
        self.assertAlmostEqual(result["points"], 3.33, places=2)

    def test_missing_tickets_counted_as_false_negatives(self) -> None:
        # Only submit half the tickets
        half_preds = "ticket_id,priority\nT1,low\nT5,low\nT2,medium"
        result = score_predictions(half_preds, self.ground_truth)
        self.assertEqual(result["matched_tickets"], 3)
        self.assertEqual(result["total_tickets"], 8)
        self.assertLess(result["macro_f1"], 0.5)


class TestRetrievalGrader(unittest.TestCase):
    def setUp(self) -> None:
        self.ground_truth = {
            "answerable": [
                {"query_id": f"q{i}", "target_article_id": f"art_{i}"} for i in range(1, 16)
            ],
            "unanswerable": [
                {"query_id": f"q{i}"} for i in range(16, 21)
            ],
        }

    def test_perfect_retrieval_and_refusal(self) -> None:
        # All 15 answerable have correct target in top-3
        # All 5 unanswerable are flagged declined: true
        candidate_data = {
            "queries": [
                {
                    "query_id": f"q{i}",
                    "retrieved_articles": [f"art_{i}", "other_1", "other_2"],
                    "declined": False,
                    "answer": f"Answer for q{i}",
                }
                for i in range(1, 16)
            ] + [
                {
                    "query_id": f"q{i}",
                    "retrieved_articles": [],
                    "declined": True,
                    "answer": "This question cannot be answered from the provided corpus.",
                }
                for i in range(16, 21)
            ]
        }

        res = score_retrieval(candidate_data, self.ground_truth)
        self.assertEqual(res["b1_hits"], 15)
        self.assertEqual(res["b1_points"], 15.0)
        self.assertEqual(res["b3_refusals"], 5)
        self.assertEqual(res["b3_points"], 10.0)
        self.assertEqual(res["total_points"], 25.0)

    def test_top3_boundary(self) -> None:
        # Target in position 3 (0-indexed 2) counts as hit
        # Target in position 4 (0-indexed 3) does NOT count as hit
        candidate_data = [
            {"query_id": "q1", "retrieved_articles": ["wrong_1", "wrong_2", "art_1"]},
            {"query_id": "q2", "retrieved_articles": ["wrong_1", "wrong_2", "wrong_3", "art_2"]},
        ]
        gt = {
            "answerable": [
                {"query_id": "q1", "target_article_id": "art_1"},
                {"query_id": "q2", "target_article_id": "art_2"},
            ],
            "unanswerable": [],
        }
        res = score_retrieval(candidate_data, gt, b1_max_points=15.0)
        self.assertEqual(res["b1_hits"], 1)
        self.assertEqual(res["b1_total"], 2)
        self.assertEqual(res["b1_points"], 7.5)

    def test_refusal_via_text_keywords(self) -> None:
        # Even if declined is not explicitly set, detecting refusal keywords counts
        candidate_data = [
            {
                "query_id": "q16",
                "retrieved_articles": [],
                "declined": False,
                "answer": "This query cannot be answered based on internal docs.",
            }
        ]
        gt = {"answerable": [], "unanswerable": [{"query_id": "q16"}]}
        res = score_retrieval(candidate_data, gt, b3_max_points=10.0)
        self.assertEqual(res["b3_refusals"], 1)
        self.assertEqual(res["b3_points"], 10.0)

    def test_zero_hits_zero_refusals(self) -> None:
        candidate_data = [
            {"query_id": f"q{i}", "retrieved_articles": ["random_doc"], "declined": False, "answer": "Halucinated answer"}
            for i in range(1, 21)
        ]
        res = score_retrieval(candidate_data, self.ground_truth)
        self.assertEqual(res["b1_hits"], 0)
        self.assertEqual(res["b3_refusals"], 0)
        self.assertEqual(res["total_points"], 0.0)


if __name__ == "__main__":
    unittest.main()
