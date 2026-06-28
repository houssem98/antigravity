"""Unit tests for the FinanceBench retrieval-recall scorer (eval infra)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "eval"))
import financebench as fb  # noqa: E402


def test_recall_hit_when_evidence_in_sources():
    ev = [{"evidence_text": "Research and development expense was 8000 million in fiscal 2024"}]
    src = [{"text": "Apple research and development expense fiscal 2024 totaled 8000 million dollars"}]
    assert fb.evidence_recall(ev, src) is True


def test_recall_miss_when_unrelated_sources():
    ev = [{"evidence_text": "quick ratio improved from 0.67 to 0.69 between fiscal 2022 and 2023"}]
    src = [{"text": "the weather today is sunny and warm with light winds"}]
    assert fb.evidence_recall(ev, src) is False


def test_recall_neutral_when_no_evidence():
    assert fb.evidence_recall([], [{"text": "anything"}]) is True


def test_recall_partial_below_threshold_is_miss():
    ev = [{"evidence_text": "operating income margin expanded fifty basis points segment international"}]
    src = [{"text": "operating income was reported"}]  # only 'operating','income' overlap
    assert fb.evidence_recall(ev, src, threshold=0.5) is False
