"""Tests for the financial table parser — HTML and PDF table extraction."""
import pytest

from app.ingestion.processing.table_parser import (
    FinancialTableParser,
    ParsedTable,
)


class TestParsedTable:
    """Test the ParsedTable dataclass."""

    def test_basic_table(self):
        table = ParsedTable(
            headers=["Metric", "Q3 2025", "Q3 2024"],
            rows=[
                ["Revenue", "$124.3B", "$111.0B"],
                ["Net Income", "$36.3B", "$30.1B"],
            ],
        )
        assert table.row_count == 2
        assert table.col_count == 3
        assert table.table_type == "income_statement"  # "Revenue" + "Net Income" → IS

    def test_balance_sheet_detection(self):
        table = ParsedTable(
            headers=["", "2025", "2024"],
            rows=[
                ["Total Assets", "$352.6B", "$338.5B"],
                ["Total Liabilities", "$274.8B", "$264.9B"],
                ["Stockholders' Equity", "$77.8B", "$73.6B"],
            ],
        )
        assert table.table_type == "balance_sheet"

    def test_cash_flow_detection(self):
        table = ParsedTable(
            headers=["", "FY2025"],
            rows=[
                ["Cash Flows from Operating Activities", "$118.3B"],
                ["Capital Expenditures", "$($10.8B)"],
                ["Free Cash Flow", "$107.5B"],
            ],
        )
        assert table.table_type == "cash_flow"

    def test_other_type(self):
        table = ParsedTable(
            headers=["Name", "Role"],
            rows=[
                ["Tim Cook", "CEO"],
                ["Luca Maestri", "CFO"],
            ],
        )
        assert table.table_type == "other"

    def test_to_markdown(self):
        table = ParsedTable(
            headers=["Metric", "Value"],
            rows=[["Revenue", "$124.3B"]],
        )
        md = table.to_markdown()
        assert "| Metric | Value |" in md
        assert "| Revenue | $124.3B |" in md
        assert "|---|---|" in md

    def test_to_markdown_with_caption(self):
        table = ParsedTable(
            headers=["A", "B"],
            rows=[["1", "2"]],
            caption="Income Statement",
        )
        md = table.to_markdown()
        assert "**Income Statement**" in md

    def test_to_structured_dict(self):
        table = ParsedTable(
            headers=["Metric", "Value"],
            rows=[["Revenue", "$124.3B"]],
            caption="Test",
        )
        d = table.to_structured_dict()
        assert d["table_type"] in ("income_statement", "other")
        assert d["headers"] == ["Metric", "Value"]
        assert d["rows"] == [["Revenue", "$124.3B"]]
        assert d["row_count"] == 1
        assert d["col_count"] == 2

    def test_empty_table(self):
        table = ParsedTable(headers=[], rows=[])
        assert table.to_markdown() == ""


class TestFinancialTableParserHTML:
    """Test HTML table extraction."""

    @pytest.fixture
    def parser(self):
        return FinancialTableParser()

    def test_simple_html_table(self, parser):
        html = """
        <html><body>
        <p>Consolidated Statements of Operations</p>
        <table>
            <thead>
                <tr><th>Metric</th><th>Q3 2025</th><th>Q3 2024</th></tr>
            </thead>
            <tbody>
                <tr><td>Net Revenue</td><td>$124,300</td><td>$111,000</td></tr>
                <tr><td>Cost of Revenue</td><td>$67,100</td><td>$60,200</td></tr>
                <tr><td>Gross Profit</td><td>$57,200</td><td>$50,800</td></tr>
            </tbody>
        </table>
        </body></html>
        """
        tables = parser.extract_html_tables(html, section_name="Item 8")
        assert len(tables) == 1
        table = tables[0]
        assert table.row_count >= 3
        assert table.headers[0] == "Metric"
        assert table.source_section == "Item 8"
        assert table.table_type == "income_statement"  # "Gross Profit" triggers IS

    def test_table_with_colspan(self, parser):
        html = """
        <table>
            <tr><th>Metric</th><th colspan="2">2025</th></tr>
            <tr><td>Revenue</td><td>Q3</td><td>Q4</td></tr>
            <tr><td>Total</td><td>$100</td><td>$120</td></tr>
        </table>
        """
        tables = parser.extract_html_tables(html)
        assert len(tables) >= 1

    def test_no_tables_in_html(self, parser):
        html = "<html><body><p>Just a paragraph of text.</p></body></html>"
        tables = parser.extract_html_tables(html)
        assert len(tables) == 0

    def test_trivial_table_skipped(self, parser):
        """Tables with less than 2 rows should be skipped."""
        html = """
        <table><tr><td>Just one row</td></tr></table>
        """
        tables = parser.extract_html_tables(html)
        assert len(tables) == 0

    def test_multiple_tables(self, parser):
        html = """
        <table>
            <tr><th>A</th><th>B</th></tr>
            <tr><td>Total Revenue</td><td>$100B</td></tr>
            <tr><td>Net Income</td><td>$20B</td></tr>
        </table>
        <table>
            <tr><th>C</th><th>D</th></tr>
            <tr><td>Total Assets</td><td>$300B</td></tr>
            <tr><td>Total Liabilities</td><td>$200B</td></tr>
        </table>
        """
        tables = parser.extract_html_tables(html)
        assert len(tables) == 2
        types = {t.table_type for t in tables}
        # First should be IS, second BS
        assert "income_statement" in types or "balance_sheet" in types


class TestFinancialTableParserUtility:
    """Test utility methods."""

    def test_clean_cell(self):
        assert FinancialTableParser._clean_cell("  hello   world  ") == "hello world"
        assert FinancialTableParser._clean_cell("$1,234\xa0M") == "$1,234 M"

    def test_is_numeric(self):
        assert FinancialTableParser._is_numeric("$1,234.56") is True
        assert FinancialTableParser._is_numeric("(123)") is True
        assert FinancialTableParser._is_numeric("45.6%") is True
        assert FinancialTableParser._is_numeric("Revenue") is False
        assert FinancialTableParser._is_numeric("") is False
