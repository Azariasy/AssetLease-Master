
import React, { useState } from 'react';
import { Save, LayoutTemplate, Building2 } from 'lucide-react';
import { SystemConfig } from '../types';

interface SettingsPageProps {
  config: SystemConfig;
  onSave: (newConfig: SystemConfig) => void;
}

const SettingsPage = ({ config, onSave }: SettingsPageProps) => {
  const [formData, setFormData] = useState<SystemConfig>(config);
  const [msg, setMsg] = useState('');

  const handleChange = (field: keyof SystemConfig, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEntityChange = (id: string, field: string, value: string) => {
      const newEntities = formData.entities.map(e => e.id === id ? { ...e, [field]: value } : e);
      setFormData(prev => ({ ...prev, entities: newEntities }));
  };

  const handleSave = () => {
    onSave(formData);
    setMsg('设置已保存');
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
        <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <LayoutTemplate size={24} className="text-blue-600" /> 系统参数配置
        </h3>

        <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">收入科目代码 (逗号分隔)</label>
              <textarea 
                value={formData.incomeSubjectCodes.join(', ')}
                onChange={(e) => handleChange('incomeSubjectCodes', e.target.value.split(',').map(s => s.trim()))}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg h-20"
              />
            </div>
             <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">成本费用科目代码 (逗号分隔)</label>
              <textarea 
                value={formData.costSubjectCodes.join(', ')}
                onChange={(e) => handleChange('costSubjectCodes', e.target.value.split(',').map(s => s.trim()))}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg h-20"
              />
            </div>
        </div>

        <h3 className="text-xl font-bold text-slate-900 mt-10 mb-6 flex items-center gap-2">
            <Building2 size={24} className="text-indigo-600" /> 主体与对账配置
        </h3>
        <div className="space-y-4">
            {formData.entities.map(ent => (
                <div key={ent.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50">
                    <div className="flex justify-between mb-2">
                        <span className="font-bold text-slate-800">{ent.name}</span>
                        <span className="text-xs text-slate-500 uppercase">{ent.type}</span>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">对方账套中的名称 (用于自动匹配)</label>
                        <input 
                            type="text"
                            value={ent.matchedNameInOtherBooks || ''}
                            onChange={(e) => handleEntityChange(ent.id, 'matchedNameInOtherBooks', e.target.value)}
                            className="w-full px-3 py-1.5 border border-slate-200 rounded text-sm"
                            placeholder="例如：置业公司"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                            当其他公司在该字段匹配到此名称时，系统将识别为与该公司的关联交易。
                        </p>
                    </div>
                </div>
            ))}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
          <span className="text-emerald-600 text-sm font-bold animate-pulse">{msg}</span>
          <button onClick={handleSave} className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition shadow-lg">
            <Save size={18} /> 保存配置
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
