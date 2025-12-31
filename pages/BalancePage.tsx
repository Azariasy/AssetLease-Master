
import React, { useState, useMemo, useEffect } from 'react';
import { BalanceRow, SystemConfig, Company } from '../types';
import { Search, Filter, ArrowRightCircle, Users, Building2, X, ChevronRight, ChevronDown, LayoutGrid, Download, FolderTree, List, PlusSquare, MinusSquare, Briefcase, Layers, ChevronLeft, ChevronsLeft, ChevronsRight } from 'lucide-react';
import * as XLSX from 'xlsx';

interface BalancePageProps {
  balances: BalanceRow[];
  onDrillDown: (subjectCode: string, period: string) => void;
  config?: SystemConfig;
  currentEntity?: Company;
}

// Extended Interface for Tree Display
interface TreeBalanceRow extends BalanceRow {
  level: number;
  hasChildren: boolean;
  isGenerated?: boolean; // Marks rows synthesized by the frontend
  parentCode?: string | null;
  isExpanded?: boolean; 
}

const ITEMS_PER_PAGE = 50;

const BalancePage: React.FC<BalancePageProps> = ({ balances, onDrillDown, config, currentEntity }) => {
  const storagePrefix = currentEntity ? `bal_${currentEntity.id}_` : 'bal_';

  // --- State ---
  const [period, setPeriod] = useState<string>(() => sessionStorage.getItem(storagePrefix + 'period') || '');
  const [keyword, setKeyword] = useState(() => sessionStorage.getItem(storagePrefix + 'keyword') || '');
  const [activeTab, setActiveTab] = useState<string>(() => sessionStorage.getItem(storagePrefix + 'tab') || '全部');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>(() => (sessionStorage.getItem(storagePrefix + 'viewMode') as 'tree'|'list') || 'tree');
  
  // Dimensions - Allow toggling in both modes now
  const [showDept, setShowDept] = useState(() => sessionStorage.getItem(storagePrefix + 'showDept') !== 'false');
  const [showCounterparty, setShowCounterparty] = useState(() => sessionStorage.getItem(storagePrefix + 'showCP') !== 'false');
  const [showProject, setShowProject] = useState(() => sessionStorage.getItem(storagePrefix + 'showProj') !== 'false');
  const [showSubAccount, setShowSubAccount] = useState(() => sessionStorage.getItem(storagePrefix + 'showSub') !== 'false');

  // Tree State
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // --- Persistence ---
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'period', period); }, [period, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'keyword', keyword); }, [keyword, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'tab', activeTab); }, [activeTab, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showDept', String(showDept)); }, [showDept, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showCP', String(showCounterparty)); }, [showCounterparty, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showProj', String(showProject)); }, [showProject, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'showSub', String(showSubAccount)); }, [showSubAccount, storagePrefix]);
  useEffect(() => { sessionStorage.setItem(storagePrefix + 'viewMode', viewMode); }, [viewMode, storagePrefix]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [period, keyword, activeTab, viewMode]);

  // --- Init ---
  const periods = useMemo(() => Array.from(new Set(balances.map(b => b.period))).sort().reverse(), [balances]);
  useEffect(() => {
    if (!period && periods.length > 0) setPeriod(periods[0]);
  }, [periods, period]);

  const elements = useMemo(() => {
    const s = new Set(balances.map(b => b.accountElement || '未分类'));
    return ['全部', ...Array.from(s).sort()];
  }, [balances]);

  // --- Helpers ---
  const normalize = (str: string) => str ? String(str).replace(/[\s\.]/g, '').toLowerCase() : '';
  const inferNameByLevel = (targetCode: string, childName: string): string => {
      if (!childName) return `(汇总) ${targetCode}`;
      const targetLevel = Math.max(0, Math.ceil((targetCode.length - 4) / 2));
      const separators = ['-', '—', '_', '\\', '/', ' '];
      let parts = [childName];
      let bestSep = '';
      for (const sep of separators) {
          if (childName.includes(sep)) {
               const p = childName.split(sep);
               if (p.length > parts.length) {
                   parts = p;
                   bestSep = sep;
               }
          }
      }
      const partsNeeded = targetLevel + 1;
      if (parts.length >= partsNeeded) {
          return parts.slice(0, partsNeeded).join(bestSep);
      }
      return childName;
  };

  // --- Data Processing ---
  const processedData = useMemo(() => {
    // 1. Basic Filter
    const filtered = balances.filter(b => {
      if (period && b.period !== period) return false;
      if (activeTab !== '全部' && b.accountElement !== activeTab) return false;
      return true;
    });

    // --- List Mode (Flat Aggregation) ---
    if (viewMode === 'list') {
        const aggMap = new Map<string, BalanceRow>();
        filtered.forEach(row => {
            let key = row.subjectCode;
            if (showDept) key += `|${row.costCenterCode || 'NULL'}`;
            if (showCounterparty) key += `|${row.counterpartyCode || 'NULL'}`;
            if (showProject) key += `|${row.projectCode || 'NULL'}`;
            if (showSubAccount) key += `|${row.subAccountCode || 'NULL'}`;

            if (!aggMap.has(key)) {
                aggMap.set(key, { ...row, openingBalance: 0, debitPeriod: 0, creditPeriod: 0, closingBalance: 0, lastYearClosingBalance: 0 });
            }
            const item = aggMap.get(key)!;
            item.openingBalance += row.openingBalance;
            item.debitPeriod += row.debitPeriod;
            item.creditPeriod += row.creditPeriod;
            item.closingBalance += row.closingBalance;
            item.lastYearClosingBalance = (item.lastYearClosingBalance || 0) + (row.lastYearClosingBalance || 0);
            
            // Optimization: pickup names if missing
            if (!item.costCenterName && row.costCenterName) item.costCenterName = row.costCenterName;
            if (!item.projectName && row.projectName) item.projectName = row.projectName;
            if (!item.subAccountName && row.subAccountName) item.subAccountName = row.subAccountName;
            if (!item.counterpartyName && row.counterpartyName) item.counterpartyName = row.counterpartyName;
        });

        let result = Array.from(aggMap.values());
        if (keyword) {
            const terms = keyword.toLowerCase().split(' ').filter(t => t);
            result = result.filter(b => {
                const text = normalize(`${b.subjectCode} ${b.subjectName} ${b.costCenterName} ${b.counterpartyName} ${b.projectName} ${b.subAccountName}`);
                const amountStr = Math.abs(b.closingBalance).toString();
                return terms.every(term => text.includes(term)) || (amountStr.includes(keyword));
            });
        }
        return result.sort((a,b) => a.subjectCode.localeCompare(b.subjectCode)).map(r => ({ ...r, level: 0, hasChildren: false, isGenerated: false, parentCode: null } as TreeBalanceRow));
    } 
    
    // --- Tree Mode (Hierarchy) ---
    const nodeMap = new Map<string, TreeBalanceRow>();
    
    // Map existing rows (Leaf Nodes or Intermediate Nodes present in source)
    filtered.forEach(row => {
        if (!nodeMap.has(row.subjectCode)) {
            nodeMap.set(row.subjectCode, { 
                ...row, 
                level: 0, hasChildren: false, parentCode: null,
                // KEEP dimensions for tree nodes, do not clear them!
                openingBalance: 0, debitPeriod: 0, creditPeriod: 0, closingBalance: 0, lastYearClosingBalance: 0,
                isGenerated: false
            });
        }
        const node = nodeMap.get(row.subjectCode)!;
        node.openingBalance += row.openingBalance;
        node.debitPeriod += row.debitPeriod;
        node.creditPeriod += row.creditPeriod;
        node.closingBalance += row.closingBalance;
        node.lastYearClosingBalance = (node.lastYearClosingBalance || 0) + (row.lastYearClosingBalance || 0);
    });

    // Synthesize Parents
    const existingCodes = Array.from(nodeMap.keys());
    const getParentCode = (code: string) => (code.length <= 4) ? null : code.substring(0, code.length - 2);

    existingCodes.forEach(leafCode => {
        let curr = leafCode;
        const leafName = nodeMap.get(leafCode)?.subjectName || '';
        while (true) {
            const pCode = getParentCode(curr);
            if (!pCode) break;
            const inferredName = inferNameByLevel(pCode, leafName);

            if (!nodeMap.has(pCode)) {
                nodeMap.set(pCode, {
                    id: `gen-${pCode}`,
                    period: period,
                    subjectCode: pCode,
                    subjectName: inferredName,
                    accountElement: nodeMap.get(curr)?.accountElement,
                    // Generated Parents have empty dimensions
                    costCenter: '', counterparty: '', projectCode: '', subAccountCode: '',
                    openingBalance: 0, debitPeriod: 0, creditPeriod: 0, closingBalance: 0, lastYearClosingBalance: 0,
                    level: 0, hasChildren: true, isGenerated: true, parentCode: getParentCode(pCode),
                });
            } else {
                const parent = nodeMap.get(pCode)!;
                if (parent.isGenerated && inferredName && (!parent.subjectName || parent.subjectName.includes('汇总'))) {
                     parent.subjectName = inferredName;
                }
            }
            curr = pCode;
        }
    });

    // Aggregate Bottom-Up
    const sortedAllCodes = Array.from(nodeMap.keys()).sort((a, b) => b.length - a.length);
    sortedAllCodes.forEach(code => {
        const node = nodeMap.get(code)!;
        const pCode = getParentCode(code);
        if (pCode && nodeMap.has(pCode)) {
            const parent = nodeMap.get(pCode)!;
            parent.hasChildren = true;
            if (parent.isGenerated) {
                parent.openingBalance += node.openingBalance;
                parent.debitPeriod += node.debitPeriod;
                parent.creditPeriod += node.creditPeriod;
                parent.closingBalance += node.closingBalance;
                parent.lastYearClosingBalance = (parent.lastYearClosingBalance || 0) + (node.lastYearClosingBalance || 0);
            }
        }
    });

    // Flatten for View with Filtering and Recursive Visibility Check
    const result: TreeBalanceRow[] = [];
    const finalSortedCodes = Array.from(nodeMap.keys()).sort();
    
    // TRACK VISIBILITY: A node is visible only if its parent is visible AND expanded
    const visibleCodes = new Set<string>();

    finalSortedCodes.forEach(code => {
        const node = nodeMap.get(code)!;
        node.level = Math.max(0, (code.length - 4) / 2);
        
        if (keyword) {
             const terms = keyword.toLowerCase().split(' ').filter(t => t);
             const text = normalize(`${node.subjectCode} ${node.subjectName}`);
             const amountStr = Math.abs(node.closingBalance).toString();
             const match = terms.every(term => text.includes(term)) || amountStr.includes(keyword);
             if (match) result.push(node);
        } else {
             const pCode = getParentCode(code);
             const isRoot = !pCode || !nodeMap.has(pCode);
             
             let isVisible = false;
             if (isRoot) {
                 isVisible = true;
             } else {
                 // RECURSIVE CHECK: Parent must be visible (in visibleCodes) AND Parent must be expanded
                 if (visibleCodes.has(pCode!) && expandedRows.has(pCode!)) {
                     isVisible = true;
                 }
             }

             if (isVisible) {
                 visibleCodes.add(code);
                 result.push(node);
             }
        }
    });

    return result;
  }, [balances, period, activeTab, viewMode, showDept, showCounterparty, showProject, showSubAccount, keyword, expandedRows]);

  // Pagination Logic
  const totalPages = Math.ceil(processedData.length / ITEMS_PER_PAGE);
  const paginatedRows = processedData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Tree Handlers
  const toggleRow = (code: string) => {
      const newSet = new Set(expandedRows);
      if (newSet.has(code)) newSet.delete(code);
      else newSet.add(code);
      setExpandedRows(newSet);
  };

  const expandAll = () => {
      setExpandedRows(new Set()); // Simple clear to reset state, implies collapse all or use logic to find all parents
  };
  
  const collapseAll = () => setExpandedRows(new Set());

  const handleExport = () => {
    if (processedData.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(processedData.map(r => ({
        '科目编码': r.subjectCode,
        '科目名称': r.subjectName,
        '成本中心名称': r.costCenterName || r.costCenter || '',
        '项目名称': r.projectName || '',
        '子目名称': r.subAccountName || '',
        '往来名称': r.counterpartyName || r.counterparty || '',
        '期初余额': r.openingBalance,
        '本期借方': r.debitPeriod,
        '本期贷方': r.creditPeriod,
        '期末余额': r.closingBalance,
        '上年同期期末': r.lastYearClosingBalance
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "余额表");
    XLSX.writeFile(workbook, `余额表_${period}.xlsx`);
  };

  const renderDualLine = (name: string | undefined, code: string | undefined, placeholder: string = '-') => {
    const hasName = name && name !== '缺省' && name !== 'Default';
    const hasCode = code && code !== '0' && code !== '缺省';
    
    // Compact View for empty cells
    if (!hasName && !hasCode) return <span className="text-slate-300">-</span>;

    return (
      <div className="flex flex-col max-w-[160px]">
        <span className="font-bold text-slate-700 text-xs truncate" title={name}>{hasName ? name : placeholder}</span>
        {hasCode && <span className="font-mono text-[10px] text-slate-400">{code}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-140px)]">
      {/* Control Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4 flex-shrink-0">
        <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
            {/* Left: Filters */}
            <div className="flex items-center gap-3 overflow-x-auto pb-1 xl:pb-0 no-scrollbar">
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

                <div className="relative group w-72 flex-shrink-0 h-9">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" size={15} />
                    <input 
                        type="text" 
                        placeholder="搜索科目 / 金额" 
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

            {/* Right: View Modes & Actions */}
            <div className="flex items-center gap-2">
                <div className="bg-slate-100 p-1 rounded-lg flex gap-1 mr-2">
                    <button 
                        onClick={() => setViewMode('tree')}
                        className={`p-1.5 rounded-md transition-all flex items-center gap-1.5 px-2 ${viewMode === 'tree' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-400 hover:text-slate-600'}`}
                        title="树状视图"
                    >
                        <FolderTree size={16} />
                        <span className="text-xs">树状</span>
                    </button>
                    <button 
                        onClick={() => setViewMode('list')}
                        className={`p-1.5 rounded-md transition-all flex items-center gap-1.5 px-2 ${viewMode === 'list' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-400 hover:text-slate-600'}`}
                        title="列表视图"
                    >
                        <List size={16} />
                        <span className="text-xs">列表</span>
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => setShowDept(!showDept)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${showDept ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>成本中心</button>
                    <button onClick={() => setShowProject(!showProject)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${showProject ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>项目</button>
                    <button onClick={() => setShowSubAccount(!showSubAccount)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${showSubAccount ? 'bg-orange-50 border-orange-200 text-orange-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>子目</button>
                    <button onClick={() => setShowCounterparty(!showCounterparty)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${showCounterparty ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>往来</button>
                </div>
                
                {viewMode === 'tree' && !keyword && (
                     <div className="flex gap-2 ml-2">
                        <button onClick={expandAll} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-indigo-600 px-2 py-1.5 hover:bg-slate-50 rounded">
                            <PlusSquare size={14} />
                        </button>
                        <button onClick={collapseAll} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-indigo-600 px-2 py-1.5 hover:bg-slate-50 rounded">
                            <MinusSquare size={14} />
                        </button>
                    </div>
                )}

                <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-all ml-2">
                   <Download size={14} /> 导出
                </button>
            </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {elements.map(el => (
                    <button key={el} onClick={() => setActiveTab(el)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${activeTab === el ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'}`}>
                        {el}
                    </button>
                ))}
            </div>
            <div className="text-xs text-slate-500 whitespace-nowrap">共 <span className="font-bold text-slate-900">{processedData.length}</span> 条</div>
        </div>
      </div>

      {/* Table Area - Sticky Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm">
                <tr>
                <th className="px-6 py-4 w-64 bg-slate-50">科目信息</th>
                <th className="px-6 py-4 w-24 bg-slate-50">会计要素</th>
                
                {showDept && <th className="px-6 py-4 w-40 bg-indigo-50/30 text-indigo-700">成本中心</th>}
                {showProject && <th className="px-6 py-4 w-40 bg-purple-50/30 text-purple-700">项目</th>}
                {showSubAccount && <th className="px-6 py-4 w-40 bg-orange-50/30 text-orange-700">子目</th>}
                {showCounterparty && <th className="px-6 py-4 w-48 bg-blue-50/30 text-blue-700">往来单位</th>}

                <th className="px-6 py-4 text-right w-32 bg-slate-50">期初余额</th>
                <th className="px-6 py-4 text-right w-32 bg-slate-50">本期借方</th>
                <th className="px-6 py-4 text-right w-32 bg-slate-50">本期贷方</th>
                <th className="px-6 py-4 text-right w-32 bg-slate-50">期末余额</th>
                <th className="px-6 py-4 text-right w-32 bg-slate-50">上年同期期末</th>
                <th className="px-6 py-4 text-center w-24 bg-slate-50">穿透</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {paginatedRows.length > 0 ? paginatedRows.map((row) => (
                <tr key={row.id || row.subjectCode} className="hover:bg-slate-50 group transition-colors">
                    {/* Subject Column: Unified Style for Tree & List */}
                    <td className="px-6 py-3">
                        <div className="flex items-center" style={{ paddingLeft: viewMode === 'tree' ? `${(row.level || 0) * 20}px` : '0px' }}>
                            {viewMode === 'tree' && row.hasChildren && !keyword ? (
                                <button 
                                    onClick={() => toggleRow(row.subjectCode)}
                                    className="p-1 mr-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-200 transition-colors flex-shrink-0"
                                >
                                    {expandedRows.has(row.subjectCode) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                            ) : (
                                viewMode === 'tree' && <div className="w-6 mr-1 flex-shrink-0" />
                            )}
                            <div className="flex flex-col">
                                <span className={`truncate max-w-[240px] font-bold text-slate-700 text-xs`} title={row.subjectName}>
                                    {row.subjectName}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                    {row.subjectCode}
                                </span>
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-3">{row.accountElement && <span className="px-2 py-1 bg-slate-100 rounded text-[10px] text-slate-500">{row.accountElement}</span>}</td>

                    {/* Dynamic Cells: Visible in both Tree & List if toggled */}
                    {showDept && <td className="px-6 py-3 text-xs font-medium text-indigo-600 truncate max-w-[160px]">{renderDualLine(row.costCenterName || row.costCenter, row.costCenterCode)}</td>}
                    {showProject && <td className="px-6 py-3 text-xs font-medium text-purple-600 truncate max-w-[160px]">{renderDualLine(row.projectName, row.projectCode)}</td>}
                    {showSubAccount && <td className="px-6 py-3 text-xs font-medium text-orange-600 truncate max-w-[160px]">{renderDualLine(row.subAccountName, row.subAccountCode)}</td>}
                    {showCounterparty && <td className="px-6 py-3 text-xs font-medium text-blue-600 truncate max-w-[200px]">{renderDualLine(row.counterpartyName || row.counterparty, row.counterpartyCode)}</td>}

                    <td className="px-6 py-3 text-right text-slate-400 font-mono text-xs">¥{row.openingBalance.toLocaleString()}</td>
                    <td className="px-6 py-3 text-right text-slate-600 font-mono text-xs">¥{row.debitPeriod.toLocaleString()}</td>
                    <td className="px-6 py-3 text-right text-slate-600 font-mono text-xs">¥{row.creditPeriod.toLocaleString()}</td>
                    <td className={`px-6 py-3 text-right font-mono font-bold text-sm ${row.closingBalance < 0 ? 'text-red-600' : 'text-slate-900'}`}>¥{row.closingBalance.toLocaleString()}</td>
                    <td className="px-6 py-3 text-right text-slate-400 font-mono text-xs">¥{row.lastYearClosingBalance?.toLocaleString() || '0'}</td>
                    
                    <td className="px-6 py-3 text-center">
                        <button onClick={() => onDrillDown(row.subjectCode, period)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1 mx-auto" title="查看明细账">
                            <ArrowRightCircle size={16} />
                        </button>
                    </td>
                </tr>
                )) : (
                <tr><td colSpan={13} className="px-6 py-12 text-center text-slate-400">暂无数据</td></tr>
                )}
            </tbody>
            </table>
        </div>
        
        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-white flex-shrink-0">
             <div className="text-xs text-slate-500">
               第 <span className="font-bold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> - <span className="font-bold">{Math.min(currentPage * ITEMS_PER_PAGE, processedData.length)}</span> 条 / 共 {processedData.length} 条
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
    </div>
  );
};

export default BalancePage;
