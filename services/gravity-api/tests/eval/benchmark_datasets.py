"""
Gravity Search — Benchmark Evaluation Datasets
FinanceBench + FinQA + TAT-QA format-aligned test sets.

These are curated evaluation examples in the exact format of each benchmark
so we can measure our pipeline against the same scoring criteria.
"""

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any


class BenchmarkType(str, Enum):
    FINANCE_BENCH = "financebench"  # RAG QA over SEC filings
    FINQA = "finqa"  # Numerical reasoning
    TAT_QA = "tatqa"  # Hybrid table+text QA
    CONV_FINQA = "convfinqa"  # Conversational financial QA
    FPB = "fpb"  # Sentiment classification
    BIZBENCH = "bizbench"  # Quantitative business reasoning


@dataclass
class BenchmarkExample:
    """A single benchmark test case."""
    id: str
    benchmark: BenchmarkType
    question: str
    answer: str  # Ground truth answer (text or numeric)
    answer_type: str = "text"  # text | number | percentage | ratio | boolean
    context: str = ""  # Document context (for RAG evaluation)
    table_context: str = ""  # Table in markdown/structured format
    program: str = ""  # FinQA-style calculation program
    steps: list[str] = field(default_factory=list)  # Multi-step reasoning chain
    source_doc: str = ""  # Source document identifier
    entity: str = ""  # Company ticker
    difficulty: str = "medium"  # easy | medium | hard
    category: str = ""  # Sub-category within benchmark
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ═══════════════════════════════════════════════════════════════════════
# FinanceBench-style examples (RAG QA over SEC filings)
# Source format: question + answer + evidence from real 10-K/10-Q filings
# ═══════════════════════════════════════════════════════════════════════

FINANCEBENCH_EXAMPLES = [
    BenchmarkExample(
        id="fb_001",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What was Apple's total net revenue for fiscal year 2024?",
        answer="$391.0 billion",
        answer_type="number",
        entity="AAPL",
        source_doc="AAPL_10K_FY2024",
        category="extraction",
        difficulty="easy",
        context="Consolidated Statements of Operations: Net sales for the fiscal year ended September 28, 2024 were $391,035 million.",
    ),
    BenchmarkExample(
        id="fb_002",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What percentage of Microsoft's revenue came from cloud services in FY2024?",
        answer="Approximately 56%",
        answer_type="percentage",
        entity="MSFT",
        source_doc="MSFT_10K_FY2024",
        category="calculation",
        difficulty="medium",
        context="Intelligent Cloud segment revenue was $96.8 billion. Total revenue was $245.1 billion.",
        program="divide(96.8, 245.1) * 100",
    ),
    BenchmarkExample(
        id="fb_003",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="Did NVIDIA's gross margin improve or decline between FY2023 and FY2024?",
        answer="NVIDIA's gross margin improved from 56.9% in FY2023 to 72.7% in FY2024.",
        answer_type="text",
        entity="NVDA",
        source_doc="NVDA_10K_FY2024",
        category="comparison",
        difficulty="medium",
        steps=["Extract FY2023 gross margin", "Extract FY2024 gross margin", "Compare"],
    ),
    BenchmarkExample(
        id="fb_004",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What are the main risk factors disclosed in Tesla's most recent 10-K?",
        answer="Key risk factors include: competition, supply chain dependencies, regulatory risk, demand uncertainty, EV adoption rate, battery costs, and geopolitical risk from China operations.",
        answer_type="text",
        entity="TSLA",
        source_doc="TSLA_10K_FY2024",
        category="extraction",
        difficulty="easy",
    ),
    BenchmarkExample(
        id="fb_005",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What was the year-over-year revenue growth rate for Amazon in fiscal year 2024?",
        answer="Approximately 12%",
        answer_type="percentage",
        entity="AMZN",
        source_doc="AMZN_10K_FY2024",
        category="calculation",
        difficulty="medium",
        context="Net sales were $638.0 billion in 2024 and $574.8 billion in 2023.",
        program="subtract(638.0, 574.8) / 574.8 * 100",
        steps=["Get 2024 revenue: $638.0B", "Get 2023 revenue: $574.8B", "Calculate: (638-574.8)/574.8 = 11.0%"],
    ),
    BenchmarkExample(
        id="fb_006",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What is Alphabet's total cash and short-term investments as of Q4 2024?",
        answer="$95.7 billion",
        answer_type="number",
        entity="GOOGL",
        source_doc="GOOGL_10K_FY2024",
        category="extraction",
        difficulty="easy",
        context="Cash, cash equivalents, and short-term marketable securities totaled $95,659 million as of December 31, 2024.",
    ),
    BenchmarkExample(
        id="fb_007",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What was Meta's operating margin in Q4 2024?",
        answer="Approximately 48%",
        answer_type="percentage",
        entity="META",
        source_doc="META_10Q_Q42024",
        category="calculation",
        difficulty="medium",
        context="Q4 2024: Revenue $48.4B, Income from operations $23.4B.",
        program="divide(23.4, 48.4) * 100",
    ),
    BenchmarkExample(
        id="fb_008",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="How does JPMorgan's net interest income compare to its non-interest income in FY2024?",
        answer="Net interest income was approximately $92.6 billion vs non-interest income of $67.9 billion. NII represents about 58% of total net revenue.",
        answer_type="text",
        entity="JPM",
        source_doc="JPM_10K_FY2024",
        category="comparison",
        difficulty="hard",
    ),
    BenchmarkExample(
        id="fb_009",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What was the total amount of stock buybacks executed by Apple in fiscal year 2024?",
        answer="$94.9 billion",
        answer_type="number",
        entity="AAPL",
        source_doc="AAPL_10K_FY2024",
        category="extraction",
        difficulty="medium",
    ),
    BenchmarkExample(
        id="fb_010",
        benchmark=BenchmarkType.FINANCE_BENCH,
        question="What is TSMC's capital expenditure guidance for 2025?",
        answer="Between $38 billion and $42 billion",
        answer_type="text",
        entity="TSM",
        source_doc="TSM_ER_Q42024",
        category="extraction",
        difficulty="medium",
    ),
]


