
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { LeaseContract, AssetInfo, TrialBalanceRow, AssetStatus } from '../types';

interface DashboardProps {
  contracts: LeaseContract[];
  assets: AssetInfo[];
  financialData: TrialBalanceRow[];
}

const Dashboard: React.FC<DashboardProps> = ({ contracts, assets, financialData }) => {
  // 模拟真实级差数据
  const rentIncome = 12580000; // 125.8W -> 1258W (修正为更真实的级差)
  const propertyIncome = 3420000; // 34.2W
  const arTotal = contracts.reduce((sum, c) => sum + c.cumulativeArrears, 0) || 450000;
  
  // 关联方占比
  const relatedPartyIncome = contracts
    .filter(c => c.type === '关联方')
    .reduce((sum, c) => sum + (c.annualRent/12), 0);
  const totalMonthlyTarget = contracts.reduce((sum, c) => sum + (c.annualRent/12), 0);
  const relatedRatio = totalMonthlyTarget ? (relatedPartyIncome / totalMonthlyTarget * 100) : 92.4;

  const leasedUnits = assets.reduce((sum, a) => sum + (a.units?.filter(u => u.status === AssetStatus.LEASED).length || 0), 0);
  const totalUnits = assets.reduce((sum, a) => sum + (a.units?.length || 0), 0);
  const occupancyRate = (leasedUnits / (totalUnits || 1)) * 100 || 66.7;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
  const pieData = [
    { name: '房屋租金', value: rentIncome },
    { name: '物业服务', value: propertyIncome },
    { name: '其他收入', value: 150000 },
  ];

  // 12个月趋势数据
  const trendData = [
    { name: '24-01', target: 1200, actual: 1180, ratio: 91 },
    { name: '24-02', target: 1200, actual: 1150, ratio: 92 },
    { name: '24-03', target: 1250, actual: 1230, ratio: 93 },
    { name: '24-04', target: 1250, actual: 950, ratio: 92.4 },
    { name: '24-05', target: 1300, actual: 1280, ratio: 94 },
    { name: '24-06', target: 1300, actual: 1100, ratio: 93 },
    { name: '24-07', target: 1350, actual: 1320, ratio: 92 },
    { name: '24-08', target: 1350, actual: 1340, ratio: 93 },
    { name: '24-09', target: 1400, actual: 1380, ratio: 92 },
    { name: '24-10', target: 1400, actual: 1390, ratio: 94 },
    { name: '24-11', target: 1450, actual: 1420, ratio: 95 },
    { name: '24-12', target: 1500, actual: 1480, ratio: 96 },
  ];

  return (
    <div className="space-y-6">
      {/* 顶部指标卡：体现级差与关键占比 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-blue-600">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">房屋租金 (主营)</p>
          <p className="text-xl font-black text-gray-900 mt-1">¥ {(rentIncome / 10000).toFixed(1)}W</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-green-500 font-bold">
            <span>占总收 78%</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-emerald-500">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">物业服务收入</p>
          <p className="text-xl font-black text-gray-900 mt-1">¥ {(propertyIncome / 10000).toFixed(1)}W</p>
          <p className="text-[10px] text-gray-400 mt-2">规模仅为租金 1/4</p>
        </div>
        <div className="bg-indigo-900 p-5 rounded-2xl shadow-lg text-white">
          <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">关联方占比</p>
          <p className="text-2xl font-black mt-1">{relatedRatio.toFixed(1)}%</p>
          <div className="flex items-center gap-1 mt-1 text-[10px] text-red-400 font-bold">
            <span>⚠️ 业务高度集中</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border-l-4 border-red-500">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">欠费总额 (1131)</p>
          <p className="text-xl font-black text-red-600 mt-1">¥ {(arTotal / 10000).toFixed(1)}W</p>
          <p className="text-[10px] text-red-400 mt-2 font-bold underline cursor-pointer">含 12 天以上逾期单 →</p>
        </div>
        <div className="bg-slate-100 p-5 rounded-2xl border border-slate-200">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">水电气代收代付</p>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-slate-700">≈ 0</span>
            <span className="text-[8px] text-slate-400 font-medium">净额</span>
          </div>
          <p className="text-[9px] text-slate-500 mt-2">交易笔数: 1,452 笔/月</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 12个月趋势分析 */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-gray-800">2024 年度经营趋势 (12个月)</h3>
            <div className="flex gap-4 text-[10px] font-bold">
              <span className="flex items-center gap-1"><i className="w-2 h-2 bg-blue-500 rounded-full"></i> 合同应收</span>
              <span className="flex items-center gap-1"><i className="w-2 h-2 bg-slate-200 rounded-full"></i> 财务实收</span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 9}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 9}} />
                <Tooltip />
                <Area type="monotone" dataKey="target" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.05} strokeWidth={2} />
                <Area type="monotone" dataKey="actual" stroke="#94a3b8" fill="transparent" strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 收入构成与风险 */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-6">收入结构比 (金额加权)</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">
                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {pieData.map((d, i) => (
                <div key={i} className="flex justify-between items-center text-[10px]">
                  <span className="flex items-center gap-2"><i className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[i]}}></i>{d.name}</span>
                  <span className="font-bold text-gray-700">{(d.value/10000).toFixed(0)}W</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-red-50 p-6 rounded-3xl border border-red-100">
            <h3 className="text-xs font-bold text-red-800 mb-3">⚠️ 财务不匹配预警</h3>
            <ul className="text-[10px] space-y-2 text-red-700">
              <li className="flex gap-2"><span>•</span> <strong>物业成本倒挂：</strong>部分关联方单元物业支出远超预收服务费</li>
              <li className="flex gap-2"><span>•</span> <strong>跨期入账：</strong>Q1 存在大额上年租金补收，导致趋势波动</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
