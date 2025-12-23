
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { LeaseContract, AssetInfo, TrialBalanceRow } from '../../types';
import { TrendingUp, AlertCircle, Users, Building2, Wallet } from 'lucide-react';

interface DashboardProps {
  contracts: LeaseContract[];
  assets: AssetInfo[];
  financialData: TrialBalanceRow[];
}

const DashboardPage: React.FC<DashboardProps> = ({ contracts, assets, financialData }) => {
  // 计算核心指标
  const totalAnnualRent = contracts.reduce((sum, c) => sum + c.annualRent, 0);
  const totalArrears = contracts.reduce((sum, c) => sum + c.cumulativeArrears, 0);
  const relatedPartyRent = contracts.filter(c => c.type === '关联方').reduce((sum, c) => sum + c.annualRent, 0);
  const relatedRatio = ((relatedPartyRent / totalAnnualRent) * 100).toFixed(1);
  
  const trendData = [
    { name: 'Q1', target: 3800, actual: 3650 },
    { name: 'Q2', target: 3800, actual: 3720 },
    { name: 'Q3', target: 4000, actual: 3950 },
    { name: 'Q4', target: 4000, actual: 2800 } // 模拟当前季度尚未完成
  ];

  const arrearsTop5 = contracts
    .filter(c => c.cumulativeArrears > 0)
    .sort((a, b) => b.cumulativeArrears - a.cumulativeArrears)
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="年度租金合同总额" 
          value={`¥ ${(totalAnnualRent/10000).toFixed(0)}W`} 
          sub="房屋租金主营业务" 
          icon={<Building2 size={20} />} 
          color="blue" 
        />
        <StatCard 
          label="关联方收入占比" 
          value={`${relatedRatio}%`} 
          sub="高度集中于中移体系" 
          icon={<Users size={20} />} 
          color="indigo" 
        />
        <StatCard 
          label="当前累计欠费" 
          value={`¥ ${(totalArrears/10000).toFixed(1)}W`} 
          sub="主要受外部单位及B座超期影响" 
          icon={<AlertCircle size={20} />} 
          color="red" 
        />
        <StatCard 
          label="物业管理费规模" 
          value="¥ 342.4W" 
          sub="覆盖率约 12.5% (待提升)" 
          icon={<Wallet size={20} />} 
          color="emerald" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：趋势图 */}
        <div className="lg:col-span-2 bg-white p-10 rounded-[40px] shadow-sm border border-slate-100">
           <div className="flex justify-between items-center mb-10">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                 <TrendingUp className="text-blue-500" /> 年度收入实现趋势 (百万)
              </h3>
              <div className="flex gap-4 text-[10px] font-bold text-slate-400">
                 <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-blue-500 rounded-full"></div> 预算目标</span>
                 <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-slate-200 rounded-full"></div> 财务实收</span>
              </div>
           </div>
           <div className="h-80">
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={trendData}>
                 <defs>
                   <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                     <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                 <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                 <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 'bold'}} />
                 <Tooltip contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                 <Area type="monotone" dataKey="target" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorTarget)" />
                 <Area type="monotone" dataKey="actual" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
               </AreaChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* 右侧：欠费 TOP 表格 */}
        <div className="bg-slate-900 text-white p-10 rounded-[40px] shadow-2xl flex flex-col">
           <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-8">欠费 TOP 风险预警</h3>
           <div className="flex-1 space-y-6">
              {arrearsTop5.map((c, i) => (
                <div key={c.id} className="flex justify-between items-center border-b border-slate-800 pb-4">
                   <div className="max-w-[150px]">
                      <p className="text-xs font-black truncate">{c.tenantName}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-1">逾期 {c.overdueDays} 天</p>
                   </div>
                   <div className="text-right">
                      <p className="text-sm font-black text-red-400">¥{(c.cumulativeArrears/10000).toFixed(1)}W</p>
                      <p className="text-[9px] text-slate-500 uppercase font-black">{c.type}</p>
                   </div>
                </div>
              ))}
              {arrearsTop5.length === 0 && <p className="text-slate-500 text-xs text-center py-20 italic">暂无重大欠费风险</p>}
           </div>
           <button className="w-full mt-8 py-4 bg-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors">
              查看全部财务对账流水
           </button>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, sub, icon, color }: any) => (
  <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100 group hover:shadow-xl hover:shadow-slate-200/50 transition-all">
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-sm transition-transform group-hover:scale-110 ${
      color === 'blue' ? 'bg-blue-50 text-blue-600' : 
      color === 'red' ? 'bg-red-50 text-red-600' : 
      color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
    }`}>
      {icon}
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    <p className="text-3xl font-black text-slate-900 mt-2 tracking-tight">{value}</p>
    <p className="text-[10px] text-slate-400 font-bold mt-3">{sub}</p>
  </div>
);

export default DashboardPage;
