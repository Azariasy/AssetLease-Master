
import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line 
} from 'recharts';
import { LeaseContract, AssetInfo, TrialBalanceRow } from '../../types/index';
import { 
  TrendingUp, AlertCircle, Users, Building2, Wallet, 
  ArrowUpRight, ArrowDownRight, Zap 
} from 'lucide-react';

interface DashboardProps {
  contracts: LeaseContract[];
  assets: AssetInfo[];
  financialData: TrialBalanceRow[];
}

const DashboardPage: React.FC<DashboardProps> = ({ contracts, assets, financialData }) => {
  // 核心财务计算
  const totalAnnualRent = contracts.reduce((sum, c) => sum + c.annualRent, 0);
  const totalArrears = contracts.reduce((sum, c) => sum + c.cumulativeArrears, 0);
  const relatedPartyRent = contracts.filter(c => c.type === '关联方').reduce((sum, c) => sum + c.annualRent, 0);
  const relatedRatio = totalAnnualRent ? ((relatedPartyRent / totalAnnualRent) * 100).toFixed(1) : "0.0";
  
  // 模拟实收趋势（对比目标）
  const trendData = [
    { name: '1月', target: 1200, actual: 1180, collection: 98 },
    { name: '2月', target: 1200, actual: 1150, collection: 95 },
    { name: '3月', target: 1250, actual: 1230, collection: 98 },
    { name: '4月', target: 1250, actual: 950, collection: 76 }
  ];

  // 收入结构
  const COLORS = ['#3b82f6', '#6366f1', '#10b981', '#f59e0b'];
  const incomeStructure = [
    { name: '关联方租金', value: relatedPartyRent },
    { name: '外部租金', value: totalAnnualRent - relatedPartyRent },
    { name: '物业管理费', value: contracts.reduce((sum, c) => sum + (c.monthlyPropertyFee * 12), 0) },
    { name: '其他收入', value: 150000 }
  ];

  const arrearsTop5 = [...contracts]
    .filter(c => c.cumulativeArrears > 0)
    .sort((a, b) => b.cumulativeArrears - a.cumulativeArrears)
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* 1. 核心 KPI 矩阵 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="管理资产估值" 
          value="¥ 24.8亿" 
          sub="+2.4% 较上年" 
          icon={<Building2 size={22} />} 
          trend="up"
          color="blue" 
        />
        <StatCard 
          label="关联方收入依赖" 
          value={`${relatedRatio}%`} 
          sub="中移体系集中度高" 
          icon={<Users size={22} />} 
          trend="neutral"
          color="indigo" 
        />
        <StatCard 
          label="风险欠费敞口" 
          value={`¥ ${(totalArrears/10000).toFixed(1)}W`} 
          sub="12笔逾期未清算" 
          icon={<AlertCircle size={22} />} 
          trend="down"
          color="red" 
        />
        <StatCard 
          label="现金流稳定性" 
          value="94.2" 
          sub="处于安全区间" 
          icon={<Zap size={22} />} 
          trend="up"
          color="emerald" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 2. 经营趋势分析 */}
        <div className="lg:col-span-2 bg-white p-10 rounded-[40px] shadow-sm border border-slate-100 flex flex-col">
           <div className="flex justify-between items-center mb-10">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">年度收入与收缴率趋势</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">对比合同应收与财务实收</p>
              </div>
              <div className="flex gap-6 items-center">
                 <LegendItem color="#3b82f6" label="目标值" />
                 <LegendItem color="#cbd5e1" label="实收值" dashed />
              </div>
           </div>
           <div className="h-80 w-full">
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={trendData}>
                 <defs>
                   <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                     <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                 <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 'bold', fill: '#94a3b8'}} />
                 <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fontWeight: 'bold', fill: '#94a3b8'}} />
                 <Tooltip 
                   contentStyle={{borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}} 
                 />
                 <Area type="monotone" dataKey="target" stroke="#3b82f6" strokeWidth={4} fillOpacity={1} fill="url(#colorTarget)" />
                 <Area type="monotone" dataKey="actual" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 6" fill="transparent" />
               </AreaChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* 3. 风险雷达 (欠费名单) */}
        <div className="bg-slate-900 text-white p-10 rounded-[40px] shadow-2xl flex flex-col relative overflow-hidden">
           <div className="absolute top-0 right-0 p-8 opacity-10">
              <TrendingUp size={120} />
           </div>
           <h3 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-10">关键欠费风险名单</h3>
           <div className="flex-1 space-y-6">
              {arrearsTop5.map((c, i) => (
                <div key={c.id} className="flex justify-between items-center group cursor-pointer">
                   <div className="flex-1 min-w-0 pr-4">
                      <p className="text-sm font-black truncate group-hover:text-blue-400 transition-colors">{c.tenantName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${c.overdueDays > 60 ? 'bg-red-500 animate-pulse' : 'bg-orange-500'}`}></span>
                        <p className="text-[10px] text-slate-500 font-bold">逾期 {c.overdueDays}d</p>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-sm font-black text-red-400">¥{(c.cumulativeArrears/10000).toFixed(1)}W</p>
                      <p className="text-[9px] text-slate-600 font-black uppercase">{c.type}</p>
                   </div>
                </div>
              ))}
              {arrearsTop5.length === 0 && <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">当前暂无高风险单位</div>}
           </div>
           <button className="w-full mt-10 py-5 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all text-blue-400">
              生成完整催收研判报告
           </button>
        </div>
      </div>

      {/* 4. 收入结构构成 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 flex items-center gap-8">
              <div className="w-32 h-32 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={incomeStructure} innerRadius={40} outerRadius={55} paddingAngle={4} dataKey="value">
                      {incomeStructure.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                 <h4 className="text-sm font-black text-slate-800 mb-2">收入加权分布</h4>
                 {incomeStructure.map((item, i) => (
                   <div key={i} className="flex justify-between text-[10px] font-bold">
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{background: COLORS[i]}}></div> {item.name}
                      </span>
                      <span className="text-slate-700">¥{(item.value/10000).toFixed(0)}W</span>
                   </div>
                 ))}
              </div>
          </div>
          
          <div className="lg:col-span-2 bg-indigo-600 rounded-[40px] p-8 text-white flex items-center justify-between shadow-xl shadow-indigo-100">
              <div className="max-w-md">
                <h3 className="text-xl font-black mb-2 flex items-center gap-2">
                   <Zap size={20} className="text-yellow-400 fill-yellow-400" /> AI 经营助手建议
                </h3>
                <p className="text-xs text-indigo-100 leading-relaxed font-medium">
                   “当前关联方租金收缴进度超前，但物业费覆盖率仅为 12.5%，建议对科研大楼 A 座的非关联方单元进行成本重新核算，识别潜在的亏损倒挂点。”
                </p>
              </div>
              <button className="px-8 py-4 bg-white text-indigo-600 rounded-2xl font-black text-xs hover:bg-indigo-50 transition-colors">
                 深度分析
              </button>
          </div>
      </div>
    </div>
  );
};

const LegendItem = ({ color, label, dashed }: any) => (
  <div className="flex items-center gap-2">
    <div className={`w-3 h-0.5 ${dashed ? 'border-t-2 border-dashed' : 'h-1'}`} style={{ borderColor: color, backgroundColor: dashed ? 'transparent' : color }}></div>
    <span className="text-[10px] font-black text-slate-500 uppercase">{label}</span>
  </div>
);

const StatCard = ({ label, value, sub, icon, color, trend }: any) => (
  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 group hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-500">
    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 shadow-sm transition-all group-hover:rotate-6 group-hover:scale-110 ${
      color === 'blue' ? 'bg-blue-50 text-blue-600' : 
      color === 'red' ? 'bg-red-50 text-red-600' : 
      color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
    }`}>
      {icon}
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    <div className="flex items-baseline gap-2 mt-2">
      <p className="text-3xl font-black text-slate-900 tracking-tight">{value}</p>
      {trend === 'up' && <ArrowUpRight size={16} className="text-emerald-500" />}
      {trend === 'down' && <ArrowDownRight size={16} className="text-red-500" />}
    </div>
    <p className="text-[10px] text-slate-400 font-bold mt-4 flex items-center gap-1">
      {sub}
    </p>
  </div>
);

export default DashboardPage;
