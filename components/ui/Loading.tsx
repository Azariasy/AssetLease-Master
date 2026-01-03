
import React from 'react';
import { Loader2 } from 'lucide-react';

export const PageLoading = ({ message = "加载模块中..." }: { message?: string }) => (
  <div className="h-full w-full flex flex-col items-center justify-center min-h-[400px] text-slate-400 animate-in fade-in duration-300">
    <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center">
        <Loader2 size={32} className="animate-spin text-indigo-500 mb-3" />
        <span className="text-xs font-bold">{message}</span>
    </div>
  </div>
);
