import React from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Card } from '../../components/shared/Card';
import { Badge } from '../../components/shared/Badge';
import { User, ShieldCheck } from 'lucide-react';

export default function AdminProfilePage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">System Administrator Profile</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Root administrator credentials & full system control access.
        </p>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-950 text-white font-black text-2xl flex items-center justify-center shadow-md border border-indigo-800">
            {(user?.name || 'A').charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy">{user?.name || 'System Admin'}</h2>
            <p className="text-xs font-mono text-indigo-700 font-bold">{user?.adminId || user?.identifier || 'ADM001'}</p>
            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 font-bold text-[10px] uppercase mt-1">
              Super Admin Access
            </Badge>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3 text-xs">
          <div className="flex justify-between items-center"><span className="text-slate-500">Email:</span> <strong className="text-navy">{user?.email || 'admin@college.edu'}</strong></div>
          <div className="flex justify-between items-center"><span className="text-slate-500">Department:</span> <strong className="text-navy">{user?.department || 'IT & Systems Administration'}</strong></div>
          <div className="flex justify-between items-center"><span className="text-slate-500">Role Authority:</span> <strong className="text-indigo-700">SUPER ADMIN</strong></div>
        </div>
      </Card>
    </div>
  );
}
