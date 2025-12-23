
import React from 'react';
import { Bell } from 'lucide-react';

interface HeaderProps {
  title: string;
}

const Header: React.FC<HeaderProps> = ({ title }) => {
  return (
    <header className="h-28 flex items-center justify-between px-12 border-b border-slate-100 bg-white/50 backdrop-blur-xl sticky top-0 z-20">
      <div>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">{title}</h2>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">系统运行正常 • 实时数据已同步</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <button className="relative w-12 h-12 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-100 transition-all">
          <Bell size={20} />
          <span className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        <div className="h-10 w-[1px] bg-slate-100 mx-2"></div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-black text-slate-900">2024年4月</p>
            <p className="text-[9px] font-bold text-slate-400">决算周期中</p>
          </div>
          <div className="w-12 h-12 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl"></div>
        </div>
      </div>
    </header>
  );
};

export default Header;
