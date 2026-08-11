import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, Mail, Clock, UserX } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Card } from '../components/shared/Card';
import { useAuth } from '../auth/AuthProvider';

export default function AccountBlockedPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [blockedData, setBlockedData] = useState({
    reason: 'Policy violation or unhandled attendance issue.',
    blockedAt: new Date().toISOString(),
    blockedBy: 'Library Staff'
  });

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('seatsync_blocked_info') || localStorage.getItem('seatsync_blocked_info');
      if (stored) {
        const parsed = JSON.parse(stored);
        setBlockedData({
          reason: parsed.reason || 'Policy violation',
          blockedAt: parsed.blockedAt || new Date().toISOString(),
          blockedBy: parsed.blockedBy || 'Library Staff'
        });
      }
    } catch { /* fallback */ }
  }, []);

  const handleReturnToLogin = async () => {
    try {
      sessionStorage.removeItem('seatsync_blocked_info');
      localStorage.removeItem('seatsync_blocked_info');
    } catch { /* proceed */ }
    await logout();
    navigate('/login', { replace: true });
  };

  const formattedDate = new Date(blockedData.blockedAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none" />

      <Card className="w-full max-w-md border border-red-500/30 bg-slate-900/90 text-white rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative z-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center mx-auto shadow-lg shadow-red-500/10">
          <ShieldAlert size={36} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white tracking-tight">Access Blocked</h1>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-sm mx-auto">
            Your SeatSync account has been blocked by library staff.
          </p>
        </div>

        <div className="bg-red-950/40 border border-red-800/40 rounded-2xl p-4 text-xs space-y-3 text-red-200 text-left">
          <div className="flex items-center justify-between border-b border-red-800/30 pb-2">
            <span className="text-[10px] uppercase font-extrabold text-red-400 tracking-wider">Access Status</span>
            <span className="text-[11px] font-black text-white bg-red-600 px-2 py-0.5 rounded-full">BLOCKED</span>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reason</span>
            <p className="font-bold text-white text-xs bg-red-900/40 p-2.5 rounded-xl border border-red-700/30">
              {blockedData.reason}
            </p>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-300 pt-1">
            <span className="flex items-center gap-1"><Clock size={12} className="text-red-400" /> Blocked on:</span>
            <span className="font-mono font-bold text-white">{formattedDate}</span>
          </div>

          {blockedData.blockedBy && (
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span className="flex items-center gap-1"><UserX size={12} className="text-red-400" /> Blocked by:</span>
              <span className="font-semibold text-white">{blockedData.blockedBy}</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-400 font-medium">
          Please contact the library staff if you believe this has been resolved.
        </p>

        <div className="space-y-3 pt-1">
          <Button
            onClick={handleReturnToLogin}
            className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Return to Login
          </Button>

          <p className="text-[11px] text-slate-500 font-medium flex items-center justify-center gap-1">
            <Mail size={12} /> Contact Library: {' '}
            <a href="mailto:support@library.edu" className="text-slate-300 underline font-semibold">
              support@library.edu
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
