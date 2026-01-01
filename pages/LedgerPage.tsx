
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerRow, SystemConfig, Company, ComplianceResult } from '../types';
import { Search, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText, ArrowRightLeft, Sparkles, Loader2, MessageSquare, Keyboard, ShieldCheck, AlertOctagon } from 'lucide-react';
import * as XLSX from 'xlsx';
import { parseNaturalLanguageQuery, generateNlqResponse, checkLedgerCompliance } from '../services/geminiService';
import { formatCurrency } from '../utils/currency';
import { useDebounce } from '../hooks/useDebounce';

interface LedgerPageProps {
  data: LedgerRow[];
  initialFilter?: { subjectCode?: string, period?: string } | null;
  config: SystemConfig;
  currentEntity?: Company;
  privacyMode: boolean; 
}

const ITEMS_PER_PAGE = 50;

const LedgerPage: React.FC<LedgerPageProps> = ({ data, initialFilter, config, currentEntity, privacyMode }) => {
  const storagePrefix = currentEntity ? `led_${currentEntity.id}_` : 'led_';
  const nlqInputRef = useRef<HTMLInputElement>(null);

  // State
  const [filter, setFilter] = useState({
    period: sessionStorage.getItem(storagePrefix + 'period') || '',
    subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
    keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
    category: '', 
  });

  const debouncedKeyword = useDebounce(filter.keyword, 300);
  const debouncedSubject = useDebounce(filter.subjectCode, 300);

  // NLQ State
  const [nlqInput, setNlqInput] = useState('');
  const [isNlqLoading, setIsNlqLoading] = useState(false);
  const [nlqError, setNlqError] = useState('');
  const [aiResponse, setAiResponse] = useState('');

  // Compliance State
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);
  const [complianceResults, setComplianceResults] = useState<ComplianceResult[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVoucherNo, setSelectedVoucherNo] = useState<string | null>(null);

  // ... (Keep existing useEffects for filter persistence)
  useEffect(() => {
      setFilter({
        period: sessionStorage.getItem(storagePrefix + 'period') || '',
        subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
        keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
        category: ''
      });
      setSelectedVoucherNo(null);
      setAiResponse('');
      setNlqInput('');
      setComplianceResults([]);
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
  }, [filter.period, debouncedSubject, debouncedKeyword, filter.category]);

  const periods = Array.from(new Set(data.map(r => r.period))).sort().reverse();
  const normalize = (str: string) => str ? String(str).replace(/[\s\.]/g, '').toLowerCase() : '';

  const filteredRows = useMemo(() => {
    return data.filter(row => {
      const matchPeriod = filter.period ? row.period === filter.period || row.period.startsWith(filter.period) : true;
      let matchCode = true;
      if (debouncedSubject) {
          matchCode = normalize(row.subjectCode).includes(normalize(debouncedSubject));
      }
      
      let matchCategory = true;
      if (filter.category === 'income') matchCategory = config.incomeSubjectCodes.some(c => row.subjectCode.startsWith(c));
      else if (filter.category === 'cost') matchCategory = config.costSubjectCodes.some(c => row.subjectCode.startsWith(c));

      let matchKey = true;
      if (debouncedKeyword) {
        const terms = debouncedKeyword.toLowerCase().split(' ').filter(t => t);
        const deptName = row.departmentName || config.departmentMap[row.department || ''] || '';
        const searchableText = normalize(`${row.summary} ${row.voucherNo} ${row.counterparty} ${row.subjectName} ${deptName}`);
        const amountStr = Math.abs(row.debitAmount || row.creditAmount).toString();
        matchKey = terms.every(term => searchableText.includes(term)) || amountStr.includes(debouncedKeyword);
      }
      return matchPeriod && matchCode && matchKey && matchCategory;
    });
  }, [data, filter.period, debouncedSubject, debouncedKeyword, filter.category, config]);

  const totalDebit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.debitAmount, 0), [filteredRows]);
  const totalCredit = useMemo(() => filteredRows.reduce((sum, r) => sum + r.creditAmount, 0), [filteredRows]);

  const totalPages = Math.ceil(filteredRows.length / ITEMS_PER_PAGE);
  const paginatedRows = filteredRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleExport = () => {
    if (filteredRows.length === 0) return;
    const exportData = filteredRows.map(r => ({
        '期间': r.period,
        '凭证号': r.voucherNo,
        '科目编码': r.subjectCode,
        '科目名称': r.subjectName,
        '借方': r.debitAmount,
        '贷方': r.creditAmount,
        '摘要': r.summary
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "明细账");
    XLSX.writeFile(workbook, `明细账_${new Date().getTime()}.xlsx`);
  };

  const handleClearAI = () => {
      setNlqInput('');
      setAiResponse('');
      setFilter({ period: '', subjectCode: '', keyword: '', category: '' });
  };

  const handleNlqSearch = async () => {
      if (!nlqInput.trim()) return;
      setIsNlqLoading(true);
      setNlqError('');
      setAiResponse('');
      try {
          const validPeriods = (Array.from(new Set(data.map(r => String(r.period)))) as string[]).sort();
          const result = await parseNaturalLanguageQuery(nlqInput, validPeriods, config);
          setFilter({
              period: result.period || '',
              subjectCode: result.subjectCode || '',
              keyword: result.keyword || '',
              category: result.category || ''
          });
          
          // Generate context-aware response
          const tempFiltered = data.filter(r => (result.period ? r.period === result.period : true));
          const stats = {
              count: tempFiltered.length,
              totalDebit: tempFiltered.reduce((sum, r) => sum + r.debitAmount, 0).toFixed(2),
              totalCredit: tempFiltered.reduce((sum, r) => sum + r.creditAmount, 0).toFixed(2),
          };
          const aiText = await generateNlqResponse(nlqInput, stats);
          setAiResponse(aiText);
      } catch (e) {
          setNlqError("AI 解析失败");
      } finally {
          setIsNlqLoading(false);
      }
  };

  const handleComplianceCheck = async () => {
      setIsCheckingCompliance(true);
      setComplianceResults([]);
      try {
          // Check visible rows (or top 20 of filter)
          const rowsToCheck = filteredRows.slice(0, 20); 
          const results = await checkLedgerCompliance(rowsToCheck);
          setComplianceResults(results);
          if(results.length === 0) alert("未发现明显合规问题 (基于当前抽样)");
      } catch (e) {
          console.error(e);
          alert("合规检查失败");
      } finally {
          setIsCheckingCompliance(false);
      }
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
      
      {/* 1. NLQ Search & Compliance Bar */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-1 rounded-2xl shadow-md transition-all">
          <div className="bg-white rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                    <Sparkles size={18} />
                </div>
                <input 
                    ref={nlqInputRef}
                    type="text"
                    value={nlqInput}
                    onChange={(e) => setNlqInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNlqSearch()}
                    placeholder="AI 搜索：'查一下研发部的差旅费'..."
                    className="flex-1 outline-none text-sm font-bold text-slate-700 placeholder:font-normal placeholder:text-slate-400"
                    disabled={isNlqLoading}
                />
                
                {(nlqInput || filter.period) && (
                    <button onClick={handleClearAI} className="p-1 rounded-full text-slate-300 hover:text-slate-500 hover:bg-slate-100"><X size={16} /></button>
                )}

                <button 
                    onClick={handleNlqSearch}
                    disabled={isNlqLoading || !nlqInput.trim()}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-all flex items-center gap-2 shrink-0"
                >
                    {isNlqLoading ? <Loader2 size={14} className="animate-spin" /> : "AI 查询"}
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1"></div>

                <button 
                    onClick={handleComplianceCheck}
                    disabled={isCheckingCompliance}
                    className="px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-bold rounded-lg hover:bg-emerald-100 transition-all flex items-center gap-2 shrink-0"
                    title="主动检查当前列表中的记录是否符合知识库制度"
                >
                    {isCheckingCompliance ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    合规审计
                </button>
              </div>

              {/* AI Response Area */}
              {aiResponse && (
                  <div className="mt-3 mx-1 p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                      <MessageSquare size={16} className="text-indigo-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-indigo-900 font-medium whitespace-pre-line">{aiResponse}</p>
                  </div>
              )}

              {/* Compliance Results Area */}
              {complianceResults.length > 0 && (
                  <div className="mt-3 mx-1 p-3 bg-red-50/50 rounded-xl border border-red-100 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center gap-2 mb-2 text-red-700 font-bold text-sm">
                          <AlertOctagon size={16} /> 发现疑似违规记录 ({complianceResults.length})
                      </div>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-2 scrollbar-thin">
                          {complianceResults.map((res, i) => (
                              <div key={i} className="text-xs p-2 bg-white rounded border border-red-100 shadow-sm">
                                  <div className="flex justify-between font-bold text-slate-700">
                                      <span>{res.summary}</span>
                                      <span className="font-mono">{res.voucherNo}</span>
                                  </div>
                                  <div className="text-red-600 mt-1">❌ {res.issue}</div>
                                  <div className="text-slate-400 mt-1 flex items-center gap-1">
                                      <FileText size={10} /> 依据: {res.policySource}
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}
          </div>
      </div>

      {/* 2. Standard Filter Bar (Same as before) */}
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
              </div>
          </div>
          <button onClick={handleExport} className="flex-shrink-0 flex items-center gap-2 px-4 h-9 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg transition text-sm w-fit ml-auto xl:ml-0">
            <Download size={16} /> 导出 Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 flex-shrink-0">
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">借方合计</span>
          <span className="text-lg font-mono font-bold text-slate-900">{formatCurrency(totalDebit, privacyMode)}</span>
        </div>
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">贷方合计</span>
          <span className="text-lg font-mono font-bold text-slate-900">{formatCurrency(totalCredit, privacyMode)}</span>
        </div>
        <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[150px]">
          <span className="text-xs text-slate-400 font-bold uppercase mr-2 block">记录总数</span>
          <span className="text-lg font-mono font-bold text-slate-900">{filteredRows.length}</span>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 w-24 bg-slate-50">日期/期间</th>
                <th className="px-4 py-3 w-32 bg-slate-50">凭证号</th>
                <th className="px-4 py-3 w-32 bg-slate-50">部门</th>
                <th className="px-4 py-3 w-48 bg-slate-50">科目</th>
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
                    className="px-4 py-2 font-mono text-blue-600 text-xs cursor-pointer hover:underline"
                    onClick={() => setSelectedVoucherNo(row.voucherNo)}
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
                  <td className="px-4 py-2 text-right font-mono text-emerald-600">{formatCurrency(row.debitAmount, privacyMode)}</td>
                  <td className="px-4 py-2 text-right font-mono text-orange-600">{formatCurrency(row.creditAmount, privacyMode)}</td>
                  <td className="px-4 py-2 max-w-[200px]">
                     <div className="text-xs text-slate-600 truncate" title={row.summary}>{row.summary}</div>
                  </td>
                  <td className="px-4 py-2 w-40">
                     <div className="flex flex-col max-w-[160px]">
                        <span className="font-bold text-slate-700 text-xs truncate" title={row.counterpartyName || row.counterparty}>
                            {row.counterpartyName || row.counterparty || '-'}
                        </span>
                     </div>
                  </td>
                </tr>
              ))}
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
        <VoucherModal voucherNo={selectedVoucherNo} allData={data} config={config} onClose={() => setSelectedVoucherNo(null)} privacyMode={privacyMode} />
      )}
    </div>
  );
};

const VoucherModal = ({ voucherNo, allData, config, onClose, privacyMode }: any) => {
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
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">{row.debitAmount > 0 ? formatCurrency(row.debitAmount, privacyMode) : ''}</td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">{row.creditAmount > 0 ? formatCurrency(row.creditAmount, privacyMode) : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-bold text-xs border-t border-slate-200">
                            <tr>
                                <td colSpan={6} className="px-6 py-3 text-right text-slate-500 uppercase">合计 (Total) {!isBalanced && <span className="ml-2 text-red-500 flex inline-flex items-center gap-1"><ArrowRightLeft size={10} /> 不平!</span>}</td>
                                <td className="px-6 py-3 text-right font-mono text-emerald-600 border-t border-slate-300">{formatCurrency(totalDebit, privacyMode)}</td>
                                <td className="px-6 py-3 text-right font-mono text-orange-600 border-t border-slate-300">{formatCurrency(totalCredit, privacyMode)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default LedgerPage;
