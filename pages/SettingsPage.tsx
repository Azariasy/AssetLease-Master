import React, { useState, useEffect, useRef } from 'react';
import { Save, LayoutTemplate, Building2, Tag, Plus, X, BookOpen, ArrowRightLeft, HelpCircle, Bot, Eye, EyeOff, Database, Download, Upload, Loader2, RefreshCw, Trash2, AlertOctagon } from 'lucide-react';
import { SystemConfig } from '../types';
import { db } from '../db';

interface SettingsPageProps {
  config: SystemConfig;
  onSave: (newConfig: SystemConfig) => void;
}

const SettingsPage = ({ config, onSave }: SettingsPageProps) => {
  const [formData, setFormData] = useState<SystemConfig>(config);
  const [msg, setMsg] = useState('');
  
  // Local state for adding new inputs
  const [newIncomeCode, setNewIncomeCode] = useState('');
  const [newCostCode, setNewCostCode] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptName, setNewDeptName] = useState('');

  // Backup State
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Handlers ---

  const handleAddCode = (field: 'incomeSubjectCodes' | 'costSubjectCodes', value: string, setter: (v:string)=>void) => {
    if (value && !formData[field].includes(value)) {
      setFormData(prev => ({ ...prev, [field]: [...prev[field], value] }));
      setter('');
    }
  };

  const handleRemoveCode = (field: 'incomeSubjectCodes' | 'costSubjectCodes', value: string) => {
    setFormData(prev => ({ ...prev, [field]: prev[field].filter(c => c !== value) }));
  };

  const handleAddDept = () => {
    if (newDeptCode && newDeptName) {
      setFormData(prev => ({
        ...prev,
        departmentMap: { ...prev.departmentMap, [newDeptCode]: newDeptName }
      }));
      setNewDeptCode('');
      setNewDeptName('');
    }
  };

  const handleRemoveDept = (code: string) => {
    const newMap = { ...formData.departmentMap };
    delete newMap[code];
    setFormData(prev => ({ ...prev, departmentMap: newMap }));
  };

  const handleEntityChange = (id: string, field: string, value: string) => {
      const newEntities = formData.entities.map(e => e.id === id ? { ...e, [field]: value } : e);
      setFormData(prev => ({ ...prev, entities: newEntities }));
  };

  const handleSave = () => {
    onSave(formData);
    setMsg('系统配置已更新并生效');
    setTimeout(() => setMsg(''), 3000);
  };

  // --- Backup & Restore Logic ---

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportData: any = {
            version: "v4.1",
            date: timestamp,
            config: formData,
            tables: {}
        };

        // Export all tables
        exportData.tables.ledger = await db.ledger.toArray();
        exportData.tables.balances = await db.balances.toArray();
        exportData.tables.history = await db.history.toArray();
        // Export Knowledge (Shared)
        exportData.tables.knowledge = await db.knowledge.toArray();
        exportData.tables.chunks = await db.chunks.toArray();

        // Create Blob
        const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Trigger Download
        const a = document.createElement('a');
        a.href = url;
        a.download = `finance_master_backup_${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setMsg('全库备份（含共享知识库）已下载');
        setTimeout(() => setMsg(''), 3000);
    } catch (e) {
        console.error("Backup failed", e);
        alert("备份失败，请检查控制台日志。");
    } finally {
        setIsBackingUp(false);
    }
  };

  const handleRestoreClick = () => {
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click();
      }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!window.confirm("警告：恢复备份将覆盖当前所有数据（包括配置、流水、余额表、知识库）。此操作不可撤销！\n\n确定要继续吗？")) {
          return;
      }

      setIsRestoring(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
          try {
              const jsonStr = event.target?.result as string;
              const data = JSON.parse(jsonStr);

              if (!data.tables || !data.config) {
                  throw new Error("无效的备份文件格式");
              }

              // Restore
              await (db as any).transaction('rw', db.ledger, db.balances, db.history, db.knowledge, db.chunks, async () => {
                  // Clear existing
                  await db.ledger.clear();
                  await db.balances.clear();
                  await db.history.clear();
                  await db.knowledge.clear();
                  await db.chunks.clear();

                  // Add new
                  if (data.tables.ledger?.length) await db.ledger.bulkAdd(data.tables.ledger);
                  if (data.tables.balances?.length) await db.balances.bulkAdd(data.tables.balances);
                  if (data.tables.history?.length) await db.history.bulkAdd(data.tables.history);
                  if (data.tables.knowledge?.length) await db.knowledge.bulkAdd(data.tables.knowledge);
                  if (data.tables.chunks?.length) await db.chunks.bulkAdd(data.tables.chunks);
              });

              // Restore Config
              onSave(data.config);
              setFormData(data.config); // Update local state
              
              alert(`数据恢复成功！页面将刷新以应用更改。`);
              window.location.reload(); 

          } catch (err) {
              console.error("Restore failed", err);
              alert("恢复失败：文件格式不正确或数据损坏。");
          } finally {
              setIsRestoring(false);
          }
      };
      reader.readAsText(file);
  };

  const handleClearAllData = async () => {
      if (!window.confirm("【危险操作】此操作将清空本地数据库中的所有财务数据、知识库文档与向量索引。\n\n确定要清空吗？")) {
          return;
      }
      
      setIsClearing(true);
      try {
          await (db as any).transaction('rw', db.ledger, db.balances, db.history, db.knowledge, db.chunks, async () => {
              await db.ledger.clear();
              await db.balances.clear();
              await db.history.clear();
              await db.knowledge.clear();
              await db.chunks.clear();
          });
          alert("数据已清空，页面将刷新。");
          window.location.reload();
      } catch (err) {
          console.error("Clear failed", err);
          alert("清空失败");
      } finally {
          setIsClearing(false);
      }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800">系统参数配置</h2>
        <p className="text-slate-500 mt-1">配置财务科目的识别规则、部门字典、关联方逻辑。</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* 0. Data Management (Backup/Restore) - New Feature */}
        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Database size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">数据安全与管理</h3>
                    <p className="text-xs text-slate-400">导出全库备份或从备份文件恢复</p>
                </div>
            </div>
            
            <div className="flex gap-4">
                <button 
                    onClick={handleBackup}
                    disabled={isBackingUp}
                    className="flex-1 py-4 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition flex flex-col items-center justify-center gap-2 group"
                >
                    {isBackingUp ? <Loader2 className="animate-spin text-slate-400"/> : <Download className="text-slate-400 group-hover:text-slate-600" />}
                    <span className="text-sm font-bold text-slate-600 group-hover:text-slate-800">导出全库备份 (.json)</span>
                </button>

                <button 
                    onClick={handleRestoreClick}
                    disabled={isRestoring}
                    className="flex-1 py-4 bg-slate-50 border border-slate-200 rounded-xl hover:bg-red-50 hover:border-red-100 transition flex flex-col items-center justify-center gap-2 group"
                >
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />
                    {isRestoring ? <RefreshCw className="animate-spin text-red-400"/> : <Upload className="text-slate-400 group-hover:text-red-500" />}
                    <span className="text-sm font-bold text-slate-600 group-hover:text-red-600">恢复备份数据</span>
                </button>
            </div>
            
            <div className="pt-2 border-t border-slate-100">
               <button 
                  onClick={handleClearAllData}
                  disabled={isClearing}
                  className="w-full py-2 flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-xs font-bold"
               >
                   {isClearing ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12} />}
                   清空所有业务数据 (危险)
               </button>
            </div>
        </div>

        {/* 1. 科目识别规则 (Financial Definitions) */}
        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <BookOpen size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">科目识别规则</h3>
                    <p className="text-xs text-slate-400">系统根据此处配置自动计算营收与成本</p>
                </div>
            </div>

            {/* Income Codes */}
            <div>
                <label className="text-sm font-bold text-slate-700 mb-2 block">收入类科目 (前缀)</label>
                <div className="flex flex-wrap gap-2 mb-2 p-3 bg-slate-50 rounded-xl border border-slate-100 min-h-[60px]">
                    {formData.incomeSubjectCodes.map(code => (
                        <span key={code} className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
                            {code}
                            <button onClick={() => handleRemoveCode('incomeSubjectCodes', code)} className="hover:text-emerald-900"><X size={12}/></button>
                        </span>
                    ))}
                    <input 
                        type="text" 
                        value={newIncomeCode}
                        onChange={(e) => setNewIncomeCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCode('incomeSubjectCodes', newIncomeCode, setNewIncomeCode)}
                        placeholder="输入如 6001 回车..."
                        className="bg-transparent text-sm outline-none w-32 placeholder:text-slate-400"
                    />
                </div>
                <p className="text-[10px] text-slate-400">
                    提示：输入科目代码的前几位即可，例如输入 "6001" 会匹配 "600101", "600199" 等所有子科目。
                </p>
            </div>

            {/* Cost Codes */}
            <div>
                <label className="text-sm font-bold text-slate-700 mb-2 block">成本费用类科目 (前缀)</label>
                <div className="flex flex-wrap gap-2 mb-2 p-3 bg-slate-50 rounded-xl border border-slate-100 min-h-[60px]">
                    {formData.costSubjectCodes.map(code => (
                        <span key={code} className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
                            {code}
                            <button onClick={() => handleRemoveCode('costSubjectCodes', code)} className="hover:text-amber-900"><X size={12}/></button>
                        </span>
                    ))}
                    <input 
                        type="text" 
                        value={newCostCode}
                        onChange={(e) => setNewCostCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCode('costSubjectCodes', newCostCode, setNewCostCode)}
                        placeholder="输入如 6401 回车..."
                        className="bg-transparent text-sm outline-none w-32 placeholder:text-slate-400"
                    />
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* 2. 部门字典 (Department Map) */}
        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6 flex flex-col">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <LayoutTemplate size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">部门代码字典</h3>
                    <p className="text-xs text-slate-400">将 ERP 导出的部门代码翻译为中文名称</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[300px] pr-2 space-y-2">
                {Object.entries(formData.departmentMap).map(([code, name]) => (
                    <div key={code} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg group hover:bg-slate-100 transition-colors">
                        <div className="flex items-center gap-3">
                            <span className="font-mono text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 min-w-[40px] text-center">{code}</span>
                            <ArrowRightLeft size={12} className="text-slate-300" />
                            <span className="text-sm font-bold text-slate-700">{name}</span>
                        </div>
                        <button onClick={() => handleRemoveDept(code)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <TrashIcon />
                        </button>
                    </div>
                ))}
                {Object.keys(formData.departmentMap).length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-xs italic">暂无映射记录</div>
                )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-2">
                <input 
                    type="text" 
                    value={newDeptCode}
                    onChange={(e) => setNewDeptCode(e.target.value)}
                    placeholder="代码 (如 260001)"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                />
                <input 
                    type="text" 
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="名称 (如 综合部)"
                    className="flex-[2] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                />
                <button 
                    onClick={handleAddDept}
                    disabled={!newDeptCode || !newDeptName}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={18} />
                </button>
            </div>
        </div>

      {/* 3. 关联方互认 (Entity Interconnection) */}
      <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
         <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <Building2 size={20} />
            </div>
            <div>
                <h3 className="font-bold text-slate-800">关联方互认配置</h3>
                <p className="text-xs text-slate-400">配置各主体在对方账套中的名称与公司段代码</p>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {formData.entities.map(ent => (
                <div key={ent.id} className="border border-slate-200 rounded-2xl p-5 relative overflow-hidden group hover:shadow-md transition-shadow bg-slate-50/50">
                    <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[10px] font-bold text-white ${ent.type === 'listed' ? 'bg-emerald-500' : 'bg-blue-500'}`}>
                        {ent.type === 'listed' ? '上市主体' : '非上市主体'}
                    </div>
                    
                    <div className="mb-4 pr-16">
                        <div className="text-xs text-slate-400 font-bold uppercase mb-1">主体名称 (我)</div>
                        <div className="font-bold text-slate-800 text-sm leading-tight">{ent.name}</div>
                    </div>

                    <div className="space-y-3">
                         <div className="bg-white p-3 rounded-xl border border-slate-200">
                             <div className="flex items-center gap-2 mb-1">
                                 <label className="text-xs font-bold text-slate-600">公司段代码 (Segment)</label>
                             </div>
                             <input 
                                 type="text"
                                 value={ent.segmentPrefix || ''}
                                 onChange={(e) => handleEntityChange(ent.id, 'segmentPrefix', e.target.value)}
                                 className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-mono text-slate-700 focus:bg-white focus:border-indigo-500 outline-none"
                                 placeholder="如 391310"
                             />
                        </div>

                        <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <div className="flex items-center gap-2 mb-1">
                                 <HelpCircle size={14} className="text-slate-400" />
                                 <label className="text-xs font-bold text-slate-600">在对方账套里的名称</label>
                            </div>
                            <input 
                                type="text"
                                value={ent.matchedNameInOtherBooks || ''}
                                onChange={(e) => handleEntityChange(ent.id, 'matchedNameInOtherBooks', e.target.value)}
                                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-700 focus:bg-white focus:border-indigo-500 outline-none"
                                placeholder="如 成研分公司"
                            />
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
      </div>

      {/* Save Bar */}
      <div className="fixed bottom-6 right-6 z-20 flex items-center gap-4">
         {msg && (
             <div className="px-4 py-2 bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-lg animate-in slide-in-from-bottom-5 fade-in">
                 {msg}
             </div>
         )}
         <button 
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-slate-900/20"
         >
            <Save size={20} /> 保存系统配置
         </button>
      </div>

    </div>
  );
};

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
);

export default SettingsPage;