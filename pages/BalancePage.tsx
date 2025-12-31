import React, { useState, useMemo, useEffect } from 'react';
import { BalanceRow, SystemConfig, Company } from '../types';
import { Search, Filter, ArrowRightCircle, Users, Building2, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface BalancePageProps {
  balances: BalanceRow[];
  onDrillDown: (subjectCode: string, period: string) => void;
  config?: SystemConfig;
  currentEntity?: Company;
}

const ITEMS_PER_PAGE = 50;

const BalancePage: React.FC<BalancePageProps> = ({ balances, onDrillDown, config, currentEntity }) => {
  const storagePrefix = currentEntity ? `bal_${currentEntity.id}_` : 'bal_';

  // 1. State Definitions (Load from SessionStorage if available)
  const [period, setPeriod] = useState<string>(() => sessionStorage.getItem(storagePrefix + 'period') || '');
  const [keyword, setKeyword] = useState(() => sessionStorage.getItem(storagePrefix + 'keyword') || '');
  const [activeTab, setActiveTab] = useState<string>(() => sessionStorage.getItem(storagePrefix + 'tab') || '全部');
  
  // Dimensions State
  const [showDept, setShowDept] = useState(() => sessionStorage.getItem(storagePrefix + 'showDept') === 'true');
  const [showCounterparty, setShowCounterparty] = useState(() => sessionStorage.getItem(storagePrefix + 'showCP') === 'true');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Persist State Changes
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'period', period); }, [period, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'keyword', keyword); }, [keyword, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'tab', activeTab); }, [activeTab, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showDept', String(showDept)); }, [showDept, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showCP', String(showCounterparty)); }, [showCounterparty, storagePrefix]);

  // Handle Entity Switch - Reset or Reload if prefix changes
  useEffect(() => {
      setPeriod(sessionStorage.getItem(storagePrefix + 'period') || '');
      setKeyword(sessionStorage.getItem(storagePrefix + 'keyword') || '');
      setActiveTab(sessionStorage.getItem(storagePrefix + 'tab') || '全部');
      setShowDept(sessionStorage.getItem(storagePrefix + 'showDept') === 'true');
      setShowCounterparty(sessionStorage.getItem(storagePrefix + 'showCP') === 'true');
  }, [storagePrefix]);

  // Initialize period if empty
  const periods = useMemo(() => Array.from(new Set(balances.map(b => b.period))).sort().reverse(), [balances]);
  useEffect(() => {
    if (!period && periods.length > 0) setPeriod(periods[0]);
  }, [periods, period]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [period, keyword, activeTab, showDept, showCounterparty]);

  // Get available elements for tabs
  const elements = useMemo(() => {
    const s = new Set(balances.map(b => b.accountElement || '未分类'));
    return ['全部', ...Array.from(s).sort()];
  }, [balances]);

  // Helper: Normalize string for search
  const normalize = (str: string) => str ? String(str).replace(/[\s\.]/g, '').toLowerCase() : '';

  // Helper: Get Friendly Counterparty Name
  const getFriendlyCounterparty = (raw: string | undefined) => {
      if (!raw) return '-';
      if (!config) return raw;
      
      const matchedEntity = config.entities.find(e => 
          (e.segmentPrefix && raw.includes(e.segmentPrefix)) || 
          raw.includes(e.name) ||
          (e.matchedNameInOtherBooks && raw.includes(e.matchedNameInOtherBooks))
      );

      return matchedEntity ? matchedEntity.name : raw;
  };

  // 2. Data Processing Pipeline
  
  // Step A: Filter raw data (Period, Element, Keyword)
  const filteredRawData = useMemo(() => {
    return balances.filter(b => {
      // Period Filter
      if (period && b.period !== period) return false;
      
      // Element Tab Filter
      if (activeTab !== '全部' && b.accountElement !== activeTab) return false;

      // Keyword Search (Multi-field)
      if (keyword) {
        const terms = keyword.toLowerCase().split(' ').filter(t => t);
        // Use friendly name for search as well
        const friendlyCP = getFriendlyCounterparty(b.counterparty);
        
        const searchableText = normalize(
          `${b.subjectCode} ${b.subjectName} ${b.costCenter} ${b.counterparty} ${friendlyCP}`
        );
        // Also allow searching by exact amount
        const amountStr = Math.abs(b.closingBalance).toString();
        const isAmountSearch = /^\d+(\.\d+)?$/.test(keyword) && amountStr.includes(keyword);

        const matchText = terms.every(term => searchableText.includes(term));
        return matchText || isAmountSearch;
      }

      return true;
    });
  }, [balances, period, activeTab, keyword, config]);

  // Step B: Dynamic Aggregation based on selected dimensions
  const aggregatedData = useMemo(() => {
    const aggMap = new Map<string, BalanceRow>();

    filteredRawData.forEach(row => {
      // Create a unique key based on selected dimensions
      let key = row.subjectCode;
      if (showDept) key += `|${row.costCenterCode || 'NULL'}`;
      if (showCounterparty) key += `|${row.counterparty || 'NULL'}`;

      if (!aggMap.has(key)) {
        aggMap.set(key, {
          ...row,
          // If dimension is NOT selected, mark it as Aggregated/Mixed
          costCenter: showDept ? row.costCenter : '多部门汇总',
          costCenterCode: showDept ? row.costCenterCode : 'ALL',
          counterparty: showCounterparty ? row.counterparty : '多客商汇总',
          
          // Reset amounts for summation
          openingBalance: 0,
          debitPeriod: 0,
          creditPeriod: 0,
          closingBalance: 0
        });
      }

      const item = aggMap.get(key)!;
      item.openingBalance += row.openingBalance;
      item.debitPeriod += row.debitPeriod;
      item.creditPeriod += row.creditPeriod;
      item.closingBalance += row.closingBalance;
    });

    // Convert map to array and sort
    return Array.from(aggMap.values()).sort((a, b) => {
        const codeCompare = a.subjectCode.localeCompare(b.subjectCode);
        if (codeCompare !== 0) return codeCompare;
        // Secondary sorts
        if (showDept && a.costCenter && b.costCenter) return a.costCenter.localeCompare(b.costCenter);
        return 0;
    });
  }, [filteredRawData, showDept, showCounterparty]);

  // Step C: Pagination
  const totalPages = Math.ceil(aggregatedData.length / ITEMS_PER_PAGE);
  const paginatedData = aggregatedData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleExport = () => {
    if (aggregatedData.length === 0) return;
    
    const exportData = aggregatedData.map(r => ({
        '期间': r.period,
        '科目编码': r.subjectCode,
        '科目名称': r.subjectName,
        '会计要素': r.accountElement,
        '成本中心': showDept ? r.costCenter : '(未展开)',
        '往来单位': showCounterparty ? getFriendlyCounterparty(r.counterparty) : '(未展开)',
        '期初余额': r.openingBalance,
        '本期借方': r.debitPeriod,
        '本期贷方': r.creditPeriod,
        '期末余额': r.closingBalance,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "余额表");
    XLSX.writeFile(workbook, `余额表_${period || '全部'}_${new Date().getTime()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Control Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
            {/* Left: Filters */}
            <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0 no-scrollbar">
                {/* Period Select */}
                <div className="flex-shrink-0 flex items-center gap-2 px-3 h-9 bg-slate-50 rounded-lg border border-slate-200">
                    <Filter size={12} className="text-slate-500" />
                    <select 
                        value={period} 
                        onChange={(e) => setPeriod(e.target.value)}
                        className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer h-full min-w-[80px]"
                    >
                        {periods.map(p => <option key={p} value={p}>{p}</option>)}
                        {periods.length === 0 && <option>无数据</option>}
                    </select>
                </div>

                {/* Enhanced Search */}
                <div className="relative group w-72 flex-shrink-0 h-9">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={15} />
                    <input 
                        type="text" 
                        placeholder="搜索科目 / 部门 / 往来 / 金额" 
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="pl-9 pr-8 h-full bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 w-full focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-slate-400"
                    />
                    {keyword && (
                        <button onClick={() => setKeyword('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                            <X size={14} className="text-slate-400 hover:text-red-500"/>
                        </button>
                    )}
                </div>
            </div>

            {/* Right: Dimension Toggles */}
            <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 uppercase hidden sm:block">显示维度:</span>
                
                <button 
                    onClick={() => setShowDept(!showDept)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                        showDept 
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-600' 
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    <LayoutGrid size={14} />
                    {showDept ? '已按部门区分' : '按部门区分'}
                </button>

                <button 
                    onClick={() => setShowCounterparty(!showCounterparty)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                        showCounterparty 
                        ? 'bg-blue-50 border-blue-200 text-blue-600' 
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                >
                    <Building2 size={14} />
                    {showCounterparty ? '已按往来区分' : '按往来区分'}
                </button>

                <button 
                  onClick={handleExport}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all ml-2"
                  title="导出当前表格"
                >
                   <Download size={14} />
                   导出
                </button>
            </div>
        </div>

        {/* Element Tabs */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {elements.map(el => (
                    <button
                        key={el}
                        onClick={() => setActiveTab(el)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                            activeTab === el 
                            ? 'bg-slate-800 text-white' 
                            : 'bg-white text-slate-500 hover:bg-slate-100'
                        }`}
                    >
                        {el}
                    </button>
                ))}
            </div>
            <div className="text-xs text-slate-500 whitespace-nowrap">
                共 <span className="font-bold text-slate-900">{aggregatedData.length}</span> 条记录
            </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
        <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm">
                <tr>
                <th className="px-6 py-4 w-32">科目编码</th>
                <th className="px-6 py-4 w-48">科目名称</th>
                <th className="px-6 py-4 w-24">会计要素</th>
                
                {/* Dynamic Columns */}
                {showDept && <th className="px-6 py-4 w-40 bg-indigo-50/30 text-indigo-700">成本中心</th>}
                {showCounterparty && <th className="px-6 py-4 w-48 bg-blue-50/30 text-blue-700">往来单位</th>}

                <th className="px-6 py-4 text-right w-32">期初余额</th>
                <th className="px-6 py-4 text-right w-32">本期借方</th>
                <th className="px-6 py-4 text-right w-32">本期贷方</th>
                <th className="px-6 py-4 text-right w-32">期末余额</th>
                <th className="px-6 py-4 text-center w-24">操作</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {paginatedData.length > 0 ? paginatedData.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 group">
                    <td className="px-6 py-4 font-mono text-slate-600 font-medium">{row.subjectCode}</td>
                    <td className="px-6 py-4 font-bold text-slate-800" title={row.subjectName}>
                        <div className="max-w-[200px] truncate">{row.subjectName}</div>
                    </td>
                    <td className="px-6 py-4">
                        {row.accountElement && <span className="px-2 py-1 bg-slate-100 rounded text-xs text-slate-500">{row.accountElement}</span>}
                    </td>

                    {/* Dynamic Cells */}
                    {showDept && (
                        <td className="px-6 py-4 text-xs font-medium text-indigo-600 truncate max-w-[160px]" title={row.costCenter}>
                            {row.costCenter || '-'}
                        </td>
                    )}
                    {showCounterparty && (
                        <td className="px-6 py-4 text-xs font-medium text-blue-600 truncate max-w-[200px]" title={row.counterparty}>
                             <div className="flex items-center gap-1">
                                {row.counterparty && row.counterparty !== '-' && row.counterparty !== '多客商汇总' && <Users size={12} className="opacity-50" />}
                                {getFriendlyCounterparty(row.counterparty)}
                             </div>
                        </td>
                    )}

                    <td className="px-6 py-4 text-right text-slate-400 font-mono">¥{row.openingBalance.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-slate-600 font-mono">¥{row.debitPeriod.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-slate-600 font-mono">¥{row.creditPeriod.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900 font-mono">¥{row.closingBalance.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center">
                    <button 
                        onClick={() => onDrillDown(row.subjectCode, period)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1 mx-auto"
                        title="查看明细账"
                    >
                        <ArrowRightCircle size={16} />
                    </button>
                    </td>
                </tr>
                )) : (
                <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                        {balances.length === 0 ? "暂无数据，请先导入余额表文件。" : "当前筛选条件下无数据。"}
                    </td>
                </tr>
                )}
            </tbody>
            </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-white">
             <div className="text-xs text-slate-500">
               显示第 <span className="font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> 至 <span className="font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, aggregatedData.length)}</span> 条
             </div>
             <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentPage(1)} 
                  disabled={currentPage === 1}
                  className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500"
                >
                  <ChevronsLeft size={18} />
                </button>
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                  disabled={currentPage === 1}
                  className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500"
                >
                  <ChevronLeft size={18} />
                </button>
                
                <span className="text-sm font-bold text-slate-700 px-2">
                   {currentPage} / {totalPages}
                </span>

                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                  disabled={currentPage === totalPages}
                  className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500"
                >
                  <ChevronRight size={18} />
                </button>
                <button 
                  onClick={() => setCurrentPage(totalPages)} 
                  disabled={currentPage === totalPages}
                  className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-slate-500"
                >
                  <ChevronsRight size={18} />
                </button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BalancePage;