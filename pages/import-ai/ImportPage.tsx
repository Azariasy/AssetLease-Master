
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { TrialBalanceRow, LeaseContract } from '../../types/index';
import { extractContractFromDoc } from '../../services/gemini/geminiService';
import Button from '../../components/ui/Button';
import { 
  Database, FileText, UploadCloud, Brain, 
  Sparkles, CheckCircle2, ShieldCheck, 
  X, AlertCircle, RefreshCcw
} from 'lucide-react';

interface ImportPageProps {
  onFinancialDataImported: (data: TrialBalanceRow[]) => void;
  onContractsImported: (contracts: LeaseContract[]) => void;
}

const ImportPage: React.FC<ImportPageProps> = ({ onFinancialDataImported, onContractsImported }) => {
  const [loading, setLoading] = useState(false);
  const [extractionQueue, setExtractionQueue] = useState<Partial<LeaseContract>[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileToBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  // 处理财务 Excel 上传
  const handleFinancialUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        const results: TrialBalanceRow[] = [];
        data.slice(1).forEach((row) => {
          if (!row[1]) return; // 假设第二列是期间
          results.push({
            period: String(row[1] || ''),
            subjectCode: String(row[9] || ''),
            subjectName: String(row[10] || ''),
            combinationDesc: String(row[3] || ''),
            openingBalance: parseFloat(String(row[21] || '0').replace(/,/g, '')),
            debitAmount: parseFloat(String(row[22] || '0').replace(/,/g, '')),
            creditAmount: parseFloat(String(row[23] || '0').replace(/,/g, '')),
            closingBalance: parseFloat(String(row[24] || '0').replace(/,/g, '')),
            intercompanyName: row[16] === '缺省' ? '' : row[16]
          });
        });
        
        onFinancialDataImported(results);
        alert(`成功解析 ${results.length} 条财务流水记录`);
      } catch (err) {
        alert('解析失败，请确保使用 EBS 标准明细表导出格式。');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // 处理合同 AI 解析 (支持 ZIP)
  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFiles(true);
    setProgress(10);
    const fileName = file.name.toLowerCase();
    
    try {
      let filesToProcess: { blob: Blob, name: string }[] = [];

      if (fileName.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        // Fix: Cast entries to any to avoid TypeScript errors accessing dir, name, and async on unknown types
        const entries = Object.values(zip.files).filter((f: any) => !f.dir && (f.name.endsWith('.pdf') || f.name.endsWith('.docx'))) as any[];
        for (const entry of entries) {
          const blob = await entry.async('blob');
          filesToProcess.push({ blob, name: entry.name });
        }
      } else {
        filesToProcess.push({ blob: file, name: file.name });
      }

      const results: Partial<LeaseContract>[] = [];
      for (let i = 0; i < filesToProcess.length; i++) {
        const item = filesToProcess[i];
        setProgress(Math.round(((i + 1) / filesToProcess.length) * 100));
        
        const base64 = await fileToBase64(item.blob);
        const mimeType = item.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        
        try {
          const extracted = await extractContractFromDoc(base64, mimeType);
          results.push({
            id: `extracted-${Date.now()}-${i}`,
            status: '履行중' as any,
            cumulativeArrears: 0,
            overdueDays: 0,
            ...extracted
          });
        } catch (err) {
          console.error(`AI 提取文件 ${item.name} 失败`, err);
        }
      }
      
      setExtractionQueue(prev => [...prev, ...results]);
    } catch (err) {
      alert('解析异常，请检查网络或文件。');
    } finally {
      setIsProcessingFiles(false);
      setProgress(0);
    }
  };

  const confirmAllExtractions = () => {
    onContractsImported(extractionQueue as LeaseContract[]);
    setExtractionQueue([]);
    alert('全部提取结果已保存至合同台账');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-24">
      {/* 1. 财务数据接入 */}
      <section>
        <div className="flex items-center justify-between mb-8">
           <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-100 text-blue-600 rounded-2xl shadow-sm"><Database size={24} /></div>
              <h3 className="text-2xl font-black text-slate-900">财务明细数据接入</h3>
           </div>
           <div className="flex gap-2">
              <span className="px-3 py-1 bg-slate-100 text-[10px] font-black text-slate-500 rounded-full border border-slate-200">支持 XLS / XLSX</span>
           </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <ImportActionCard 
             title="EBS 明细账查询" 
             desc="自动识别 1131(应收)、2401(预收) 等科目，用于收缴率对账" 
             onFileChange={handleFinancialUpload}
             loading={loading}
             accept=".xlsx,.xls"
           />
           <ImportActionCard 
             title="科目余额表 (组合)" 
             desc="核对期初/期末余额，自动执行试算平衡校验" 
             onFileChange={handleFinancialUpload}
             loading={loading}
             accept=".xlsx,.xls"
           />
        </div>
      </section>

      {/* 2. 合同 AI 解析 */}
      <section className="bg-white p-12 rounded-[56px] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none rotate-12">
          <Brain size={320} />
        </div>

        <div className="flex justify-between items-start mb-12">
           <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-2xl shadow-sm"><FileText size={24} /></div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">合同中心 AI 智能解析</h3>
           </div>
           <div className="bg-gradient-to-r from-indigo-500 to-blue-600 px-5 py-2.5 rounded-2xl shadow-lg shadow-indigo-200 flex items-center gap-2">
              <Sparkles size={16} className="text-white animate-pulse" />
              <span className="text-[11px] font-black text-white uppercase tracking-wider">Gemini 3 Pro Vision Powered</span>
           </div>
        </div>

        {extractionQueue.length > 0 ? (
          <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
             <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-[32px] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"><ShieldCheck size={20} /></div>
                  <div>
                    <h4 className="text-sm font-black text-indigo-900">AI 已完成 {extractionQueue.length} 份合同研读</h4>
                    <p className="text-[10px] text-indigo-500 font-bold uppercase mt-0.5">请在下方待审区核对提取信息的准确性</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setExtractionQueue([])} className="text-red-500 hover:bg-red-50">放弃全部</Button>
                  <Button variant="primary" size="sm" onClick={confirmAllExtractions}>确认并入库</Button>
                </div>
             </div>

             <div className="bg-slate-50 border border-slate-100 rounded-[40px] overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-100/50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase">合同号/类型</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase">承租方</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase text-right">年度租金</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {extractionQueue.map((item, idx) => (
                      <tr key={idx} className="group hover:bg-white transition-colors">
                        <td className="px-6 py-4">
                           <p className="font-black text-slate-800">{item.contractNo}</p>
                           <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${item.type === '关联方' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-600'}`}>{item.type}</span>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-600">{item.tenantName}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">¥{(item.annualRent || 0).toLocaleString()}</td>
                        <td className="px-6 py-4 text-right">
                           <button onClick={() => setExtractionQueue(prev => prev.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500 transition-colors"><X size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-20 border-2 border-dashed border-slate-100 rounded-[48px] bg-slate-50/40 group relative">
            <input 
              type="file" 
              className="absolute inset-0 opacity-0 cursor-pointer z-10" 
              onChange={handleContractUpload} 
              disabled={isProcessingFiles}
              accept=".pdf,.docx,.zip"
            />
            
            {isProcessingFiles ? (
              <div className="flex flex-col items-center animate-in zoom-in-95">
                 <div className="w-24 h-24 relative mb-8">
                   <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                   <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                   <Brain className="absolute inset-0 m-auto text-indigo-600 animate-pulse" size={32} />
                 </div>
                 <h4 className="text-xl font-black text-slate-800">AI 正在深度研读合同文本...</h4>
                 <div className="w-64 bg-slate-200 h-1.5 rounded-full mt-6 overflow-hidden">
                    <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                 </div>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-4">已完成 {progress}% • 正在识别租金与免租期</p>
              </div>
            ) : (
              <>
                <div className="w-24 h-24 bg-white rounded-3xl shadow-xl shadow-slate-200/50 flex items-center justify-center mb-8 group-hover:scale-110 transition-all duration-500">
                   <FileText className="text-slate-300" size={40} />
                </div>
                <h4 className="text-xl font-black text-slate-800">将合同文件(PDF/DOCX)或压缩包(ZIP)拖入此处</h4>
                <p className="text-sm text-slate-400 mt-3 max-w-sm text-center leading-relaxed font-medium">
                  由 Gemini 3 Pro 驱动，自动解析年度租金、物业费分项，识别关联方身份，并为您自动完成单元匹配建议。
                </p>
                <div className="mt-10 pointer-events-none">
                  <Button variant="secondary" size="lg" className="rounded-2xl px-12">立即选择并解析</Button>
                </div>
                <div className="mt-8 flex gap-6">
                   <FeatureBadge icon={<CheckCircle2 size={12} />} label="OCR 扫描件识别" />
                   <FeatureBadge icon={<RefreshCcw size={12} />} label="历史版本自动比对" />
                   <FeatureBadge icon={<AlertCircle size={12} />} label="风险条款检测" />
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

const FeatureBadge = ({ icon, label }: any) => (
  <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-tight bg-white px-3 py-1.5 rounded-full border border-slate-100 shadow-sm">
    <span className="text-indigo-500">{icon}</span> {label}
  </div>
);

const ImportActionCard = ({ title, desc, icon, onFileChange, loading, accept }: any) => (
  <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex items-center gap-8 hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-500 cursor-pointer group relative overflow-hidden">
    <input 
      type="file" 
      className="absolute inset-0 opacity-0 cursor-pointer z-10" 
      onChange={onFileChange} 
      disabled={loading}
      accept={accept}
    />
    <div className={`w-20 h-20 bg-slate-50 rounded-[28px] flex items-center justify-center transition-all duration-500 group-hover:bg-blue-50 group-hover:rotate-3 ${loading ? 'animate-pulse' : ''}`}>
       <UploadCloud className="text-slate-300 group-hover:text-blue-500 transition-colors" size={32} />
    </div>
    <div className="flex-1">
       <div className="flex items-center gap-2">
         <h4 className="text-base font-black text-slate-800 tracking-tight">{title}</h4>
         {loading && <RefreshCcw size={12} className="text-blue-500 animate-spin" />}
       </div>
       <p className="text-[10px] text-slate-400 font-bold mt-1.5 leading-relaxed uppercase tracking-tight">{desc}</p>
       <div className="mt-4 flex items-center gap-2 text-[10px] font-black text-blue-600 opacity-0 group-hover:opacity-100 transform translate-x-[-10px] group-hover:translate-x-0 transition-all">
          点击选择本地文件 <span className="text-lg">→</span>
       </div>
    </div>
  </div>
);

export default ImportPage;
