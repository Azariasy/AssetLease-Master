
import React, { useState } from 'react';
import { TrialBalanceRow, LeaseContract } from '../../types';
import { extractContractFromDoc } from '../../services/gemini/geminiService';
import Button from '../../components/ui/Button';
import { Database, FileText, UploadCloud, Brain, Sparkles, CheckCircle2 } from 'lucide-react';

interface ImportPageProps {
  onFinancialDataImported: (data: TrialBalanceRow[]) => void;
  onContractsImported: (contracts: LeaseContract[]) => void;
}

const ImportPage: React.FC<ImportPageProps> = ({ onFinancialDataImported, onContractsImported }) => {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const mockExtract = async () => {
    setLoading(true);
    setSuccess(false);
    // 模拟真实的 AI 研读与比对过程
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }, 2500);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-20">
      {/* 财务 EBS 导入 */}
      <section>
        <div className="flex items-center gap-3 mb-8">
           <div className="p-2 bg-blue-100 text-blue-600 rounded-xl"><Database size={24} /></div>
           <h3 className="text-2xl font-black text-slate-900">财务中心数据接入</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <ImportCard 
             title="EBS 明细账查询" 
             desc="解析 1131、2401、5171 等核心科目流水" 
             icon={<UploadCloud className="text-slate-400" />} 
           />
           <ImportCard 
             title="科目余额表 (组合)" 
             desc="自动识别期初/期末余额，用于自动化试算平衡" 
             icon={<UploadCloud className="text-slate-400" />} 
           />
        </div>
      </section>

      {/* 合同 AI 研读 */}
      <section className="bg-white p-12 rounded-[50px] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
          <Brain size={300} />
        </div>
        
        <div className="flex justify-between items-start mb-12">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><FileText size={24} /></div>
              <h3 className="text-2xl font-black text-slate-900">合同中心 AI 智能研读</h3>
           </div>
           <div className="flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-full border border-indigo-100">
              <Sparkles size={14} className="text-indigo-600" />
              <span className="text-[10px] font-black text-indigo-700 uppercase">Gemini 3 Pro Vision Powered</span>
           </div>
        </div>

        <div className="flex flex-col items-center py-16 border-2 border-dashed border-slate-100 rounded-[40px] bg-slate-50/50">
           {success ? (
             <div className="flex flex-col items-center animate-in zoom-in-95 duration-300">
               <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6">
                 <CheckCircle2 size={40} />
               </div>
               <h4 className="text-xl font-black text-slate-800">解析比对完成！</h4>
               <p className="text-sm text-slate-500 mt-2">已自动识别 3 份关联方合同，同步至台账预览区</p>
             </div>
           ) : (
             <>
               <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8">
                 <FileText className="text-slate-300" size={32} />
               </div>
               <h4 className="text-xl font-black text-slate-800">拖拽合同文件或 ZIP 包至此处</h4>
               <p className="text-sm text-slate-400 mt-3 max-w-sm text-center leading-relaxed">
                 系统将自动提取租金、物业费分项，识别免租期与递增条款，并为您自动匹配出租单元。
               </p>
               <div className="mt-10">
                 <Button onClick={mockExtract} loading={loading} variant="secondary" size="lg" className="rounded-[20px]">
                   {loading ? 'AI 正在深度研读...' : '立即上传并解析'}
                 </Button>
               </div>
             </>
           )}
        </div>
      </section>
    </div>
  );
};

const ImportCard = ({ title, desc, icon }: any) => (
  <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex items-center gap-6 hover:shadow-xl transition-all cursor-pointer group">
    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center group-hover:bg-blue-50 transition-colors">
       {icon}
    </div>
    <div className="flex-1">
       <h4 className="text-base font-black text-slate-800">{title}</h4>
       <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tight">{desc}</p>
    </div>
  </div>
);

export default ImportPage;
