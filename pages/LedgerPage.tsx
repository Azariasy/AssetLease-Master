import React, { useState, useEffect, useMemo } from 'react';
import { LedgerRow, SystemConfig, Company } from '../types';
import { Search, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Building2 } from 'lucide-react';
import * as XLSX from 'xlsx';

interface LedgerPageProps {
  data: LedgerRow[];
  initialFilter?: { subjectCode?: string, period?: string } | null;
  config: SystemConfig;
  currentEntity?: Company;
}

const ITEMS_PER_PAGE = 50;

const LedgerPage: React.FC<LedgerPageProps> = ({ data, initialFilter, config, currentEntity }) => {
  const storagePrefix = currentEntity ? `led_${currentEntity.id}_` : 'led_';

  const [filter, setFilter] = useState({
    period: sessionStorage.getItem(storagePrefix + 'period') || '',
    subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
    keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
  });

  const [currentPage, setCurrentPage] = useState(1);

  // Handle Entity Switch - Reload filters
  useEffect(() => {
      setFilter({
        period: sessionStorage.getItem(storagePrefix + 'period') || '',
        subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
        keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
      });
  }, [storagePrefix]);

  // Apply initial filters if provided (from Dashboard Drilldown), override session
  useEffect(() => {
    if (initialFilter) {
      setFilter(prev => {
          const newState = {
            ...prev,
            period: initialFilter.period || prev.period,
            subjectCode: initialFilter.subjectCode || prev.subjectCode
          };
          return newState;
      });
    }
  }, [initialFilter]);

  // Save to Session Storage on change
  useEffect(() => {
      sessionStorage.setItem(storagePrefix + 'period', filter.period);
      sessionStorage.setItem(storagePrefix + 'subject', filter.subjectCode);
      sessionStorage.setItem(storagePrefix + 'keyword', filter.keyword);
  }, [filter, storagePrefix]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const periods = Array.from(new Set(data.map(r => r.period))).sort().reverse();

  // Helper: Clean string for search (remove spaces, dots)
  const normalize = (str: string) => str ? String(str).replace(/[\s\.]/g, '').toLowerCase() : '';

  // Filter Data
  const filteredRows = useMemo(() => {
    return data.filter(row => {
      const matchPeriod = filter.period ? row.period === filter.period : true;
      const matchCode = filter.subjectCode 
        ? normalize(row.subjectCode).includes(normalize(filter.subjectCode)) 
        : true;

      let matchKey = true;
      if (filter.keyword) {
        const terms = filter.keyword.toLowerCase().split(' ').filter(t => t);
        const deptName = config.departmentMap[row.department || ''] || '';
        const searchableText = normalize(
          `${row.summary} ${row.voucherNo} ${row.counterparty} ${row.subjectName} ${deptName}`
        );
        const amountStr = Math.abs(row.debitAmount || row.creditAmount).toString();
        const isAmountSearch = /^\d+(\.\d+)?$/.test(filter.keyword) && amountStr.includes(filter.keyword);
        matchKey = terms.every(term => searchableText.includes(term)) || isAmountSearch;
      }
      
      return matchPeriod && matchCode && matchKey;
    });
  }, [data, filter, config.departmentMap]);

  // Totals Calculation
  const totalDebit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.debitAmount, 0), [filteredRows]);
  const totalCredit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.creditAmount, 0), [filteredRows]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredRows.length / ITEMS_PER_PAGE);
  const paginatedRows = filteredRows.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleExport = () => {
    if (filteredRows.length === 0) return;
    
    const exportData = filteredRows.map(r => ({
        '期间': r.period,
        '日期': r.date,
        '凭证号': r.voucherNo,
        '科目编码': r.subjectCode,
        '科目名称': r.subjectName,
        '借方金额': r.debitAmount,
        '贷方金额': r.creditAmount,
        '摘要': r.summary,
        '部门': config.departmentMap[r.department || ''] || r.department || '',
        '往来单位': r.counterparty || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "明细账");
    XLSX.writeFile(workbook, `明细账_${filter.period || '全部'}_${new Date().getTime()}.xlsx`);
  };

  const getDeptDisplay = (code?: string) => {
    if (!code) return '-';
    const name = config.departmentMap[code];
    if (name) {
      return (
        <div className="flex flex-col group cursor-help relative">
          <span className="font-bold text-slate-700 text-xs">{name}</span>
          <div className="hidden group-hover:block absolute bottom-full left-0 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20 mb-1">
            编码: {code}
          </div>
        </div>
      );
    }
    return (
      <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 rounded truncate max-w-[80px] block" title={code}>
        {code}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Bar - Aesthetic Polish */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
          <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0 no-scrollbar">
             {/* Period Filter */}
             <div className="flex-shrink-0 flex items-center gap-2 px-3 h-9 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs font-bold text-slate-500 uppercase whitespace-nowrap">期间</span>
                <select 
                  value={filter.period} 
                  onChange={(e) => setFilter({...filter, period: e.target.value})}
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer h-full"
                >
                  <option value="">全部</option>
                  {periods.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
             </div>

             {/* Subject Filter Input */}
             <div className="flex-shrink-0 flex items-center gap-2 px-3 h-9 bg-slate-50 rounded-lg border border-slate-200 w-44">
                <span className="text-xs font-bold text-slate-500 uppercase whitespace-nowrap">科目</span>
                <input 
                  type="text" 
                  placeholder="如: 5502"
                  value={filter.subjectCode}
                  onChange={(e) => setFilter({...filter, subjectCode: e.target.value})}
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full min-w-0 h-full placeholder:font-normal"
                />
                {filter.subjectCode && (
                  <button onClick={() => setFilter({...filter, subjectCode: ''})}>
                    <X size={14} className="text-slate-400 hover:text-red-500"/>
                  </button>
                )}
             </div>

             {/* Smart Keyword Search */}
             <div className="relative group w-64 flex-shrink-0 h-9">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={15} />
                <input 
                  type="text" 
                  placeholder="搜摘要/金额/往来/部门" 
                  value={filter.keyword}
                  onChange={(e) => setFilter({...filter, keyword: e.target.value})}
                  className="pl-9 pr-8 h-full bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 w-full focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-slate-400"
                />
                 {filter.keyword && (
                  <button onClick={() => setFilter({...filter, keyword: ''})} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X size={14} className="text-slate-400 hover:text-red-500"/>
                  </button>
                )}
              </div>
          </div>

          <button 
            onClick={handleExport}
            className="flex-shrink-0 flex items-center gap-2 px-4 h-9 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm w-fit ml-auto xl:ml-0"
          >
            <Download size={16} />
            导出 Excel
          </button>
        </div>

        {/* Active Filters Summary */}
        {(filter.subjectCode || filter.period) && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
            <Filter size={12} />
            <span>当前筛选条件:</span>
            {filter.period && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">期间: {filter.period}</span>}
            {filter.subjectCode && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded">科目包含: {filter.subjectCode}</span>}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      <div className="flex flex-wrap gap-4">
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">借方合计</span>
          <span className="text-lg font-mono font-bold text-slate-900">¥{totalDebit.toLocaleString()}</span>
        </div>
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">贷方合计</span>
          <span className="text-lg font-mono font-bold text-slate-900">¥{totalCredit.toLocaleString()}</span>
        </div>
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">记录总数</span>
          <span className="text-lg font-mono font-bold text-slate-900">{filteredRows.length}</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 w-24">日期/期间</th>
                <th className="px-4 py-3 w-32">凭证号</th>
                <th className="px-4 py-3 w-32">部门</th>
                <th className="px-4 py-3 w-48">科目</th>
                <th className="px-4 py-3 w-28 text-right">借方</th>
                <th className="px-4 py-3 w-28 text-right">贷方</th>
                <th className="px-4 py-3">摘要 / 往来</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 group">
                  <td className="px-4 py-2">
                     <div className="font-mono text-xs text-slate-700">{row.date}</div>
                     <div className="text-[10px] text-slate-400">{row.period}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-blue-600 text-xs">{row.voucherNo}</td>
                  <td className="px-4 py-2 text-xs">
                     {getDeptDisplay(row.department)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col max-w-[180px]">
                      <span className="font-bold text-slate-700 text-xs truncate" title={row.subjectName}>{row.subjectName}</span>
                      <span className="font-mono text-[10px] text-slate-400">{row.subjectCode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-600">{row.debitAmount ? row.debitAmount.toLocaleString() : '-'}</td>
                  <td className="px-4 py-2 text-right font-mono text-orange-600">{row.creditAmount ? row.creditAmount.toLocaleString() : '-'}</td>
                  <td className="px-4 py-2 max-w-[300px]">
                     <div className="flex flex-col gap-1">
                        <div className="text-xs text-slate-600 truncate" title={row.summary}>{row.summary}</div>
                        {row.counterparty && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded w-fit">
                            <Building2 size={10} />
                            {row.counterparty}
                          </div>
                        )}
                     </div>
                  </td>
                </tr>
              ))}
              {paginatedRows.length === 0 && (
                <tr>
                    <td colSpan={7} className="px-4 py-20 text-center text-slate-400 italic">未查询到符合条件的明细记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-white">
             <div className="text-xs text-slate-500">
               显示第 <span className="font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> 至 <span className="font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, filteredRows.length)}</span> 条，共 {filteredRows.length} 条
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

export default LedgerPage;