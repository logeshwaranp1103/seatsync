import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService, parseErrorMessage } from '../services/authService';
import { Card } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import PasswordField from '../components/auth/PasswordField';
import { BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 6) return setErrorMsg('Password must be at least 6 characters.');
    if (password !== confirmPassword) return setErrorMsg('Passwords do not match.');

    setLoading(true);
    try {
      await authService.updatePassword(password);
      toast.success('Password updated successfully! Please sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      const msg = parseErrorMessage(err, 'Failed to update password. Token may have expired.');
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="w-full max-w-md relative z-10 my-auto">
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-brandBlue to-indigo-500 text-white shadow-xl mb-1">
            <BookOpen size={24} />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Set New Password</h1>
          <p className="text-xs text-blue-200 font-medium">Enter your new secure password below</p>
        </div>

        <Card className="border border-slate-200/90 bg-white shadow-2xl rounded-3xl p-6 sm:p-8 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              id="new-password"
              label="New Password"
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />

            <PasswordField
              id="confirm-new-password"
              label="Confirm New Password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
            />

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-xs font-bold bg-brandBlue hover:bg-blue-700 text-white rounded-xl shadow-md mt-2"
            >
              {loading ? 'Updating Password...' : 'Save New Password →'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
