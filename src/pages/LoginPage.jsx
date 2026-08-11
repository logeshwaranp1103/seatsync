import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService, parseErrorMessage } from '../services/authService';
import SeatSyncBrandPanel from '../components/auth/SeatSyncBrandPanel';
import LoginCard from '../components/auth/LoginCard';
import { BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-redirect if session already active
  useEffect(() => {
    if (user) {
      const dest = authService.getDashboardRoute(user.role, user);
      navigate(dest, { replace: true });
    }
  }, [user, navigate]);

  const handleLoginSubmit = async (identifier, password, rememberMe) => {
    setErrorMsg('');
    setLoading(true);
    try {
      const loggedInUser = await login(identifier, password);
      toast.success(`Welcome back, ${loggedInUser.name || loggedInUser.fullName || 'User'}!`);
      const dest = authService.getDashboardRoute(loggedInUser.role, loggedInUser);
      navigate(dest, { replace: true });
      return loggedInUser;
    } catch (err) {
      const msg = parseErrorMessage(err, 'Invalid ID or password. Please check your credentials and try again.');
      setErrorMsg(msg);
      toast.error(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-navy to-indigo-950 flex items-center justify-center p-4 sm:p-6 lg:p-8 relative overflow-hidden font-sans">
      {/* Subtle Indigo & Teal Glow Effects */}
      <div 
        className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none" 
        aria-hidden="true"
      />
      <div 
        className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px] pointer-events-none" 
        aria-hidden="true"
      />

      {/* Centred Container (Max Width ~ 1240px) */}
      <div className="w-full max-w-[1240px] relative z-10 my-auto">
        {/* Mobile Header (Shown on < lg screens) */}
        <div className="lg:hidden text-center space-y-2 mb-6 select-none">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-brandBlue to-indigo-500 text-white shadow-xl shadow-brandBlue/30 border border-white/20 mb-1">
            <BookOpen size={24} />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Seat<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">Sync</span>
          </h1>
          <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">
            Smart Library Booking System
          </p>
        </div>

        {/* Desktop Balanced 2-Column Grid Layout */}
        <div className="grid lg:grid-cols-12 gap-8 items-center bg-slate-900/40 border border-white/10 rounded-3xl backdrop-blur-xl shadow-2xl overflow-hidden p-2 sm:p-4 lg:p-6">
          {/* Left Brand Panel (7 cols on Desktop) */}
          <div className="hidden lg:block lg:col-span-7 h-full">
            <SeatSyncBrandPanel />
          </div>

          {/* Right Login Card (5 cols on Desktop) */}
          <div className="lg:col-span-5 w-full flex justify-center">
            <LoginCard
              onSubmit={handleLoginSubmit}
              loading={loading}
              errorMsg={errorMsg}
              setErrorMsg={setErrorMsg}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
