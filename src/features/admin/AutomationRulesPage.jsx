import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { db } from '../../services/mockDatabase';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Cpu, RefreshCw, CheckCircle2, Lock, Clock, AlertCircle, Database } from 'lucide-react';
import toast from 'react-hot-toast';

const AUTOMATION_RULES_META = [
  {
    id: 'AUTO-01',
    name: 'No-Show Grace Auto-Release',
    schedule: 'Every 5 minutes',
    action: 'Automatically marks uncollected reservations as no-show after 15-minute grace period, releases seat, and triggers FIFO waitlist allocation.',
    defaultLastRun: null
  },
  {
    id: 'AUTO-02',
    name: 'Waitlist Auto-Allocation',
    schedule: 'Event-driven + 5-min reconciliation',
    action: 'Instantly allocates released seats to the oldest eligible student in the FIFO waiting queue upon seat checkout or cancellation.',
    defaultLastRun: null
  },
  {
    id: 'AUTO-03',
    name: 'Waitlist Offer Expiration',
    schedule: 'Every 5 minutes',
    action: 'Expires unclaimed seat allocations after 10 minutes and automatically promotes the next student in line.',
    defaultLastRun: null
  },
  {
    id: 'AUTO-04',
    name: 'Occupancy Threshold Alert',
    schedule: 'Event-driven + 5-min check',
    action: 'Monitors reading room occupancy and dispatches urgent notifications to staff when occupancy reaches or exceeds 90%.',
    defaultLastRun: null
  }
];

export default function AutomationRulesPage() {
  const [logs, setLogs] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('automation_execution_logs')
        .select('*')
        .order('started_at', { ascending: false });

      if (!error && data && data.length > 0) {
        const latestMap = {};
        data.forEach(log => {
          if (!latestMap[log.automation_code]) {
            latestMap[log.automation_code] = log;
          }
        });
        setLogs(latestMap);
      }
    } catch {
      /* Fallback to local DB execution log if applicable */
    } finally {
      setLastRefreshed(new Date());
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* PAGE HEADING & CONTROL HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Cpu className="text-indigo-600" size={28} /> Automated Rules & Cron Engine
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-1">
            All essential SeatSync automation jobs are managed securely by the backend and remain permanently enabled.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-slate-100 border-slate-200 text-slate-600 text-xs font-mono px-3 py-1">
            Last Sync: {lastRefreshed.toLocaleTimeString()}
          </Badge>
          <Button onClick={fetchLogs} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold h-9 px-3 rounded-xl border border-slate-300">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Execution Logs
          </Button>
        </div>
      </div>

      {/* SYSTEM PERMANENT AUTOMATION NOTICE */}
      <Card className="border border-emerald-200/80 bg-emerald-50/50 rounded-2xl p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Lock size={16} />
          </div>
          <div className="text-xs">
            <span className="font-extrabold text-emerald-900 block">Backend Managed Execution Engine</span>
            <p className="text-emerald-700 font-medium mt-0.5">
              These jobs run automatically in PostgreSQL via <code className="font-mono bg-emerald-100 px-1 rounded">pg_cron</code>. Manual overrides are disabled to preserve database consistency.
            </p>
          </div>
        </div>
      </Card>

      {/* AUTOMATION CARDS LIST */}
      <div className="space-y-4">
        {AUTOMATION_RULES_META.map(rule => {
          const logData = logs[rule.id];

          return (
            <Card key={rule.id} className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 flex-1 min-w-[280px]">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 font-mono text-[10px] font-bold">
                      {rule.id}
                    </Badge>
                    <h3 className="text-base font-extrabold text-navy">{rule.name}</h3>
                  </div>

                  <p className="text-xs text-slate-600 font-sans leading-relaxed">{rule.action}</p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500 pt-1">
                    <span className="flex items-center gap-1 font-bold text-indigo-600">
                      <Clock size={12} /> Schedule: {rule.schedule}
                    </span>
                    <span>•</span>
                    <span>
                      Last Run: {logData?.started_at ? new Date(logData.started_at).toLocaleString() : 'Awaiting first execution'}
                    </span>
                    <span>•</span>
                    <span>
                      Next Execution: <strong className="text-slate-700">In ~5 mins</strong>
                    </span>
                  </div>

                  {logData && (
                    <div className="flex items-center gap-3 text-[11px] font-mono pt-1">
                      <span className={`font-bold flex items-center gap-1 ${logData.status === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                        {logData.status === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        Result: {logData.status.toUpperCase()}
                      </span>
                      <span>•</span>
                      <span className="text-slate-600">Processed: <strong>{logData.records_processed || 0} records</strong></span>
                    </div>
                  )}
                </div>

                {/* NON-INTERACTIVE PERMANENT STATUS BADGE */}
                <div className="shrink-0 pt-1">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold shadow-xs select-none">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Enabled Automatically</span>
                    <Lock size={12} className="text-emerald-600 ml-0.5" />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
