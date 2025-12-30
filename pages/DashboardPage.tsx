
import React, { useMemo, useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { 
  Wallet, TrendingUp, TrendingDown, ArrowRightLeft, 
  AlertTriangle, CheckCircle2, X, PieChart as PieIcon,
  Activity, ArrowUpRight, ArrowDownRight, CalendarClock, Upload
} from 'lucide-react';
import { BalanceRow, LedgerRow, Company, SystemConfig } from '../types';
import { db } from '../db';

interface DashboardPageProps {
  currentEntity: Company;
  allEntities: Company[];
  balances: BalanceRow[];
  ledger: LedgerRow[];
  config: SystemConfig;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

const DashboardPage = ({ currentEntity, allEntities, balances, ledger, config }: DashboardPageProps) => {
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
            {/* Note: In a real app we might route to import, here we just show visual cue */}
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

  // 计算去年同期 (YoY Period)
  const lastYearPeriod = useMemo(() => {
    if (!latestPeriod) return '';
    try {
        // 假设期间格式为 YYYY-MM
        const parts = latestPeriod.split('-');
        if (parts.length === 2) {
             const y = parseInt(parts[0]);
             return `${y - 1}-${parts[1]}`;
        }
        return '';
    } catch (e) {
        return '';
    }
  }, [latestPeriod]);

  // 辅助函数：计算特定期间的收入/成本
  const calcStats = (p: string) => {
    const pRows = balances.filter(b => b.period === p);
    const inc = pRows
      .filter(b => config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + b.creditPeriod, 0);
    const cst = pRows
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .reduce((sum, b) => sum + b.debitPeriod, 0);
    return { income: inc, cost: cst, profit: inc - cst };
  };

  // 全量累计数据
  const totalStats = periods.reduce((acc, p) => {
    const s = calcStats(p);
    return { income: acc.income + s.income, cost: acc.cost + s.cost };
  }, { income: 0, cost: 0 });

  const totalProfit = totalStats.income - totalStats.cost;
  const profitMargin = totalStats.income > 0 ? (totalProfit / totalStats.income) * 100 : 0;

  // 环比计算 (MoM: 最新月 vs 上月)
  const currentMonthStats = latestPeriod ? calcStats(latestPeriod) : { income: 0, cost: 0 };
  const prevMonthStats = prevPeriod ? calcStats(prevPeriod) : { income: 0, cost: 0 };
  
  // 同比计算 (YoY: 最新月 vs 去年同月)
  const lastYearStats = lastYearPeriod ? calcStats(lastYearPeriod) : { income: 0, cost: 0 };

  const getGrowthRate = (curr: number, prev: number) => {
    if (!prev || prev === 0) return 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  
  // 收入增长率
  const incomeMoM = getGrowthRate(currentMonthStats.income, prevMonthStats.income);
  const incomeYoY = getGrowthRate(currentMonthStats.income, lastYearStats.income);
  const hasIncomeYoYData = lastYearStats.income > 0;

  // 成本增长率
  const costMoM = getGrowthRate(currentMonthStats.cost, prevMonthStats.cost);
  const costYoY = getGrowthRate(currentMonthStats.cost, lastYearStats.cost);
  const hasCostYoYData = lastYearStats.cost > 0;

  // --- 2. 图表数据准备 ---
  
  // A. 趋势图数据
  const trendData = periods.map(p => {
    const s = calcStats(p);
    return { period: p, ...s };
  });

  // B. 成本结构数据 (Top 5 部门/成本中心)
  const costStructureData = useMemo(() => {
    const map = new Map<string, number>();
    balances
      .filter(b => config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)))
      .forEach(b => {
        let deptName = '未分类/其他';
        if (b.costCenter && b.costCenter !== '缺省' && b.costCenter !== 'Default') {
            deptName = b.costCenter;
        } else if (b.costCenterCode && config.departmentMap[b.costCenterCode]) {
            deptName = config.departmentMap[b.costCenterCode];
        }
        map.set(deptName, (map.get(deptName) || 0) + b.debitPeriod);
      });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); // Top 5
  }, [balances, config]);

  // --- 3. 关联交易对账逻辑 ---
  const [reconData, setReconData] = useState<any[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [selectedRecon, setSelectedRecon] = useState<any | null>(null);

  useEffect(() => {
    const runReconciliation = async () => {
      setReconLoading(true);
      const results = [];
      const otherEntities = allEntities.filter(e => e.id !== currentEntity.id);

      for (const other of otherEntities) {
        // A. 我方收入
        const myRevenueRows = balances.filter(b => 
            config.incomeSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
            (b.counterparty?.includes(other.name) || (other.matchedNameInOtherBooks && b.counterparty?.includes(other.matchedNameInOtherBooks)))
        );
        const myRevenueTotal = myRevenueRows.reduce((sum, b) => sum + b.creditPeriod, 0);

        // B. 对方成本 (从DB查)
        const otherBalances = await db.balances.where('entityId').equals(other.id).toArray();
        const theirCostRows = otherBalances.filter(b => 
            config.costSubjectCodes.some(code => b.subjectCode.startsWith(code)) &&
            (b.counterparty?.includes(currentEntity.name) || (currentEntity.matchedNameInOtherBooks && b.counterparty?.includes(currentEntity.matchedNameInOtherBooks)))
        );
        const theirCostTotal = theirCostRows.reduce((sum, b) => sum + b.debitPeriod, 0);

        // C. 月度明细
        const allPeriods = Array.from(new Set([...myRevenueRows.map(r=>r.period), ...theirCostRows.map(r=>r.period)])).sort();
        const monthlyBreakdown = allPeriods.map(p => {
            const myRev = myRevenueRows.filter(r => r.period === p).reduce((sum, r) => sum + r.creditPeriod, 0);
            const theirCost = theirCostRows.filter(r => r.period === p).reduce((sum, r) => sum + r.debitPeriod, 0);
            return {
                period: p,
                myRev,
                theirCost,
                diff: myRev - theirCost,
                status: Math.abs(myRev - theirCost) < 1 ? 'matched' : 'unmatched'
            };
        });

        results.push({
            otherEntityName: other.name,
            matchedName: other.matchedNameInOtherBooks,
            myRevenue: myRevenueTotal,
            theirCost: theirCostTotal,
            diff: myRevenueTotal - theirCostTotal,
            status: Math.abs(myRevenueTotal - theirCostTotal) < 100 ? 'matched' : 'unmatched',
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

  return (
    <div className="space-y-6 relative pb-10">
      
      {/* 1. Executive Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <ExecutiveCard 
          title="累计经营收入" 
          amount={totalStats.income} 
          mom={incomeMoM} 
          yoy={incomeYoY}
          hasYoy={hasIncomeYoYData}
          period={latestPeriod}
          color="blue"
          icon={<TrendingUp size={24} className="text-white opacity-80" />}
        />
        <ExecutiveCard 
          title="累计成本费用" 
          amount={totalStats.cost} 
          mom={costMoM} 
          yoy={costYoY}
          hasYoy={hasCostYoYData}
          period={latestPeriod}
          isInverse={true} // 成本增长标红
          color="orange"
          icon={<TrendingDown size={24} className="text-white opacity-80" />}
        />
        <ExecutiveCard 
          title="经营毛利" 
          amount={totalProfit} 
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
                            收支趋势分析
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">基于 {periods.length} 个会计期间数据</p>
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
                     成本费用构成
                  </h3>
                  <p className="text-xs text-slate-500 mb-6">按部门/成本中心归集的 Top 5 支出</p>
                  
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
                                 {totalStats.cost > 0 ? ((item.value / totalStats.cost) * 100).toFixed(1) : 0}%
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
                     <span className="text-lg font-black text-slate-800">¥{(totalStats.cost/10000).toFixed(0)}w</span>
                  </div>
               </div>
            </div>
        </div>

        {/* Right: Reconciliation Feed */}
        <div className="xl:col-span-1 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col h-full min-h-[500px]">
          <div className="mb-6">
             <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
               <ArrowRightLeft size={20} className="text-indigo-500" />
               关联交易监控
             </h3>
             <p className="text-xs text-slate-500 mt-1">自动比对双方账套往来数据</p>
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
                        onClick={() => setSelectedRecon(item)}
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
                                <span className="text-slate-400">我方确认收入</span>
                                <span className="font-mono font-medium text-slate-700">¥{item.myRevenue.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-400">对方确认成本</span>
                                <span className="font-mono font-medium text-slate-700">¥{item.theirCost.toLocaleString()}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <ArrowRightLeft size={18} className="text-indigo-600"/>
                            对账详情单
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 max-w-[400px] truncate">{selectedRecon.otherEntityName}</p>
                    </div>
                    <button onClick={() => setSelectedRecon(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white text-slate-500 font-bold text-xs uppercase sticky top-0 border-b border-slate-100 shadow-sm z-10">
                            <tr>
                                <th className="px-6 py-4 bg-white">会计期间</th>
                                <th className="px-6 py-4 text-right bg-white">我方收入</th>
                                <th className="px-6 py-4 text-right bg-white">对方成本</th>
                                <th className="px-6 py-4 text-right bg-white">差额</th>
                                <th className="px-6 py-4 text-center bg-white">结论</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {selectedRecon.monthlyBreakdown.map((m: any) => (
                                <tr key={m.period} className={m.status === 'unmatched' ? 'bg-red-50/30' : 'hover:bg-slate-50'}>
                                    <td className="px-6 py-4 font-mono font-bold text-slate-700">{m.period}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-600">{m.myRev.toLocaleString()}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-600">{m.theirCost.toLocaleString()}</td>
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
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    
                    {selectedRecon.status === 'unmatched' && (
                         <div className="m-6 p-4 bg-orange-50 border border-orange-100 rounded-xl flex items-start gap-3">
                            <AlertTriangle className="text-orange-500 flex-shrink-0 mt-0.5" size={18} />
                            <div>
                                <h4 className="font-bold text-orange-800 text-sm">处置建议</h4>
                                <ul className="list-disc list-inside text-xs text-orange-700 mt-1 space-y-1.5 leading-relaxed">
                                    <li>检查差额月份的凭证日期，确认是否存在跨期入账（如：我方1月31日开票，对方2月1日入账）。</li>
                                    <li>检查科目使用：确认对方是否将该笔费用计入了“在建工程”或“往来款”而非成本费用科目。</li>
                                    <li>检查对方系统中是否正确配置了“{currentEntity.name}”作为往来对象。</li>
                                </ul>
                            </div>
                         </div>
                    )}
                </div>
            </div>
        </div>
      )}
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
                    {hasYoy && yoy !== undefined && renderTrend(yoy, "同比")}
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
