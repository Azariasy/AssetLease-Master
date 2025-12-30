
import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, TableProperties, ListFilter, Import, Settings, 
  Search, Bell, ChevronRight, Building2, RefreshCw
} from 'lucide-react';
import { db } from './db';

// Pages
import DashboardPage from './pages/DashboardPage';
import BalancePage from './pages/BalancePage'; 
import LedgerPage from './pages/LedgerPage';   
import ImportPage from './pages/ImportPage';   
import SettingsPage from './pages/SettingsPage';

// Types
import { LedgerRow, BalanceRow, SystemConfig, ImportHistoryItem, Company } from './types';

// Default Config Updated with User's specific entities
const DEFAULT_COMPANIES: Company[] = [
  { 
    id: 'ent_listed', 
    name: '中移（成都）信息通信科技有限公司', 
    type: 'listed', 
    matchedNameInOtherBooks: '成研院' // 非上市账套里，往来单位通常叫“成研院”
  },
  { 
    id: 'ent_non_listed', 
    name: '中国移动通信集团有限公司成都产业研究院分公司', 
    type: 'non-listed', 
    matchedNameInOtherBooks: '成研分公司' // 上市账套里，往来单位通常叫“成研分公司”
  }
];

const DEFAULT_CONFIG: SystemConfig = {
  mappingTemplates: [],
  incomeSubjectCodes: ['6001', '6051', '5001', '5051'], // 扩充常见收入科目
  costSubjectCodes: ['6401', '6402', '6403', '6601', '6602', '5401'], // 扩充常见成本科目
  accountSegmentIndex: 4,
  subAccountSegmentIndex: 5,
  departmentMap: {
    "01": "综合部",
    "02": "财务部",
    "03": "市场部",
    "04": "研发一部"
  },
  entities: DEFAULT_COMPANIES
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  
  // Global State - Initialize from localStorage
  const [currentEntityId, setCurrentEntityId] = useState<string>(() => {
     return localStorage.getItem('last_entity_id') || DEFAULT_COMPANIES[0].id;
  });

  const [config, setConfig] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem('sys_config');
    // Simple migration: if saved config doesn't have the new specific names, use default
    if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.entities && parsed.entities.some((e:any) => e.name.includes('中移'))) {
            return parsed;
        }
    }
    return DEFAULT_CONFIG;
  });
  
  // Data State (Loaded from DB)
  const [ledgerData, setLedgerData] = useState<LedgerRow[]>([]);
  const [balanceData, setBalanceData] = useState<BalanceRow[]>([]);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  
  const [drillDownFilter, setDrillDownFilter] = useState<{subjectCode?: string, period?: string} | null>(null);

  // Load Data when Entity Changes
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const balances = await db.balances.where('entityId').equals(currentEntityId).toArray();
        const ledgers = await db.ledger.where('entityId').equals(currentEntityId).toArray();
        const history = await db.history.where('entityId').equals(currentEntityId).reverse().toArray();
        
        setBalanceData(balances);
        setLedgerData(ledgers);
        setImportHistory(history);
      } catch (e) {
        console.error("Failed to load data from Dexie:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
    
    // Persist selection
    localStorage.setItem('last_entity_id', currentEntityId);
  }, [currentEntityId]);

  // Save Config Persistence
  useEffect(() => {
    localStorage.setItem('sys_config', JSON.stringify(config));
  }, [config]);

  // Navigation Handler
  const handleNavigate = (tab: string, params?: any) => {
    if (params) setDrillDownFilter(params);
    else setDrillDownFilter(null);
    setActiveTab(tab);
  };

  const handleRefreshData = async () => {
      setIsLoading(true);
      // Re-fetch current entity data
      const balances = await db.balances.where('entityId').equals(currentEntityId).toArray();
      const ledgers = await db.ledger.where('entityId').equals(currentEntityId).toArray();
      const history = await db.history.where('entityId').equals(currentEntityId).reverse().toArray();
      setBalanceData(balances);
      setLedgerData(ledgers);
      setImportHistory(history);
      setIsLoading(false);
  };

  const currentEntity = config.entities.find(e => e.id === currentEntityId) || config.entities[0];

  const renderContent = () => {
    if (isLoading) {
      return <div className="flex h-full items-center justify-center text-slate-400">正在从本地数据库加载数据...</div>;
    }

    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage 
            currentEntity={currentEntity} 
            allEntities={config.entities}
            balances={balanceData} 
            ledger={ledgerData} 
            config={config}
        />;
      case 'balances':
        return <BalancePage 
          balances={balanceData} 
          onDrillDown={(code, period) => handleNavigate('ledger', { subjectCode: code, period })} 
        />;
      case 'ledger':
        return <LedgerPage 
          data={ledgerData} 
          initialFilter={drillDownFilter}
          config={config}
        />;
      case 'import':
        return <ImportPage 
          currentEntity={currentEntity}
          onDataChanged={handleRefreshData}
          config={config}
          importHistory={importHistory}
        />;
      case 'settings':
        return <SettingsPage config={config} onSave={(newConfig) => setConfig(newConfig)} />; 
      default:
        return <DashboardPage currentEntity={currentEntity} allEntities={config.entities} balances={balanceData} ledger={ledgerData} config={config} />;
    }
  };

  const getHeaderTitle = () => {
    switch(activeTab) {
      case 'dashboard': return '财务总览与对账';
      case 'balances': return '科目余额表';
      case 'ledger': return '明细账查询';
      case 'import': return '数据导入';
      case 'settings': return '系统配置';
      default: return '首页';
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-10">
        <div className="p-6 flex items-center gap-3 text-white border-b border-slate-800/50">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
            <span className="font-bold text-lg">G</span>
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-wide">Group Finance</h1>
            <p className="text-[10px] text-slate-500 font-medium">集团财务数据中心 v3.1</p>
          </div>
        </div>

        {/* Entity Switcher */}
        <div className="px-4 py-4 border-b border-slate-800/50">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-2">当前账套主体</div>
          <div className="relative">
            <select 
              value={currentEntityId}
              onChange={(e) => setCurrentEntityId(e.target.value)}
              className="w-full appearance-none bg-slate-800 text-white text-xs font-bold py-2.5 pl-3 pr-8 rounded-lg outline-none border border-slate-700 focus:border-indigo-500 transition-colors cursor-pointer"
            >
              {config.entities.map(ent => (
                <option key={ent.id} value={ent.id}>
                  {ent.name.length > 10 ? ent.name.substring(0,6) + '...' + ent.name.substring(ent.name.length-4) : ent.name}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
               <Building2 size={14} />
            </div>
          </div>
          <div className="mt-2 px-2 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${currentEntity.type === 'listed' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
            <span className="text-[10px] text-slate-400">{currentEntity.type === 'listed' ? '上市主体' : '非上市主体'}</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavItem icon={<LayoutDashboard size={18} />} label="看板与对账" active={activeTab === 'dashboard'} onClick={() => handleNavigate('dashboard')} />
          <NavItem icon={<TableProperties size={18} />} label="余额表" active={activeTab === 'balances'} onClick={() => handleNavigate('balances')} />
          <NavItem icon={<ListFilter size={18} />} label="明细账" active={activeTab === 'ledger'} onClick={() => handleNavigate('ledger')} />
          <NavItem icon={<Import size={18} />} label="数据导入" active={activeTab === 'import'} onClick={() => handleNavigate('import')} />
          
          <div className="pt-6 pb-2 px-4 text-xs font-bold text-slate-600 uppercase tracking-wider">系统管理</div>
          <NavItem icon={<Settings size={18} />} label="参数配置" active={activeTab === 'settings'} onClick={() => handleNavigate('settings')} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">
              {getHeaderTitle()}
            </h2>
            {isLoading && <RefreshCw size={16} className="animate-spin text-slate-400" />}
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-sm text-right hidden md:block">
               <p className="font-bold text-slate-800 max-w-[300px] truncate">{currentEntity.name}</p>
               <p className="text-xs text-slate-400">本地数据已同步</p>
            </div>
            <div className={`w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white font-bold text-xs ${currentEntity.type === 'listed' ? 'bg-emerald-500' : 'bg-blue-500'}`}>
              {currentEntity.name.substring(0,1)}
            </div>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
      active 
        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20 font-medium' 
        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
    }`}
  >
    <div className={`${active ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}>
      {icon}
    </div>
    <span className="text-sm">{label}</span>
    {active && <ChevronRight size={14} className="ml-auto opacity-50" />}
  </button>
);

export default App;
