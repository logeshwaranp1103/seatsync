import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { authService } from '../../services/authService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ShieldAlert, AlertTriangle, LogOut, RefreshCw, Mail, PhoneCall, Calendar, HelpCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function BlockedAccessPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [accessInfo, setAccessInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const statusData = await authService.getMyAccessStatus();
      setAccessInfo(statusData);

      // If user is actually active, redirect them back to student dashboard
      if (statusData && statusData.account_status === 'active') {
        navigate('/student/dashboard', { replace: true });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const blockReason = accessInfo?.blocked_reason || user?.blockedReason || 'Policy violation or unreturned library resources.';
  const blockedAt = accessInfo?.blocked_at ? format(new Date(accessInfo.blocked_at), 'MMMM dd, yyyy — hh:mm a') : 'Recently';
  const blockedBy = accessInfo?.blocked_by_display_name || 'Library Administration';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <Card className="max-w-xl w-full border-rose-200 shadow-xl overflow-hidden rounded-3xl bg-white">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-rose-600 to-rose-700 p-6 text-white text-center relative">
          <div className="mx-auto w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center mb-3 border border-white/20">
            <ShieldAlert className="w-9 h-9 text-white" />
          </div>
          <Badge className="bg-rose-900/60 text-rose-100 border-rose-400/30 uppercase tracking-widest text-[10px] font-bold px-3 py-1 mb-2">
            Access Restricted
          </Badge>
          <h1 className="text-2xl font-extrabold tracking-tight">SeatSync Access Blocked</h1>
          <p className="text-rose-100 text-sm mt-1 max-w-md mx-auto">
            Your library seat reservation & portal access privileges have been temporarily suspended.
          </p>
        </div>

        <CardContent className="p-6 space-y-6">
          {/* Reason Box */}
          <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-sm">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>Official Reason for Block</span>
            </div>
            <p className="text-slate-800 font-medium text-sm pl-6 border-l-2 border-rose-400">
              "{blockReason}"
            </p>
            <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-rose-200/60 pl-6 gap-2">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Blocked on: <strong className="text-slate-700">{blockedAt}</strong>
              </span>
              <span>
                Issued by: <strong className="text-slate-700">{blockedBy}</strong>
              </span>
            </div>
          </div>

          {/* Guidance Steps */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-indigo-500" />
              What should you do next?
            </h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2 bg-slate-100/70 p-2.5 rounded-xl border border-slate-200/60">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 font-bold text-slate-700 text-[11px] flex items-center justify-center">1</span>
                <span>Visit the <strong>Central Library Circulation Desk</strong> in person with your Student ID card.</span>
              </li>
              <li className="flex items-start gap-2 bg-slate-100/70 p-2.5 rounded-xl border border-slate-200/60">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 font-bold text-slate-700 text-[11px] flex items-center justify-center">2</span>
                <span>Resolve any outstanding book returns, penalties, or policy acknowledgements with the duty librarian.</span>
              </li>
              <li className="flex items-start gap-2 bg-slate-100/70 p-2.5 rounded-xl border border-slate-200/60">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 font-bold text-slate-700 text-[11px] flex items-center justify-center">3</span>
                <span>Once unblocked by staff, click <strong>Check Status Again</strong> below to restore your access immediately.</span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1 border-slate-300 hover:bg-slate-100 font-semibold"
              onClick={checkStatus}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Check Status Again
            </Button>
            <Button
              className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-sm"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
