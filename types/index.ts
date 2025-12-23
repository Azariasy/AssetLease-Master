
export enum AssetStatus {
  LEASED = '已出租',
  VACANT = '空置',
  WARNING = '即将到期',
  MAINTENANCE = '维修中'
}

export interface LeaseContract {
  id: string;
  contractNo: string;
  tenantName: string;
  assetName: string;
  unitCode: string; 
  startDate: string;
  endDate: string;
  annualRent: number;
  monthlyPropertyFee: number;
  paymentCycle: '月度' | '季度' | '年度';
  type: '关联方' | '外部单位';
  status: '履行中' | '即将到期' | '已超期';
  cumulativeArrears: number;
  overdueDays: number;
  deposit?: number; // 押金
}

export interface TrialBalanceRow {
  period: string;
  subjectCode: string;
  subjectName: string;
  combinationDesc: string;
  openingBalance: number;
  debitAmount: number;
  creditAmount: number;
  closingBalance: number;
  intercompanyName: string;
}

export interface AssetUnit {
  id: string;
  code: string;
  floor: number;
  area: number;
  status: AssetStatus;
  rentPerSqm: number;
  tenant?: string;
  contractId?: string;
}

export interface AssetInfo {
  id: string;
  name: string;
  type: '房屋' | '建筑物' | '配套设施';
  area: number;
  location: string;
  status: AssetStatus;
  units?: AssetUnit[];
}

export interface AnalysisResult {
  summary: string;
  risks: string[];
  recommendations: string[];
  kpiIndicators?: { label: string; value: string; status: 'success' | 'warning' | 'error' }[];
}
