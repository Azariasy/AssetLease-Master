
import React, { useState } from 'react';
import { Upload, FileIcon, Loader2, History, CheckCircle2, Eye, Building2, Trash2, AlertTriangle, BookOpenCheck } from 'lucide-react';
import { LedgerRow, BalanceRow, SystemConfig, ImportHistoryItem, Company } from '../types';
import { parseCSVData, parseExcelData, parseBalanceCSV, parseExcelBalance } from '../services/reconciliationUtils';
import { db } from '../db';

interface ImportPageProps {
  currentEntity: Company;
  onDataChanged: () => void;
  config: SystemConfig;
  importHistory: ImportHistoryItem[];
  onConfigUpdate: (newConfig: SystemConfig) => void;
}

const ImportPage: React.FC<ImportPageProps> = ({ currentEntity, onDataChanged, config, importHistory, onConfigUpdate }) => {
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [step, setStep] = useState(1);
  const [importType, setImportType] = useState<'ledger' | 'balance'>('ledger');
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]); 
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Feedback for Auto Learning
  const [learnedDepts, setLearnedDepts] = useState<number>(0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setRawFile(file);
    setIsParsing(true);
    setErrorMsg(null);
    setParsedRows([]);
    setLearnedDepts(0);

    // Get expected company segment prefix to validate file ownership
    const expectedPrefix = currentEntity.segmentPrefix;

    try {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      let rows: any[] = [];

      if (importType === 'ledger') {
        if (isExcel) rows = await parseExcelData(file, expectedPrefix);
        else rows = parseCSVData(await readFileAsText(file), expectedPrefix);
      } else {
        if (isExcel) rows = await parseExcelBalance(file, expectedPrefix);
        else rows = parseBalanceCSV(await readFileAsText(file), expectedPrefix);
      }

      if (rows.length === 0) {
        setErrorMsg("未识别到有效数据，请检查文件格式或表头。");
      } else {
        // Tag rows with current Entity ID
        const taggedRows = rows.map(r => ({ ...r, entityId: currentEntity.id }));
        setParsedRows(taggedRows);
        setStep(2);
      }
    } catch (err: any) {
      console.error(err);
      
      // Handle Specific Entity Mismatch Error
      if (err.message && err.message.includes('ENTITY_MISMATCH')) {
          const detected = err.message.split(':')[1];
          const actualName = config.entities.find(e => e.segmentPrefix === detected)?.name || '未知主体';
          setErrorMsg(`⛔ 主体校验失败：当前在【${currentEntity.name}】下，但文件包含【${actualName} (${detected})】的数据。禁止跨主体导入！`);
      } else {
          setErrorMsg("解析文件失败，请确保文件未损坏且格式正确。");
      }
    } finally {
      setIsParsing(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file); 
    });
  };

  const executeImport = async () => {
    setIsSaving(true);
    const importId = `batch-${Date.now()}`;
    const rowsWithBatch = parsedRows.map(r => ({ ...r, importId }));

    try {
      // 1. Auto-Learn Departments
      const newMap = { ...config.departmentMap };
      let learnCount = 0;
      
      // Scan imported rows for pairs of DeptCode + DeptName
      rowsWithBatch.forEach(row => {
          let code = '';
          let name = '';
          
          if (importType === 'ledger') {
              const r = row as LedgerRow;
              code = r.department || '';
              name = r.departmentName || '';
          } else {
              const r = row as BalanceRow;
              code = r.costCenterCode || '';
              name = r.costCenterName || '';
          }

          // If we have both, and code is not generic/default, and it's not already mapped or mapped to something generic
          if (code && code.length >= 6 && name && name !== '缺省' && name !== 'Default') {
              // Only update if not exists or if the existing name looks less descriptive (simplified logic: just overwrite)
              if (!newMap[code] || newMap[code] !== name) {
                  newMap[code] = name;
                  learnCount++;
              }
          }
      });

      if (learnCount > 0) {
          const newConfig = { ...config, departmentMap: newMap };
          onConfigUpdate(newConfig);
          localStorage.setItem('sys_config', JSON.stringify(newConfig)); // Ensure persistance
          setLearnedDepts(learnCount);
      }

      // 2. Database Transaction
      await (db as any).transaction('rw', db.ledger, db.balances, db.history, async () => {
        // Bulk Add Data
        if (importType === 'ledger') {
          await db.ledger.bulkAdd(rowsWithBatch as LedgerRow[]);
        } else {
          await db.balances.bulkAdd(rowsWithBatch as BalanceRow[]);
        }

        // Add History Record
        const historyItem: ImportHistoryItem = {
           id: importId, // Use batch ID as history ID
           entityId: currentEntity.id,
           fileName: rawFile?.name || 'unknown',
           importDate: new Date().toLocaleString(),
           recordCount: parsedRows.length,
           type: importType,
           status: 'success'
        };
        await db.history.add(historyItem);
      });

      onDataChanged(); // Notify App to reload data
      setStep(3);
    } catch (error) {
      console.error("Failed to save to DB:", error);
      setErrorMsg("保存数据至本地数据库失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBatch = async (item: ImportHistoryItem) => {
    if (!window.confirm(`确定要撤销并删除导入批次 "${item.fileName}" 吗？该批次的所有财务记录将被永久移除。`)) {
        return;
    }

    setDeletingId(item.id);
    try {
        await (db as any).transaction('rw', db.ledger, db.balances, db.history, async () => {
            if (item.type === 'ledger') {
                await db.ledger.where('importId').equals(item.id).delete();
            } else {
                await db.balances.where('importId').equals(item.id).delete();
            }
            await db.history.delete(item.id);
        });
        onDataChanged();
    } catch (err) {
        console.error("Delete failed:", err);
        alert("删除失败，请重试。");
    } finally {
        setDeletingId(null);
    }
  };

  // Helper to render preview table based on type
  const renderPreviewTable = () => {
    const previewRows = parsedRows.slice(0, 50); // Show top 50 rows

    if (importType === 'ledger') {
      return (
        <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-96">
           <table className="w-full text-sm text-left whitespace-nowrap">
             <thead className="bg-slate-100 text-slate-500 font-bold text-xs uppercase sticky top-0">
               <tr>
                 <th className="px-4 py-3">期间</th>
                 <th className="px-4 py-3">凭证号</th>
                 <th className="px-4 py-3">科目</th>
                 <th className="px-4 py-3">摘要</th>
                 <th className="px-4 py-3 text-right">借方</th>
                 <th className="px-4 py-3 text-right">贷方</th>
                 <th className="px-4 py-3">往来/部门</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {previewRows.map((row: any, idx) => (
                 <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-600">{row.period}</td>
                    <td className="px-4 py-2 font-mono text-blue-600">{row.voucherNo}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <span className="font-bold text-xs text-slate-700 truncate max-w-[150px]" title={row.subjectName}>{row.subjectName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{row.subjectCode}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500 truncate max-w-[180px]" title={row.summary}>{row.summary}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.debitAmount ? row.debitAmount.toLocaleString() : '-'}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.creditAmount ? row.creditAmount.toLocaleString() : '-'}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                        <div>{row.counterparty || '-'}</div>
                        <div title={row.departmentName}>{row.departmentName || row.department}</div>
                    </td>
                 </tr>
               ))}
             </tbody>
           </table>
        </div>
      );
    } else {
      // Balance Table Preview
      return (
        <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-96">
           <table className="w-full text-sm text-left whitespace-nowrap">
             <thead className="bg-slate-100 text-slate-500 font-bold text-xs uppercase sticky top-0">
               <tr>
                 <th className="px-4 py-3">期间</th>
                 <th className="px-4 py-3">科目</th>
                 <th className="px-4 py-3 text-right">期初余额</th>
                 <th className="px-4 py-3 text-right">本期借方</th>
                 <th className="px-4 py-3 text-right">本期贷方</th>
                 <th className="px-4 py-3 text-right">期末余额</th>
                 <th className="px-4 py-3">辅助维度</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {previewRows.map((row: any, idx) => (
                 <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-600">{row.period}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <span className="font-bold text-xs text-slate-700 truncate max-w-[150px]" title={row.subjectName}>{row.subjectName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{row.subjectCode}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-500">{row.openingBalance?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600">{row.debitPeriod?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600">{row.creditPeriod?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">{row.closingBalance?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                        {row.costCenterCode && <div title="成本中心">{row.costCenterName || row.costCenterCode}</div>}
                        {row.counterparty && <div title="往来单位">{row.counterparty}</div>}
                    </td>
                 </tr>
               ))}
             </tbody>
           </table>
        </div>
      );
    }
  };

  // UI Components
  const renderNewImport = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Current Entity Indicator */}
      <div className="bg-slate-800 text-white px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg">
         <Building2 size={20} className="text-indigo-400" />
         <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">当前导入目标主体</div>
            <div className="font-bold">{currentEntity.name}</div>
         </div>
      </div>

      {step === 1 && (
        <>
          <div className="grid grid-cols-2 gap-6">
            <div onClick={() => setImportType('ledger')} className={`p-6 rounded-2xl border-2 cursor-pointer transition-all ${importType === 'ledger' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-100 hover:border-slate-300 bg-white'}`}>
              <div className="font-bold text-lg text-slate-800 mb-2">A. 账户明细表</div>
              <p className="text-sm text-slate-500">导入账户明细查询报表。</p>
            </div>
            <div onClick={() => setImportType('balance')} className={`p-6 rounded-2xl border-2 cursor-pointer transition-all ${importType === 'balance' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-100 hover:border-slate-300 bg-white'}`}>
              <div className="font-bold text-lg text-slate-800 mb-2">B. 余额表</div>
              <p className="text-sm text-slate-500">导入组合余额表。</p>
            </div>
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-20 flex flex-col items-center justify-center hover:bg-slate-50 transition cursor-pointer relative bg-white">
             <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} accept=".csv,.xlsx,.xls" disabled={isParsing} />
             {isParsing ? (
                <div className="flex flex-col items-center animate-pulse">
                   <Loader2 size={40} className="text-indigo-600 animate-spin mb-4" />
                   <p className="text-slate-500 font-bold">正在解析数据...</p>
                </div>
             ) : (
               <>
                 <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6"><Upload size={32} /></div>
                 <p className="text-lg font-bold text-slate-700">点击上传文件</p>
               </>
             )}
             {errorMsg && <div className="mt-6 p-3 bg-red-50 text-red-600 text-sm rounded-lg font-medium">{errorMsg}</div>}
           </div>
        </>
      )}

      {step === 2 && (
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-800">数据预览</h3>
            <div className="text-sm">共识别 <span className="font-bold text-indigo-600">{parsedRows.length}</span> 条</div>
          </div>
          
          {/* Render Actual Data Preview */}
          {renderPreviewTable()}

          <div className="flex justify-end gap-4 mt-6">
            <button onClick={() => setStep(1)} className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">重新上传</button>
            <button onClick={executeImport} disabled={isSaving} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-lg shadow-indigo-200">
              {isSaving && <Loader2 size={16} className="animate-spin" />}
              确认并保存至数据库
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-3xl p-16 border border-slate-100 shadow-sm text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">导入成功</h2>
          <p className="text-slate-500 mb-8">数据已保存至本地数据库 ({currentEntity.name})。</p>
          
          {learnedDepts > 0 && (
             <div className="mb-8 p-4 bg-blue-50 border border-blue-100 rounded-xl inline-flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
                 <div className="p-2 bg-white rounded-lg text-blue-600 shadow-sm">
                     <BookOpenCheck size={20} />
                 </div>
                 <div className="text-left">
                     <div className="text-sm font-bold text-blue-800">字典自动进化</div>
                     <div className="text-xs text-blue-600">已自动学习并更新了 {learnedDepts} 个部门代码的中文名称。</div>
                 </div>
             </div>
          )}

          <div>
             <button onClick={() => setStep(1)} className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">继续导入</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderHistory = () => (
    <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-800">导入历史记录 ({currentEntity.name})</h3>
        <div className="flex items-center gap-2 p-2 bg-amber-50 text-amber-700 text-[10px] rounded-lg border border-amber-100">
           <AlertTriangle size={12} />
           <span>撤销批次将同时从财务报表中移除该批次对应的所有凭证或余额数据。</span>
        </div>
      </div>
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase">
          <tr>
            <th className="px-6 py-4">文件名</th>
            <th className="px-4 py-4">类型</th>
            <th className="px-6 py-4">时间</th>
            <th className="px-4 py-4 text-center">条数</th>
            <th className="px-4 py-4 text-center">状态</th>
            <th className="px-4 py-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {importHistory.map(item => (
            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-6 py-4 font-bold text-slate-700 truncate max-w-[200px]" title={item.fileName}>{item.fileName}</td>
              <td className="px-4 py-4">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.type === 'ledger' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                    {item.type === 'ledger' ? '明细账' : '余额表'}
                  </span>
              </td>
              <td className="px-6 py-4 text-slate-500 text-xs">{item.importDate}</td>
              <td className="px-4 py-4 text-center font-bold text-slate-600">{item.recordCount}</td>
              <td className="px-4 py-4 text-center text-emerald-500"><CheckCircle2 size={16} className="mx-auto" /></td>
              <td className="px-4 py-4 text-right">
                <button 
                  onClick={() => handleDeleteBatch(item)}
                  disabled={deletingId === item.id}
                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="撤销并删除该批次"
                >
                  {deletingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </td>
            </tr>
          ))}
          {importHistory.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">暂无导入历史记录</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-4 border-b border-slate-200 pb-1">
        <button onClick={() => setActiveTab('new')} className={`px-4 py-2 text-sm font-bold border-b-2 ${activeTab === 'new' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>新导入</button>
        <button onClick={() => setActiveTab('history')} className={`px-4 py-2 text-sm font-bold border-b-2 ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>历史记录与撤销</button>
      </div>
      {activeTab === 'new' ? renderNewImport() : renderHistory()}
    </div>
  );
};

export default ImportPage;
