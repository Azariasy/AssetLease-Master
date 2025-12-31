
// 公司实体
export interface Company {
  id: string;
  name: string;
  type: 'listed' | 'non-listed'; // 上市 | 非上市
  matchedNameInOtherBooks?: string; // 在对方账套里的名称 (用于对账)
  segmentPrefix?: string; // 公司段代码 (e.g. 391310)
}

// 系统配置
export interface SystemConfig {
  mappingTemplates: MappingTemplate[];
  incomeSubjectCodes: string[]; // 收入类科目 (e.g., 6001)
  costSubjectCodes: string[];   // 成本费用类科目 (e.g., 6401, 6602)
  accountSegmentIndex: number;
  subAccountSegmentIndex: number;
  departmentMap: Record<string, string>;
  
  // New: 关联方配置
  entities: Company[];
}

// 字段映射模板
export interface MappingTemplate {
  id: string;
  name: string; 
  type: 'ledger' | 'balance'; 
  columnMap: Record<string, string>; 
}

// 导入历史记录
export interface ImportHistoryItem {
  id: string;
  entityId: string; // 所属主体
  fileName: string;
  importDate: string; 
  recordCount: number;
  type: 'ledger' | 'balance';
  status: 'success' | 'failed';
}

// 1. 财务流水 (账户明细表)
export interface LedgerRow {
  id?: string | number;
  entityId?: string;
  importId?: string; // Batch ID for rollback

  voucherNo: string;      
  date: string;           
  period: string;         // YYYY-MM
  summary: string;        
  
  subjectCode: string;     
  subjectName: string;     
  department?: string;     // Department Code
  departmentName?: string; // Department Name (New)

  // New Dimensions
  projectCode?: string;
  projectName?: string;
  subAccountCode?: string;
  subAccountName?: string;

  debitAmount: number;    
  creditAmount: number;   

  counterparty?: string;   
  counterpartyCode?: string; // New: Separated Code
  counterpartyName?: string; // New: Separated Name
  rawReference?: string;   
}

// 2. 科目余额表行
export interface BalanceRow {
  id?: string | number;
  entityId?: string;
  importId?: string; // Batch ID for rollback

  period: string;        
  subjectCode: string;   
  subjectName: string;   
  
  accountElement?: string; 
  
  // Dimensions - Extended
  costCenter?: string;     // Usually Name
  costCenterCode?: string; 
  costCenterName?: string;
  
  counterparty?: string;   // Usually combined or Name
  counterpartyCode?: string;
  counterpartyName?: string;

  projectCode?: string;
  projectName?: string;
  
  subAccountCode?: string;
  subAccountName?: string;

  // Monthly / Period amounts (当期发生)
  openingBalance: number; 
  debitPeriod: number;    
  creditPeriod: number;   
  closingBalance: number; 

  // YTD (Year to Date) & Last Year comparisons (parsed from specific columns)
  // 用于计算准确的年度净发生额
  ytdDebit?: number;      // 本年借方累计
  ytdCredit?: number;     // 本年贷方累计
  lastYearDebit?: number; // 上年同期借方 (累计/余额)
  lastYearCredit?: number; // 上年同期贷方 (累计/余额)
  
  // New: 上年同期期末余额
  lastYearClosingBalance?: number; 
}

// Aliases for FinancePage compatibility
export type TrialBalanceRow = LedgerRow;
export type SubjectBalanceRow = BalanceRow;

// --- Analysis Types ---

export interface AnalysisResult {
  summary: string;
  risks: string[];
  recommendations: string[];
  kpiIndicators: Array<{
    label: string;
    value: string;
    status: string;
  }>;
}

// --- Additional Types and Enums for Extended UI Components ---

export enum PartnerType {
  RELATED = 'related',
  EXTERNAL = 'external'
}

export enum AssetStatus {
  LEASED = '已出租',
  VACANT = '空置',
  MAINTENANCE = '维修/自用'
}

export interface LeaseContract {
  id: string;
  contractNo: string;
  name: string;
  tenantName: string;
  partnerType: PartnerType;
  type: string;
  startDate: string;
  endDate: string;
  unitIds: string[];
  rentAmount: number;
  propertyFee: number;
  paymentCycle: '月度' | '季度' | '年度' | '一次性';
  status: string;
  aiAnalysis?: string;
}

export interface AssetUnit {
  id: string;
  code: string;
  building: string;
  floor: number;
  area: number;
  status: AssetStatus | string;
}

export interface ReceivablePlan {
  id: string;
  period: string;
  type: string;
  planAmount: number;
  matchedAmount: number;
  status: string;
  matchDetail?: {
    matchType: string;
  };
}

export interface UtilityRecord {
  id: string;
  period: string;
  type: string;
  amount: number;
}
