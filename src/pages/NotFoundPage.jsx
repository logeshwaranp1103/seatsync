import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService } from '../services/authService';
import { Card } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import { FileQuestion, Home } from 'lucide-react';

export default function NotFoundPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleReturn = () => {
    if (user) {
      const dest = authService.getDashboardRoute(user.role);
      navigate(dest, { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-slate-200 bg-white rounded-3xl p-6 text-center space-y-6 shadow-md">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-brandBlue border border-blue-200 mx-auto flex items-center justify-center">
          <FileQuestion size={32} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-navy">404 — Page Not Found</h1>
          <p className="text-xs text-slate-500 font-medium">
            The page or route you requested does not exist in SeatSync.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleReturn}
          className="w-full h-10 text-xs font-bold bg-brandBlue hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2"
        >
          <Home size={16} /> Return to Safety
        </Button>
      </Card>
    </div>
  );
}
