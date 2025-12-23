
import { LeaseContract, AssetInfo, LedgerEntry, AssetStatus } from './types';

export const MOCK_CONTRACTS: LeaseContract[] = [
  { 
    id: '1', contractNo: 'HT2024001', tenantName: '中移(成都)产业研究院', 
    assetName: '科研大楼A座', unitCode: '1-5F整租', 
    startDate: '2024-01-01', endDate: '2024-12-31', 
    annualRent: 15000000, monthlyPropertyFee: 28000, // 体现级差
    paymentCycle: '季度', type: '关联方', status: '履行中',
    cumulativeArrears: 0, overdueDays: 0
  },
  { 
    id: '2', contractNo: 'HT2024002', tenantName: '外部高新科技B', 
    assetName: '2号配套用房', unitCode: '101', 
    startDate: '2023-06-01', endDate: '2025-05-31', 
    annualRent: 340000, monthlyPropertyFee: 1500, 
    paymentCycle: '月度', type: '外部单位', status: '即将到期',
    cumulativeArrears: 45000, overdueDays: 12
  },
  { 
    id: '3', contractNo: 'HT2023050', tenantName: '咪咕音乐有限公司', 
    assetName: '科研大楼B座', unitCode: '3F-A区', 
    startDate: '2023-01-01', endDate: '2023-12-31', 
    annualRent: 1200000, monthlyPropertyFee: 5000, 
    paymentCycle: '年度', type: '关联方', status: '已超期',
    cumulativeArrears: 120000, overdueDays: 85
  },
];

export const MOCK_ASSETS: AssetInfo[] = [
  { id: 'A1', name: '科研大楼A座', type: '房屋', area: 12000, location: '高新区天府大道', status: AssetStatus.LEASED },
  { id: 'A2', name: '2号配套用房', type: '建筑物', area: 800, location: '高新区中和路', status: AssetStatus.LEASED },
  { id: 'A3', name: '科研大楼B座', type: '房屋', area: 8000, location: '高新区天府大道', status: AssetStatus.LEASED },
];

export const MOCK_LEDGER: LedgerEntry[] = [
  { id: 'L1', date: '2024-03-31', voucherNo: '记-045', subjectCode: '113103', subjectName: '应收账款-关联方', summary: '收中移产研租金', debit: 0, credit: 3750000, balance: 0 },
  { id: 'L2', date: '2024-04-10', voucherNo: '记-012', subjectCode: '517113', subjectName: '其他业务收入-租赁', summary: '计提4月科技公司B租金', debit: 28333, credit: 0, balance: 28333 },
];
