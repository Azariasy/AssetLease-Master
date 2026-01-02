import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerRow, SystemConfig, Company, ComplianceResult } from '../types';
import { Search, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText, ArrowRightLeft, Sparkles, Loader2, MessageSquare, Keyboard, ShieldCheck, AlertOctagon, Bot, Send, User } from 'lucide-react';
import * as XLSX from 'xlsx';
import { parseNaturalLanguageQuery, generateChatResponse, checkLedgerCompliance } from '../services/geminiService';
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

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

const LedgerPage: React.FC<LedgerPageProps> = ({ data, initialFilter, config, currentEntity, privacyMode }) => {
  const storagePrefix = currentEntity ? `led_${currentEntity.id}_` : 'led_';
  const chatEndRef = useRef<HTMLDivElement>(null);

  // State
  const [filter, setFilter] = useState({
    period: sessionStorage.getItem(storagePrefix + 'period') || '',
    subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
    keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
    category: '', 
  });

  const debouncedKeyword = useDebounce(filter.keyword, 300);
  const debouncedSubject = useDebounce(filter.subjectCode, 300);

  // AI Chat State
  const [showChat, setShowChat] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{
      id: 'welcome',
      role: 'assistant',
      content: '你好！我是您的财务助手。您可以让我帮您筛选数据，例如：“查一下研发部上个月的差旅费”。',
      timestamp: Date.now()
  }]);

  // Compliance State
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);
  const [complianceResults, setComplianceResults] = useState<ComplianceResult[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVoucherNo, setSelectedVoucherNo] = useState<string | null>(null);

  useEffect(() => {
      setFilter({
        period: sessionStorage.getItem(storagePrefix + 'period') || '',
        subjectCode: sessionStorage.getItem(storagePrefix + 'subject') || '',
        keyword: sessionStorage.getItem(storagePrefix + 'keyword') || '',
        category: ''
      });
      setSelectedVoucherNo(null);
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

  // Scroll chat to bottom
  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, showChat]);

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

  const handleChatSubmit = async () => {
      if (!chatInput.trim()) return;
      
      const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: chatInput, timestamp: Date.now() };
      setChatHistory(prev => [...prev, userMsg]);
      setChatInput('');
      setIsChatLoading(true);

      try {
          // 1. Parse Query to update Filters
          const validPeriods = Array.from(new Set(data.map(r => String(r.period)))).sort() as string[];
          const parseRes = await parseNaturalLanguageQuery(userMsg.content, validPeriods, config);
          
          const newFilter = {
              period: parseRes.period || filter.period, // Keep existing if not mentioned
              subjectCode: parseRes.subjectCode || '',
              keyword: parseRes.keyword || '',
              category: parseRes.category || ''
          };
          
          // Only update filter if the AI found actionable filters
          if (parseRes.period || parseRes.subjectCode || parseRes.keyword || parseRes.category) {
              setFilter(prev => ({...prev, ...newFilter}));
          }

          // 2. Generate Stats for AI context
          // Note: We need to calculate stats based on the *potentially new* filter
          // Since React state update is async, we manually filter here for the AI context
          const tempFiltered = data.filter(row => {
               const p = newFilter.period || filter.period;
               const k = newFilter.keyword || filter.keyword;
               const s = newFilter.subjectCode || filter.subjectCode;
               
               const matchP = p ? row.period.startsWith(p) : true;
               const matchS = s ? row.subjectCode.includes(s) : true;
               const matchK = k ? row.summary.includes(k) : true;
               return matchP && matchS && matchK;
          });

          const stats = {
              count: tempFiltered.length,
              totalDebit: tempFiltered.reduce((sum, r) => sum + r.debitAmount, 0).toFixed(2),
              totalCredit: tempFiltered.reduce((sum, r) => sum + r.creditAmount, 0).toFixed(2),
              summaries: Array.from(new Set(tempFiltered.map(r => r.summary).filter(Boolean))).slice(0, 3)
          };

          // 3. Generate Multi-turn Response
          const apiHistory = chatHistory.map(m => ({ role: m.role, content: m.content }));
          const aiResponseText = await generateChatResponse(apiHistory, userMsg.content, stats);
          
          setChatHistory(prev => [...prev, {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: aiResponseText,
              timestamp: Date.now()
          }]);

      } catch (e) {
          console.error(e);
          setChatHistory(prev => [...prev, {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: "抱歉，AI 服务暂时不可用，请检查网络或 API Key 设置。",
              timestamp: Date.now()
          }]);
      } finally {
          setIsChatLoading(false);
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
      
      {/* 1. AI Copilot (Collapsible Chat) */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-1 rounded-2xl shadow-md transition-all">
          <div className="bg-white rounded-xl overflow-hidden flex flex-col">
              {/* Header / Toggle */}
              <div 
                className="p-3 bg-indigo-50/50 flex justify-between items-center cursor-pointer border-b border-indigo-50"
                onClick={() => setShowChat(!showChat)}
              >
                  <div className="flex items-center gap-2 text-indigo-800 font-bold text-sm">
                      <Sparkles size={16} className="text-indigo-600" />
                      <span>AI 财务助手 (Copilot)</span>
                  </div>
                  <div className="flex items-center gap-2">
                       {/* Compliance Button moved here */}
                       <button 
                            onClick={(e) => { e.stopPropagation(); handleComplianceCheck(); }}
                            disabled={isCheckingCompliance}
                            className="px-3 py-1 bg-white border border-emerald-200 text-emerald-600 text-xs font-bold rounded-lg hover:bg-emerald-50 transition-all flex items-center gap-1"
                        >
                            {isCheckingCompliance ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                            合规审计
                        </button>
                      <div className={`transition-transform duration-200 ${showChat ? 'rotate-180' : ''}`}>
                          <ChevronLeft size={16} className="rotate-90 text-indigo-400" />
                      </div>
                  </div>
              </div>

              {/* Chat Body */}
              {showChat && (
                  <div className="flex flex-col h-64 transition-all duration-300">
                      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 scrollbar-thin">
                          {chatHistory.map(msg => (
                              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                                  </div>
                                  <div className={`p-3 rounded-2xl text-sm max-w-[80%] ${msg.role === 'user' ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white border border-slate-200 shadow-sm rounded-tl-none text-slate-700'}`}>
                                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                  </div>
                              </div>
                          ))}
                          {isChatLoading && (
                              <div className="flex gap-3">
                                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0"><Bot size={16} /></div>
                                  <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-sm rounded-tl-none">
                                      <div className="flex gap-1">
                                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                                          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                                      </div>
                                  </div>
                              </div>
                          )}
                          <div ref={chatEndRef}></div>
                      </div>

                      {/* Input Area */}
                      <div className="p-3 bg-white border-t border-slate-100 flex gap-2 items-center">
                          <input 
                              type="text" 
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                              placeholder="输入指令，例如：筛选大于5万元的报销记录..."
                              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                              disabled={isChatLoading}
                          />
                          <button 
                            onClick={handleChatSubmit} 
                            disabled={!chatInput.trim() || isChatLoading}
                            className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                              <Send size={18} />
                          </button>
                      </div>
                  </div>
              )}
          </div>
      </div>

      {/* Compliance Results Alert */}
      {complianceResults.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 animate-in fade-in slide-in-from-top-2 flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg text-red-600 shadow-sm shrink-0">
                    <AlertOctagon size={20} />
                </div>
                <div className="flex-1">
                    <h4 className="font-bold text-red-800 text-sm mb-1">审计发现 {complianceResults.length} 条疑似违规记录</h4>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {complianceResults.map((res, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-red-100 rounded text-xs text-red-600" title={res.issue}>
                                <FileText size={10} /> {res.voucherNo}: {res.summary.substring(0, 10)}...
                            </span>
                        ))}
                    </div>
                </div>
                <button onClick={() => setComplianceResults([])} className="text-red-400 hover:text-red-600"><X size={16}/></button>
            </div>
      )}

      {/* 2. Standard Filter Bar */}
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

        {(filter.subjectCode || filter.period || filter.category) && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
            <Filter size={12} />
            <span>当前筛选条件:</span>
            {filter.period && <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">期间: {filter.period}</span>}
            {filter.category && (
                <span className={`px-2 py-0.5 rounded ${filter.category === 'income' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                    类别: {filter.category === 'income' ? '收入类' : '成本费用类'}
                </span>
            )}
            {filter.subjectCode && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded">科目包含: {filter.subjectCode}</span>}
          </div>
        )}
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
        <VoucherModal voucherNo={selectedVoucherNo} allData={data} config={config} onClose={() => setSelectedVoucherNo(null)} privacyMode={privacyMode} />
      )}
    </div>
  );
};

const VoucherModal = ({ voucherNo, allData, config, onClose, privacyMode }: { voucherNo: string, allData: LedgerRow[], config: SystemConfig, onClose: () => void, privacyMode: boolean }) => {
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