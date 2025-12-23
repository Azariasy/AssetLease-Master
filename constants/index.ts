
import { LeaseContract, AssetInfo, AssetStatus } from '../types';

export const MOCK_CONTRACTS: LeaseContract[] = [
  { 
    id: '1', contractNo: 'HT2024001', tenantName: '中移(成都)产业研究院', 
    assetName: '科研大楼A座', unitCode: '1-5F整租', 
    startDate: '2024-01-01', endDate: '2024-12-31', 
    annualRent: 15000000, monthlyPropertyFee: 28000,
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
  }
];

export const MOCK_ASSETS: AssetInfo[] = [
  { id: 'A1', name: '科研大楼A座', type: '房屋', area: 12000, location: '高新区天府大道', status: AssetStatus.LEASED },
  { id: 'A2', name: '2号配套用房', type: '建筑物', area: 800, location: '高新区中和路', status: AssetStatus.LEASED }
];
