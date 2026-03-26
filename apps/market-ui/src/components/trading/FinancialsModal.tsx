import React, { useState, useEffect } from 'react';
import { X, Loader2, DollarSign, TrendingUp, BarChart3, Activity } from 'lucide-react';
import { isCryptoAsset } from '../../constants/tradingAssets';

interface FinancialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: string;
}

export const FinancialsModal: React.FC<FinancialsModalProps> = ({ isOpen, onClose, asset }) => {
  const [activeTab, setActiveTab] = useState<'ratios' | 'income' | 'balance' | 'cashflow'>('ratios');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, asset]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const symbol = isCryptoAsset(asset) ? `${asset}-USD` : asset;
      
      // Fetch both fundamentals and financials
      const [fundRes, finRes] = await Promise.all([
        fetch(`/api/fundamentals?symbol=${symbol}`),
        fetch(`/api/financials?symbol=${symbol}`)
      ]);

      let fundData = {};
      let finData = {};

      if (fundRes.ok) {
        const json = await fundRes.json();
        fundData = json.quoteSummary?.result?.[0] || {};
      }
      if (finRes.ok) {
        const json = await finRes.json();
        finData = json.quoteSummary?.result?.[0] || {};
      }

      setData({
        fundamentals: fundData,
        financials: finData
      });
    } catch (err: any) {
      setError(err.message || 'Failed to fetch financial data');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return '-';
    if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatPercent = (num?: number) => {
    if (num === undefined || num === null) return '-';
    return `${(num * 100).toFixed(2)}%`;
  };

  const renderRatios = () => {
    if (!data?.fundamentals) return <div className="p-4 text-gray-400">No ratio data available</div>;
    
    const stats = data.fundamentals.defaultKeyStatistics || {};
    const fin = data.fundamentals.financialData || {};
    const summary = data.fundamentals.summaryDetail || {};

    const metrics = [
      { label: 'Trailing P/E', value: summary.trailingPE?.raw || stats.trailingPE?.raw },
      { label: 'Forward P/E', value: summary.forwardPE?.raw || stats.forwardPE?.raw },
      { label: 'PEG Ratio', value: stats.pegRatio?.raw },
      { label: 'Price to Book', value: stats.priceToBook?.raw },
      { label: 'Price to Sales', value: summary.priceToSalesTrailing12Months?.raw },
      { label: 'Profit Margin', value: formatPercent(fin.profitMargins?.raw) },
      { label: 'Operating Margin', value: formatPercent(fin.operatingMargins?.raw) },
      { label: 'Return on Assets', value: formatPercent(fin.returnOnAssets?.raw) },
      { label: 'Return on Equity', value: formatPercent(fin.returnOnEquity?.raw) },
      { label: 'Revenue Growth', value: formatPercent(fin.revenueGrowth?.raw) },
      { label: 'Earnings Growth', value: formatPercent(fin.earningsGrowth?.raw) },
      { label: 'Debt to Equity', value: fin.debtToEquity?.raw },
      { label: 'Current Ratio', value: fin.currentRatio?.raw },
      { label: 'Quick Ratio', value: fin.quickRatio?.raw },
      { label: 'Dividend Yield', value: formatPercent(summary.dividendYield?.raw) },
      { label: 'Beta', value: summary.beta?.raw },
    ];

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
        {metrics.map((m, i) => (
          <div key={i} className="bg-[#1F2937] p-4 rounded-lg border border-[#374151]">
            <div className="text-xs text-gray-400 mb-1">{m.label}</div>
            <div className="text-lg font-semibold text-white">
              {typeof m.value === 'number' ? m.value.toFixed(2) : (m.value || '-')}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderStatementTable = (history: any[], columns: {key: string, label: string}[]) => {
    if (!history || history.length === 0) return <div className="p-4 text-gray-400">No statement data available</div>;

    return (
      <div className="overflow-x-auto p-4">
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-[#1F2937] border-b border-[#374151]">
            <tr>
              <th className="px-4 py-3 rounded-tl-lg">Metric</th>
              {history.map((period: any, i: number) => (
                <th key={i} className={`px-4 py-3 text-right ${i === history.length - 1 ? 'rounded-tr-lg' : ''}`}>
                  {period.endDate?.fmt || period.endDate || `Period ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => (
              <tr key={i} className="border-b border-[#1F2937] hover:bg-[#1F2937]/50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-200">{col.label}</td>
                {history.map((period: any, j: number) => {
                  const val = period[col.key]?.raw !== undefined ? period[col.key].raw : period[col.key];
                  return (
                    <td key={j} className="px-4 py-3 text-right">
                      {formatNumber(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderIncomeStatement = () => {
    const history = data?.financials?.incomeStatementHistory?.incomeStatementHistory || [];
    const columns = [
      { key: 'totalRevenue', label: 'Total Revenue' },
      { key: 'costOfRevenue', label: 'Cost of Revenue' },
      { key: 'grossProfit', label: 'Gross Profit' },
      { key: 'operatingExpenses', label: 'Operating Expenses' },
      { key: 'operatingIncome', label: 'Operating Income' },
      { key: 'totalOtherIncomeExpenseNet', label: 'Other Income/Expense' },
      { key: 'incomeBeforeTax', label: 'Pretax Income' },
      { key: 'incomeTaxExpense', label: 'Tax Provision' },
      { key: 'netIncome', label: 'Net Income' },
      { key: 'netIncomeApplicableToCommonShares', label: 'Net Income to Common' },
    ];
    return renderStatementTable(history, columns);
  };

  const renderBalanceSheet = () => {
    const history = data?.financials?.balanceSheetHistory?.balanceSheetStatements || [];
    const columns = [
      { key: 'totalAssets', label: 'Total Assets' },
      { key: 'totalCurrentAssets', label: 'Total Current Assets' },
      { key: 'cash', label: 'Cash & Equivalents' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'totalLiab', label: 'Total Liabilities' },
      { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities' },
      { key: 'shortLongTermDebt', label: 'Short Term Debt' },
      { key: 'longTermDebt', label: 'Long Term Debt' },
      { key: 'totalStockholderEquity', label: 'Total Equity' },
      { key: 'retainedEarnings', label: 'Retained Earnings' },
    ];
    return renderStatementTable(history, columns);
  };

  const renderCashFlow = () => {
    const history = data?.financials?.cashflowStatementHistory?.cashflowStatements || [];
    const columns = [
      { key: 'totalCashFromOperatingActivities', label: 'Operating Cash Flow' },
      { key: 'netIncome', label: 'Net Income' },
      { key: 'depreciation', label: 'Depreciation' },
      { key: 'totalCashflowsFromInvestingActivities', label: 'Investing Cash Flow' },
      { key: 'capitalExpenditures', label: 'Capital Expenditures' },
      { key: 'totalCashFromFinancingActivities', label: 'Financing Cash Flow' },
      { key: 'dividendsPaid', label: 'Dividends Paid' },
      { key: 'netBorrowings', label: 'Net Borrowings' },
      { key: 'changeInCash', label: 'Change in Cash' },
    ];
    return renderStatementTable(history, columns);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#111827] rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden border border-[#1F2937] flex flex-col h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#1F2937] flex items-center justify-between bg-[#0A0E17]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">{asset} Financials</h2>
              <p className="text-sm text-gray-400">Fundamental Analysis & Statements</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 border-b border-[#1F2937] bg-[#0A0E17]">
          {[
            { id: 'ratios', label: 'Key Ratios', icon: Activity },
            { id: 'income', label: 'Income Statement', icon: TrendingUp },
            { id: 'balance', label: 'Balance Sheet', icon: DollarSign },
            { id: 'cashflow', label: 'Cash Flow', icon: BarChart3 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-4 font-medium text-sm transition-colors relative ${
                activeTab === tab.id ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-[#0A0E17]">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-500" />
              <p>Loading financial data...</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-red-400 p-8 text-center">
              <div className="bg-red-500/10 p-4 rounded-full mb-4">
                <X className="w-8 h-8" />
              </div>
              <p className="text-lg font-medium mb-2">Data Unavailable</p>
              <p className="text-sm opacity-80">{error}</p>
            </div>
          ) : (
            <div className="h-full">
              {activeTab === 'ratios' && renderRatios()}
              {activeTab === 'income' && renderIncomeStatement()}
              {activeTab === 'balance' && renderBalanceSheet()}
              {activeTab === 'cashflow' && renderCashFlow()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
