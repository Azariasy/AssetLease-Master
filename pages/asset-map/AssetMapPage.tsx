
import React, { useState } from 'react';
import { AssetInfo, AssetStatus } from '../../types';

interface AssetMapProps {
  assets: AssetInfo[];
}

const AssetMapPage: React.FC<AssetMapProps> = ({ assets }) => {
  const [selectedId, setSelectedId] = useState(assets[0]?.id);
  const activeAsset = assets.find(a => a.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex gap-4 overflow-x-auto pb-2">
        {assets.map(a => (
          <button 
            key={a.id} 
            onClick={() => setSelectedId(a.id)}
            className={`px-6 py-3 rounded-2xl border transition-all font-black text-sm whitespace-nowrap ${
              selectedId === a.id ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-500'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div className="bg-white p-10 rounded-[40px] shadow-sm border border-slate-100 min-h-[500px]">
        <h3 className="text-xl font-black mb-10">资产单元分布可视化</h3>
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-4">
          {Array.from({ length: 30 }).map((_, i) => (
            <div 
              key={i} 
              className={`aspect-square rounded-2xl flex flex-col items-center justify-center transition-all hover:scale-110 cursor-pointer ${
                i % 7 === 0 ? 'bg-red-50 border border-red-100 text-red-600' : 'bg-green-50 border border-green-100 text-green-600'
              }`}
            >
              <span className="text-[10px] font-black">{100 + i}</span>
              <span className="text-[8px] font-bold mt-1 opacity-60">{i % 7 === 0 ? '空置' : '在租'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AssetMapPage;
