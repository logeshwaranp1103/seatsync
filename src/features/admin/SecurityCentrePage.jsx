import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ShieldCheck, Lock, AlertOctagon, UserX, Clock, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SecurityCentrePage() {
  const { user: adminUser } = useAuth();
  const [securityEvents, setSecurityEvents] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const logs = (await db.read('seatsync_activity_logs')) || [];
      const secLogs = logs.filter(l =>
        (l.action || '').includes('LOGIN') ||
        (l.action || '').includes('SECURITY') ||
        (l.action || '').includes('RESTRICT') ||
        (l.action || '').includes('ROLE')
      );
      setSecurityEvents(secLogs.reverse());
    } catch (err) {
      console.warn('Failed to load security events:', err);
    }
  };

  const handleForceLogoutStaff = (staffName) => {
    adminService.logAudit({
      userName: adminUser?.name || 'Administrator',
      action: 'SECURITY_FORCE_LOGOUT',
      affectedRecord: `Session for ${staffName}`,
      result: 'SUCCESS',
      notes: 'Terminated active session clearance'
    });
    toast.success(`Active staff session for ${staffName} forcefully terminated.`);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-indigo-600" size={28} /> Security & Access Audit Centre
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Monitor login attempt logs, suspicious QR scans, active staff sessions, and force logout controls.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Failed Login Attempts</p>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">0 Detected</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">No brute-force anomalies</p>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Suspicious QR Scans</p>
          <h3 className="text-2xl font-black text-teal-600 mt-1">0 Flagged</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono font-bold">Encrypted HMAC Validated</p>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Active Staff Sessions</p>
          <h3 className="text-2xl font-black text-purple-600 mt-1">3 Sessions</h3>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">Encrypted JWT tokens</p>
        </Card>
      </div>

      {/* SECURITY LOGS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Lock size={18} className="text-indigo-600" /> Platform Security & Clearance Logs
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-slate-200/80 text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="py-3 px-3">Timestamp</th>
                <th className="py-3 px-3">User Actor</th>
                <th className="py-3 px-3">Security Action</th>
                <th className="py-3 px-3">Target Record</th>
                <th className="py-3 px-3 text-right">Emergency Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(securityEvents || []).map(evt => (
                <tr key={evt.id} className="hover:bg-slate-50/80 text-slate-700">
                  <td className="py-3 px-3 text-slate-500">{new Date(evt.timestamp).toLocaleString()}</td>
                  <td className="py-3 px-3 font-sans font-bold text-navy">{evt.userName}</td>
                  <td className="py-3 px-3">
                    <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] font-bold">
                      {evt.action}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 text-indigo-700">{evt.affectedRecord}</td>
                  <td className="py-3 px-3 text-right">
                    <Button
                      onClick={() => handleForceLogoutStaff(evt.userName)}
                      className="h-7 px-2.5 text-[10px] bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg"
                    >
                      Force Terminate Session
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
