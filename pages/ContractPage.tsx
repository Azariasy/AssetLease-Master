
import React, { useState } from 'react';
import { LeaseContract, PartnerType } from '../types';
import { extractContractData } from '../services/geminiService';
import { UploadCloud, CheckCircle2, FileText, Loader2 } from 'lucide-react';

const ContractPage = ({ contracts, onImport }: { contracts: LeaseContract[], onImport: (c: any) => void }) => {
  const [isImporting, setIsImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    // Convert to base64
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const base64 = (evt.target?.result as string).split(',')[1];
      try {
        const extractedData = await extractContractData(base64, file.type);
        
        // Validate payment cycle
        const validCycles = ['月度', '季度', '年度', '一次性'];
        const paymentCycle = validCycles.includes(extractedData.paymentCycle) 
            ? (extractedData.paymentCycle as '月度' | '季度' | '年度' | '一次性') 
            : '季度';

        // Create new contract from AI data
        const newContract: LeaseContract = {
          id: `new-${Date.now()}`,
          contractNo: extractedData.contractNo || 'Draft-001',
          name: file.name.replace(/\.[^/.]+$/, ""),
          tenantName: extractedData.tenantName || '未知租户',
          partnerType: extractedData.isRelated ? PartnerType.RELATED : PartnerType.EXTERNAL,
          type: extractedData.type || '房屋租赁',
          startDate: extractedData.startDate || '2025-01-01',
          endDate: extractedData.endDate || '2025-12-31',
          unitIds: [], // 需要人工关联
          rentAmount: extractedData.amount || 0,
          propertyFee: 0,
          paymentCycle: paymentCycle,
          status: '履行中',
          aiAnalysis: 'AI 自动提取完成，请核对金额与周期。'
        };
        onImport(newContract);
        alert(`成功导入合同：${newContract.name}`);
      } catch (err) {
        console.error(err);
        alert('AI 解析失败，请重试');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-8">
      {/* Import Area */}
      <div 
        className={`bg-white border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer relative overflow-hidden group ${
          isImporting ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'
        }`}
      >
        <input 
          type="file" 
          className="absolute inset-0 opacity-0 cursor-pointer z-10" 
          onChange={handleFileUpload}
          disabled={isImporting}
          accept=".pdf,.docx" 
        />
        
        {isImporting ? (
          <div className="flex flex-col items-center animate-pulse">
            <Loader2 size={40} className="text-blue-600 animate-spin mb-4" />
            <h3 className="text-lg font-bold text-blue-800">Gemini AI 正在研读合同...</h3>
            <p className="text-sm text-blue-600">提取条款、金额、周期与关联方信息</p>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">拖拽或点击上传合同文件</h3>
            <p className="text-sm text-slate-400 mt-2">支持 PDF / Word 格式，AI 自动识别填充字段</p>
          </>
        )}
      </div>

      {/* Contract List */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-800">合同台账列表</h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg border border-indigo-100">关联方优先</span>
          </div>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium text-xs uppercase">
            <tr>
              <th className="px-8 py-4">合同信息</th>
              <th className="px-8 py-4">承租方 / 关联方</th>
              <th className="px-8 py-4 text-right">租金总额</th>
              <th className="px-8 py-4 text-center">周期</th>
              <th className="px-8 py-4 text-center">状态</th>
              <th className="px-8 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contracts.map(c => (
              <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-8 py-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                      <FileText size={16} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{c.contractNo}</p>
                    </div>
                  </div>
                </td>
                <td className="px-8 py-5">
                  <p className="font-medium text-slate-700">{c.tenantName}</p>
                  {c.partnerType === PartnerType.RELATED && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded border border-indigo-100">
                      关联方
                    </span>
                  )}
                </td>
                <td className="px-8 py-5 text-right font-mono font-bold text-slate-900">
                  ¥{c.rentAmount.toLocaleString()}
                </td>
                <td className="px-8 py-5 text-center text-xs text-slate-500 font-medium">
                  {c.paymentCycle}
                </td>
                <td className="px-8 py-5 text-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                    c.status === '履行中' ? 'bg-emerald-50 text-emerald-600' : 
                    c.status === '即将到期' ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-8 py-5 text-right">
                  <button className="text-blue-600 hover:text-blue-700 font-bold text-xs">详情</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContractPage;
