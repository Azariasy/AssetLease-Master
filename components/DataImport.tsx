
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { TrialBalanceRow, LeaseContract } from '../types';
import { extractContractFromDoc } from '../services/geminiService';

interface DataImportProps {
  onFinancialDataImported: (data: TrialBalanceRow[]) => void;
  onContractsImported: (contracts: LeaseContract[]) => void;
}

const DataImport: React.FC<DataImportProps> = ({ onFinancialDataImported, onContractsImported }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processType, setProcessType] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);

  // 会计期间状态
  const [startPeriod, setStartPeriod] = useState('2024-01');
  const [endPeriod, setEndPeriod] = useState('2024-12');

  const fileToBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  const handleFinancialUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'details' | 'balance') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProcessType(type === 'details' ? `正在解析账户明细 (${startPeriod} 至 ${endPeriod})` : '正在解析账户组合余额...');
    setProgress(20);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        const results: TrialBalanceRow[] = [];
        data.forEach((row, index) => {
          if (index === 0 || !row[9]) return; // 假设第9列是科目代码
          
          const rowPeriod = String(row[1] || '');
          // 简易期间过滤逻辑
          if (rowPeriod >= startPeriod && rowPeriod <= endPeriod) {
            results.push({
              period: rowPeriod,
              subjectCode: String(row[9] || ''),
              subjectName: String(row[10] || ''),
              combinationDesc: String(row[3] || ''),
              openingBalance: parseFloat(String(row[21] || '0').replace(/,/g, '')),
              debitAmount: parseFloat(String(row[22] || '0').replace(/,/g, '')),
              creditAmount: parseFloat(String(row[23] || '0').replace(/,/g, '')),
              closingBalance: parseFloat(String(row[24] || '0').replace(/,/g, '')),
              intercompanyName: row[16] === '缺省' ? '' : row[16]
            });
          }
        });
        
        setProgress(100);
        onFinancialDataImported(results);
      } catch (err) {
        alert('财务文件格式不正确，请确保表头符合 EBS 标准。');
      } finally {
        setTimeout(() => setIsProcessing(false), 800);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const fileName = file.name.toLowerCase();
    
    try {
      if (fileName.endsWith('.zip')) {
        setProcessType('正在解压批量合同...');
        const zip = await JSZip.loadAsync(file);
        // Cast values to any to fix TypeScript errors related to unknown properties on zip.files objects
        const contractFiles = Object.values(zip.files).filter((f: any) => !f.dir && (f.name.endsWith('.pdf') || f.name.endsWith('.docx'))) as any[];
        
        setTotalFiles(contractFiles.length);
        const extractedContracts: LeaseContract[] = [];

        for (let i = 0; i < contractFiles.length; i++) {
          const contractFile = contractFiles[i];
          setCurrentFileIndex(i + 1);
          // Access properties on the casted object to satisfy TypeScript
          setProcessType(`AI 正在解析第 ${i + 1}/${contractFiles.length} 份合同: ${contractFile.name}`);
          setProgress(Math.round(((i) / contractFiles.length) * 100));

          const content = await contractFile.async('blob');
          const base64 = await fileToBase64(content);
          // Use the internal file name to detect the correct MIME type
          const currentMimeType = contractFile.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          
          const extracted = await extractContractFromDoc(base64, currentMimeType);
          extractedContracts.push({
            id: `${Date.now()}-${i}`,
            unitCode: '待分配',
            cumulativeArrears: 0,
            overdueDays: 0,
            ...extracted,
            status: '履行中'
          });
        }
        setProgress(100);
        onContractsImported(extractedContracts);
      } else {
        // 单个文件处理
        setProcessType('AI 正在研读单份合同...');
        setProgress(40);
        const base64 = await fileToBase64(file);
        const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const extracted = await extractContractFromDoc(base64, mimeType);
        setProgress(100);
        onContractsImported([{
          id: Date.now().toString(),
          unitCode: '待分配',
          cumulativeArrears: 0,
          overdueDays: 0,
          ...extracted,
          status: '履行中'
        }]);
      }
    } catch (err) {
      alert('合同解析失败，请检查文件格式或 API 状态。');
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setCurrentFileIndex(0);
        setTotalFiles(0);
      }, 800);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-20">
      {/* 财务数据导入区 */}
      <section className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h3 className="text-xl font-black text-slate-900">财务报表处理中心</h3>
            <p className="text-xs text-slate-400 mt-1">支持 EBS 明细账与余额表，自动识别会计期间</p>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl border border-slate-100">
            <span className="text-[10px] font-black text-slate-400 px-2">会计期间范围</span>
            <input 
              type="month" 
              value={startPeriod} 
              onChange={e => setStartPeriod(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold"
            />
            <span className="text-slate-300">至</span>
            <input 
              type="month" 
              value={endPeriod} 
              onChange={e => setEndPeriod(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ImportCard 
            title="账户明细查询" 
            desc="分析长周期流水、水电气代收代付活跃度" 
            icon="📊" 
            onUpload={e => handleFinancialUpload(e, 'details')}
            disabled={isProcessing}
            accept=".xlsx,.xls"
          />
          <ImportCard 
            title="账户组合余额" 
            desc="核对期末应收账款(1131)与预收账款(2401)" 
            icon="⚖️" 
            onUpload={e => handleFinancialUpload(e, 'balance')}
            disabled={isProcessing}
            accept=".xlsx,.xls"
          />
        </div>
      </section>

      {/* 合同中心导入区 */}
      <section className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h3 className="text-xl font-black text-slate-900">合同中心 (支持批量 ZIP)</h3>
            <p className="text-xs text-slate-400 mt-1">AI 视觉识别合同要素，支持压缩包一键上传</p>
          </div>
          <div className="flex gap-2">
            <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black px-3 py-1 rounded-full border border-indigo-100">PDF / DOCX / ZIP</span>
          </div>
        </div>

        <div className="border-2 border-dashed border-slate-200 rounded-[32px] p-12 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-all relative">
          <input 
            type="file" 
            className="absolute inset-0 opacity-0 cursor-pointer" 
            accept=".pdf,.doc,.docx,.zip"
            onChange={handleContractUpload}
            disabled={isProcessing}
          />
          <div className="text-5xl mb-4">📂</div>
          <h4 className="text-lg font-black text-slate-800">拖拽合同原件或 ZIP 压缩包至此</h4>
          <p className="text-xs text-slate-400 mt-2">AI 将自动解压并逐份提取金额、期限、承租方等 12 项核心指标</p>
          <div className="mt-6 flex justify-center gap-4">
             <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold bg-white px-3 py-1.5 rounded-xl shadow-sm">
                <span className="text-blue-500">✔</span> 支持扫描件 OCR
             </div>
             <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold bg-white px-3 py-1.5 rounded-xl shadow-sm">
                <span className="text-blue-500">✔</span> 自动识别关联方
             </div>
          </div>
        </div>
      </section>

      {/* 动态进度反馈 */}
      {isProcessing && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[500px] z-50 animate-in fade-in slide-in-from-bottom-10">
          <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-2xl border border-slate-700">
            <div className="flex justify-between items-center mb-4">
               <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-widest">{processType}</span>
               </div>
               <span className="text-xs font-black text-blue-400">{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
               <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{width: `${progress}%`}}></div>
            </div>
            {totalFiles > 0 && (
              <p className="text-[10px] text-slate-500 mt-3 font-bold">
                队列进度: 已完成 {currentFileIndex - 1} / {totalFiles} 份文档
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ImportCard = ({ title, desc, icon, onUpload, disabled, accept }: any) => (
  <div className="group relative border border-slate-100 bg-slate-50/50 rounded-[32px] p-6 hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all">
    <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={onUpload} disabled={disabled} accept={accept} />
    <div className="flex items-start gap-5">
      <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="flex-1">
        <h4 className="text-base font-black text-slate-800">{title}</h4>
        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{desc}</p>
        <div className="mt-4 flex items-center gap-2 text-[10px] font-black text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
          立即上传预览 <span className="text-lg">→</span>
        </div>
      </div>
    </div>
  </div>
);

export default DataImport;
