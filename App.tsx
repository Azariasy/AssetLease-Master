import React, { useState, useEffect } from 'react';
// Correct the import paths to point to folder-based index files which contain the necessary MOCK_FINANCIAL_DATA and augmented types.
import { MOCK_CONTRACTS, MOCK_ASSETS, MOCK_FINANCIAL_DATA } from './constants/index';
import { LeaseContract, AssetInfo, TrialBalanceRow, AnalysisResult, AssetStatus } from './types/index';

// 布局组件
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';

// 页面级组件
import DashboardPage from './pages/dashboard/DashboardPage';
import AssetMapPage from './pages/asset-map/AssetMapPage';
import ContractPage from './pages/contract/ContractPage';
import ReconcilePage from './pages/finance-reconcile/ReconcilePage';
import ImportPage from './pages/import-ai/ImportPage';
import DecisionReportPage from './pages/decision-report/DecisionReportPage';

// 服务
import { analyzeLeaseData } from './services/gemini/geminiService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'assets' | 'ledger' | 'recon' | 'import' | 'analysis'>('dashboard');
  const [contracts, setContracts] = useState<LeaseContract[]>(MOCK_CONTRACTS);
  const [assets, setAssets] = useState<AssetInfo[]>(MOCK_ASSETS);
  const [financialData, setFinancialData] = useState<TrialBalanceRow[]>(MOCK_FINANCIAL_DATA);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    // 增强资产单元数据
    setAssets(prev => prev.map(a => ({
      ...a,
      units: Array.from({ length: 15 }, (_, i) => ({
        id: `${a.id}-u${i}`,
        code: `${101 + i}`,
        floor: Math.floor(i / 3) + 1,
        area: 120,
        status: i % 5 === 0 ? AssetStatus.VACANT : AssetStatus.LEASED,
        rentPerSqm: 3.8
      }))
    })));
  }, []);

  const handleStartAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeLeaseData(contracts, financialData, assets);
      setAnalysis(result);
    } catch (err) {
      console.error("AI 分析失败:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const pageTitles: Record<string, string> = {
    dashboard: '企业经营驾驶舱',
    assets: '全景资产地图',
    ledger: '租赁合同台账',
    recon: '财务智能对账',
    import: '数据中心 (AI)',
    analysis: 'CFO 决策报告'
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="ml-80 flex-1 min-h-screen flex flex-col">
        <Header title={pageTitles[activeTab]} />

        <div className="p-12 flex-1">
          {activeTab === 'dashboard' && (
            <DashboardPage contracts={contracts} assets={assets} financialData={financialData} />
          )}
          {activeTab === 'assets' && (
            <AssetMapPage assets={assets} />
          )}
          {activeTab === 'ledger' && (
            <ContractPage contracts={contracts} />
          )}
          {activeTab === 'recon' && (
            <ReconcilePage />
          )}
          {activeTab === 'import' && (
            <ImportPage 
              onFinancialDataImported={setFinancialData} 
              onContractsImported={newOnes => setContracts([...newOnes, ...contracts])} 
            />
          )}
          {activeTab === 'analysis' && (
            <DecisionReportPage 
              analysis={analysis} 
              isAnalyzing={isAnalyzing} 
              onStartAnalysis={handleStartAnalysis} 
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;