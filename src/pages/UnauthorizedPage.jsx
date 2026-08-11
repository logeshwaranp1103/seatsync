import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService } from '../services/authService';
import { Card, CardContent } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import { ShieldAlert, ArrowLeft, Home, LogOut } from 'lucide-react';

export default function UnauthorizedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleReturnDashboard = () => {
    if (user) {
      const dest = authService.getDashboardRoute(user.role);
      navigate(dest, { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-slate-800 bg-slate-950 text-white rounded-3xl p-6 text-center space-y-6 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 mx-auto flex items-center justify-center">
          <ShieldAlert size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white">403 — Unauthorized Access</h1>
          <p className="text-xs text-slate-400 leading-relaxed font-medium">
            You do not have permission to access this dashboard route. Your account role ({user?.role || 'GUEST'}) is restricted from this section.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button
            type="button"
            onClick={handleReturnDashboard}
            className="w-full sm:w-auto h-10 text-xs font-bold bg-brandBlue hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2"
          >
            <Home size={16} /> Return to My Dashboard
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="w-full sm:w-auto h-10 text-xs font-bold border-slate-700 text-slate-300 hover:bg-slate-800 rounded-xl flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Sign Out
          </Button>
        </div>
      </Card>
    </div>
  );
}