# ═══════════════════════════════════════════════════════════════════════
# FinQA-style examples (Numerical reasoning over financial reports)
# Source format: question + table + text → program → answer
# ═══════════════════════════════════════════════════════════════════════

FINQA_EXAMPLES = [
    BenchmarkExample(
        id="fq_001",
        benchmark=BenchmarkType.FINQA,
        question="What is the percentage change in total revenue from 2023 to 2024?",
        answer="12.0",
        answer_type="percentage",
        entity="AMZN",
        category="percentage_change",
        difficulty="easy",
        table_context="""| | 2024 | 2023 |
|---|---|---|
| Net Sales | $638,013 | $574,785 |
| Operating Income | $68,594 | $36,852 |""",
        program="percentage_change(574785, 638013)",
        steps=[
            "Identify 2024 revenue: $638,013M",
            "Identify 2023 revenue: $574,785M",
            "Calculate: (638013 - 574785) / 574785 × 100 = 11.0%",
        ],
    ),
    BenchmarkExample(
        id="fq_002",
        benchmark=BenchmarkType.FINQA,
        question="What was the gross margin in 2024?",
        answer="47.2",
        answer_type="percentage",
        entity="MSFT",
        category="margin_calculation",
        difficulty="easy",
        table_context="""| | 2024 | 2023 |
|---|---|---|
| Revenue | $245,122 | $211,915 |
| Cost of Revenue | $129,536 | $112,440 |
| Gross Profit | $115,586 | $99,475 |""",
        program="gross_margin(245122, 129536)",
        steps=[
            "Revenue = $245,122M",
            "COGS = $129,536M",
            "Gross Margin = (245122 - 129536) / 245122 × 100 = 47.2%",
        ],
    ),
    BenchmarkExample(
        id="fq_003",
        benchmark=BenchmarkType.FINQA,
        question="What is the debt-to-equity ratio?",
        answer="1.45",
        answer_type="ratio",
        entity="AAPL",
        category="ratio_calculation",
        difficulty="medium",
        table_context="""| Balance Sheet | Amount |
|---|---|
| Total Debt | $108,040 |
| Stockholders' Equity | $74,100 |""",
        program="debt_to_equity(108040, 74100)",
        steps=[
            "Total Debt = $108,040M",
            "Equity = $74,100M",
            "D/E = 108040 / 74100 = 1.458",
        ],
    ),
    BenchmarkExample(
        id="fq_004",
        benchmark=BenchmarkType.FINQA,
        question="What is the diluted EPS for 2024?",
        answer="6.42",
        answer_type="number",
        entity="AAPL",
        category="per_share",
        difficulty="easy",
        table_context="""| | 2024 |
|---|---|
| Net Income | $101,956M |
| Diluted Shares | 15,882M |""",
        program="eps_diluted(101956, 15882)",
    ),
    BenchmarkExample(
        id="fq_005",
        benchmark=BenchmarkType.FINQA,
        question="What is the 3-year CAGR of revenue from 2021 to 2024?",
        answer="9.8",
        answer_type="percentage",
        entity="MSFT",
        category="growth_calculation",
        difficulty="hard",
        table_context="""| Year | Revenue (M) |
|---|---|
| 2021 | $168,088 |
| 2022 | $198,270 |
| 2023 | $211,915 |
| 2024 | $245,122 |""",
        program="cagr(168088, 245122, 3)",
        steps=[
            "Beginning (2021) = $168,088M",
            "Ending (2024) = $245,122M",
            "Years = 3",
            "CAGR = (245122/168088)^(1/3) - 1 = 13.3%",
        ],
    ),
    BenchmarkExample(
        id="fq_006",
        benchmark=BenchmarkType.FINQA,
        question="What is the free cash flow for 2024?",
        answer="73,005",
        answer_type="number",
        entity="AAPL",
        category="calculation",
        difficulty="medium",
        table_context="""| Cash Flow Statement | 2024 |
|---|---|
| Operating Cash Flow | $118,254M |
| Capital Expenditures | ($10,959M) |
| Acquisitions | ($2,117M) |""",
        program="free_cash_flow(118254, 10959)",
        steps=[
            "Operating Cash Flow = $118,254M",
            "CapEx = $10,959M",
            "FCF = 118254 - 10959 = $107,295M",
        ],
    ),
    BenchmarkExample(
        id="fq_007",
        benchmark=BenchmarkType.FINQA,
        question="How much did operating income grow year-over-year?",
        answer="86.0",
        answer_type="percentage",
        entity="AMZN",
        category="percentage_change",
        difficulty="medium",
        table_context="""| | 2024 | 2023 |
|---|---|---|
| Operating Income | $68,594 | $36,852 |""",
        program="yoy_growth(68594, 36852)",
    ),
    BenchmarkExample(
        id="fq_008",
        benchmark=BenchmarkType.FINQA,
        question="What is the return on equity?",
        answer="157.5",
        answer_type="percentage",
        entity="AAPL",
        category="return_metric",
        difficulty="medium",
        table_context="""| | Amount |
|---|---|
| Net Income | $101,956M |
| Average Equity (FY24) | $64,750M |""",
        program="roe(101956, 64750)",
    ),
]


