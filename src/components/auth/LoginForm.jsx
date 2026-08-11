import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { User, AlertCircle, ArrowRight, ShieldCheck, CheckCircle2, KeyRound, UserPlus } from 'lucide-react';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { Label } from '../shared/Label';
import PasswordField from './PasswordField';
import DemoAccessPanel from './DemoAccessPanel';
import ForgotPasswordModal from './ForgotPasswordModal';

export default function LoginForm({ onSubmit, loading, errorMsg, setErrorMsg }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [identifierError, setIdentifierError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');
  const [forgotModalOpen, setForgotModalOpen] = useState(false);

  const handleAutofill = (id, pass) => {
    setIdentifier(id);
    setPassword(pass);
    setIdentifierError('');
    setPasswordError('');
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIdentifierError('');
    setPasswordError('');
    setErrorMsg('');
    setLoginSuccessMsg('');

    const cleanId = identifier.trim();
    const cleanPass = password;

    let hasError = false;

    if (!cleanId) {
      setIdentifierError('College ID, Staff ID or Email is required.');
      hasError = true;
    }

    if (!cleanPass) {
      setPasswordError('Password is required.');
      hasError = true;
    }

    if (hasError) return;

    try {
      await onSubmit(cleanId, cleanPass, rememberMe);
      setLoginSuccessMsg('Authentication verified — Redirecting...');
    } catch {
      // Error handled by parent auth flow securely
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Live Error / Success Announcement */}
        <div aria-live="polite" aria-atomic="true">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}

          {loginSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2.5 animate-in fade-in">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
              <span className="font-bold">{loginSuccessMsg}</span>
            </div>
          )}
        </div>

        {/* Identifier Field */}
        <div className="space-y-1.5">
          <Label htmlFor="identifier" className="text-xs font-bold text-slate-700">
            College ID, Staff ID or Email
          </Label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
            <Input
              id="identifier"
              type="text"
              placeholder="Enter your email, Staff ID or Admin ID"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (identifierError) setIdentifierError('');
                if (errorMsg) setErrorMsg('');
              }}
              disabled={loading}
              required
              autoComplete="username"
              aria-invalid={!!identifierError}
              className={`pl-10 h-11 border-slate-300 focus:border-brandBlue focus:ring-2 focus:ring-brandBlue/20 rounded-xl text-xs font-semibold ${
                identifierError ? 'border-red-400 bg-red-50/20' : ''
              }`}
            />
          </div>
          {identifierError && (
            <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 pt-0.5">
              <AlertCircle size={12} className="shrink-0" />
              {identifierError}
            </p>
          )}
        </div>

        {/* Password Field with Show/Hide toggle */}
        <PasswordField
          id="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError('');
            if (errorMsg) setErrorMsg('');
          }}
          error={passwordError}
          disabled={loading}
          required
        />

        {/* Remember Me & Forgot Password Options */}
        <div className="flex items-center justify-between pt-1 text-xs">
          <label className="flex items-center gap-2 text-slate-600 font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="rounded text-brandBlue focus:ring-brandBlue border-slate-300 h-4 w-4 transition-colors"
            />
            Remember me
          </label>

          <button
            type="button"
            onClick={() => setForgotModalOpen(true)}
            disabled={loading}
            className="text-brandBlue font-bold hover:underline focus:outline-none"
          >
            Forgot Password?
          </button>
        </div>

        {/* Full-width Sign-In Button */}
        <Button
          type="submit"
          disabled={loading}
          className="w-full h-12 text-xs font-bold bg-gradient-to-r from-brandBlue to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-brandBlue/25 flex items-center justify-center gap-2 transition-all mt-2 cursor-pointer"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Signing in…
            </>
          ) : (
            <>
              Sign In <ArrowRight size={16} />
            </>
          )}
        </Button>

        {/* Student Sign Up Link */}
        <div className="text-center pt-2 border-t border-slate-100">
          <p className="text-xs text-slate-500 font-medium">
            New Student?{' '}
            <Link to="/signup" className="text-brandBlue font-bold hover:underline inline-flex items-center gap-1">
              Create Student Account <UserPlus size={12} />
            </Link>
          </p>
        </div>

        {/* Dev Access Panel */}
        <DemoAccessPanel onAutofill={handleAutofill} />
      </form>

      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        isOpen={forgotModalOpen}
        onClose={() => setForgotModalOpen(false)}
      />
    </>
  );
}
