
import React, { useState } from 'react';
import { TrialBalanceRow, LeaseContract } from '../../types';
import { extractContractFromDoc } from '../../services/gemini/geminiService';
import Button from '../../components/ui/Button';
import { Database, FileText, UploadCloud, Brain } from 'lucide-react';

interface ImportPageProps {
  onFinancialDataImported: (data: TrialBalanceRow[]) => void;
  onContractsImported: (contracts: LeaseContract[]) => void;
}

const ImportPage: React.FC<ImportPageProps> = ({ onFinancialDataImported, onContractsImported }) => {
  const [loading, setLoading] = useState(false);

  const mockExtract = async () => {
    setLoading(true);
    // 模拟 AI 提取过程
    setTimeout(() => {
      setLoading(false);
      alert('AI 解析成功！已同步 2 份新合同至台账。');
    }, 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <section className="bg-white p-10 rounded-[40px] shadow-sm border border-slate-100">
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Database /></div>
          <h3 className="text-2xl font-black">财务数据导入</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           <div className="border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
              <UploadCloud className="mx-auto text-slate-300 mb-4" size={40} />
              <p className="text-sm font-black text-slate-800">EBS 明细账 (Excel)</p>
              <p className="text-[10px] text-slate-400 mt-2">支持账户明细查询、余额表</p>
           </div>
           <div className="border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
              <UploadCloud className="mx-auto text-slate-300 mb-4" size={40} />
              <p className="text-sm font-black text-slate-800">往来核销明细</p>
              <p className="text-[10px] text-slate-400 mt-2">用于自动化对账匹配</p>
           </div>
        </div>
      </section>

      <section className="bg-white p-10 rounded-[40px] shadow-sm border border-slate-100">
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600"><FileText /></div>
          <h3 className="text-2xl font-black">合同中心 AI 解析</h3>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-[32px] p-12 text-center">
           <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Brain className="text-indigo-600" />
           </div>
           <h4 className="text-lg font-black mb-2">拖拽合同文件或 ZIP 到这里</h4>
           <p className="text-xs text-slate-400 mb-8 max-w-sm mx-auto font-medium">
             由 Gemini 3 Pro 驱动，自动识别租金、物业费、关联方关系，并直接转化为结构化台账。
           </p>
           <Button onClick={mockExtract} disabled={loading} size="lg" className="bg-indigo-600 shadow-indigo-100">
             {loading ? 'AI 解析中...' : '选择文件并开始解析'}
           </Button>
        </div>
      </section>
    </div>
  );
};

export default ImportPage;
