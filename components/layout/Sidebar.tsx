
import React from 'react';
import { 
  LayoutDashboard, 
  Map, 
  FileText, 
  Scale, 
  Database, 
  Sparkles, 
  LogOut, 
  User 
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const navItems = [
    { id: 'dashboard', label: '经营看板', icon: <LayoutDashboard size={20} /> },
    { id: 'assets', label: '资产地图', icon: <Map size={20} /> },
    { id: 'ledger', label: '合同台账', icon: <FileText size={20} /> },
    { id: 'recon', label: '财务对账', icon: <Scale size={20} /> },
    { id: 'import', label: '数据中心', icon: <Database size={20} /> },
    { id: 'analysis', label: '决策报告', icon: <Sparkles size={20} /> },
  ];

  return (
    <aside className="w-80 bg-slate-900 text-slate-300 flex flex-col fixed h-full z-30">
      <div className="p-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-900/40">
            AL
          </div>
          <div>
            <h1 className="text-white font-black text-lg tracking-tight leading-none">AssetLease</h1>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1 block">Management AI</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-6 space-y-2 mt-4">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-bold text-sm transition-all ${
              activeTab === item.id 
              ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/50' 
              : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-8 border-t border-slate-800 m-6 bg-slate-800/50 rounded-[32px]">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center text-slate-400">
            <User size={20} />
          </div>
          <div>
            <p className="text-xs font-black text-white">管理员 (财务部)</p>
            <p className="text-[10px] text-slate-500 font-bold">非上市主体</p>
          </div>
        </div>
        <button className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-red-400 transition-colors">
          <LogOut size={14} /> 退出系统
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
