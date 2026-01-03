
import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { 
  Wallet, TrendingUp, TrendingDown, ArrowRightLeft, 
  AlertTriangle, CheckCircle2, X, PieChart as PieIcon,
  Activity, ArrowUpRight, ArrowDownRight, CalendarClock, Upload, Sparkles, Loader2, Lightbulb,
  FileSearch, ChevronDown, ChevronUp, RefreshCw, Users, CreditCard, ShoppingBag, Briefcase,
  Construction
} from 'lucide-react';
import { BalanceRow, LedgerRow, Company, SystemConfig, AnalysisResult } from '../types';
import { db } from '../db';
import { analyzeInterCompanyRecon, smartVoucherMatch, detectFinancialAnomalies } from '../services/geminiService';
import { formatCurrencyShort, formatCurrency } from '../utils/currency';

interface DashboardPageProps {
  currentEntity: Company;
  allEntities: Company[];
  balances: BalanceRow[];
  ledger: LedgerRow[];
  config: SystemConfig;
  onNavigate: (tab: string) => void;
  privacyMode: boolean; // New Prop
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

// Asset related codes from Accounting Manual (Class 1)
const ASSET_CODES = ['1601', '1604', '1901']; // Fixed Assets, Construction in Progress, Engineering Materials

const DashboardPage: React.FC<DashboardPageProps> = React.memo(({ currentEntity, allEntities, balances, ledger, config, onNavigate, privacyMode }) => {
  // --- Empty State Handling ---
  if (!balances || balances.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                <Activity size={32} className="text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">暂无经营数据</h3>
            <p className="text-slate-500 mb-6 max-w-md">
                主体 <span className="font-bold text-slate-700">{currentEntity.name}</span> 尚未导入任何财务数据。
                <br/>请前往“数据导入”页面上传科目余额表。
            </p>
            <button 
              onClick={() => onNavigate('import')}
              className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-indigo-100 transition-colors"
            >
                <Upload size={16} /> 请先导入数据
            </button>
        </div>
    );
  }

  // --- 1. 数据预处理 & 基础计算 ---
  const periods = useMemo(() => Array.from(new Set(balances.map(b => b.period))).sort(), [balances]);
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : '';
  
  const filterLeafNodes = (rows: BalanceRow[]) => {
    const allCodes = new Set(rows.map(r => r.subjectCode));
    return rows.filter(r => !Array.from(allCodes).some(c => c !== r.subjectCode && c.startsWith(r.subjectCode)));
  };

  // Calculate stats based on Accounting Manual logic
  const annualStats = useMemo(() => {
    if (!latestPeriod) return { income: 0, cost: 0, profit: 0, capex: 0, lastYearIncome: 0, lastYearCost: 0 };

    const currentRows = balances.filter(b => b.period === latestPeriod);
    const leafRows = filterLeafNodes(currentRows);

    // Income: 5xxx (Credit - Debit)
    const ytdIncome = leafRows
        .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
            const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
            return sum + (cr - dr);
        }, 0);

    // Cost/Expense: 54xx, 66xx (Debit - Credit)
    const ytdCost = leafRows
        .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
            const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
            return sum + (dr - cr); 
        }, 0);

    // CAPEX: 1604(CIP), 1901(Material) (Debit - Credit)
    // Reflects investment activity
    const ytdCapex = leafRows
        .filter(b => ASSET_CODES.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
             const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
             const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
             return sum + (dr - cr);
        }, 0);

    // Last Year Income
    const lyIncome = leafRows
        .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => sum + ((b.lastYearCredit || 0) - (b.lastYearDebit || 0)), 0);

    const lyCost = leafRows
        .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => sum + ((b.lastYearDebit || 0) - (b.lastYearCredit || 0)), 0);

    return {
        income: ytdIncome,
        cost: ytdCost,
        profit: ytdIncome - ytdCost,
        capex: ytdCapex,
        lastYearIncome: lyIncome,
        lastYearCost: lyCost
    };
  }, [balances, latestPeriod, config]);

  const profitMargin = annualStats.income > 0 ? (annualStats.profit / annualStats.income) * 100 : 0;
  const incomeYoY = annualStats.lastYearIncome ? ((annualStats.income - annualStats.lastYearIncome) / Math.abs(annualStats.lastYearIncome)) * 100 : 0;
  const costYoY = annualStats.lastYearCost ? ((annualStats.cost - annualStats.lastYearCost) / Math.abs(annualStats.lastYearCost)) * 100 : 0;
  
  // --- 2. Chart Data ---
  const trendData = useMemo(() => periods.map(p => {
    const pRows = balances.filter(b => b.period === p);
    const leafRows = filterLeafNodes(pRows);
    
    const inc = leafRows
      .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + (b.creditPeriod - b.debitPeriod), 0); 
      
    const cst = leafRows
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + (b.debitPeriod - b.creditPeriod), 0); 
    
    // Capex (Monthly net debit)
    const cap = leafRows
      .filter(b => ASSET_CODES.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + (b.debitPeriod - b.creditPeriod), 0);
      
    return { period: p, income: inc, cost: cst, capex: cap, profit: inc - cst };
  }), [periods, balances, config]);

  const costStructureData = useMemo(() => {
    const map = new Map<string, number>();
    const currentRows = balances.filter(b => b.period === latestPeriod);
    const leafRows = filterLeafNodes(currentRows);

    leafRows
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .forEach(b => {
        let deptName = b.costCenter || (b.costCenterCode && config.departmentMap[b.costCenterCode]) || '其他';
        if (deptName === '缺省' || deptName === 'Default') deptName = '公共费用';
        
        const netVal = (b.ytdDebit||b.debitPeriod) - (b.ytdCredit||b.creditPeriod);
        if (netVal > 0) map.set(deptName, (map.get(deptName) || 0) + netVal);
      });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); 
  }, [balances, config, latestPeriod]);

  // Business Logic: Counterparty Classification (Income=Customer, Cost=Supplier)
  const { topCustomers, topSuppliers } = useMemo(() => {
    const customerMap = new Map<string, number>();
    const supplierMap = new Map<string, number>();
    
    const currentRows = balances.filter(b => b.period === latestPeriod);
    const leafRows = filterLeafNodes(currentRows);
    
    leafRows.forEach(b => {
        const isIncome = config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code));
        const isCost = config.costSubjectCodes.some(code => b.subjectCode.startsWith(code));
        const isAsset = ASSET_CODES.some(code => b.subjectCode.startsWith(code)); // Asset suppliers also matter
        
        let cpName = b.counterpartyName || b.counterparty;
        if (!cpName || cpName === '缺省' || cpName === 'Default' || cpName === '0' || cpName.includes('挂账')) return;

        const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
        const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;

        if (isIncome) {
            const netVal = cr - dr;
            if (netVal > 0) customerMap.set(cpName, (customerMap.get(cpName) || 0) + netVal);
        } else if (isCost || isAsset) {
            const netVal = dr - cr;
            if (netVal > 0) supplierMap.set(cpName, (supplierMap.get(cpName) || 0) + netVal);
        }
    });

    const sortAndSlice = (map: Map<string, number>) => Array.from(map.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

    return {
        topCustomers: sortAndSlice(customerMap),
        topSuppliers: sortAndSlice(supplierMap)
    };
  }, [balances, config, latestPeriod]);

  // UI State
  const [cpView, setCpView] = useState<'customer' | 'supplier'>('customer');
  const [trendView, setTrendView] = useState<'profit' | 'capex'>('profit');

  // --- 3. Reconciliation & AI ---
  const [reconData, setReconData] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [selectedRecon, setSelectedRecon] = useState<any | null>(null);
  const [otherEntityId, setOtherEntityId] = useState<string>(''); 
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AnalysisResult | null>(null);
  const [anomalyResult, setAnomalyResult] = useState<any>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);

  const isInterCompanyRow = (counterparty: string | undefined, otherEntity: Company) => {
    if (!counterparty) return false;
    const cp = counterparty.trim();
    if (otherEntity.segmentPrefix && cp.includes(otherEntity.segmentPrefix)) return true;
    if (cp.includes(otherEntity.name)) return true;
    if (otherEntity.matchedNameInOtherBooks && cp.includes(otherEntity.matchedNameInOtherBooks)) return true;
    return false;
  };

  useEffect(() => {
    const runReconciliation = async () => {
      setReconLoading(true);
      const results = [];
      const otherEntities = allEntities.filter(e => e.id !== currentEntity.id);

      for (const other of otherEntities) {
        let myRows: BalanceRow[], theirRows: BalanceRow[];
        let myLabel: string, theirLabel: string;
        let myAmount = 0, theirAmount = 0;

        const otherBalances = await db.balances.where('entityId').equals(other.id).toArray();

        // Direction logic based on entity type (Listed vs Non-listed)
        if (currentEntity.type === 'listed') {
            myLabel = "我方成本 (Listed)";
            theirLabel = "对方收入 (Non-Listed)";
            myRows = balances.filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)) && isInterCompanyRow(b.counterparty, other));
            myAmount = myRows.reduce((sum, b) => sum + ((b.ytdDebit || b.debitPeriod) - (b.ytdCredit || b.creditPeriod)), 0);
            
            theirRows = otherBalances.filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)) && isInterCompanyRow(b.counterparty, currentEntity));
            theirAmount = theirRows.reduce((sum, b) => sum + ((b.ytdCredit || b.creditPeriod) - (b.ytdDebit || b.debitPeriod)), 0);
        } else {
            myLabel = "我方收入 (Non-Listed)";
            theirLabel = "对方成本 (Listed)";
            myRows = balances.filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)) && isInterCompanyRow(b.counterparty, other));
            myAmount = myRows.reduce((sum, b) => sum + ((b.ytdCredit || b.creditPeriod) - (b.ytdDebit || b.debitPeriod)), 0);
            
            theirRows = otherBalances.filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)) && isInterCompanyRow(b.counterparty, currentEntity));
            theirAmount = theirRows.reduce((sum, b) => sum + ((b.ytdDebit || b.debitPeriod) - (b.ytdCredit || b.creditPeriod)), 0);
        }

        const allPeriods = Array.from(new Set([...myRows.map(r=>r.period), ...theirRows.map(r=>r.period)])).sort();
        const monthlyBreakdown = allPeriods.map(p => {
            let myVal = 0, theirVal = 0;
            if (currentEntity.type === 'listed') {
                myVal = myRows.filter(r => r.period === p).reduce((sum, r) => sum + (r.debitPeriod - r.creditPeriod), 0);
                theirVal = theirRows.filter(r => r.period === p).reduce((sum, r) => sum + (r.creditPeriod - r.debitPeriod), 0);
            } else {
                myVal = myRows.filter(r => r.period === p).reduce((sum, r) => sum + (r.creditPeriod - r.debitPeriod), 0);
                theirVal = theirRows.filter(r => r.period === p).reduce((sum, r) => sum + (r.debitPeriod - r.creditPeriod), 0);
            }
            return {
                period: p,
                myVal,
                theirVal,
                diff: myVal - theirVal,
                status: Math.abs(myVal - theirVal) < 100 ? 'matched' : 'unmatched'
            };
        });

        results.push({
            otherEntityId: other.id,
            otherEntityName: other.name,
            matchedName: other.matchedNameInOtherBooks,
            myAmount: myAmount,
            theirAmount: theirAmount,
            myLabel,
            theirLabel,
            diff: myAmount - theirAmount,
            status: Math.abs(myAmount - theirAmount) < 1000 ? 'matched' : 'unmatched',
            monthlyBreakdown
        });
      }
      setReconData(results);
      setReconLoading(false);
    };

    if (balances.length > 0) runReconciliation();
    else setReconData([]);
  }, [balances, currentEntity, allEntities, config]);

  const matchRate = reconData.length > 0 
    ? (reconData.filter(r => r.status === 'matched').length / reconData.length) * 100 
    : 0;

  const openReconModal = (item: any) => {
    setSelectedRecon(item);
    setOtherEntityId(item.otherEntityId);
    setAiResult(null); 
  };

  const handleRunAIAnalysis = async () => {
    if (!selectedRecon) return;
    setAiAnalyzing(true);
    try {
        const result = await analyzeInterCompanyRecon(
            currentEntity.name,
            selectedRecon.otherEntityName,
            selectedRecon.monthlyBreakdown
        );
        setAiResult(result);
    } catch (e) {
        console.error(e);
    } finally {
        setAiAnalyzing(false);
    }
  };

  const handleRunAnomalyDetection = async () => {
    setAnomalyLoading(true);
    setAnomalyResult(null);
    try {
      const result = await detectFinancialAnomalies(currentEntity.name, trendData);
      setAnomalyResult(result);
    } catch (e) {
      console.error(e);
    } finally {
      setAnomalyLoading(false);
    }
  };

  const activeCpData = cpView === 'customer' ? topCustomers : topSuppliers;

  return (
    <div className="space-y-6 relative pb-10">
      
      {/* 1. Executive Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <ExecutiveCard 
          title="累计经营收入" 
          amount={annualStats.income} 
          mom={undefined} 
          yoy={incomeYoY}
          hasYoy={annualStats.lastYearIncome > 0}
          period={latestPeriod}
          color="blue"
          icon={<TrendingUp size={24} className="text-white opacity-80" />}
          privacyMode={privacyMode}
        />
        <ExecutiveCard 
          title="累计成本费用 (OPEX)" 
          amount={annualStats.cost} 
          mom={undefined} 
          yoy={costYoY}
          hasYoy={annualStats.lastYearCost > 0}
          period={latestPeriod}
          isInverse={true}
          color="orange"
          icon={<TrendingDown size={24} className="text-white opacity-80" />}
          privacyMode={privacyMode}
        />
        <ExecutiveCard 
          title="资本性支出 (CAPEX)" 
          amount={annualStats.capex} 
          subLabel="资产转固/在建工程"
          subValue={formatCurrencyShort(annualStats.capex, privacyMode)}
          color="purple"
          icon={<Construction size={24} className="text-white opacity-80" />}
          privacyMode={privacyMode}
        />
        {/* Reconciliation Card */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div>
            <div className="flex items-center gap-2 mb-2 relative z-10">
               <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600"><ArrowRightCircleIcon size={16} /></div>
               <span className="text-xs font-bold text-slate-500 uppercase">关联对账健康度</span>
            </div>
            <div className="flex items-baseline gap-2 relative z-10 mt-2">
               <span className="text-3xl font-black text-slate-800">{matchRate.toFixed(0)}%</span>
               <span className="text-xs text-slate-400">已匹配</span>
            </div>
          </div>
          <div className="mt-4 relative z-10">
             <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${matchRate}%` }}></div>
             </div>
             <p className="text-[10px] text-slate-400 mt-2 flex justify-between">
                <span>涉及主体: {reconData.length} 家</span>
                <span className={reconData.some(r => r.status === 'unmatched') ? 'text-red-500 font-bold' : 'text-emerald-500 font-bold'}>
                  {reconData.some(r => r.status === 'unmatched') ? '存在差异' : '全部相符'}
                </span>
             </p>
          </div>
        </div>
      </div>

      {/* 2. Main Analytics Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left: Trend Analysis (Toggle between Profit & CAPEX) */}
        <div className="xl:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
                <div className="flex justify-between items-center mb-6 relative z-10">
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Activity size={20} className={trendView === 'profit' ? "text-blue-500" : "text-purple-500"} />
                                {trendView === 'profit' ? '经营趋势分析 (P&L)' : '资产构建分析 (CAPEX)'}
                            </h3>
                            <div className="flex bg-slate-100 p-0.5 rounded-lg">
                                <button 
                                    onClick={() => setTrendView('profit')} 
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${trendView === 'profit' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}
                                >
                                    损益
                                </button>
                                <button 
                                    onClick={() => setTrendView('capex')} 
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${trendView === 'capex' ? 'bg-white shadow text-purple-600' : 'text-slate-500'}`}
                                >
                                    资产
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          基于 {periods.length} 个会计期间数据
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                         <button 
                            onClick={handleRunAnomalyDetection}
                            disabled={anomalyLoading}
                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold transition-all"
                         >
                            {anomalyLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            AI 异常检测
                         </button>
                        {trendView === 'profit' ? (
                            <div className="flex items-center gap-2 pl-2 border-l border-slate-100">
                                <LegendBadge color="bg-emerald-500" label="收入" />
                                <LegendBadge color="bg-amber-400" label="成本" />
                                <LegendBadge color="bg-blue-500" label="利润" />
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 pl-2 border-l border-slate-100">
                                <LegendBadge color="bg-purple-500" label="CAPEX" />
                            </div>
                        )}
                    </div>
                </div>

                {/* AI Anomaly Result Box */}
                {anomalyResult && (
                   <div className="mb-6 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 animate-in slide-in-from-top-4 fade-in">
                       <div className="flex items-start gap-3">
                           <div className="p-2 bg-white rounded-lg shadow-sm text-indigo-500"><Lightbulb size={18} /></div>
                           <div className="flex-1">
                               <h4 className="text-sm font-bold text-indigo-900 mb-1">AI 诊断结论</h4>
                               <p className="text-xs text-indigo-800 leading-relaxed mb-3">{anomalyResult.summary}</p>
                               {anomalyResult.anomalies?.length > 0 && (
                                   <div className="flex flex-wrap gap-2">
                                       {anomalyResult.anomalies.map((a:any, i:number) => (
                                           <span key={i} className="px-2 py-1 bg-white border border-indigo-100 rounded text-[10px] text-indigo-600 font-medium">
                                               {a.period}: {a.description}
                                           </span>
                                       ))}
                                   </div>
                               )}
                           </div>
                           <button onClick={() => setAnomalyResult(null)} className="text-indigo-300 hover:text-indigo-500"><X size={14} /></button>
                       </div>
                   </div>
                )}

                <div className="h-[320px] w-full">
                    {anomalyLoading ? (
                        <div className="w-full h-full bg-slate-50 rounded-xl animate-pulse flex items-center justify-center">
                            <span className="text-slate-300 text-sm font-bold">AI 正在分析趋势...</span>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorProf" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorCapex" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} tickFormatter={(v) => privacyMode ? '***' : `${(v/10000).toFixed(0)}w`} />
                            <Tooltip 
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                                formatter={(val:number) => formatCurrency(val, privacyMode)}
                            />
                            {trendView === 'profit' ? (
                                <>
                                    <Area type="monotone" dataKey="income" name="收入" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorInc)" />
                                    <Area type="monotone" dataKey="profit" name="利润" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorProf)" />
                                    <Area type="monotone" dataKey="cost" name="成本" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
                                </>
                            ) : (
                                <Area type="monotone" dataKey="capex" name="资本开支" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorCapex)" />
                            )}
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Analysis Row: Cost Structure & Counterparties */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Cost Structure (Departments) */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
                        <PieIcon size={20} className="text-amber-500" />
                        累计成本构成 (Top 5)
                    </h3>
                    <p className="text-xs text-slate-500 mb-6">按部门/成本中心归集的支出占比</p>
                    <div className="flex gap-4">
                        <div className="flex-1 space-y-3">
                            {costStructureData.map((item, index) => (
                                <div key={index} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors cursor-default group">
                                <div className="flex items-center gap-3">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                                    <span className="text-xs text-slate-600 font-bold truncate max-w-[100px]" title={item.name}>{item.name}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-bold text-slate-800">{formatCurrencyShort(item.value, privacyMode)}</span>
                                </div>
                                </div>
                            ))}
                            {costStructureData.length === 0 && <div className="text-sm text-slate-400 italic">暂无数据</div>}
                        </div>
                        <div className="w-[120px] h-[120px] relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={costStructureData} innerRadius={35} outerRadius={55} paddingAngle={5} dataKey="value">
                                    {costStructureData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />)}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* 2. Top Counterparties (Business Logic Enhanced) */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            {cpView === 'customer' ? <Users size={20} className="text-emerald-500" /> : <ShoppingBag size={20} className="text-amber-500" />}
                            {cpView === 'customer' ? '核心客户 TOP 5' : '核心供应商 TOP 5'}
                        </h3>
                    </div>
                    
                    {/* Toggle */}
                    <div className="flex p-1 bg-slate-100 rounded-lg mb-4">
                        <button 
                            onClick={() => setCpView('customer')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-bold rounded-md transition-all ${cpView === 'customer' ? 'bg-white shadow text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <Users size={12} /> 收入来源
                        </button>
                        <button 
                            onClick={() => setCpView('supplier')}
                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-bold rounded-md transition-all ${cpView === 'supplier' ? 'bg-white shadow text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <ShoppingBag size={12} /> 成本/资产支出
                        </button>
                    </div>

                    <div className="space-y-4">
                        {activeCpData.map((item, index) => (
                            <div key={index} className="flex flex-col gap-1">
                                <div className="flex justify-between items-end text-xs">
                                    <span className="font-bold text-slate-700 truncate max-w-[180px]" title={item.name}>{item.name}</span>
                                    <span className="font-mono font-medium text-slate-600">{formatCurrencyShort(item.value, privacyMode)}</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full ${cpView === 'customer' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                        style={{ width: `${(item.value / activeCpData[0].value) * 100}%`, opacity: 1 - (index * 0.15) }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                         {activeCpData.length === 0 && <div className="text-sm text-slate-400 italic py-4 text-center">暂无{cpView === 'customer' ? '客户收入' : '供应商支出'}数据</div>}
                    </div>
                </div>

            </div>
        </div>

        {/* Right: Reconciliation Feed */}
        <div className="xl:col-span-1 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col h-full min-h-[500px]">
          <div className="mb-6">
             <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
               <ArrowRightLeft size={20} className="text-indigo-500" />
               关联交易监控 (YTD)
             </h3>
             <p className="text-xs text-slate-500 mt-1">自动比对双方账套累计发生额</p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
            {reconLoading ? (
                [1,2,3].map(i => (
                    <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-white animate-pulse">
                        <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
                        <div className="h-3 bg-slate-200 rounded w-full"></div>
                    </div>
                ))
            ) : reconData.length > 0 ? (
                reconData.map((item, idx) => (
                    <div 
                        key={idx} 
                        onClick={() => openReconModal(item)}
                        className={`p-4 rounded-2xl border cursor-pointer transition-all hover:translate-x-1 ${
                            item.status === 'matched' 
                            ? 'bg-white border-slate-100 hover:border-emerald-200 hover:shadow-md' 
                            : 'bg-red-50/50 border-red-100 hover:border-red-300 hover:shadow-md'
                        }`}
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <div className="text-[10px] text-slate-400 mb-0.5">往来单位</div>
                                <div className="font-bold text-sm text-slate-700 truncate max-w-[140px]" title={item.otherEntityName}>
                                    {item.otherEntityName}
                                </div>
                            </div>
                            {item.status === 'matched' ? (
                                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                                    <CheckCircle2 size={16} />
                                </div>
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center animate-pulse">
                                    <AlertTriangle size={16} />
                                </div>
                            )}
                        </div>
                        
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-400">{item.myLabel}</span>
                                <span className="font-mono font-medium text-slate-700">{formatCurrency(item.myAmount, privacyMode)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-400">{item.theirLabel}</span>
                                <span className="font-mono font-medium text-slate-700">{formatCurrency(item.theirAmount, privacyMode)}</span>
                            </div>
                            {item.status === 'unmatched' && (
                                <div className="pt-2 border-t border-red-100 flex justify-between text-xs text-red-600 font-bold">
                                    <span>差异金额</span>
                                    <span>{formatCurrency(Math.abs(item.diff), privacyMode)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))
            ) : (
                <div className="text-center py-10 text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="mb-2">暂无关联方数据</p>
                    <p>请确保已导入双方报表，并配置了正确的关联方映射名称。</p>
                </div>
            )}
          </div>
        </div>
      </div>

      {/* Reconciliation Detail Modal */}
      {selectedRecon && (
        <ReconciliationModal 
          data={selectedRecon} 
          currentEntity={currentEntity}
          otherEntityId={otherEntityId}
          config={config}
          onClose={() => setSelectedRecon(null)} 
          aiResult={aiResult}
          onRunAI={handleRunAIAnalysis}
          aiAnalyzing={aiAnalyzing}
          privacyMode={privacyMode} // Pass Privacy Mode
        />
      )}
    </div>
  );
});

// ... Sub Components (ReconciliationModal, VoucherMatchingDetail, ExecutiveCard, etc.) same as before ...

const ArrowRightCircleIcon = ({size}:{size:number}) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="m12 16 4-4-4-4"/></svg>
);

const LegendBadge = ({ color, label }: any) => (
    <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${color}`}></span>
        <span className="text-xs font-bold text-slate-500">{label}</span>
    </div>
);

// Include ExecutiveCard, ReconciliationModal, VoucherMatchingDetail definitions from previous version...
// (Assuming these are kept as they were, just re-exporting them in the full file context)

const ExecutiveCard = ({ title, amount, mom, yoy, hasYoy, period, isInverse, subLabel, subValue, color, icon, privacyMode }: any) => {
  const gradients: any = {
    blue: "from-blue-500 to-indigo-600",
    orange: "from-orange-400 to-pink-500",
    emerald: "from-emerald-400 to-teal-600",
    purple: "from-purple-400 to-violet-600",
  };

  const renderTrend = (value: number, label: string) => {
      return (
           <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-lg backdrop-blur-sm border border-white/10">
              {value > 0 ? <ArrowUpRight size={12} className="text-white"/> : value < 0 ? <ArrowDownRight size={12} className="text-white"/> : <Activity size={12} className="text-white"/>}
              <span className="font-bold text-white text-[10px]">
                 {label} {value > 0 ? '+' : ''}{value.toFixed(1)}%
              </span>
           </div>
      );
  };

  return (
    <div className={`rounded-2xl p-5 text-white shadow-lg shadow-slate-200/50 bg-gradient-to-br ${gradients[color]} relative overflow-hidden group`}>
       <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
       
       <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-xs font-bold text-white/80 uppercase tracking-wide">{title}</p>
            <h3 className="text-3xl font-black mt-2">
                {privacyMode ? (
                    <span>****</span>
                ) : (
                    <>
                        <span className="text-sm align-top opacity-80 mr-1">¥</span>
                        {(amount / 10000).toFixed(2)}
                        <span className="text-sm align-baseline opacity-80 ml-1">w</span>
                    </>
                )}
            </h3>
          </div>
          <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
             {icon}
          </div>
       </div>

       <div className="relative z-10 mt-4 flex items-end justify-between">
          {mom !== undefined ? (
             <div className="flex flex-col gap-1.5 w-full">
                <div className="flex gap-2">
                    {renderTrend(mom, "环比")}
                    {hasYoy ? renderTrend(yoy, "同比") : (
                        <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-lg border border-white/5 text-white/50" title="未检测到去年同期数据">
                            <span className="text-[10px]">同比 N/A</span>
                        </div>
                    )}
                </div>
                {period && (
                    <div className="flex items-center gap-1 text-[10px] text-white/60 font-mono mt-1">
                        <CalendarClock size={10} />
                        <span>统计截至: {period}</span>
                    </div>
                )}
             </div>
          ) : (
            <div className="flex flex-col">
                <span className="text-[10px] text-white/60">{subLabel}</span>
                <span className="font-bold text-sm">{subValue}</span>
            </div>
          )}
       </div>
    </div>
  );
};

const ReconciliationModal = ({ data, currentEntity, otherEntityId, config, onClose, aiResult, onRunAI, aiAnalyzing, privacyMode }: any) => {
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <ArrowRightLeft size={18} className="text-indigo-600"/>
                        对账详情单 (月度发生额)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      我方 ({currentEntity.name}) ⇌ 对方 ({data.otherEntityName})
                    </p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                    <X size={20} />
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-0 scrollbar-thin">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white text-slate-500 font-bold text-xs uppercase sticky top-0 border-b border-slate-100 shadow-sm z-10">
                        <tr>
                            <th className="px-6 py-4 bg-white">会计期间</th>
                            <th className="px-6 py-4 text-right bg-white">{data.myLabel}</th>
                            <th className="px-6 py-4 text-right bg-white">{data.theirLabel}</th>
                            <th className="px-6 py-4 text-right bg-white">差额</th>
                            <th className="px-6 py-4 text-center bg-white">结论</th>
                            <th className="px-6 py-4 text-right bg-white">穿透</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {data.monthlyBreakdown.map((m: any) => (
                            <React.Fragment key={m.period}>
                              <tr 
                                className={`transition-colors cursor-pointer ${
                                  m.status === 'unmatched' ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-slate-50'
                                } ${expandedPeriod === m.period ? 'bg-indigo-50/30' : ''}`}
                                onClick={() => setExpandedPeriod(expandedPeriod === m.period ? null : m.period)}
                              >
                                  <td className="px-6 py-4 font-mono font-bold text-slate-700">{m.period}</td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">{formatCurrency(m.myVal, privacyMode)}</td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">{formatCurrency(m.theirVal, privacyMode)}</td>
                                  <td className={`px-6 py-4 text-right font-mono font-bold ${m.diff !== 0 ? 'text-red-500' : 'text-slate-300'}`}>
                                      {m.diff !== 0 ? formatCurrency(m.diff, privacyMode) : '-'}
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                      {m.status === 'matched' ? (
                                           <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-100">
                                              <CheckCircle2 size={10} /> 平
                                           </span>
                                      ) : (
                                           <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2 py-0.5 rounded text-[10px] font-bold border border-red-100">
                                              <AlertTriangle size={10} /> 差
                                           </span>
                                      )}
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    {expandedPeriod === m.period ? <ChevronUp size={16} className="ml-auto text-indigo-500" /> : <ChevronDown size={16} className="ml-auto text-slate-400" />}
                                  </td>
                              </tr>
                              {expandedPeriod === m.period && (
                                <tr>
                                  <td colSpan={6} className="p-0 bg-slate-50">
                                    <VoucherMatchingDetail 
                                      period={m.period}
                                      currentEntityId={currentEntity.id}
                                      otherEntityId={otherEntityId}
                                      otherEntityName={data.otherEntityName}
                                      otherMatchedName={data.matchedName}
                                      config={config}
                                      currentEntity={currentEntity}
                                      privacyMode={privacyMode}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
                
                {/* Action Area (General Analysis) */}
                <div className="p-6 bg-slate-50 border-t border-slate-100">
                     {aiResult ? (
                         <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 animate-in fade-in duration-500">
                            <div className="flex items-center gap-2 mb-3">
                                <Sparkles size={18} className="text-indigo-600" />
                                <h4 className="font-bold text-indigo-900 text-sm">AI 智能诊断报告 (通义千问)</h4>
                            </div>
                            <div className="space-y-3">
                                <p className="text-sm text-indigo-800 font-medium leading-relaxed">{aiResult.summary}</p>
                                
                                {aiResult.risks.length > 0 && (
                                    <div className="flex gap-2 items-start">
                                        <AlertTriangle size={14} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                                        <ul className="text-xs text-indigo-700 space-y-1">
                                            {aiResult.risks.map((risk:any, i:number) => <li key={i}>{risk}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                         </div>
                     ) : data.status === 'unmatched' ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-sm text-slate-500">
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                                    <FileSearch size={16} />
                                </div>
                                <span>存在差异月份？点击上方行展开凭证，或使用 AI 宏观分析</span>
                            </div>
                            <button 
                                onClick={onRunAI}
                                disabled={aiAnalyzing}
                                className="px-4 py-2 bg-white border border-indigo-200 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition flex items-center gap-2"
                            >
                                {aiAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                宏观原因分析
                            </button>
                        </div>
                     ) : null}
                </div>
            </div>
        </div>
    </div>
  );
});

const VoucherMatchingDetail = ({ period, currentEntityId, otherEntityId, otherEntityName, otherMatchedName, config, currentEntity, privacyMode }: any) => {
  const [loading, setLoading] = useState(false);
  const [myVouchers, setMyVouchers] = useState<LedgerRow[]>([]);
  const [theirVouchers, setTheirVouchers] = useState<LedgerRow[]>([]);
  
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<any>(null);

  useEffect(() => {
    const fetchVouchers = async () => {
      setLoading(true);
      
      const myRows = await db.ledger.where({ entityId: currentEntityId, period }).toArray();
      const theirRows = await db.ledger.where({ entityId: otherEntityId, period }).toArray();

      // Dynamic Filtering based on Entity Type
      let filteredMy, filteredTheir;

      if (currentEntity.type === 'listed') {
          // I am Buyer (Cost Side)
          filteredMy = myRows.filter(r => 
            config.costSubjectCodes.some((code: string) => r.subjectCode.startsWith(code)) &&
            (r.counterparty?.includes(otherEntityName) || 
             (otherMatchedName && r.counterparty?.includes(otherMatchedName)) ||
             (config.entities.find((e: Company) => e.name === otherEntityName)?.segmentPrefix && r.counterparty?.includes(config.entities.find((e: Company) => e.name === otherEntityName)?.segmentPrefix!))
            )
          );
          // They are Seller (Revenue Side)
          filteredTheir = theirRows.filter(r => 
            config.incomeSubjectCodes.some((code: string) => r.subjectCode.startsWith(code)) &&
            (r.counterparty?.includes(currentEntity.name) || 
             (currentEntity.matchedNameInOtherBooks && r.counterparty?.includes(currentEntity.matchedNameInOtherBooks)) ||
             (currentEntity.segmentPrefix && r.counterparty?.includes(currentEntity.segmentPrefix))
            )
          );
      } else {
          // I am Seller (Revenue Side)
          filteredMy = myRows.filter(r => 
            config.incomeSubjectCodes.some((code: string) => r.subjectCode.startsWith(code)) &&
            (r.counterparty?.includes(otherEntityName) || 
             (otherMatchedName && r.counterparty?.includes(otherMatchedName)) ||
             (config.entities.find((e: Company) => e.name === otherEntityName)?.segmentPrefix && r.counterparty?.includes(config.entities.find((e: Company) => e.name === otherEntityName)?.segmentPrefix!))
            )
          );
          // They are Buyer (Cost Side)
          filteredTheir = theirRows.filter(r => 
            config.costSubjectCodes.some((code: string) => r.subjectCode.startsWith(code)) &&
            (r.counterparty?.includes(currentEntity.name) || 
             (currentEntity.matchedNameInOtherBooks && r.counterparty?.includes(currentEntity.matchedNameInOtherBooks)) ||
             (currentEntity.segmentPrefix && r.counterparty?.includes(currentEntity.segmentPrefix))
            )
          );
      }

      setMyVouchers(filteredMy);
      setTheirVouchers(filteredTheir);
      setLoading(false);
    };
    fetchVouchers();
  }, [period, currentEntityId, otherEntityId, config, currentEntity]);

  const handleSmartMatch = async () => {
    setMatching(true);
    try {
      // Map to simpler format for AI
      const listA = myVouchers.map(v => ({ voucherNo: v.voucherNo, amount: Math.abs(v.debitAmount || v.creditAmount), summary: v.summary, date: v.date }));
      const listB = theirVouchers.map(v => ({ voucherNo: v.voucherNo, amount: Math.abs(v.debitAmount || v.creditAmount), summary: v.summary, date: v.date }));
      
      const res = await smartVoucherMatch(listA, listB);
      setMatchResult(res);
    } catch (e) {
      console.error(e);
      alert("AI 匹配失败");
    } finally {
      setMatching(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm"><Loader2 size={20} className="animate-spin mx-auto mb-2"/> 加载凭证中...</div>;

  return (
    <div className="p-4 bg-slate-100/50 border-t border-b border-indigo-100 shadow-inner">
       <div className="flex justify-between items-center mb-4">
          <div className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
             <FileSearch size={14} /> 凭证级穿透 ({period})
          </div>
          <button 
             onClick={handleSmartMatch} 
             disabled={matching || myVouchers.length === 0}
             className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
             {matching ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>}
             智能凭证匹配
          </button>
       </div>

       {matchResult && (
         <div className="mb-4 bg-white rounded-xl p-4 border border-indigo-200 shadow-sm animate-in zoom-in-95">
            <h4 className="font-bold text-sm text-indigo-900 mb-2">AI 匹配结果</h4>
            <div className="text-xs text-slate-600 space-y-2">
              <p><span className="font-bold">分析结论：</span> {matchResult.analysis}</p>
              {matchResult.unmatchedMySide?.length > 0 && (
                <p className="text-red-600 bg-red-50 p-2 rounded"><span className="font-bold">我方未匹配凭证：</span> {matchResult.unmatchedMySide.join(', ')}</p>
              )}
              {matchResult.unmatchedTheirSide?.length > 0 && (
                <p className="text-orange-600 bg-orange-50 p-2 rounded"><span className="font-bold">对方未匹配凭证：</span> {matchResult.unmatchedTheirSide.join(', ')}</p>
              )}
            </div>
         </div>
       )}

       <div className="grid grid-cols-2 gap-4">
          {/* My Side */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
             <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-bold text-slate-600 flex justify-between">
                <span>我方 - {myVouchers.length} 笔</span>
                <span>{formatCurrency(myVouchers.reduce((sum,v)=>sum+(v.debitAmount||v.creditAmount),0), privacyMode)}</span>
             </div>
             <div className="max-h-[300px] overflow-y-auto">
               <table className="w-full text-xs">
                 <tbody className="divide-y divide-slate-100">
                    {myVouchers.map(v => {
                       const isUnmatched = matchResult?.unmatchedMySide?.includes(v.voucherNo);
                       return (
                         <tr key={v.id} className={`${isUnmatched ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                           <td className="p-2 font-mono text-blue-600">{v.voucherNo}</td>
                           <td className="p-2 truncate max-w-[120px]" title={v.summary}>{v.summary}</td>
                           <td className="p-2 text-right font-mono font-bold">{formatCurrency((v.debitAmount||v.creditAmount), privacyMode)}</td>
                         </tr>
                       );
                    })}
                    {myVouchers.length===0 && <tr><td colSpan={3} className="p-4 text-center text-slate-400 italic">无记录</td></tr>}
                 </tbody>
               </table>
             </div>
          </div>

          {/* Their Side */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
             <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-bold text-slate-600 flex justify-between">
                <span>对方 - {theirVouchers.length} 笔</span>
                <span>{formatCurrency(theirVouchers.reduce((sum,v)=>sum+(v.debitAmount||v.creditAmount),0), privacyMode)}</span>
             </div>
             <div className="max-h-[300px] overflow-y-auto">
               <table className="w-full text-xs">
                 <tbody className="divide-y divide-slate-100">
                    {theirVouchers.map(v => {
                       const isUnmatched = matchResult?.unmatchedTheirSide?.includes(v.voucherNo);
                       return (
                         <tr key={v.id} className={`${isUnmatched ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
                           <td className="p-2 font-mono text-blue-600">{v.voucherNo}</td>
                           <td className="p-2 truncate max-w-[120px]" title={v.summary}>{v.summary}</td>
                           <td className="p-2 text-right font-mono font-bold">{formatCurrency((v.debitAmount||v.creditAmount), privacyMode)}</td>
                         </tr>
                       );
                    })}
                    {theirVouchers.length===0 && <tr><td colSpan={3} className="p-4 text-center text-slate-400 italic">无记录</td></tr>}
                 </tbody>
               </table>
             </div>
          </div>
       </div>
    </div>
  );
};

export default DashboardPage;
