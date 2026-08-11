import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { ShieldCheck, RefreshCw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

import { supabase } from '../../lib/supabase';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      setLoading(true);

      // 1. Fetch real Supabase audit logs
      let dbLogs = [];
      try {
        const { data, error } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          dbLogs = data.map(l => ({
            id: l.id,
            timestamp: l.created_at || l.timestamp,
            userId: l.actor_id || l.user_id || l.userId || 'SYSTEM',
            action: l.action || l.event_type || 'ACTIVITY',
            entityId: l.target_id || l.entity_id || l.entityId || 'N/A'
          }));
        }
      } catch { /* proceed */ }

      // 2. Fetch local activity logs
      const localLogs = (await db.read('seatsync_activity_logs')) || [];

      // Merge and deduplicate
      const map = new Map();
      dbLogs.forEach(l => map.set(l.id, l));
      localLogs.forEach(l => {
        if (l.id && !map.has(l.id)) {
          map.set(l.id, {
            id: l.id,
            timestamp: l.timestamp || l.createdAt,
            userId: l.userId || 'SYSTEM',
            action: l.action || 'ACTIVITY',
            entityId: l.entityId || 'N/A'
          });
        }
      });

      const combined = Array.from(map.values());
      combined.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      setLogs(combined);
    } catch {
      toast.error('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchLogs();
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">System Audit & Security Logs</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Immutable log trail tracking login authentication, checkout requests, and staff overrides.
          </p>
        </div>

        <Button onClick={fetchLogs} variant="outline" className="text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh Audit Trail
        </Button>
      </div>

      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading audit trail...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No activity logs recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5">User ID</th>
                    <th className="p-3.5">Action Code</th>
                    <th className="p-3.5">Target Entity ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-slate-50 transition-colors font-mono">
                      <td className="p-3.5 text-slate-500">{log.timestamp ? format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss') : '—'}</td>
                      <td className="p-3.5 font-bold text-navy">{log.userId}</td>
                      <td className="p-3.5 font-bold text-indigo-600">{log.action}</td>
                      <td className="p-3.5 text-slate-600">{log.entityId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
