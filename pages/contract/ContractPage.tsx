
import React from 'react';
import { LeaseContract } from '../../types';

interface ContractPageProps {
  contracts: LeaseContract[];
}

const ContractPage: React.FC<ContractPageProps> = ({ contracts }) => {
  return (
    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
          <tr>
            <th className="px-10 py-6">合同信息</th>
            <th className="px-10 py-6">承租方</th>
            <th className="px-10 py-6 text-right">分项明细 (月)</th>
            <th className="px-10 py-6 text-right">状态与欠费</th>
            <th className="px-10 py-6">截止日</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {contracts.map(c => (
            <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
              <td className="px-10 py-7">
                <p className="text-sm font-black text-blue-600 group-hover:underline underline-offset-4">{c.contractNo}</p>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-2 inline-block ${c.type === '关联方' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-100 text-slate-500'}`}>
                  {c.type}
                </span>
              </td>
              <td className="px-10 py-7 text-sm font-bold text-slate-700">{c.tenantName}</td>
              <td className="px-10 py-7 text-right">
                <p className="text-sm font-black text-slate-900">租: ¥{(c.annualRent/12).toLocaleString()}</p>
                <p className="text-[10px] text-slate-400 font-medium">费: ¥{c.monthlyPropertyFee.toLocaleString()}</p>
              </td>
              <td className="px-10 py-7 text-right">
                <p className={`text-sm font-black ${c.cumulativeArrears > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                  ¥{c.cumulativeArrears.toLocaleString()}
                </p>
                {c.overdueDays > 0 && <p className="text-[10px] text-red-400 font-bold mt-1">⚠️ {c.overdueDays}d 逾期</p>}
              </td>
              <td className="px-10 py-7 text-xs text-slate-500 font-bold">{c.endDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ContractPage;