# ═══════════════════════════════════════════════════════════════════════
# TAT-QA-style examples (Hybrid table + text reasoning)
# Source format: table + text paragraph → question → answer
# ═══════════════════════════════════════════════════════════════════════

TATQA_EXAMPLES = [
    BenchmarkExample(
        id="tq_001",
        benchmark=BenchmarkType.TAT_QA,
        question="What was the total revenue for the three months ended March 31, 2024?",
        answer="$143,313",
        answer_type="number",
        entity="AMZN",
        category="span_extraction",
        difficulty="easy",
        table_context="""| | Three Months Ended March 31 |
| | 2024 | 2023 |
|---|---|---|
| Net product sales | $59,641 | $51,098 |
| Net service sales | $83,672 | $71,721 |
| Total net sales | $143,313 | $122,819 |""",
        context="Amazon reported net sales of $143.3 billion for Q1 2024, an increase of 17% compared to Q1 2023.",
    ),
    BenchmarkExample(
        id="tq_002",
        benchmark=BenchmarkType.TAT_QA,
        question="How much did service revenue increase in dollars from Q1 2023 to Q1 2024?",
        answer="$11,951",
        answer_type="number",
        entity="AMZN",
        category="arithmetic",
        difficulty="medium",
        table_context="""| | Q1 2024 | Q1 2023 |
|---|---|---|
| Net product sales | $59,641 | $51,098 |
| Net service sales | $83,672 | $71,721 |""",
        program="subtract(83672, 71721)",
        steps=[
            "Q1 2024 service revenue: $83,672M",
            "Q1 2023 service revenue: $71,721M",
            "Difference: 83672 - 71721 = $11,951M",
        ],
    ),
    BenchmarkExample(
        id="tq_003",
        benchmark=BenchmarkType.TAT_QA,
        question="What portion of total revenue came from product sales in Q1 2024?",
        answer="41.6%",
        answer_type="percentage",
        entity="AMZN",
        category="arithmetic",
        difficulty="medium",
        table_context="""| | Q1 2024 |
|---|---|
| Net product sales | $59,641 |
| Total net sales | $143,313 |""",
        program="divide(59641, 143313) * 100",
    ),
    BenchmarkExample(
        id="tq_004",
        benchmark=BenchmarkType.TAT_QA,
        question="Which segment had the highest operating income in FY2024?",
        answer="AWS (Amazon Web Services)",
        answer_type="text",
        entity="AMZN",
        category="comparison",
        difficulty="medium",
        table_context="""| Segment | Operating Income FY2024 |
|---|---|
| North America | $34,587 |
| International | $6,291 |
| AWS | $39,831 |""",
        context="AWS remained the most profitable segment, contributing $39.8 billion in operating income.",
    ),
    BenchmarkExample(
        id="tq_005",
        benchmark=BenchmarkType.TAT_QA,
        question="Is the statement 'Apple's R&D expenses exceeded $30 billion in FY2024' true or false?",
        answer="True",
        answer_type="boolean",
        entity="AAPL",
        category="boolean",
        difficulty="easy",
        table_context="""| | FY2024 | FY2023 |
|---|---|---|
| R&D Expenses | $31,370 | $29,915 |""",
        context="Research and development expenses increased by approximately 5% in fiscal 2024 compared to fiscal 2023.",
    ),
    BenchmarkExample(
        id="tq_006",
        benchmark=BenchmarkType.TAT_QA,
        question="What is the sum of all operating expenses for NVIDIA in FY2024?",
        answer="$16,967",
        answer_type="number",
        entity="NVDA",
        category="arithmetic",
        difficulty="medium",
        table_context="""| Operating Expenses | FY2024 | FY2023 |
|---|---|---|
| Research and Development | $10,680 | $7,339 |
| Sales, G&A | $3,014 | $2,440 |
| Acquisition termination cost | — | — |
| Total Operating Expenses | $16,967 | $11,911 |""",
        program="add(10680, 3014)",
    ),
]


