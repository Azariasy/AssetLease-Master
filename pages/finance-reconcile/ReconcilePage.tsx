
import React from 'react';
import { Scale } from 'lucide-react';

const ReconcilePage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-[40px] p-12 border border-slate-100 shadow-sm text-center">
        <Scale className="mx-auto text-blue-100 mb-6" size={60} />
        <h3 className="text-2xl font-black text-slate-900">财务智能对账引擎已就绪</h3>
        <p className="text-slate-400 text-sm mt-3 max-w-sm mx-auto">
          系统将自动对比 EBS 财务子账与合同约定的应收项，自动识别跨期调整与尾数差异。
        </p>
        <button className="mt-10 px-8 py-4 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-slate-800 transition-all">
          执行全库自动匹配分析
        </button>
      </div>
    </div>
  );
};

export default ReconcilePage;
