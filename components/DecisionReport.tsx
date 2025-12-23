
import React from 'react';
import { AnalysisResult } from '../types';
import { Brain, AlertCircle, TrendingUp, CheckCircle, ShieldAlert, Zap } from 'lucide-react';

interface DecisionReportProps {
  analysis: AnalysisResult | null;
  isAnalyzing: boolean;
  onStartAnalysis: () => void;
}

const DecisionReport: React.FC<DecisionReportProps> = ({ analysis, isAnalyzing, onStartAnalysis }) => {
  if (isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
          <Brain className="absolute inset-0 m-auto text-blue-500 w-10 h-10 animate-pulse" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-black text-slate-800">AI 首席财务官正在研判...</h3>
          <p className="text-slate-400 text-sm mt-2 font-medium">深度扫描 120+ 份合同要素与 30,000+ 财务科目流水</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="bg-white border-2 border-dashed border-slate-200 rounded-[40px] p-20 text-center">
        <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-blue-600">
          <Zap size={40} />
        </div>
        <h3 className="text-2xl font-black text-slate-800">尚未生成智能经营报告</h3>
        <p className="text-slate-400 text-sm mt-3 mb-10 max-w-md mx-auto">
          点击下方按钮，我们将整合当前所有合同数据、财务明细以及资产利用情况，为您出具一份具有战略指导意义的经营月报。
        </p>
        <button 
          onClick={onStartAnalysis}
          className="bg-blue-600 text-white px-10 py-4 rounded-2xl font-black shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95"
        >
          立即生成 AI 深度分析
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：核心摘要与风险 */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-10 rounded-[40px] shadow-sm border border-slate-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><TrendingUp /></div>
              <h3 className="text-2xl font-black">经营摘要</h3>
            </div>
            <p className="text-slate-600 leading-relaxed text-lg font-medium">
              {analysis.summary}
            </p>
          </div>

          <div className="bg-red-50 p-10 rounded-[40px] border border-red-100">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-red-100 rounded-2xl text-red-600"><ShieldAlert /></div>
              <h3 className="text-2xl font-black text-red-900">核心风险预警</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {analysis.risks.map((risk, i) => (
                <div key={i} className="flex gap-4 items-start bg-white p-6 rounded-3xl shadow-sm border border-red-50">
                  <AlertCircle className="text-red-500 flex-shrink-0 mt-1" size={20} />
                  <p className="text-sm font-bold text-slate-700">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：关键 KPI 与 建议 */}
        <div className="space-y-8">
           <div className="bg-slate-900 p-8 rounded-[40px] shadow-2xl text-white">
              <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-8">AI 指标看板</h3>
              <div className="space-y-6">
                 {(analysis as any).kpiIndicators?.map((kpi: any, i: number) => (
                   <div key={i} className="flex justify-between items-end border-b border-slate-800 pb-4">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">{kpi.label}</p>
                        <p className="text-2xl font-black mt-1">{kpi.value}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        kpi.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-orange-500/10 text-orange-400'
                      }`}>{kpi.status === 'success' ? '健康' : '待优化'}</span>
                   </div>
                 ))}
              </div>
           </div>

           <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
              <h3 className="text-xl font-black mb-6 flex items-center gap-2">
                <CheckCircle className="text-emerald-500" /> 管理建议
              </h3>
              <ul className="space-y-4">
                {analysis.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-3 text-sm font-bold text-slate-600">
                    <span className="text-blue-500">•</span> {rec}
                  </li>
                ))}
              </ul>
           </div>
        </div>
      </div>
    </div>
  );
};

export default DecisionReport;
