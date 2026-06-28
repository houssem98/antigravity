"""Regression test for filing_date body-date leak (P0-d root cause).

_extract_date used to return the first date found anywhere in the document, so
a future date in the body (lease term, debt maturity) became the filing_date
(e.g. 2031-12-31). It must now ignore implausible/future dates and pick the
latest plausible (<= today, >= 1994) date.
"""

from datetime import date, timedelta

from app.ingestion.processing.metadata_extractor import MetadataExtractor


def test_future_body_date_rejected():
    me = MetadataExtractor()
    text = (
        "This lease agreement expires on 2031-12-31 and the note matures "
        "2029-02-04. The company filed this report on 2026-02-15."
    )
    assert me._extract_date(text) == "2026-02-15"


def test_picks_latest_plausible_date():
    me = MetadataExtractor()
    text = "Comparatives for 2023-09-30 and 2024-09-28 are presented."
    assert me._extract_date(text) == "2024-09-28"


def test_no_date_falls_back_to_today():
    me = MetadataExtractor()
    assert me._extract_date("No dates here at all.") == date.today().isoformat()


def test_all_future_dates_fall_back_to_today():
    me = MetadataExtractor()
    future = (date.today() + timedelta(days=400)).isoformat()
    assert me._extract_date(f"Maturity {future} only.") == date.today().isoformat()
