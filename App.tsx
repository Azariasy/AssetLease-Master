
import React, { useState, useEffect } from 'react';
import { MOCK_CONTRACTS, MOCK_ASSETS } from './constants';
import { LeaseContract, AssetInfo, TrialBalanceRow, AnalysisResult, AssetStatus } from './types';
import Dashboard from './components/Dashboard';
import AssetMap from './components/AssetMap';
import DataImport from './components/DataImport';
import { analyzeLeaseData } from './services/geminiService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'assets' | 'ledger' | 'recon' | 'import' | 'analysis'>('dashboard');
  const [contracts, setContracts] = useState<LeaseContract[]>(MOCK_CONTRACTS);
  const [assets, setAssets] = useState<AssetInfo[]>(MOCK_ASSETS);
  const [financialData, setFinancialData] = useState<TrialBalanceRow[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    setAssets(prev => prev.map(a => ({
      ...a,
      units: Array.from({ length: 15 }, (_, i) => ({
        id: `${a.id}-u${i}`,
        code: `${101 + i + (Math.floor(i/3)*100)}`,
        floor: Math.floor(i / 3) + 1,
        area: 120 + (i % 3) * 20,
        status: i % 5 === 0 ? AssetStatus.VACANT : AssetStatus.LEASED,
        rentPerSqm: 3.8,
        tenant: i % 5 === 0 ? undefined : '中移(成都)有限公司'
      }))
    })));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      <aside className="w-72 bg-slate-900 text-white flex flex-col fixed h-full z-20 shadow-2xl">
        <div className="p-8">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center font-black">A</div>
             <div>
               <h1 className="text-lg font-black tracking-tight">智慧资产工作站</h1>
               <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Mobile Cloud Non-Listed</p>
             </div>
          </div>
        </div>
        
        <nav className="flex-1 px-4 space-y-1">
          <NavItem icon="📊" label="经营看板" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon="🗺️" label="资产地图" active={activeTab === 'assets'} onClick={() => setActiveTab('assets')} />
          <NavItem icon="📜" label="合同台账" active={activeTab === 'ledger'} onClick={() => setActiveTab('ledger')} />
          <NavItem icon="⚖️" label="财务对账" active={activeTab === 'recon'} onClick={() => setActiveTab('recon')} />
          <NavItem icon="📥" label="数据中心" active={activeTab === 'import'} onClick={() => setActiveTab('import')} />
          <NavItem icon="✨" label="决策报告" active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} />
        </nav>
      </aside>

      <main className="ml-72 flex-1 p-10 overflow-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">
              {activeTab === 'dashboard' && '经营驾驶舱'}
              {activeTab === 'assets' && '资产可视化地图'}
              {activeTab === 'ledger' && '合同履约台账 (分项)'}
              {activeTab === 'recon' && '财务合同对账 (差异处理)'}
              {activeTab === 'import' && '智能数据中心'}
              {activeTab === 'analysis' && 'AI 经营深度分析'}
            </h2>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'dashboard' && <Dashboard contracts={contracts} assets={assets} financialData={financialData} />}
          {activeTab === 'assets' && <AssetMap assets={assets} />}
          {activeTab === 'import' && (
            <DataImport 
              onFinancialDataImported={data => { setFinancialData(data); setActiveTab('dashboard'); }} 
              onContractsImported={newContracts => { setContracts([...newContracts, ...contracts]); setActiveTab('ledger'); }} 
            />
          )}
          
          {activeTab === 'ledger' && (
             <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr>
                      <th className="px-8 py-5">合同 & 类型</th>
                      <th className="px-8 py-5">承租单位</th>
                      <th className="px-8 py-5 text-right">房屋租金 / 物业费 (月)</th>
                      <th className="px-8 py-5 text-right">累计欠费 / 超期</th>
                      <th className="px-8 py-5">到期日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {contracts.map(c => (
                      <tr key={c.id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-8 py-5">
                          <p className="text-sm font-black text-blue-600">{c.contractNo}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${c.type === '关联方' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                            {c.type}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-sm font-bold text-slate-700">{c.tenantName}</td>
                        <td className="px-8 py-5 text-right">
                          <p className="text-sm font-black text-slate-900">¥{(c.annualRent/12).toLocaleString()}</p>
                          <p className="text-[10px] text-slate-400">物业: ¥{c.monthlyPropertyFee.toLocaleString()}</p>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <p className={`text-sm font-black ${c.cumulativeArrears > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                            ¥{c.cumulativeArrears.toLocaleString()}
                          </p>
                          {c.overdueDays > 0 && <p className="text-[10px] text-red-400 font-bold">{c.overdueDays}天超期</p>}
                        </td>
                        <td className="px-8 py-5 text-xs text-slate-500 font-medium">{c.endDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          )}

          {activeTab === 'recon' && (
            <div className="space-y-6">
               <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-center mb-8">
                     <h3 className="text-xl font-black text-slate-900">财务实收 vs 合同约定 对账 (含差异分类)</h3>
                     <div className="flex gap-4">
                        <span className="text-xs bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full font-bold">匹配: 18</span>
                        <span className="text-xs bg-orange-50 text-orange-600 px-3 py-1 rounded-full font-bold">小额差异: 5</span>
                        <span className="text-xs bg-red-50 text-red-600 px-3 py-1 rounded-full font-bold">待处理: 2</span>
                     </div>
                  </div>
                  
                  <div className="space-y-4">
                     {[
                       { title: "中移产研 - 2024Q3 租金", status: "match", diff: 0, reason: "自动匹配成功" },
                       { title: "外部科技B - 4月租金", status: "diff", diff: 0.50, reason: "小额尾数差异 (由于计息误差)" },
                       { title: "咪咕音乐 - 年度预收", status: "warning", diff: 120000, reason: "跨期调整：实收包含上年欠费补收" },
                     ].map((item, i) => (
                       <div key={i} className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="flex-1">
                             <div className="flex items-center gap-3">
                                <p className="text-base font-black text-slate-800">{item.title}</p>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  item.status === 'match' ? 'bg-emerald-100 text-emerald-700' : 
                                  item.status === 'diff' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {item.status === 'match' ? '完全匹配' : item.status === 'diff' ? '小额差异' : '异常待核'}
                                </span>
                             </div>
                             <p className="text-xs text-slate-500 mt-2 italic">系统建议：{item.reason}</p>
                          </div>
                          <div className="flex items-center gap-10">
                             <div className="text-right">
                                <p className="text-[10px] text-slate-400 font-bold uppercase">差异额</p>
                                <p className={`text-lg font-black ${item.diff > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                  ¥{item.diff.toLocaleString()}
                                </p>
                             </div>
                             <button className="px-4 py-2 bg-white border border-slate-200 text-xs font-bold rounded-xl hover:bg-slate-100">处理</button>
                          </div>
                       </div>
                     ))}
                  </div>
               </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active, onClick }: any) => (
  <button onClick={onClick} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all ${active ? 'bg-blue-600 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-800'}`}>
    <span className="text-xl">{icon}</span>
    <span className="font-black text-sm">{label}</span>
  </button>
);

export default App;
