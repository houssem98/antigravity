"""Regression test for the SEC-table column-alignment bug (P0-b).

SEC HTML income statements interleave the label, a '$' sign cell, and blank
spacer <td>s between each numeric value, so mapping the header column index
straight into the data row picked a spacer/'$'/footnote cell — e.g. R&D showed
"33" instead of ~$8B. TableIndexer._extract_rows must align numeric cells to
period columns by ORDER.
"""

from app.ingestion.processing.table_parser import ParsedTable
from app.ingestion.indexing.table_indexer import TableIndexer


def _rows_by_metric_period(rows):
    return {(r.metric_name, r.period): r.value_float for r in rows}


def test_dollar_and_spacer_cells_align_to_periods():
    # headers: label col + two period cols. Data rows carry extra '$' and blank
    # spacer cells, exactly like real SEC HTML.
    table = ParsedTable(
        headers=["", "FY2024", "FY2023"],
        rows=[
            ["Research and development", "$", "8,000", "", "$", "7,000"],
            ["Total net sales", "$", "100,000", "", "$", "90,000"],
            ["Operating income", "30,000", "25,000"],  # no '$' spacers — still fine
        ],
        caption="(in millions)",
    )
    ti = TableIndexer()
    by = _rows_by_metric_period(
        ti._extract_rows(table, "AAPL", "Apple Inc", "10-K", "2024-09-28", "doc1")
    )

    # The previously-broken small line item now resolves to the real value.
    assert by[("Research and development", "FY2024")] == 8000.0
    assert by[("Research and development", "FY2023")] == 7000.0
    assert by[("Total net sales", "FY2024")] == 100000.0
    assert by[("Total net sales", "FY2023")] == 90000.0
    assert by[("Operating income", "FY2024")] == 30000.0
    assert by[("Operating income", "FY2023")] == 25000.0
    # No '$'-only or blank cell leaked in as a value.
    assert all(v is not None for v in by.values())


def test_negatives_in_parentheses_align():
    table = ParsedTable(
        headers=["", "FY2024", "FY2023"],
        rows=[["Net loss", "$", "(1,200)", "", "$", "(900)"]],
        caption="(in millions)",
    )
    ti = TableIndexer()
    by = _rows_by_metric_period(
        ti._extract_rows(table, "X", "X Corp", "10-Q", "2024-06-30", "doc2")
    )
    assert by[("Net loss", "FY2024")] == -1200.0
    assert by[("Net loss", "FY2023")] == -900.0
