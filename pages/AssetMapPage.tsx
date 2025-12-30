
import React from 'react';
import { AssetUnit, AssetStatus } from '../types';

const AssetMapPage = ({ assets }: { assets: AssetUnit[] }) => {
  // Group by Building and Floor
  const buildings = Array.from(new Set(assets.map(a => a.building)));

  const getStatusColor = (status: AssetStatus | string) => {
    switch (status) {
      case AssetStatus.LEASED: return 'bg-emerald-50 border-emerald-200 text-emerald-700';
      case AssetStatus.VACANT: return 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-white hover:border-blue-300 hover:text-blue-600';
      case AssetStatus.MAINTENANCE: return 'bg-orange-50 border-orange-200 text-orange-600';
      default: return 'bg-gray-100 text-gray-400';
    }
  };

  return (
    <div className="space-y-8">
      {buildings.map(building => {
        const buildingAssets = assets.filter(a => a.building === building);
        const floors = Array.from(new Set(buildingAssets.map(a => a.floor))).sort((a, b) => b - a); // Top down

        return (
          <div key={building} className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
              {building}
            </h3>
            
            <div className="space-y-6">
              {floors.map(floor => (
                <div key={floor} className="flex gap-6">
                  <div className="w-16 flex-shrink-0 flex flex-col justify-center items-center bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-2xl font-black text-slate-300">{floor}F</span>
                  </div>
                  
                  <div className="flex-1 grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                    {buildingAssets.filter(a => a.floor === floor).map(unit => (
                      <div 
                        key={unit.id}
                        className={`aspect-[4/3] rounded-xl border-2 flex flex-col items-center justify-center p-2 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg ${getStatusColor(unit.status)}`}
                      >
                        <span className="text-lg font-black">{unit.code}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-80">
                          {unit.status}
                        </span>
                        <span className="text-[9px] mt-1 font-mono opacity-60">{unit.area}㎡</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex gap-6 justify-center pt-8">
        <LegendItem color="bg-emerald-50 border-emerald-200" label="已出租 (产生收益)" />
        <LegendItem color="bg-slate-50 border-slate-200" label="空置 (待招租)" />
        <LegendItem color="bg-orange-50 border-orange-200" label="维修/自用" />
      </div>
    </div>
  );
};

const LegendItem = ({ color, label }: any) => (
  <div className="flex items-center gap-2">
    <div className={`w-4 h-4 rounded-md border-2 ${color}`}></div>
    <span className="text-sm font-medium text-slate-500">{label}</span>
  </div>
);

export default AssetMapPage;