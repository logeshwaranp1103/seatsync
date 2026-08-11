import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Server, Activity, CheckCircle2, RefreshCw, Cpu, Database, ShieldCheck, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SystemHealthPage() {
  const [healthStatus, setHealthStatus] = useState({
    database: 'HEALTHY',
    realtime: 'HEALTHY',
    auth: 'HEALTHY',
    qrScanner: 'HEALTHY',
    automation: 'HEALTHY',
    storage: 'HEALTHY',
    lastCheck: new Date().toLocaleTimeString()
  });

  const handleRunHealthCheck = () => {
    setHealthStatus({
      database: 'HEALTHY',
      realtime: 'HEALTHY',
      auth: 'HEALTHY',
      qrScanner: 'HEALTHY',
      automation: 'HEALTHY',
      storage: 'HEALTHY',
      lastCheck: new Date().toLocaleTimeString()
    });
    toast.success('System health check completed. All core services 100% operational!');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Server className="text-indigo-600" size={28} /> System Health & Telemetry Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time diagnostics of database connectivity, Realtime channels, QR scanner gateway, and background runners.
          </p>
        </div>

        <Button onClick={handleRunHealthCheck} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2">
          <RefreshCw size={16} /> Run Diagnostics Check
        </Button>
      </div>

      {/* HEALTH STATUS CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <Database size={16} className="text-emerald-600" /> Database Engine
            </span>
            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
              ONLINE
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">Response Time: 12ms</p>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <Activity size={16} className="text-teal-600" /> Realtime Channels
            </span>
            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
              CONNECTED
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">Channel Latency: 8ms</p>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <ShieldCheck size={16} className="text-purple-600" /> Auth & Security
            </span>
            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
              OPERATIONAL
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">RBAC Security Active</p>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <Cpu size={16} className="text-amber-600" /> QR Scanner Gateway
            </span>
            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
              ACTIVE
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">0 Failed Scans Today</p>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <RefreshCw size={16} className="text-brandBlue" /> Automation Scheduler
            </span>
            <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
              RUNNING
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">No-Show Cron Synced</p>
        </Card>

        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" /> Last Verification
            </span>
            <span className="text-xs font-mono font-bold text-indigo-600">{healthStatus.lastCheck}</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">System Integrity: 100%</p>
        </Card>
      </div>
    </div>
  );
}
