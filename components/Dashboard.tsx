import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { LeaseContract, AssetUnit, PartnerType } from '../types';

interface DashboardProps {
  contracts: LeaseContract[];
  assets: AssetUnit[];
}

const Dashboard: React.FC<DashboardProps> = ({ contracts, assets }) => {
  const getAnnualRent = (c: LeaseContract) => {
    switch (c.paymentCycle) {
      case '月度': return c.rentAmount * 12;
      case '季度': return c.rentAmount * 4;
      case '年度': return c.rentAmount;
      case '一次性': return c.rentAmount;
      default: return c.rentAmount;
    }
  };

  const totalAnnualRent = contracts.reduce((sum, c) => sum + getAnnualRent(c), 0);
  const occupiedArea = assets.filter(a => a.status === '已出租').reduce((sum, a) => sum + a.area, 0);
  const totalArea = assets.reduce((sum, a) => sum + a.area, 0);
  const occupancyRate = totalArea > 0 ? (occupiedArea / totalArea) * 100 : 0;

  const typeData = [
    { name: '关联方', value: contracts.filter(c => c.partnerType === PartnerType.RELATED).length },
    { name: '外部单位', value: contracts.filter(c => c.partnerType === PartnerType.EXTERNAL).length },
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">年度租金总额</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">¥ {(totalAnnualRent / 10000).toFixed(2)}W</p>
          <div className="mt-2 text-xs text-green-600 font-medium">同比增长 8.2% ↑</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">资产出租率</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{occupancyRate.toFixed(1)}%</p>
          <div className="mt-2 text-xs text-blue-600 font-medium">在管面积 {totalArea} ㎡</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">异常合同预警</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{contracts.filter(c => c.status === '已超期').length}</p>
          <div className="mt-2 text-xs text-red-500 font-medium">需立即处理</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-80">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">租赁客户分布</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={typeData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {typeData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-80">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">各资产年度贡献值</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={contracts.map(c => ({ name: c.name, rent: getAnnualRent(c) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" hide />
              <YAxis />
              <Tooltip />
              <Bar dataKey="rent" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;