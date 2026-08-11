import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../shared/Dialog';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Label } from '../shared/Label';
import { KeyRound, Mail, CheckCircle2, RefreshCw } from 'lucide-react';
import { authService, parseErrorMessage } from '../../services/authService';
import toast from 'react-hot-toast';

export default function ForgotPasswordModal({ isOpen, onClose }) {
  const [mode, setMode] = useState('reset'); // 'reset' | 'resend'
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) return;

    setLoading(true);
    try {
      if (mode === 'reset') {
        await authService.requestPasswordReset(identifier.trim());
        setMessage('If an account matches the information provided, password-reset instructions will be sent to its registered email address.');
      } else {
        await authService.resendConfirmationEmail(identifier.trim());
        setMessage('A confirmation link has been resent to your registered email address. Please check your inbox.');
      }
      setSubmitted(true);
    } catch (err) {
      if (mode === 'resend') {
        toast.error(parseErrorMessage(err, 'Failed to resend confirmation email.'));
      } else {
        setSubmitted(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIdentifier('');
    setSubmitted(false);
    setMessage('');
    setMode('reset');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-white rounded-2xl p-6 text-navy space-y-4 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
            {mode === 'reset' ? <KeyRound className="text-brandBlue" size={20} /> : <RefreshCw className="text-brandBlue" size={20} />}
            {mode === 'reset' ? 'Reset Your Password' : 'Resend Email Confirmation'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium pt-1">
            {mode === 'reset' 
              ? 'Enter your Email, Staff ID, or Admin ID to receive password reset instructions.'
              : 'Enter your registered email address to resend your signup verification link.'}
          </DialogDescription>
        </DialogHeader>

        {/* Mode Toggle */}
        <div className="flex bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => { setMode('reset'); setSubmitted(false); }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${mode === 'reset' ? 'bg-white text-navy shadow-sm' : 'text-slate-500 hover:text-navy'}`}
          >
            Reset Password
          </button>
          <button
            type="button"
            onClick={() => { setMode('resend'); setSubmitted(false); }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${mode === 'resend' ? 'bg-white text-navy shadow-sm' : 'text-slate-500 hover:text-navy'}`}
          >
            Resend Confirmation
          </button>
        </div>

        {submitted ? (
          <div className="space-y-4 py-2">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-emerald-700">
                <CheckCircle2 size={16} /> Request Processed
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600 font-medium pt-1">
                {message}
              </p>
            </div>

            <Button onClick={handleClose} className="w-full h-10 text-xs font-bold bg-navy hover:bg-slate-800 text-white rounded-xl">
              Back to Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">
                {mode === 'reset' ? 'Email, Staff ID, or Admin ID' : 'Registered Email Address'}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input
                  type="text"
                  placeholder={mode === 'reset' ? "e.g. STAFF001 or student@college.edu" : "student@college.edu"}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="pl-10 h-11 text-xs rounded-xl border-slate-300"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} className="rounded-xl text-xs font-bold">
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="bg-brandBlue hover:bg-blue-700 text-white font-bold rounded-xl text-xs px-5">
                {loading ? 'Processing...' : (mode === 'reset' ? 'Send Reset Link →' : 'Resend Link →')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