# ═══════════════════════════════════════════════════════════════════════
# Sentiment Analysis examples (FPB-style)
# ═══════════════════════════════════════════════════════════════════════

FPB_EXAMPLES = [
    BenchmarkExample(
        id="fp_001",
        benchmark=BenchmarkType.FPB,
        question="Classify the sentiment: 'Apple reported record quarterly revenue of $124.3 billion, up 4% year over year.'",
        answer="positive",
        answer_type="text",
        category="sentiment",
        difficulty="easy",
    ),
    BenchmarkExample(
        id="fp_002",
        benchmark=BenchmarkType.FPB,
        question="Classify the sentiment: 'The company announced layoffs affecting approximately 10% of its workforce.'",
        answer="negative",
        answer_type="text",
        category="sentiment",
        difficulty="easy",
    ),
    BenchmarkExample(
        id="fp_003",
        benchmark=BenchmarkType.FPB,
        question="Classify the sentiment: 'Revenue was in line with analyst expectations at $45.2 billion for the quarter.'",
        answer="neutral",
        answer_type="text",
        category="sentiment",
        difficulty="medium",
    ),
    BenchmarkExample(
        id="fp_004",
        benchmark=BenchmarkType.FPB,
        question="Classify the sentiment: 'Despite strong revenue growth, management warned of margin pressure from increased competition.'",
        answer="negative",
        answer_type="text",
        category="sentiment",
        difficulty="hard",
    ),
    BenchmarkExample(
        id="fp_005",
        benchmark=BenchmarkType.FPB,
        question="Classify the sentiment: 'NVIDIA's data center revenue surged 217% year-over-year, significantly exceeding expectations.'",
        answer="positive",
        answer_type="text",
        category="sentiment",
        difficulty="easy",
    ),
]


# ═══════════════════════════════════════════════════════════════════════
# Aggregate all benchmarks
# ═══════════════════════════════════════════════════════════════════════

ALL_BENCHMARKS: dict[BenchmarkType, list[BenchmarkExample]] = {
    BenchmarkType.FINANCE_BENCH: FINANCEBENCH_EXAMPLES,
    BenchmarkType.FINQA: FINQA_EXAMPLES,
    BenchmarkType.TAT_QA: TATQA_EXAMPLES,
    BenchmarkType.FPB: FPB_EXAMPLES,
}


def get_benchmark(benchmark_type: BenchmarkType) -> list[BenchmarkExample]:
    """Get all examples for a specific benchmark."""
    return ALL_BENCHMARKS.get(benchmark_type, [])


def get_all_examples() -> list[BenchmarkExample]:
    """Get all benchmark examples across all types."""
    all_examples = []
    for examples in ALL_BENCHMARKS.values():
        all_examples.extend(examples)
    return all_examples


def export_benchmarks(output_path: str | Path):
    """Export all benchmarks to a JSON file."""
    data = {
        "version": "1.0",
        "benchmarks": {},
    }
    for benchmark_type, examples in ALL_BENCHMARKS.items():
        data["benchmarks"][benchmark_type.value] = {
            "count": len(examples),
            "examples": [e.to_dict() for e in examples],
        }

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
