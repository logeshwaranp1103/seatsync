import React, { useEffect, useState } from 'react';
import { dashboardService } from '../../services/dashboardService';
import { Clock } from 'lucide-react';

export default function LibraryStatusBadge() {
  const [info, setInfo] = useState({
    operatingHours: '08:00 AM – 10:00 PM',
    isClosed: false
  });

  useEffect(() => {
    let isMounted = true;
    const fetchInfo = async () => {
      try {
        const libData = await dashboardService.getLibraryInfo();
        if (isMounted && libData) {
          const now = new Date();
          const hour = now.getHours();
          const isClosed = hour < 8 || hour >= 22;
          setInfo({
            operatingHours: libData.operatingHours || '08:00 AM – 10:00 PM',
            isClosed
          });
        }
      } catch {
        /* fallback to default */
      }
    };
    fetchInfo();
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="inline-flex items-center gap-2 bg-slate-900/80 border border-slate-700/80 rounded-full px-3.5 py-1.5 backdrop-blur-md shadow-inner text-xs font-semibold text-slate-200">
      <span className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${info.isClosed ? 'bg-red-400' : 'bg-emerald-400'}`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${info.isClosed ? 'bg-red-500' : 'bg-emerald-500'}`} />
      </span>
      <span className="font-bold text-white">
        {info.isClosed ? 'Library Closed' : 'Library Open'}
      </span>
      <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1 border-l border-slate-700 pl-2 ml-1">
        <Clock size={11} className="text-slate-400" />
        {info.operatingHours}
      </span>
    </div>
  );
}
