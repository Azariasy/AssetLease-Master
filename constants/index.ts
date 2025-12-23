import { LeaseContract, AssetInfo, AssetStatus, TrialBalanceRow } from '../types/index';

export const MOCK_CONTRACTS: LeaseContract[] = [
  { 
    id: '1', contractNo: 'HT2024001', tenantName: '中移(成都)产业研究院', 
    assetName: '科研大楼A座', unitCode: '1-5F整租', 
    startDate: '2024-01-01', endDate: '2024-12-31', 
    annualRent: 15000000, monthlyPropertyFee: 28000,
    paymentCycle: '季度', type: '关联方', status: '履行中',
    cumulativeArrears: 0, overdueDays: 0, deposit: 2500000
  },
  { 
    id: '2', contractNo: 'HT2024002', tenantName: '成都某高新科技有限责任公司', 
    assetName: '2号配套用房', unitCode: '101', 
    startDate: '2023-06-01', endDate: '2025-05-31', 
    annualRent: 340000, monthlyPropertyFee: 1500, 
    paymentCycle: '月度', type: '外部单位', status: '即将到期',
    cumulativeArrears: 45000, overdueDays: 12, deposit: 56000
  },
  { 
    id: '3', contractNo: 'HT2023088', tenantName: '中国移动通信集团四川有限公司', 
    assetName: '科研大楼B座', unitCode: 'L3-A', 
    startDate: '2023-01-01', endDate: '2023-12-31', 
    annualRent: 4200000, monthlyPropertyFee: 8500, 
    paymentCycle: '年度', type: '关联方', status: '已超期',
    cumulativeArrears: 1050000, overdueDays: 95, deposit: 700000
  }
];

export const MOCK_ASSETS: AssetInfo[] = [
  { id: 'A1', name: '科研大楼A座', type: '房屋', area: 12000, location: '高新区天府大道', status: AssetStatus.LEASED },
  { id: 'A2', name: '2号配套用房', type: '建筑物', area: 800, location: '高新区中和路', status: AssetStatus.LEASED },
  { id: 'A3', name: '科研大楼B座', type: '房屋', area: 8000, location: '高新区天府大道', status: AssetStatus.LEASED }
];

export const MOCK_FINANCIAL_DATA: TrialBalanceRow[] = [
  { period: '2024-03', subjectCode: '11310301', subjectName: '应收账款-关联方租金', combinationDesc: '非上市主体-租赁事业部', openingBalance: 0, debitAmount: 3750000, creditAmount: 3750000, closingBalance: 0, intercompanyName: '中移产研' },
  { period: '2024-03', subjectCode: '24010101', subjectName: '预收账款-租金', combinationDesc: '非上市主体-租赁事业部', openingBalance: 120000, debitAmount: 40000, creditAmount: 0, closingBalance: 80000, intercompanyName: '外部高新B' },
  { period: '2024-03', subjectCode: '517101', subjectName: '其他业务收入-房屋租赁', combinationDesc: '非上市主体-租赁事业部', openingBalance: 0, debitAmount: 0, creditAmount: 1250000, closingBalance: 1250000, intercompanyName: '' }
];