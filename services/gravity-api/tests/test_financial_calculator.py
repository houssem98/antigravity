"""Tests for the Financial Calculator Engine."""
import pytest
from app.core.financial_calculator import (
    parse_financial_number,
    percentage_change,
    yoy_growth,
    cagr,
    gross_margin,
    operating_margin,
    net_margin,
    pe_ratio,
    ev_ebitda,
    debt_to_equity,
    current_ratio,
    return_on_equity,
    free_cash_flow,
    eps_diluted,
    weighted_average,
    execute_calculation,
    detect_calculation_type,
)


class TestParseFinancialNumber:
    """Test financial number parsing."""

    def test_plain_number(self):
        assert parse_financial_number("1234.56") == 1234.56

    def test_with_commas(self):
        assert parse_financial_number("1,234,567") == 1234567

    def test_with_dollar_sign(self):
        assert parse_financial_number("$1,234.56") == 1234.56

    def test_billions(self):
        assert parse_financial_number("$124.3B") == 124.3e9

    def test_millions(self):
        assert parse_financial_number("$45.6M") == 45.6e6

    def test_thousands(self):
        assert parse_financial_number("$100K") == 100e3

    def test_trillions(self):
        assert parse_financial_number("$2.5T") == 2.5e12

    def test_parentheses_negative(self):
        assert parse_financial_number("(1,234)") == -1234

    def test_minus_negative(self):
        assert parse_financial_number("-$45.6M") == -45.6e6

    def test_percentage(self):
        assert parse_financial_number("12.5%") == pytest.approx(0.125)

    def test_euro(self):
        assert parse_financial_number("€100") == 100

    def test_empty(self):
        assert parse_financial_number("") is None

    def test_non_numeric(self):
        assert parse_financial_number("hello") is None

    def test_nbsp(self):
        assert parse_financial_number("$1,234\xa0M") == 1234e6


class TestCalculations:
    """Test financial calculation functions."""

    def test_percentage_change(self):
        assert percentage_change(100, 120) == pytest.approx(20.0)
        assert percentage_change(100, 80) == pytest.approx(-20.0)
        assert percentage_change(100, 100) == pytest.approx(0.0)

    def test_percentage_change_zero(self):
        assert percentage_change(0, 100) == float("inf")

    def test_yoy_growth(self):
        assert yoy_growth(638, 574.8) == pytest.approx(11.0, abs=0.5)

    def test_cagr(self):
        assert cagr(100, 200, 7) == pytest.approx(10.4, abs=0.5)
        assert cagr(168088, 245122, 3) == pytest.approx(13.3, abs=1.0)

    def test_gross_margin(self):
        assert gross_margin(245122, 129536) == pytest.approx(47.2, abs=0.5)

    def test_operating_margin(self):
        assert operating_margin(100, 25) == pytest.approx(25.0)

    def test_net_margin(self):
        assert net_margin(391035, 101956) == pytest.approx(26.1, abs=0.5)

    def test_pe_ratio(self):
        assert pe_ratio(150, 6.42) == pytest.approx(23.4, abs=0.5)

    def test_pe_ratio_zero_eps(self):
        assert pe_ratio(150, 0) == float("inf")

    def test_ev_ebitda(self):
        assert ev_ebitda(3000, 150) == pytest.approx(20.0)

    def test_debt_to_equity(self):
        assert debt_to_equity(108040, 74100) == pytest.approx(1.458, abs=0.01)

    def test_current_ratio(self):
        assert current_ratio(150000, 100000) == pytest.approx(1.5)

    def test_roe(self):
        assert return_on_equity(101956, 64750) == pytest.approx(157.5, abs=1.0)

    def test_free_cash_flow(self):
        assert free_cash_flow(118254, 10959) == pytest.approx(107295)
        assert free_cash_flow(118254, -10959) == pytest.approx(107295)

    def test_eps_diluted(self):
        assert eps_diluted(101956, 15882) == pytest.approx(6.42, abs=0.01)

    def test_weighted_average(self):
        assert weighted_average([10, 20, 30], [1, 2, 3]) == pytest.approx(23.33, abs=0.1)
        assert weighted_average([], []) == 0.0


class TestExecuteCalculation:
    """Test the calculation registry dispatcher."""

    def test_percentage_change_dispatch(self):
        result = execute_calculation("percentage_change", {
            "old": "574.8",
            "new": "638.0",
        })
        assert result["result"] is not None
        assert abs(result["result"] - 11.0) < 1.0

    def test_gross_margin_dispatch(self):
        result = execute_calculation("gross_margin", {
            "revenue": "$245.1B",
            "cogs": "$129.5B",
        })
        assert result["result"] is not None
        assert abs(result["result"] - 47.2) < 1.0

    def test_unknown_calculation(self):
        result = execute_calculation("nonexistent", {})
        assert result.get("error") is not None

    def test_missing_parameter(self):
        result = execute_calculation("pe_ratio", {"price": "150"})
        assert result.get("error") is not None


class TestDetectCalculationType:
    """Test auto-detection of calculation type from queries."""

    def test_yoy(self):
        assert detect_calculation_type("What is the YoY revenue growth?") == "yoy_growth"

    def test_gross_margin(self):
        assert detect_calculation_type("What was Apple's gross margin in FY2024?") == "gross_margin"

    def test_pe_ratio(self):
        assert detect_calculation_type("What is the P/E ratio?") == "pe_ratio"

    def test_ev_ebitda(self):
        assert detect_calculation_type("Calculate EV/EBITDA for Microsoft") == "ev_ebitda"

    def test_debt_to_equity(self):
        assert detect_calculation_type("What is the debt-to-equity ratio?") == "debt_to_equity"

    def test_free_cash_flow(self):
        assert detect_calculation_type("What was free cash flow last year?") == "free_cash_flow"

    def test_no_match(self):
        assert detect_calculation_type("Who is the CEO of Apple?") is None

    def test_eps(self):
        assert detect_calculation_type("What is the diluted earnings per share?") == "eps_diluted"

    def test_percentage_change(self):
        assert detect_calculation_type("What was the percentage change in revenue?") == "percentage_change"

    def test_roe(self):
        assert detect_calculation_type("Calculate return on equity") == "roe"
