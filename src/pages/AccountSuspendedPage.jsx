import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LogOut } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Card } from '../components/shared/Card';
import { useAuth } from '../auth/AuthProvider';

export default function AccountSuspendedPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleReturnToLogin = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-amber-600/10 rounded-full blur-[140px] pointer-events-none" />

      <Card className="w-full max-w-md border border-amber-500/20 bg-slate-900/90 text-white rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative z-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/10">
          <Clock size={36} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white tracking-tight">Account Suspended</h1>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-sm mx-auto">
            Your account is temporarily suspended due to consecutive no-shows or operational restrictions.
          </p>
        </div>

        <div className="bg-amber-950/40 border border-amber-800/40 rounded-2xl p-4 text-xs space-y-1 text-amber-200 text-left">
          <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider block">Notice</span>
          <p className="font-semibold">Account Status: <strong className="text-amber-400">SUSPENDED</strong></p>
          <p className="text-[11px] text-slate-300">You cannot create new reservations during the penalty period.</p>
        </div>

        <div className="space-y-3 pt-2">
          <Button
            onClick={handleReturnToLogin}
            className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Return to Login
          </Button>
        </div>
      </Card>
    </div>
  );
}
