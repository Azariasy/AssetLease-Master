
import React, { useState, useMemo } from 'react';
import { 
  ReceivablePlan, TrialBalanceRow, UtilityRecord, SubjectBalanceRow, SystemConfig 
} from '../types';
import { 
  CheckCircle2, AlertCircle, Upload, Settings, FileSpreadsheet, 
  ArrowRight, BarChart3, LineChart as LineChartIcon, ListFilter 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

// 模拟读取 Excel/CSV 内容
const mockParseFile = (file: File): Promise<any[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { 
          '凭证编号': 'V-NEW-001', 'GL期间': '2025-01', '有效日期': '2025-01-15', 
          '行说明': '20250101001 || 收取1月租金', '账户': '01.00.00.00.5001.01.00', 
          '原币贷项': '120000', '科目段说明': '经营租赁收入', '往来段说明': '外部租户A' 
        },
        { 
          '凭证编号': 'V-NEW-002', 'GL期间': '2025-02', '有效日期': '2025-02-20', 
          '行说明': '物业费季度付', '账户': '01.00.00.00.6001.01.00', 
          '原币贷项': '34500.50', '科目段说明': '物业管理收入', '往来段说明': '外部租户B' 
        }
      ]);
    }, 1000);
  });
};

interface FinancePageProps {
  plans: ReceivablePlan[];
  ledger: TrialBalanceRow[];
  subjectBalances: SubjectBalanceRow[];
  utilities: UtilityRecord[];
  config: SystemConfig;
  onLedgerUpdate?: (rows: TrialBalanceRow[]) => void;
  onSubjectBalanceUpdate?: (rows: SubjectBalanceRow[]) => void;
}

