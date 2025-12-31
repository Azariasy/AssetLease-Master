
import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, TableProperties, ListFilter, Import, Settings, 
  Search, Bell, ChevronRight, Building2, RefreshCw, KeyRound, Check, Eye, EyeOff
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
    matchedNameInOtherBooks: '成研院',
    segmentPrefix: '391310' // 上市公司段
  },
  { 
    id: 'ent_non_listed', 
    name: '中国移动通信集团有限公司成都产业研究院分公司', 
    type: 'non-listed', 
    matchedNameInOtherBooks: '成研分公司',
    segmentPrefix: '012610' // 非上市公司段
  }
];

const DEFAULT_CONFIG: SystemConfig = {
  mappingTemplates: [],
  // Updated Income Codes based on user provided real data (Class 5 Income)
  incomeSubjectCodes: ['5111', '5121', '5141', '5171', '5201', '5301'],
  // Updated Cost/Expense Codes based on user provided real data (Class 5 Costs)
  costSubjectCodes: ['5410', '5411', '5421', '5471', '5481', '5501', '5502', '5503', '5504', '5601', '5603'],
  accountSegmentIndex: 4,
  subAccountSegmentIndex: 5,
  // 真实部门数据映射 (Key: 6位部门段代码, Value: 通用部门名称)
  departmentMap: {
    "260003": "财务部",
    "260020": "西南区域中心",
    "260021": "北方区域中心",
    "260023": "华东区域中心",
    "260024": "华南区域中心",
    "260025": "华中区域中心",
    "260026": "西北区域中心",
    "260030": "农商文旅产品中心",
    "260011": "产业合作部",
    "260015": "北京分公司",
    "260013": "研发二部",
    "260005": "技术支撑中心",
    "260032": "教育产品中心",
    "260001": "综合部（法律事务部）",
    "260027": "教育产品一中心",
    "260016": "市场部（品质管理部）",
    "260009": "技术规划部",
    "260018": "工会",
    "260022": "纪委办公室（内审部）",
    "260029": "医疗产品中心",
    "260031": "低空经济技术研发运营中心",
    "260006": "研发一部",
    "260004": "行业应用中心",
    "260002": "人力资源部",
    "260014": "公司领导",
    "260017": "技术专家",
    "260008": "党委办公室（党群工作部/党风廉政办公室）",
    "260028": "教育产品二中心"
  },
  entities: DEFAULT_COMPANIES
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [hasApiKey, setHasApiKey] = useState(false);
  
  // New: Privacy Mode
  const [privacyMode, setPrivacyMode] = useState(false);

  // Check API Key on load (Non-blocking now)
  useEffect(() => {
    const storedKey = localStorage.getItem('DASHSCOPE_API_KEY');
    if (storedKey && storedKey.length > 10) {
      setApiKey(storedKey);
      setHasApiKey(true);
    }
  }, [activeTab]); // Re-check when tab changes (e.g. returning from Settings)

  // 1. Initialize Configuration from LocalStorage
  const [config, setConfig] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem('sys_config');
    if (saved) {
        const parsed = JSON.parse(saved);
        // Migration: If using old standard codes (6001), update to new custom codes (5111) from DEFAULT_CONFIG
        if (parsed.incomeSubjectCodes && parsed.incomeSubjectCodes.includes('6001')) {
             parsed.incomeSubjectCodes = DEFAULT_CONFIG.incomeSubjectCodes;
             parsed.costSubjectCodes = DEFAULT_CONFIG.costSubjectCodes;
        }
        
        // Merge with default map if specific keys are missing to ensure user has the latest dictionary
        if (!parsed.departmentMap["260003"]) {
            parsed.departmentMap = { ...parsed.departmentMap, ...DEFAULT_CONFIG.departmentMap };
        }
        
        // Ensure entity structure is up to date WITHOUT overwriting IDs
        // Iterate through defaults and patch missing fields in saved entities if ID matches
        const patchedEntities = parsed.entities.map((savedEnt: any) => {
            const defaultEnt = DEFAULT_COMPANIES.find(d => d.id === savedEnt.id);
            if (defaultEnt) {
                return { ...savedEnt, segmentPrefix: savedEnt.segmentPrefix || defaultEnt.segmentPrefix };
            }
            return savedEnt;
        });
        
        // If critical default entities are missing entirely, append them
        DEFAULT_COMPANIES.forEach(def => {
            if (!patchedEntities.some((e: any) => e.id === def.id)) {
                patchedEntities.push(def);
            }
        });
        
        parsed.entities = patchedEntities;
        return parsed;
    }
    return DEFAULT_CONFIG;
  });

  // 2. Initialize Entity ID *AFTER* Config is ready
  const [currentEntityId, setCurrentEntityId] = useState<string>(() => {
     const savedId = localStorage.getItem('last_entity_id');
     // Validate if saved ID exists in the loaded config
     if (savedId && config.entities.some(e => e.id === savedId)) {
         return savedId;
     }
     return config.entities[0].id;
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
      return (
        <div className="flex h-full items-center justify-center space-x-3 text-slate-400">
            <RefreshCw className="animate-spin" />
            <span>正在从本地数据库加载数据...</span>
        </div>
      );
    }

    // Adding key={currentEntityId} forces React to destroy and recreate the component when entity changes.
    // This effectively resets internal state (like filters in BalancePage/LedgerPage) automatically.
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage 
            key={currentEntityId}
            currentEntity={currentEntity} 
            allEntities={config.entities}
            balances={balanceData} 
            ledger={ledgerData} 
            config={config}
            onNavigate={(tab) => handleNavigate(tab)}
            privacyMode={privacyMode} // Pass Privacy Mode
        />;
      case 'balances':
        return <BalancePage 
          key={currentEntityId}
          balances={balanceData} 
          onDrillDown={(code, period) => handleNavigate('ledger', { subjectCode: code, period })}
          config={config}
          currentEntity={currentEntity} 
          privacyMode={privacyMode} // Pass Privacy Mode
        />;
      case 'ledger':
        return <LedgerPage 
          key={currentEntityId}
          data={ledgerData} 
          initialFilter={drillDownFilter}
          config={config}
          currentEntity={currentEntity}
          privacyMode={privacyMode} // Pass Privacy Mode
        />;
      case 'import':
        return <ImportPage 
          key={currentEntityId}
          currentEntity={currentEntity}
          onDataChanged={handleRefreshData}
          config={config}
          importHistory={importHistory}
          onConfigUpdate={setConfig}
        />;
      case 'settings':
        return <SettingsPage config={config} onSave={(newConfig) => setConfig(newConfig)} />; 
      default:
        return <DashboardPage key={currentEntityId} currentEntity={currentEntity} allEntities={config.entities} balances={balanceData} ledger={ledgerData} config={config} onNavigate={(tab) => handleNavigate(tab)} privacyMode={privacyMode} />;
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
            <h1 className="font-bold text-sm tracking-wide">Finance Master</h1>
            <p className="text-[10px] text-slate-500 font-medium">集团财务数据中心 v4.1</p>
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
          <div className="mt-2 px-2 flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${currentEntity.type === 'listed' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                <span className="text-[10px] text-slate-400">{currentEntity.type === 'listed' ? '上市主体' : '非上市主体'}</span>
            </div>
            <span className="text-[9px] font-mono text-slate-600 bg-slate-800 px-1 rounded" title="公司段代码">
              {currentEntity.segmentPrefix}
            </span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavItem icon={<LayoutDashboard size={18} />} label="看板与对账" active={activeTab === 'dashboard'} onClick={() => handleNavigate('dashboard')} />
          <NavItem icon={<TableProperties size={18} />} label="余额表" active={activeTab === 'balances'} onClick={() => handleNavigate('balances')} />
          <NavItem icon={<ListFilter size={18} />} label="明细账" active={activeTab === 'ledger'} onClick={() => handleNavigate('ledger')} />
          <NavItem icon={<Import size={18} />} label="数据导入" active={activeTab === 'import'} onClick={() => handleNavigate('import')} />
          
          <div className="pt-6 pb-2 px-4 text-xs font-bold text-slate-600 uppercase tracking-wider">系统管理</div>
          <NavItem icon={<Settings size={18} />} label="系统参数" active={activeTab === 'settings'} onClick={() => handleNavigate('settings')} />
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
          
          <div className="flex items-center gap-4 md:gap-6">
            
            {/* Privacy Toggle */}
            <button 
                onClick={() => setPrivacyMode(!privacyMode)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${privacyMode ? 'bg-slate-800 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                title={privacyMode ? "退出隐私模式" : "进入隐私模式 (隐藏金额)"}
            >
                {privacyMode ? <EyeOff size={14} /> : <Eye size={14} />}
                <span className="text-xs font-bold hidden lg:inline">{privacyMode ? '已脱敏' : '隐私模式'}</span>
            </button>

            {/* API Key Status Indicator */}
            {hasApiKey ? (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200" title="AI 引擎已就绪">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-[10px] font-bold text-slate-500">AI Ready</span>
                </div>
            ) : (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full border border-red-100 cursor-pointer hover:bg-red-100" onClick={() => setActiveTab('settings')}>
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                    <span className="text-[10px] font-bold text-red-500">AI 未配置</span>
                </div>
            )}

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
