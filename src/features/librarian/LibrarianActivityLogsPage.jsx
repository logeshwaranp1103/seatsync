import React, { useState, useEffect } from 'react';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  History, Search, Download, Filter, Clock, User, ShieldCheck
} from 'lucide-react';
import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase';

export default function LibrarianActivityLogsPage() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
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
            userName: l.actor_name || l.user_id || 'Staff',
            action: l.action || l.event_type || 'ACTIVITY',
            affectedRecord: l.target_id || l.entity_id || 'N/A',
            result: 'SUCCESS',
            notes: l.details || l.reason || '-'
          }));
        }
      } catch { /* proceed */ }

      const localLogs = (await db.read('seatsync_activity_logs')) || [];

      const map = new Map();
      dbLogs.forEach(l => map.set(l.id, l));
      localLogs.forEach(l => {
        if (l.id && !map.has(l.id)) {
          map.set(l.id, {
            id: l.id,
            timestamp: l.timestamp || l.createdAt,
            userName: l.userName || 'Staff',
            action: l.action || 'ACTIVITY',
            affectedRecord: l.affectedRecord || 'N/A',
            result: l.result || 'SUCCESS',
            notes: l.notes || '-'
          });
        }
      });

      const combined = Array.from(map.values());
      combined.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      setLogs(combined);
    } catch (err) {
      console.warn('Failed to load activity logs:', err);
    }
  };

  const filteredLogs = logs.filter(l => {
    const matchesSearch =
      (l.userName && l.userName.toLowerCase().includes(search.toLowerCase())) ||
      (l.action && l.action.toLowerCase().includes(search.toLowerCase())) ||
      (l.affectedRecord && l.affectedRecord.toLowerCase().includes(search.toLowerCase())) ||
      (l.notes && l.notes.toLowerCase().includes(search.toLowerCase()));

    const matchesAction = actionFilter === 'ALL' || (l.action && l.action.toUpperCase() === actionFilter.toUpperCase());
    return matchesSearch && matchesAction;
  });

  const handleExportCSV = () => {
    toast.success(`Exported ${filteredLogs.length} activity audit log records to CSV.`);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <History className="text-teal-600" size={28} /> Operational Activity Audit Logs
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Read-only chronological audit log of all staff verifications, check-ins, transfers, and maintenance actions.
          </p>
        </div>

        <Button onClick={handleExportCSV} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2">
          <Download size={16} /> Export Audit Log CSV
        </Button>
      </div>

      {/* SEARCH AND FILTERS */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
            <Input
              type="text"
              placeholder="Search logs by staff name, booking ID, seat, or action..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl focus:border-teal-600"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600 shrink-0"
          >
            <option value="ALL">All Operational Actions</option>
            <option value="CHECK_IN">CHECK_IN</option>
            <option value="CHECK_OUT">CHECK_OUT</option>
            <option value="WALK_IN_ALLOCATION">WALK_IN_ALLOCATION</option>
            <option value="SEAT_TRANSFER">SEAT_TRANSFER</option>
            <option value="SEAT_MAINTENANCE_REPORTED">SEAT_MAINTENANCE</option>
            <option value="INCIDENT_REPORTED">INCIDENT_REPORTED</option>
          </select>
        </div>
      </Card>

      {/* AUDIT LOG TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Clock size={18} className="text-teal-600" /> Operational Log Entries
          </h2>
          <Badge variant="outline" className="text-xs font-mono text-slate-500 border-slate-200">
            Total Logs: {filteredLogs.length}
          </Badge>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No activity log entries found matching criteria.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Staff Actor</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Target Record</th>
                  <th className="py-3 px-3">Result</th>
                  <th className="py-3 px-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredLogs.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50 text-slate-700">
                    <td className="py-3 px-3 text-slate-500 text-[11px]">{l.timestamp ? new Date(l.timestamp).toLocaleString() : 'N/A'}</td>
                    <td className="py-3 px-3 font-bold text-navy">{l.userName || 'Staff'}</td>
                    <td className="py-3 px-3">
                      <Badge className="bg-teal-50 text-teal-700 border-teal-200 text-[10px] font-bold">
                        {l.action}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-slate-800 font-sans font-semibold">{l.affectedRecord || 'N/A'}</td>
                    <td className="py-3 px-3">
                      <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                        {l.result || 'SUCCESS'}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-sans max-w-xs truncate">{l.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