const FinancePage = ({ plans, ledger, subjectBalances, utilities, config, onLedgerUpdate }: FinancePageProps) => {
  const [view, setView] = useState<'analysis' | 'ledger' | 'import'>('analysis');

  return (
    <div className="space-y-6">
      {/* Sub Navigation */}
      <div className="flex gap-4 border-b border-slate-200 pb-1 justify-between items-center">
        <div className="flex gap-4">
          <button 
            onClick={() => setView('analysis')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
              view === 'analysis' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <BarChart3 size={16} />
            科目分析 (发生额/余额)
          </button>
          <button 
            onClick={() => setView('ledger')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
              view === 'ledger' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ListFilter size={16} />
            明细与对账
          </button>
        </div>
        <button 
          onClick={() => setView('import')}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition"
        >
          <Upload size={14} />
          导入报表
        </button>
      </div>

      {view === 'analysis' && <AnalysisView ledger={ledger} subjectBalances={subjectBalances} config={config} />}
      {view === 'ledger' && <ReconciliationView plans={plans} ledger={ledger} />}
      {view === 'import' && <ImportView onImport={(rows) => {
        if(onLedgerUpdate) onLedgerUpdate(rows);
        setView('ledger'); 
      }} />}
    </div>
  );
};

// ============================================================================
// 1. Analysis View (New Requirement: Analyze Subject Balances & Transactions)
// ============================================================================
const AnalysisView = ({ ledger, subjectBalances, config }: { ledger: TrialBalanceRow[], subjectBalances: SubjectBalanceRow[], config: SystemConfig }) => {
  const [mode, setMode] = useState<'income_trend' | 'balance_sheet'>('income_trend');
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');

  // 1. 聚合发生额 (基于 Ledger 明细)
  const monthlyStats = useMemo(() => {
    const stats: Record<string, number> = {};
    const periods = Array.from(new Set(ledger.map(r => r.period))).sort();
    
    periods.forEach(p => {
      const amount = ledger
        .filter(r => r.period === p && config.incomeSubjectCodes.some(code => r.subjectCode.startsWith(code)))
        .reduce((sum, r) => sum + r.creditAmount, 0);
      stats[p] = amount;
    });

    return periods.map(p => ({ period: p, amount: stats[p] }));
  }, [ledger, config]);

  // 2. 科目列表 (用于筛选)
  const subjects = useMemo(() => Array.from(new Set(ledger.map(r => `${r.subjectCode} - ${r.subjectName}`))), [ledger]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-xs text-slate-400 font-bold uppercase">本年累计收入 (贷方)</p>
          <p className="text-2xl font-black text-slate-900 mt-2">
            ¥ {ledger.reduce((sum, r) => config.incomeSubjectCodes.includes(r.subjectCode) ? sum + r.creditAmount : sum, 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
           <p className="text-xs text-slate-400 font-bold uppercase">最大单月入账</p>
           <p className="text-2xl font-black text-blue-600 mt-2">
             ¥ {Math.max(...monthlyStats.map(s => s.amount), 0).toLocaleString()}
           </p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
           <p className="text-xs text-slate-400 font-bold uppercase">活跃业务科目数</p>
           <p className="text-2xl font-black text-emerald-600 mt-2">{subjects.length}</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <LineChartIcon size={20} className="text-blue-500"/>
            会计期间发生额分析
          </h3>
          <select 
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm outline-none"
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
          >
            <option value="ALL">全部收入科目</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyStats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip formatter={(val: number) => `¥${val.toLocaleString()}`} />
              <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} name="贷方发生额" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-sm text-slate-700">科目余额与发生额明细 (Balance Sheet View)</h3>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase">
            <tr>
              <th className="px-6 py-3">期间</th>
              <th className="px-6 py-3">科目</th>
              <th className="px-6 py-3 text-right">期初余额</th>
              <th className="px-6 py-3 text-right">本期借方</th>
              <th className="px-6 py-3 text-right">本期贷方</th>
              <th className="px-6 py-3 text-right">期末余额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subjectBalances.length > 0 ? subjectBalances.map(row => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 font-mono text-slate-600">{row.period}</td>
                <td className="px-6 py-3 font-medium">
                  <span className="text-slate-400 mr-2">{row.subjectCode}</span>
                  {row.subjectName}
                </td>
                <td className="px-6 py-3 text-right text-slate-500">{row.openingBalance.toLocaleString()}</td>
                <td className="px-6 py-3 text-right text-slate-900">{row.debitPeriod.toLocaleString()}</td>
                <td className="px-6 py-3 text-right text-blue-600 font-bold">{row.creditPeriod.toLocaleString()}</td>
                <td className="px-6 py-3 text-right font-bold">{row.closingBalance.toLocaleString()}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  暂无科目余额数据，请点击右上角“导入报表”上传科目余额表。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// 2. Import View (Cleaned Up)
// ============================================================================
const ImportView = ({ onImport }: { onImport: (rows: TrialBalanceRow[]) => void }) => {
  const [step, setStep] = useState(1); 
  const [parsedRows, setParsedRows] = useState<TrialBalanceRow[]>([]);

  const handleFile = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rows = await mockParseFile(file);
    
    // Fix: manually map mock data to TrialBalanceRow structure
    const parsed: TrialBalanceRow[] = rows.map((r: any, idx: number) => ({
      id: `imp-${idx}`,
      voucherNo: r['凭证编号'] || '',
      period: r['GL期间'] || '',
      date: r['有效日期'] || '',
      summary: r['行说明'] || '',
      subjectCode: r['账户'] ? r['账户'].split('.')[4] : '', // Extract subject segment (index 4)
      subjectName: r['科目段说明'] || '',
      debitAmount: r['原币借项'] ? parseFloat(String(r['原币借项']).replace(/,/g, '')) : 0,
      creditAmount: r['原币贷项'] ? parseFloat(String(r['原币贷项']).replace(/,/g, '')) : 0,
      counterparty: r['往来段说明'] || ''
    }));

    setParsedRows(parsed);
    setStep(2);
  };

  return (
    <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm min-h-[500px]">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-xl font-bold text-slate-800">导入账户明细报表</h3>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className={step === 1 ? "text-blue-600 font-bold" : ""}>1. 上传文件</span>
          <ArrowRight size={14} />
          <span className={step === 2 ? "text-blue-600 font-bold" : ""}>2. 预览与确认</span>
        </div>
      </div>

      {step === 1 && (
        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center hover:bg-slate-50 transition cursor-pointer relative">
          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile} />
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
            <FileSpreadsheet size={32} />
          </div>
          <p className="text-lg font-bold text-slate-700">点击上传文件 (.csv / .xlsx)</p>
          <p className="text-sm text-slate-400 mt-2">支持账户明细表、科目余额表</p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-2 text-blue-700 text-sm">
             <CheckCircle2 size={16} />
             <span>解析成功！共识别 {parsedRows.length} 条记录，其中收入类记录 {parsedRows.filter(r=>r.creditAmount>0).length} 条。</span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-96">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-500 font-bold text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-3">凭证号</th>
                  <th className="px-4 py-3">期间</th>
                  <th className="px-4 py-3">科目</th>
                  <th className="px-4 py-3 text-right">借方</th>
                  <th className="px-4 py-3 text-right">贷方</th>
                  <th className="px-4 py-3">摘要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 font-mono">{row.voucherNo}</td>
                    <td className="px-4 py-3 font-mono">{row.period}</td>
                    <td className="px-4 py-3 font-mono">{row.subjectCode}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{row.debitAmount > 0 ? row.debitAmount : '-'}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">{row.creditAmount > 0 ? row.creditAmount : '-'}</td>
                    <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">{row.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-4 pt-4">
             <button onClick={() => setStep(1)} className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">
               重选
             </button>
             <button 
               onClick={() => onImport(parsedRows)}
               className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg"
             >
               确认导入
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. Ledger/Reconciliation View (Existing Logic)
// ============================================================================
const ReconciliationView = ({ plans, ledger }: { plans: ReceivablePlan[], ledger: TrialBalanceRow[] }) => {
  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
         <h3 className="font-bold text-sm text-slate-700">合同入账跟踪 (Plan vs Actual)</h3>
         <div className="flex gap-2">
            <span className="text-xs px-2 py-1 bg-slate-100 rounded text-slate-500">明细总数: {ledger.length}</span>
         </div>
      </div>
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase">
          <tr>
            <th className="px-6 py-4">合同/期间</th>
            <th className="px-6 py-4 text-right">应收 (计划)</th>
            <th className="px-6 py-4 text-right">实收 (已匹配)</th>
            <th className="px-6 py-4 text-right">差额</th>
            <th className="px-6 py-4">入账凭证来源</th>
            <th className="px-6 py-4 text-center">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {plans.map(p => {
            const diff = p.planAmount - p.matchedAmount;
            return (
              <tr key={p.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <div className="font-mono text-slate-600">{p.period}</div>
                  <div className="text-xs text-slate-400">{p.type}</div>
                </td>
                <td className="px-6 py-4 text-right font-mono">¥{p.planAmount.toLocaleString()}</td>
                <td className="px-6 py-4 text-right font-mono text-slate-600">¥{p.matchedAmount.toLocaleString()}</td>
                <td className="px-6 py-4 text-right font-mono">
                  {diff > 0.01 ? <span className="text-red-500 font-bold">-{diff.toLocaleString()}</span> : <span className="text-emerald-400">-</span>}
                </td>
                <td className="px-6 py-4 text-xs text-slate-500">
                  {p.matchDetail ? (
                    <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded">
                      {p.matchDetail.matchType}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-6 py-4 text-center">
                  {p.status === '已平' ? <CheckCircle2 size={16} className="mx-auto text-emerald-500"/> : <AlertCircle size={16} className="mx-auto text-red-500"/>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default FinancePage;
