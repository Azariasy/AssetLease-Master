import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { 
  Wallet, TrendingUp, TrendingDown, ArrowRightLeft, 
  AlertTriangle, CheckCircle2, X, PieChart as PieIcon,
  Activity, ArrowUpRight, ArrowDownRight, CalendarClock, Upload, Sparkles, Loader2, Lightbulb,
  FileSearch, ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { BalanceRow, LedgerRow, Company, SystemConfig, AnalysisResult } from '../types';
import { db } from '../db';
import { analyzeInterCompanyRecon, smartVoucherMatch } from '../services/geminiService';

interface DashboardPageProps {
  currentEntity: Company;
  allEntities: Company[];
  balances: BalanceRow[];
  ledger: LedgerRow[];
  config: SystemConfig;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

const DashboardPage: React.FC<DashboardPageProps> = ({ currentEntity, allEntities, balances, ledger, config }) => {
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
            <div className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold flex items-center gap-2">
                <Upload size={16} /> 请先导入数据
            </div>
        </div>
    );
  }

  // --- 1. 数据预处理 & 基础计算 ---
  const periods = useMemo(() => Array.from(new Set(balances.map(b => b.period))).sort(), [balances]);
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : '';
  const prevPeriod = periods.length > 1 ? periods[periods.length - 2] : '';

  // 辅助函数：过滤叶子节点 (Leaf Nodes)
  const filterLeafNodes = (rows: BalanceRow[]) => {
    const allCodes = new Set(rows.map(r => r.subjectCode));
    return rows.filter(r => !Array.from(allCodes).some(c => c !== r.subjectCode && c.startsWith(r.subjectCode)));
  };

  // 计算累计/年度指标 (Correct Logic: Net Balances)
  const annualStats = useMemo(() => {
    if (!latestPeriod) return { income: 0, cost: 0, profit: 0, lastYearIncome: 0, lastYearCost: 0 };

    const currentRows = balances.filter(b => b.period === latestPeriod);
    const leafRows = filterLeafNodes(currentRows);

    // 1. Income = Net Credit Balance (Credit - Debit) for Income Subjects
    const ytdIncome = leafRows
        .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            // Use YTD columns if available, else Period columns
            const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
            const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
            return sum + (cr - dr); // 收入：贷方 - 借方 (余额)
        }, 0);

    // 2. Cost = Net Debit Balance (Debit - Credit) for Cost Subjects
    const ytdCost = leafRows
        .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
            const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
            return sum + (dr - cr); // 成本：借方 - 贷方 (余额)
        }, 0);

    // 3. Last Year Income (Comparison)
    const lyIncome = leafRows
        .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            const cr = b.lastYearCredit || 0;
            const dr = b.lastYearDebit || 0;
            return sum + (cr - dr);
        }, 0);

    // 4. Last Year Cost (Comparison)
    const lyCost = leafRows
        .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
        .reduce((sum, b) => {
            const cr = b.lastYearCredit || 0;
            const dr = b.lastYearDebit || 0;
            return sum + (dr - cr);
        }, 0);

    return {
        income: ytdIncome,
        cost: ytdCost,
        profit: ytdIncome - ytdCost,
        lastYearIncome: lyIncome,
        lastYearCost: lyCost
    };
  }, [balances, latestPeriod, config]);

  const profitMargin = annualStats.income > 0 ? (annualStats.profit / annualStats.income) * 100 : 0;

  // 同比计算
  const hasIncomeYoYData = annualStats.lastYearIncome > 0;
  const hasCostYoYData = annualStats.lastYearCost > 0;

  const getGrowthRate = (curr: number, prev: number) => {
    if (!prev || prev === 0) return 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  
  const incomeYoY = getGrowthRate(annualStats.income, annualStats.lastYearIncome);
  const costYoY = getGrowthRate(annualStats.cost, annualStats.lastYearCost);
  
  // --- 2. 图表数据 (仍然基于月度数据 - 当月发生额) ---
  const trendData = periods.map(p => {
    const pRows = balances.filter(b => b.period === p);
    const leafRows = filterLeafNodes(pRows);
    
    // Monthly Trend uses Period Movement (Credit for Income, Debit for Cost)
    const inc = leafRows
      .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + (b.creditPeriod - b.debitPeriod), 0); // Net Monthly Income
      
    const cst = leafRows
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + (b.debitPeriod - b.creditPeriod), 0); // Net Monthly Cost
      
    return { period: p, income: inc, cost: cst, profit: inc - cst };
  });

  const costStructureData = useMemo(() => {
    const map = new Map<string, number>();
    
    const currentRows = balances.filter(b => b.period === latestPeriod);
    const leafRows = filterLeafNodes(currentRows);

    leafRows
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .forEach(b => {
        let deptName = '未分类/其他';
        if (b.costCenter && b.costCenter !== '缺省' && b.costCenter !== 'Default') {
            deptName = b.costCenter;
        } else if (b.costCenterCode && config.departmentMap[b.costCenterCode]) {
            deptName = config.departmentMap[b.costCenterCode];
        }
        // Use Net YTD Debit for Structure
        const dr = b.ytdDebit !== undefined ? b.ytdDebit : b.debitPeriod;
        const cr = b.ytdCredit !== undefined ? b.ytdCredit : b.creditPeriod;
        const netVal = dr - cr;
        
        if (netVal > 0) {
            map.set(deptName, (map.get(deptName) || 0) + netVal);
        }
      });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); // Top 5
  }, [balances, config, latestPeriod]);

  // --- 3. 关联交易对账逻辑 ---
  const [reconData, setReconData] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [selectedRecon, setSelectedRecon] = useState<any | null>(null);
  const [otherEntityId, setOtherEntityId] = useState<string>(''); 
  
  // AI Analysis State
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AnalysisResult | null>(null);

  const isInterCompanyRow = (counterparty: string | undefined, otherEntity: Company) => {
    if (!counterparty) return false;
    const cp = counterparty.trim();
    
    // 1. Check exact segment code (most reliable)
    if (otherEntity.segmentPrefix && cp.includes(otherEntity.segmentPrefix)) {
        return true;
    }
    
    // 2. Check Entity Name
    if (cp.includes(otherEntity.name)) {
        return true;
    }

    // 3. Check Matched Name Alias
    if (otherEntity.matchedNameInOtherBooks && cp.includes(otherEntity.matchedNameInOtherBooks)) {
        return true;
    }

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

        // 核心修正逻辑：根据主体性质切换借贷方向
        // Listed Entity (Buyer/Payer) -> Focus on My Cost vs Their Revenue
        // Non-Listed Entity (Seller/Receiver) -> Focus on My Revenue vs Their Cost
        
        if (currentEntity.type === 'listed') {
            myLabel = "我方成本 (Net Dr)";
            theirLabel = "对方收入 (Net Cr)";

            // My Side: Cost Subject + Counterparty = Other
            myRows = balances.filter(b => 
                config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
                isInterCompanyRow(b.counterparty, other)
            );
            myAmount = myRows.reduce((sum, b) => {
                const dr = b.ytdDebit || b.debitPeriod;
                const cr = b.ytdCredit || b.creditPeriod;
                return sum + (dr - cr); // Net Debit
            }, 0);

            // Their Side: Income Subject + Counterparty = Me
            theirRows = otherBalances.filter(b => 
                config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
                isInterCompanyRow(b.counterparty, currentEntity)
            );
            theirAmount = theirRows.reduce((sum, b) => {
                const cr = b.ytdCredit || b.creditPeriod;
                const dr = b.ytdDebit || b.debitPeriod;
                return sum + (cr - dr); // Net Credit
            }, 0);

        } else {
            myLabel = "我方收入 (Net Cr)";
            theirLabel = "对方成本 (Net Dr)";

            // My Side: Income Subject + Counterparty = Other
            myRows = balances.filter(b => 
                config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
                isInterCompanyRow(b.counterparty, other)
            );
            myAmount = myRows.reduce((sum, b) => {
                const cr = b.ytdCredit || b.creditPeriod;
                const dr = b.ytdDebit || b.debitPeriod;
                return sum + (cr - dr); // Net Credit
            }, 0);

            // Their Side: Cost Subject + Counterparty = Me
            theirRows = otherBalances.filter(b => 
                config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
                isInterCompanyRow(b.counterparty, currentEntity)
            );
            theirAmount = theirRows.reduce((sum, b) => {
                const dr = b.ytdDebit || b.debitPeriod;
                const cr = b.ytdCredit || b.creditPeriod;
                return sum + (dr - cr); // Net Debit
            }, 0);
        }

        // C. 月度明细
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
                status: Math.abs(myVal - theirVal) < 1 ? 'matched' : 'unmatched'
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
            status: Math.abs(myAmount - theirAmount) < 100 ? 'matched' : 'unmatched',
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

  // Handle Opening Modal
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

  return (
    <div className="space-y-6 relative pb-10">
      
      {/* 1. Executive Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <ExecutiveCard 
          title="累计经营收入" 
          amount={annualStats.income} 
          mom={undefined} 
          yoy={incomeYoY}
          hasYoy={hasIncomeYoYData}
          period={latestPeriod}
          color="blue"
          icon={<TrendingUp size={24} className="text-white opacity-80" />}
        />
        <ExecutiveCard 
          title="累计成本费用" 
          amount={annualStats.cost} 
          mom={undefined} 
          yoy={costYoY}
          hasYoy={hasCostYoYData}
          period={latestPeriod}
          isInverse={true} // 成本增长标红
          color="orange"
          icon={<TrendingDown size={24} className="text-white opacity-80" />}
        />
        <ExecutiveCard 
          title="经营毛利" 
          amount={annualStats.profit} 
          subLabel="综合毛利率"
          subValue={`${profitMargin.toFixed(1)}%`}
          color="emerald"
          icon={<Wallet size={24} className="text-white opacity-80" />}
        />
        {/* 对账状态卡片 */}
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
        
        {/* Left: Financial Trend & Profitability */}
        <div className="xl:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Activity size={20} className="text-blue-500" />
                            收支趋势分析 (月度净额)
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          基于 {periods.length} 个会计期间数据
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <LegendBadge color="bg-emerald-500" label="收入" />
                        <LegendBadge color="bg-amber-400" label="成本" />
                        <LegendBadge color="bg-blue-500" label="利润" />
                    </div>
                </div>

                <div className="h-[320px] w-full">
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
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#94a3b8'}} tickFormatter={(v) => `${(v/10000).toFixed(0)}w`} />
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                            formatter={(val:number) => `¥${val.toLocaleString()}`}
                        />
                        <Area type="monotone" dataKey="income" name="收入" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorInc)" />
                        <Area type="monotone" dataKey="profit" name="利润" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorProf)" />
                        <Area type="monotone" dataKey="cost" name="成本" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Cost Structure */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-8">
               <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
                     <PieIcon size={20} className="text-amber-500" />
                     累计成本构成
                  </h3>
                  <p className="text-xs text-slate-500 mb-6">按部门/成本中心归集的 Top 5 支出 (净借方)</p>
                  
                  <div className="space-y-3">
                     {costStructureData.map((item, index) => (
                        <div key={index} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors cursor-default group">
                           <div className="flex items-center gap-3">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                              <span className="text-sm text-slate-600 font-medium group-hover:text-slate-900">{item.name}</span>
                           </div>
                           <div className="text-right">
                              <span className="text-sm font-bold text-slate-800">¥{(item.value / 10000).toFixed(1)}w</span>
                              <span className="text-[10px] text-slate-400 ml-2">
                                 {annualStats.cost > 0 ? ((item.value / annualStats.cost) * 100).toFixed(1) : 0}%
                              </span>
                           </div>
                        </div>
                     ))}
                     {costStructureData.length === 0 && (
                        <div className="text-sm text-slate-400 italic">暂无成本数据</div>
                     )}
                  </div>
               </div>
               <div className="w-full md:w-[300px] h-[250px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie
                           data={costStructureData}
                           innerRadius={60}
                           outerRadius={80}
                           paddingAngle={5}
                           dataKey="value"
                        >
                           {costStructureData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                           ))}
                        </Pie>
                        <Tooltip formatter={(val:number) => `¥${val.toLocaleString()}`} />
                     </PieChart>
                  </ResponsiveContainer>
                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                     <span className="text-xs text-slate-400 font-bold uppercase">总成本</span>
                     <span className="text-lg font-black text-slate-800">¥{(annualStats.cost/10000).toFixed(0)}w</span>
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
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                    <Activity className="animate-spin" />
                    <span className="text-xs">正在实时对账...</span>
                </div>
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
                                <span className="font-mono font-medium text-slate-700">¥{item.myAmount.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-400">{item.theirLabel}</span>
                                <span className="font-mono font-medium text-slate-700">¥{item.theirAmount.toLocaleString()}</span>
                            </div>
                            {item.status === 'unmatched' && (
                                <div className="pt-2 border-t border-red-100 flex justify-between text-xs text-red-600 font-bold">
                                    <span>差异金额</span>
                                    <span>{Math.abs(item.diff).toLocaleString()}</span>
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
        />
      )}
    </div>
  );
};

