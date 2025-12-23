
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { LeaseContract, AssetInfo, TrialBalanceRow } from '../../types';

interface DashboardProps {
  contracts: LeaseContract[];
  assets: AssetInfo[];
  financialData: TrialBalanceRow[];
}

const DashboardPage: React.FC<DashboardProps> = ({ contracts, assets, financialData }) => {
  const trendData = [
    { name: '24-01', target: 1200, actual: 1180 },
    { name: '24-02', target: 1200, actual: 1150 },
    { name: '24-03', target: 1250, actual: 1230 },
    { name: '24-04', target: 1250, actual: 950 }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="房屋租金收入" value="¥ 1,258W" sub="占总收 78%" color="blue" />
        <MetricCard title="关联方占比" value="92.4%" sub="⚠️ 高度集中" color="indigo" />
        <MetricCard title="欠费总额" value="¥ 45.0W" sub="逾期 12 天" color="red" />
        <MetricCard title="物业利润率" value="+15.2%" sub="健康" color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
           <h3 className="font-black text-slate-800 mb-6">年度经营趋势</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={trendData}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                 <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10}} />
                 <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10}} />
                 <Tooltip />
                 <Area type="monotone" dataKey="target" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.05} />
                 <Area type="monotone" dataKey="actual" stroke="#94a3b8" fill="transparent" strokeDasharray="5 5" />
               </AreaChart>
             </ResponsiveContainer>
           </div>
        </div>
        <div className="bg-slate-900 text-white p-8 rounded-[32px] shadow-xl">
           <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-6">AI 经营简报</h3>
           <p className="text-sm leading-relaxed text-slate-400 font-medium">
             本月关联方租金收缴率 100%，外部单位存在两笔小额逾期。建议关注科研大楼 A 座底层物业费支出异常点。
           </p>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, sub, color }: any) => (
  <div className={`bg-white p-6 rounded-[24px] shadow-sm border-l-4 ${
    color === 'blue' ? 'border-blue-500' : 
    color === 'red' ? 'border-red-500' : 
    color === 'emerald' ? 'border-emerald-500' : 'border-indigo-500'
  }`}>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</p>
    <p className="text-xl font-black text-slate-900 mt-2">{value}</p>
    <p className={`text-[10px] mt-2 font-bold ${color === 'red' ? 'text-red-500' : 'text-slate-400'}`}>{sub}</p>
  </div>
);

export default DashboardPage;
