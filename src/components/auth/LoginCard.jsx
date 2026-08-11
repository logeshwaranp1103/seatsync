import React from 'react';
import { Card } from '../shared/Card';
import { Badge } from '../shared/Badge';
import { ShieldCheck, Lock } from 'lucide-react';
import LoginForm from './LoginForm';

export default function LoginCard({ onSubmit, loading, errorMsg, setErrorMsg }) {
  return (
    <Card className="w-full max-w-[460px] border border-slate-200/90 bg-white shadow-2xl rounded-3xl p-6 sm:p-8 space-y-6 mx-auto relative z-10 transition-all">
      {/* Card Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="bg-blue-50/80 text-brandBlue border-blue-200/80 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 flex items-center gap-1">
            <ShieldCheck size={12} className="text-brandBlue" /> Role-Based Auth
          </Badge>
          <span className="text-[10px] font-bold text-slate-400 font-mono">SeatSync Portal</span>
        </div>

        <div>
          <h2 className="text-2xl font-extrabold text-navy tracking-tight">Welcome back</h2>
          <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
            Sign in using your registered email, Staff ID or Admin ID.
          </p>
        </div>
      </div>

      {/* Main Login Form */}
      <LoginForm
        onSubmit={onSubmit}
        loading={loading}
        errorMsg={errorMsg}
        setErrorMsg={setErrorMsg}
      />

      {/* Trust and Security Footer */}
      <div className="border-t border-slate-100 pt-3 text-center">
        <p className="text-[11px] text-slate-400 font-semibold flex items-center justify-center gap-1">
          <Lock size={12} className="text-slate-400 shrink-0" /> Protected by secure role-based access
        </p>
      </div>
    </Card>
  );
}
