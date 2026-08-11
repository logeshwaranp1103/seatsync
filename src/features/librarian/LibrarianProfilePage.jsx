import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { User, Mail, ShieldCheck, Building2, Key, Clock, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LibrarianProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordUpdate = (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      toast.success('Staff password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setLoading(false);
    }, 400);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
          <User className="text-teal-600" size={28} /> Staff Account Profile
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Librarian officer credentials, shift assignment, and security clearance details.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {/* CARD 1: PROFILE SUMMARY */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-6 md:col-span-1">
          <div className="text-center space-y-3">
            <div className="w-20 h-20 rounded-3xl bg-teal-600 text-white font-black text-3xl flex items-center justify-center mx-auto shadow-md shadow-teal-600/20">
              {(user?.name || 'L').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-navy">{user?.name || 'Librarian Officer'}</h2>
              <p className="text-xs font-mono text-teal-600 font-bold mt-0.5">Staff ID: {user?.staffId || user?.identifier || 'LIB001'}</p>
              <Badge className="bg-teal-50 text-teal-700 border-teal-200 font-bold text-[10px] uppercase mt-2">
                Authorized Staff Officer
              </Badge>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2.5 text-xs font-mono">
            <div className="flex justify-between items-center"><span className="text-slate-500 font-sans">Email:</span> <strong className="text-navy">{user?.email || 'librarian@college.edu'}</strong></div>
            <div className="flex justify-between items-center"><span className="text-slate-500 font-sans">Library:</span> <strong className="text-navy">Central University Library</strong></div>
            <div className="flex justify-between items-center"><span className="text-slate-500 font-sans">Current Shift:</span> <strong className="text-teal-600">Day Shift (08:00 AM - 04:00 PM)</strong></div>
            <div className="flex justify-between items-center"><span className="text-slate-500 font-sans">Authority:</span> <strong className="text-teal-600">LIBRARIAN / STAFF</strong></div>
          </div>
        </Card>

        {/* CARD 2: PASSWORD CHANGE FORM */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4 md:col-span-2">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Lock size={18} className="text-teal-600" /> Change Security Password
          </h2>

          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Current Staff Password</label>
              <Input
                type="password"
                placeholder="Enter current password..."
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">New Password</label>
                <Input
                  type="password"
                  placeholder="Enter new password..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Confirm New Password</label>
                <Input
                  type="password"
                  placeholder="Confirm new password..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
            >
              {loading ? 'Updating Password...' : 'Update Password →'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
