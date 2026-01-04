
import React, { useState } from 'react';
import { Upload, Loader2, CheckCircle2, Building2, Trash2, AlertTriangle, BookOpenCheck, RefreshCcw, AlertCircle, X } from 'lucide-react';
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
  
  // Status States
  const [isSaving, setIsSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Deletion State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Feedback for Auto Learning
  const [learnedDepts, setLearnedDepts] = useState<number>(0);

  // --- Parsing Logic (Step 1) ---

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setRawFile(file);
    setIsParsing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setParsedRows([]);
    setLearnedDepts(0);

    const expectedPrefix = currentEntity.segmentPrefix;

    try {
      const fileName = file.name.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      let rows: any[] = [];

      if (importType === 'ledger') {
        if (isExcel) {
            rows = await parseExcelData(file, expectedPrefix);
        } else {
            if (file.size > 50 * 1024 * 1024) throw new Error("CSV 文件过大 (超过 50MB)，建议转换为 Excel 格式导入以提高性能。");
            const textContent = await readFileAsText(file);
            rows = parseCSVData(textContent, expectedPrefix);
        }
      } else {
        if (isExcel) {
            rows = await parseExcelBalance(file, expectedPrefix);
        } else {
            const textContent = await readFileAsText(file);
            rows = parseBalanceCSV(textContent, expectedPrefix);
        }
      }

      if (rows.length === 0) {
        setErrorMsg("未识别到有效数据，请检查文件格式或表头。");
      } else {
        const taggedRows = rows.map(r => ({ ...r, entityId: currentEntity.id }));
        setParsedRows(taggedRows);
        setStep(2);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('ENTITY_MISMATCH')) {
          const detected = err.message.split(':')[1];
          const actualName = config.entities.find(e => e.segmentPrefix === detected)?.name || '未知主体';
          setErrorMsg(`⛔ 主体校验失败：当前在【${currentEntity.name}】下，但文件包含【${actualName} (${detected})】的数据。禁止跨主体导入！`);
      } else if (err.message && (err.message.includes('Invalid array length') || err.name === 'RangeError')) {
          setErrorMsg("文件解析错误：文件可能损坏或格式不兼容。请尝试另存为标准 Excel (.xlsx) 格式后重试。");
      } else {
          setErrorMsg(`解析文件失败: ${err.message || '未知错误'}`);
      }
    } finally {
      setIsParsing(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
          const text = e.target?.result as string;
          if (text.includes('\0\0\0')) {
              reject(new Error("检测到二进制内容。请确认这是有效的 CSV/文本文件"));
              return;
          }
          resolve(text);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsText(file); 
    });
  };

  // --- Saving Logic with Smart Duplicate Detection (Step 2) ---

  const checkDuplicates = async (rows: any[], type: 'ledger' | 'balance') => {
      // Group by period for efficiency
      const rowsByPeriod: Record<string, any[]> = {};
      rows.forEach(r => {
          // Normalize period (handle missing/empty as empty string)
          const cleanPeriod = r.period ? r.period.trim() : '';
          if (!rowsByPeriod[cleanPeriod]) rowsByPeriod[cleanPeriod] = [];
          rowsByPeriod[cleanPeriod].push(r);
      });

      const periods = Object.keys(rowsByPeriod);
      let conflictMsg = '';
      let idsToDelete: any[] = []; 

      for (const p of periods) {
          const periodRows = rowsByPeriod[p];
          
          if (type === 'balance') {
              // Balance Sheet Strategy: Check FULL Combination [Subject + Dept + Project + Sub + CP]
              // Generate unique key for every row
              const getRowFingerprint = (r: any) => {
                  return [
                      (r.subjectCode || '').trim(),
                      (r.costCenterCode || '').trim(),
                      (r.projectCode || '').trim(),
                      (r.subAccountCode || '').trim(),
                      (r.counterpartyCode || '').trim()
                  ].join('|');
              };

              const fileFingerprints = new Set(periodRows.map(r => getRowFingerprint(r)));
              
              // Query DB for this period
              const existingInPeriod = await db.balances
                  .where('[entityId+period]')
                  .equals([currentEntity.id, p])
                  .toArray();
              
              // Find collisions by comparing fingerprints
              const collisions = existingInPeriod.filter(dbRow => fileFingerprints.has(getRowFingerprint(dbRow)));
              
              if (collisions.length > 0) {
                  const displayP = p || '未知期间';
                  conflictMsg += `期间 [${displayP}]：检测到 ${collisions.length} 条重复的科目余额数据 (该期间已存 ${existingInPeriod.length} 条)。\n`;
                  idsToDelete.push(...collisions.map(c => c.id));
              }
          } else {
              // Ledger Strategy: 
              // 1. Check VoucherNo if available
              // 2. Fallback to Content Fingerprint (Subject + Amount + Abstract) if VoucherNo is empty
              const getLedgerFingerprint = (r: any) => {
                  if (r.voucherNo && r.voucherNo.trim().length > 1) {
                      return `V:${r.voucherNo.trim()}`;
                  }
                  // Fallback fingerprint for entries without proper voucher numbers
                  // We round amounts to integers to avoid slight float diffs, though source should be same
                  const d = Math.round(r.debitAmount || 0);
                  const c = Math.round(r.creditAmount || 0);
                  // Use a hash-like string of key attributes
                  return `R:${(r.subjectCode||'').trim()}|${d}|${c}|${(r.summary||'').substring(0,10)}`;
              };

              const fileFingerprints = new Set(periodRows.map(r => getLedgerFingerprint(r)));
              
              const existingInPeriod = await db.ledger
                  .where('[entityId+period]')
                  .equals([currentEntity.id, p])
                  .toArray();
              
              const collisions = existingInPeriod.filter(dbRow => fileFingerprints.has(getLedgerFingerprint(dbRow)));
              
              if (collisions.length > 0) {
                  const uniqueVouchers = new Set(collisions.map(c => c.voucherNo)).size;
                  const displayP = p || '未知期间';
                  // If collisions are found but uniqueVouchers is small (or 1 because all are empty), warn about row count
                  conflictMsg += `期间 [${displayP}]：检测到 ${collisions.length} 条重复的流水记录 (涉及 ${uniqueVouchers} 张凭证)。\n`;
                  idsToDelete.push(...collisions.map(c => c.id));
              }
          }
      }

      return { conflictMsg, idsToDelete };
  };

  const executeImport = async () => {
    setIsSaving(true);
    setSavingStatus('正在进行数据完整性校验...');
    setErrorMsg(null);
    
    const importId = `batch-${Date.now()}`;
    const rowsWithBatch = parsedRows.map(r => ({ ...r, importId }));

    try {
      // 1. Smart Duplicate Detection
      const { conflictMsg, idsToDelete } = await checkDuplicates(parsedRows, importType);

      if (conflictMsg) {
          await new Promise(r => setTimeout(r, 100)); // Render UI yield
          
          const confirmText = `⚠️ 发现重复数据：\n\n${conflictMsg}\n是否【覆盖】这些重复项？\n\n点击“确定”：将删除旧数据并写入新数据（覆盖更新）。\n点击“取消”：放弃本次导入。`;
          
          if (!window.confirm(confirmText)) {
              setIsSaving(false);
              setSavingStatus('');
              return;
          }

          if (idsToDelete.length > 0) {
              setSavingStatus(`正在清理 ${idsToDelete.length} 条旧数据...`);
              const table = importType === 'ledger' ? db.ledger : db.balances;
              await (table as any).bulkDelete(idsToDelete);
          }
      }

      setSavingStatus('正在智能学习部门字典...');
      // 2. Auto-Learn Departments
      const newMap = { ...config.departmentMap };
      let learnCount = 0;
      
      rowsWithBatch.forEach(row => {
          let code = '', name = '';
          if (importType === 'ledger') {
              code = row.department || ''; name = row.departmentName || '';
          } else {
              code = row.costCenterCode || ''; name = row.costCenterName || '';
          }

          if (code && code.length >= 6 && name && name !== '缺省' && name !== 'Default') {
              const currentName = newMap[code];
              if (!currentName || currentName === '缺省' || (name.length > currentName.length)) {
                  if (newMap[code] !== name) {
                      newMap[code] = name;
                      learnCount++;
                  }
              }
          }
      });

      if (learnCount > 0) {
          const newConfig = { ...config, departmentMap: newMap };
          onConfigUpdate(newConfig);
          localStorage.setItem('sys_config', JSON.stringify(newConfig));
          setLearnedDepts(learnCount);
      }

      setSavingStatus(`正在写入 ${rowsWithBatch.length} 条新数据...`);
      // 3. Database Transaction
      await (db as any).transaction('rw', db.ledger, db.balances, db.history, async () => {
        if (importType === 'ledger') {
          await db.ledger.bulkAdd(rowsWithBatch as LedgerRow[]);
        } else {
          await db.balances.bulkAdd(rowsWithBatch as BalanceRow[]);
        }

        const historyItem: ImportHistoryItem = {
           id: importId,
           entityId: currentEntity.id,
           fileName: rawFile?.name || 'unknown',
           importDate: new Date().toLocaleString(),
           recordCount: parsedRows.length,
           type: importType,
           status: 'success'
        };
        await db.history.add(historyItem);
      });

      setSavingStatus('完成！');
      onDataChanged(); 
      setStep(3);
    } catch (error: any) {
      console.error("Save Error:", error);
      setErrorMsg(`保存失败: ${error.message || '数据库写入错误'}`);
    } finally {
      setIsSaving(false);
      setSavingStatus('');
    }
  };

  // --- History Tab Logic ---

  const handleDeleteHistory = async (e: React.MouseEvent, item: ImportHistoryItem) => {
      // Stop prop to prevent row click
      e.stopPropagation();
      e.preventDefault();

      if (!window.confirm(`确定要撤销批次【${item.fileName}】吗？\n\n此操作将从数据库中永久删除该批次导入的 ${item.recordCount} 条数据。`)) {
          return;
      }

      setDeletingId(item.id);
      setSuccessMsg(null);
      setErrorMsg(null);

      try {
          // Explicitly delete based on importId which is tagged on every row
          await (db as any).transaction('rw', db.ledger, db.balances, db.history, async () => {
              // Note: using where('importId') index if available, or filter.
              // Dexie bulk delete is efficient.
              if (item.type === 'ledger') {
                  await db.ledger.where('importId').equals(item.id).delete();
              } else {
                  await db.balances.where('importId').equals(item.id).delete();
              }
              await db.history.delete(item.id);
          });

          // Show success feedback
          setSuccessMsg(`批次撤销成功，已删除 ${item.recordCount} 条数据。`);
          
          // Refresh Parent Data
          onDataChanged(); 

      } catch (err: any) {
          console.error("Delete failed:", err);
          setErrorMsg(`撤销操作失败: ${err.message}`);
      } finally {
          setDeletingId(null);
      }
  };

  // --- Renderers ---

  const renderNewImport = () => (
    <div className="max-w-4xl mx-auto space-y-6">
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
             {errorMsg && <div className="mt-6 p-3 bg-red-50 text-red-600 text-sm rounded-lg font-medium max-w-lg text-center leading-relaxed">{errorMsg}</div>}
           </div>
        </>
      )}

      {step === 2 && (
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-800">数据预览</h3>
            <div className="text-sm">共识别 <span className="font-bold text-indigo-600">{parsedRows.length}</span> 条</div>
          </div>
          
          <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-96">
             <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-500 font-bold text-xs uppercase sticky top-0">
                    <tr>
                        <th className="px-4 py-3">期间</th>
                        <th className="px-4 py-3">科目/凭证</th>
                        <th className="px-4 py-3 text-right">借方</th>
                        <th className="px-4 py-3 text-right">贷方</th>
                        <th className="px-4 py-3">辅助信息</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 20).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-mono text-slate-600">{row.period || '-'}</td>
                            <td className="px-4 py-2">
                                <div className="font-bold text-xs text-slate-700 truncate max-w-[200px]">{row.subjectName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{row.subjectCode || row.voucherNo}</div>
                            </td>
                            <td className="px-4 py-2 text-right font-mono">{row.debitAmount?.toLocaleString() || row.debitPeriod?.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right font-mono">{row.creditAmount?.toLocaleString() || row.creditPeriod?.toLocaleString()}</td>
                            <td className="px-4 py-2 text-xs text-slate-400 max-w-[150px] truncate">
                                {row.summary || row.costCenterName || row.counterparty}
                            </td>
                        </tr>
                    ))}
                </tbody>
             </table>
          </div>

          <div className="flex flex-col gap-4 mt-6">
             {/* ERROR MESSAGE DISPLAY */}
             {errorMsg && (
                 <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-2 text-sm font-bold animate-pulse">
                     <AlertCircle size={18} />
                     <span>{errorMsg}</span>
                 </div>
             )}

             <div className="flex justify-end gap-4 items-center">
                {savingStatus && (
                <div className="text-sm text-indigo-600 font-bold flex items-center gap-2 mr-2 animate-pulse">
                    <Loader2 size={16} className="animate-spin" />
                    {savingStatus}
                </div>
                )}
                <button onClick={() => setStep(1)} disabled={isSaving} className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg disabled:opacity-50">重新上传</button>
                <button onClick={executeImport} disabled={isSaving} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-50">
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : '确认并保存'}
                </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-3xl p-16 border border-slate-100 shadow-sm text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">导入成功</h2>
          <p className="text-slate-500 mb-8">数据已成功合并至本地数据库。</p>
          
          {learnedDepts > 0 && (
             <div className="mb-8 p-4 bg-blue-50 border border-blue-100 rounded-xl inline-flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
                 <div className="p-2 bg-white rounded-lg text-blue-600 shadow-sm">
                     <BookOpenCheck size={20} />
                 </div>
                 <div className="text-left">
                     <div className="text-sm font-bold text-blue-800">字典自动进化</div>
                     <div className="text-xs text-blue-600">已自动更新 {learnedDepts} 个部门名称。</div>
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
    <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm min-h-[400px]">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            导入历史记录
            <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                当前主体: {currentEntity.name}
            </span>
            <button onClick={onDataChanged} className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors" title="刷新列表"><RefreshCcw size={14}/></button>
        </h3>
        <div className="flex items-center gap-2 p-2 bg-amber-50 text-amber-700 text-[10px] rounded-lg border border-amber-100">
           <AlertTriangle size={12} />
           <span>撤销批次将物理删除该批次写入的所有数据（含合并更新的部分）。</span>
        </div>
      </div>

      {successMsg && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 size={16} />
              {successMsg}
              <button onClick={() => setSuccessMsg(null)} className="ml-auto hover:text-emerald-800"><X size={14} /></button>
          </div>
      )}

      {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in">
              <AlertCircle size={16} />
              {errorMsg}
          </div>
      )}
      
      <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase">
            <tr>
                <th className="px-6 py-4">文件名</th>
                <th className="px-4 py-4">类型</th>
                <th className="px-6 py-4">时间</th>
                <th className="px-4 py-4 text-center">条数</th>
                <th className="px-4 py-4 text-center">状态</th>
                <th className="px-6 py-4 text-right">操作</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
            {importHistory.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4 font-bold text-slate-700 max-w-[200px] truncate" title={item.fileName}>
                    {item.fileName}
                </td>
                <td className="px-4 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${item.type === 'ledger' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                        {item.type === 'ledger' ? '明细账' : '余额表'}
                    </span>
                </td>
                <td className="px-6 py-4 text-slate-500 text-xs font-mono">{item.importDate}</td>
                <td className="px-4 py-4 text-center font-bold text-slate-600">{item.recordCount}</td>
                <td className="px-4 py-4 text-center">
                    <div className="flex items-center justify-center gap-1 text-emerald-500 text-xs font-bold bg-emerald-50 py-1 px-2 rounded-full w-fit mx-auto">
                        <CheckCircle2 size={12} /> 已完成
                    </div>
                </td>
                <td className="px-6 py-4 text-right">
                    <button 
                        type="button" 
                        onClick={(e) => handleDeleteHistory(e, item)}
                        disabled={deletingId === item.id}
                        className={`flex items-center gap-1 ml-auto px-3 py-1.5 rounded-lg border transition-all ${
                            deletingId === item.id 
                            ? 'bg-red-50 text-red-500 border-red-100 cursor-not-allowed' 
                            : 'bg-white text-slate-400 border-slate-200 hover:border-red-200 hover:text-red-500 hover:bg-red-50'
                        }`}
                        title="撤销并删除该批次"
                    >
                        {deletingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        <span className="text-xs font-bold">{deletingId === item.id ? '撤销中...' : '撤销'}</span>
                    </button>
                </td>
                </tr>
            ))}
            {importHistory.length === 0 && (
                <tr>
                <td colSpan={6} className="px-6 py-16 text-center text-slate-400 italic bg-slate-50/30">
                    <div className="flex flex-col items-center gap-2">
                        <AlertCircle size={24} className="opacity-20" />
                        <span>暂无导入历史记录</span>
                    </div>
                </td>
                </tr>
            )}
            </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-4 border-b border-slate-200 pb-1">
        <button onClick={() => setActiveTab('new')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'new' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>新导入</button>
        <button onClick={() => setActiveTab('history')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>历史记录与撤销</button>
      </div>
      {activeTab === 'new' ? renderNewImport() : renderHistory()}
    </div>
  );
};

export default ImportPage;
