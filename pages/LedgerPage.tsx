
import React, { useState, useEffect, useMemo } from 'react';
import { LedgerRow, SystemConfig, Company } from '../types';
import { Search, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText, ArrowRightLeft } from 'lucide-react';
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
  const [selectedVoucherNo, setSelectedVoucherNo] = useState<string | null>(null);

  useEffect(() => {
      setFilter({
        period: sessionStorage.getItem(storagePrefix + 'period') || '',
        subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
        keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
      });
      setSelectedVoucherNo(null);
  }, [storagePrefix]);

  useEffect(() => {
    if (initialFilter) {
      setFilter(prev => ({
          ...prev,
          period: initialFilter.period || prev.period,
          subjectCode: initialFilter.subjectCode || prev.subjectCode
      }));
    }
  }, [initialFilter]);

  useEffect(() => {
      sessionStorage.setItem(storagePrefix + 'period', filter.period);
      sessionStorage.setItem(storagePrefix + 'subject', filter.subjectCode);
      sessionStorage.setItem(storagePrefix + 'keyword', filter.keyword);
  }, [filter, storagePrefix]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const periods = Array.from(new Set(data.map(r => r.period))).sort().reverse();
  const normalize = (str: string) => str ? String(str).replace(/[\s\.]/g, '').toLowerCase() : '';

  const filteredRows = useMemo(() => {
    return data.filter(row => {
      const matchPeriod = filter.period ? row.period === filter.period : true;
      const matchCode = filter.subjectCode 
        ? normalize(row.subjectCode).includes(normalize(filter.subjectCode)) 
        : true;

      let matchKey = true;
      if (filter.keyword) {
        const terms = filter.keyword.toLowerCase().split(' ').filter(t => t);
        const deptName = row.departmentName || config.departmentMap[row.department || ''] || '';
        const searchableText = normalize(
          `${row.summary} ${row.voucherNo} ${row.counterparty} ${row.subjectName} ${deptName} ${row.projectName} ${row.subAccountName}`
        );
        const amountStr = Math.abs(row.debitAmount || row.creditAmount).toString();
        const isAmountSearch = /^\d+(\.\d+)?$/.test(filter.keyword) && amountStr.includes(filter.keyword);
        matchKey = terms.every(term => searchableText.includes(term)) || isAmountSearch;
      }
      return matchPeriod && matchCode && matchKey;
    });
  }, [data, filter, config.departmentMap]);

  const totalDebit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.debitAmount, 0), [filteredRows]);
  const totalCredit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.creditAmount, 0), [filteredRows]);

  const totalPages = Math.ceil(filteredRows.length / ITEMS_PER_PAGE);
  const paginatedRows = filteredRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleExport = () => {
    if (filteredRows.length === 0) return;
    const exportData = filteredRows.map(r => ({
        '期间': r.period,
        '日期': r.date,
        '凭证号': r.voucherNo,
        '科目编码': r.subjectCode,
        '科目名称': r.subjectName,
        '部门': r.departmentName || config.departmentMap[r.department || ''] || r.department || '',
        '项目': r.projectName || r.projectCode || '',
        '子目': r.subAccountName || r.subAccountCode || '',
        '借方金额': r.debitAmount,
        '贷方金额': r.creditAmount,
        '摘要': r.summary,
        '往来单位': r.counterparty || ''
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "明细账");
    XLSX.writeFile(workbook, `明细账_${filter.period || '全部'}_${new Date().getTime()}.xlsx`);
  };

  const getDeptDisplay = (row: LedgerRow) => {
    const code = row.department;
    if (!code) return '-';
    const name = row.departmentName || config.departmentMap[code] || '';
    return (
      <div className="flex flex-col max-w-[120px]">
        <span className="font-bold text-slate-700 text-xs truncate" title={name}>{name || '-'}</span>
        <span className="font-mono text-[10px] text-slate-400">{code}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-140px)]">
      {/* Search Bar - Fixed Top */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4 flex-shrink-0">
        <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
          <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0 no-scrollbar">
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
                  <button onClick={() => setFilter({...filter, subjectCode: ''})}><X size={14} className="text-slate-400 hover:text-red-500"/></button>
                )}
             </div>
             <div className="relative group w-64 flex-shrink-0 h-9">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={15} />
                <input 
                  type="text" 
                  placeholder="搜摘要/金额/往来/项目" 
                  value={filter.keyword}
                  onChange={(e) => setFilter({...filter, keyword: e.target.value})}
                  className="pl-9 pr-8 h-full bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 w-full focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-slate-400"
                />
                 {filter.keyword && (
                  <button onClick={() => setFilter({...filter, keyword: ''})} className="absolute right-3 top-1/2 -translate-y-1/2"><X size={14} className="text-slate-400 hover:text-red-500"/></button>
                )}
              </div>
          </div>
          <button onClick={handleExport} className="flex-shrink-0 flex items-center gap-2 px-4 h-9 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm w-fit ml-auto xl:ml-0">
            <Download size={16} /> 导出 Excel
          </button>
        </div>

        {(filter.subjectCode || filter.period) && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
            <Filter size={12} />
            <span>当前筛选条件:</span>
            {filter.period && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">期间: {filter.period}</span>}
            {filter.subjectCode && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded">科目包含: {filter.subjectCode}</span>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 flex-shrink-0">
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

      {/* Table Container - Fixed Height for Sticky Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 w-24 bg-slate-50">日期/期间</th>
                <th className="px-4 py-3 w-32 bg-slate-50">凭证号</th>
                <th className="px-4 py-3 w-32 bg-slate-50">部门</th>
                <th className="px-4 py-3 w-48 bg-slate-50">科目</th>
                <th className="px-4 py-3 w-40 bg-slate-50">项目</th>
                <th className="px-4 py-3 w-32 bg-slate-50">子目</th>
                <th className="px-4 py-3 w-28 text-right bg-slate-50">借方</th>
                <th className="px-4 py-3 w-28 text-right bg-slate-50">贷方</th>
                <th className="px-4 py-3 max-w-[200px] bg-slate-50">摘要</th>
                <th className="px-4 py-3 w-40 bg-slate-50">往来单位</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50 group">
                  <td className="px-4 py-2">
                     <div className="font-mono text-xs text-slate-700">{row.date}</div>
                     <div className="text-[10px] text-slate-400">{row.period}</div>
                  </td>
                  <td 
                    className="px-4 py-2 font-mono text-blue-600 text-xs cursor-pointer hover:underline hover:text-blue-800"
                    onClick={() => setSelectedVoucherNo(row.voucherNo)}
                    title="点击查看整张凭证"
                  >
                    {row.voucherNo}
                  </td>
                  <td className="px-4 py-2 text-xs">{getDeptDisplay(row)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col max-w-[180px]">
                      <span className="font-bold text-slate-700 text-xs truncate" title={row.subjectName}>{row.subjectName}</span>
                      <span className="font-mono text-[10px] text-slate-400">{row.subjectCode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col max-w-[160px]">
                      <span className="font-bold text-slate-700 text-xs truncate" title={row.projectName}>{row.projectName || (row.projectCode && row.projectCode !== '0' ? '-' : '')}</span>
                      {row.projectCode && row.projectCode !== '0' && <span className="font-mono text-[10px] text-slate-400">{row.projectCode}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col max-w-[120px]">
                      <span className="font-bold text-slate-700 text-xs truncate" title={row.subAccountName}>{row.subAccountName || (row.subAccountCode && row.subAccountCode !== '0' ? '-' : '')}</span>
                      {row.subAccountCode && row.subAccountCode !== '0' && <span className="font-mono text-[10px] text-slate-400">{row.subAccountCode}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-600">{row.debitAmount ? row.debitAmount.toLocaleString() : '-'}</td>
                  <td className="px-4 py-2 text-right font-mono text-orange-600">{row.creditAmount ? row.creditAmount.toLocaleString() : '-'}</td>
                  <td className="px-4 py-2 max-w-[200px]">
                     <div className="text-xs text-slate-600 truncate" title={row.summary}>{row.summary}</div>
                  </td>
                  <td className="px-4 py-2 w-40">
                     <div className="flex flex-col max-w-[160px]">
                        <span className="font-bold text-slate-700 text-xs truncate" title={row.counterpartyName || row.counterparty}>
                            {row.counterpartyName || row.counterparty || '-'}
                        </span>
                        {row.counterpartyCode && row.counterpartyCode !== '0' && (
                            <span className="font-mono text-[10px] text-slate-400">{row.counterpartyCode}</span>
                        )}
                     </div>
                  </td>
                </tr>
              ))}
              {paginatedRows.length === 0 && (
                <tr>
                    <td colSpan={10} className="px-4 py-20 text-center text-slate-400 italic">未查询到符合条件的明细记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-white flex-shrink-0">
             <div className="text-xs text-slate-500">
               第 <span className="font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> 至 <span className="font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, filteredRows.length)}</span> 条 / 共 {filteredRows.length} 条
             </div>
             <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-500"><ChevronsLeft size={18} /></button>
                <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-500"><ChevronLeft size={18} /></button>
                <span className="text-sm font-bold text-slate-700 px-2">{currentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-500"><ChevronRight size={18} /></button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-500"><ChevronsRight size={18} /></button>
             </div>
          </div>
        )}
      </div>

      {selectedVoucherNo && (
        <VoucherModal voucherNo={selectedVoucherNo} allData={data} config={config} onClose={() => setSelectedVoucherNo(null)} />
      )}
    </div>
  );
};

const VoucherModal = ({ voucherNo, allData, config, onClose }: { voucherNo: string, allData: LedgerRow[], config: SystemConfig, onClose: () => void }) => {
    const voucherRows = useMemo(() => {
        return allData.filter(r => r.voucherNo === voucherNo).sort((a,b) => {
             if (a.debitAmount > 0 && b.creditAmount > 0) return -1;
             if (a.creditAmount > 0 && b.debitAmount > 0) return 1;
             return 0;
        });
    }, [voucherNo, allData]);

    const totalDebit = voucherRows.reduce((sum, r) => sum + r.debitAmount, 0);
    const totalCredit = voucherRows.reduce((sum, r) => sum + r.creditAmount, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl flex flex-col overflow-hidden max-h-[90vh]">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-3">
                         <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><FileText size={20} /></div>
                         <div><h3 className="font-bold text-slate-800 text-lg">凭证详情</h3><p className="text-xs text-slate-500 font-mono">NO. {voucherNo}</p></div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-3">摘要</th>
                                <th className="px-6 py-3">科目</th>
                                <th className="px-4 py-3">部门</th>
                                <th className="px-4 py-3">项目</th>
                                <th className="px-4 py-3">子目</th>
                                <th className="px-6 py-3">往来单位</th>
                                <th className="px-6 py-3 text-right">借方金额</th>
                                <th className="px-6 py-3 text-right">贷方金额</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {voucherRows.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-6 py-4 text-slate-700 font-medium max-w-[200px]">{row.summary}</td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-800 text-xs">{row.subjectName}</div>
                                        <div className="font-mono text-[10px] text-slate-400">{row.subjectCode}</div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-700 text-xs truncate max-w-[120px]" title={row.departmentName || config.departmentMap[row.department || ''] || ''}>{row.departmentName || config.departmentMap[row.department || ''] || ''}</span>
                                            {row.department && <span className="font-mono text-[10px] text-slate-400">{row.department}</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-700 text-xs truncate max-w-[120px]" title={row.projectName}>{row.projectName || ''}</span>
                                            {row.projectCode && row.projectCode !== '0' && <span className="font-mono text-[10px] text-slate-400">{row.projectCode}</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-700 text-xs truncate max-w-[100px]" title={row.subAccountName}>{row.subAccountName || ''}</span>
                                            {row.subAccountCode && row.subAccountCode !== '0' && <span className="font-mono text-[10px] text-slate-400">{row.subAccountCode}</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-xs text-slate-500 max-w-[150px]">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-700 text-xs truncate" title={row.counterpartyName || row.counterparty}>{row.counterpartyName || row.counterparty || ''}</span>
                                            {row.counterpartyCode && row.counterpartyCode !== '0' && (<span className="font-mono text-[10px] text-slate-400">{row.counterpartyCode}</span>)}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">{row.debitAmount > 0 ? row.debitAmount.toLocaleString() : ''}</td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">{row.creditAmount > 0 ? row.creditAmount.toLocaleString() : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-bold text-xs border-t border-slate-200">
                            <tr>
                                <td colSpan={6} className="px-6 py-3 text-right text-slate-500 uppercase">合计 (Total) {!isBalanced && <span className="ml-2 text-red-500 flex inline-flex items-center gap-1"><ArrowRightLeft size={10} /> 不平!</span>}</td>
                                <td className="px-6 py-3 text-right font-mono text-emerald-600 border-t border-slate-300">{totalDebit.toLocaleString()}</td>
                                <td className="px-6 py-3 text-right font-mono text-orange-600 border-t border-slate-300">{totalCredit.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default LedgerPage;