// --- Sub Components ---

const ReconciliationModal = ({ data, currentEntity, otherEntityId, config, onClose, aiResult, onRunAI, aiAnalyzing }: any) => {
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
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">{m.myVal.toLocaleString()}</td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">{m.theirVal.toLocaleString()}</td>
                                  <td className={`px-6 py-4 text-right font-mono font-bold ${m.diff !== 0 ? 'text-red-500' : 'text-slate-300'}`}>
                                      {m.diff !== 0 ? m.diff.toLocaleString() : '-'}
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
};

const VoucherMatchingDetail = ({ period, currentEntityId, otherEntityId, otherEntityName, otherMatchedName, config, currentEntity }: any) => {
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
      // For Listed entity (Buyer), Cost is usually Debit. For Seller, Revenue is Credit.
      // We normalize amounts to positive for matching.
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
                <span>¥{myVouchers.reduce((sum,v)=>sum+(v.debitAmount||v.creditAmount),0).toLocaleString()}</span>
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
                           <td className="p-2 text-right font-mono font-bold">¥{(v.debitAmount||v.creditAmount).toLocaleString()}</td>
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
                <span>¥{theirVouchers.reduce((sum,v)=>sum+(v.debitAmount||v.creditAmount),0).toLocaleString()}</span>
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
                           <td className="p-2 text-right font-mono font-bold">¥{(v.debitAmount||v.creditAmount).toLocaleString()}</td>
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

// --- Components ---

const ExecutiveCard = ({ title, amount, mom, yoy, hasYoy, period, isInverse, subLabel, subValue, color, icon }: any) => {
  const gradients: any = {
    blue: "from-blue-500 to-indigo-600",
    orange: "from-orange-400 to-pink-500",
    emerald: "from-emerald-400 to-teal-600",
  };

  const renderTrend = (value: number, label: string) => {
      // 简化逻辑：只展示数值方向，具体好坏由使用者结合业务判断
      // 如果要严格颜色逻辑：Inverse模式下，增长(>0)是不好的(Red)，下降(<0)是好的(Green)
      // 但因为卡片本身有底色，这里使用统一的白色/半透明样式，更显高级感
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
       {/* Background Decoration */}
       <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
       
       <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-xs font-bold text-white/80 uppercase tracking-wide">{title}</p>
            <h3 className="text-3xl font-black mt-2">
                <span className="text-sm align-top opacity-80 mr-1">¥</span>
                {(amount / 10000).toFixed(2)}
                <span className="text-sm align-baseline opacity-80 ml-1">w</span>
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

const ArrowRightCircleIcon = ({size}:{size:number}) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="m12 16 4-4-4-4"/></svg>
);

const LegendBadge = ({ color, label }: any) => (
    <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${color}`}></span>
        <span className="text-xs font-bold text-slate-500">{label}</span>
    </div>
);

export default DashboardPage;