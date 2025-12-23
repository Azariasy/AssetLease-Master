
import React, { useState } from 'react';
import { AssetInfo, AssetStatus, AssetUnit } from '../types';

interface AssetMapProps {
  assets: AssetInfo[];
}

const AssetMap: React.FC<AssetMapProps> = ({ assets }) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string>(assets[0]?.id || '');
  const [viewMode, setViewMode] = useState<'status' | 'health'>('status');

  const activeAsset = assets.find(a => a.id === selectedAssetId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {assets.map(asset => (
            <button
              key={asset.id}
              onClick={() => setSelectedAssetId(asset.id)}
              className={`flex-shrink-0 px-6 py-3 rounded-2xl border transition-all ${
                selectedAssetId === asset.id 
                ? 'bg-blue-600 border-blue-600 text-white shadow-lg' 
                : 'bg-white border-gray-100 text-gray-600'
              }`}
            >
              <span className="font-black text-sm">{asset.name}</span>
            </button>
          ))}
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button 
            onClick={() => setViewMode('status')}
            className={`px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all ${viewMode === 'status' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
          >
            出租状态
          </button>
          <button 
            onClick={() => setViewMode('health')}
            className={`px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all ${viewMode === 'health' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
          >
            经济健康度
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-black text-gray-900">
              {viewMode === 'status' ? '单元布局热力图' : '物业利润/亏损分布图'}
            </h3>
            <div className="flex gap-4 text-[10px] font-bold">
               {viewMode === 'status' ? (
                 <>
                   <span className="flex items-center gap-1.5"><i className="w-3 h-3 bg-green-100 border border-green-200 rounded"></i> 已出租</span>
                   <span className="flex items-center gap-1.5"><i className="w-3 h-3 bg-red-50 border border-red-100 rounded"></i> 空置</span>
                 </>
               ) : (
                 <>
                   <span className="flex items-center gap-1.5"><i className="w-3 h-3 bg-blue-100 rounded"></i> 高收益</span>
                   <span className="flex items-center gap-1.5"><i className="w-3 h-3 bg-red-100 rounded"></i> 利润倒挂</span>
                 </>
               )}
            </div>
          </div>

          <div className="space-y-8">
            {[5, 4, 3, 2, 1].map(floor => (
              <div key={floor} className="flex gap-4 items-center">
                <div className="w-10 text-xs font-black text-gray-400 italic">{floor}F</div>
                <div className="flex-1 grid grid-cols-5 md:grid-cols-8 gap-3">
                  {activeAsset?.units?.filter(u => u.floor === floor).map((unit, idx) => {
                    // 模拟部分关联方单元利润倒挂 (如中移成都负853万痛点)
                    const isDeficit = viewMode === 'health' && floor === 1 && idx < 2;
                    
                    return (
                      <div 
                        key={unit.id}
                        className={`group relative h-16 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 ${
                          viewMode === 'status' 
                            ? (unit.status === AssetStatus.LEASED ? 'bg-green-50 border border-green-100 text-green-700' : 'bg-red-50 border border-red-100 text-red-700')
                            : (isDeficit ? 'bg-red-100 border border-red-300 text-red-800 animate-pulse' : 'bg-blue-50 border border-blue-100 text-blue-700')
                        }`}
                      >
                        <span className="text-xs font-black">{unit.code}</span>
                        {isDeficit && <span className="text-[8px] font-bold">亏损单元</span>}
                        
                        <div className="absolute bottom-full mb-2 hidden group-hover:block z-50 w-48 bg-slate-900 text-white p-3 rounded-xl shadow-2xl text-[10px]">
                          <p className="font-bold text-blue-400 mb-1">单元：{unit.code}</p>
                          <p>承租方：{unit.tenant || '无'}</p>
                          {viewMode === 'health' && (
                            <p className={`font-bold ${isDeficit ? 'text-red-400' : 'text-green-400'}`}>
                              物业利润率：{isDeficit ? '-12.5%' : '+22.1%'}
                            </p>
                          )}
                          <p>月租金: ¥{(unit.rentPerSqm * unit.area * 30 / 10000).toFixed(1)}W</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl">
             <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">资产运营分析</h4>
             <div className="space-y-4">
                <div className="flex justify-between text-xs">
                  <span className="opacity-60">关联方占用率</span>
                  <span className="font-black text-blue-400">92.4%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="opacity-60">异常预收差异数</span>
                  <span className="font-black text-red-400">12 笔</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetMap;
