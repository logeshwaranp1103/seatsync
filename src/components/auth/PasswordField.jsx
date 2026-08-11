import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Input } from '../shared/Input';
import { Label } from '../shared/Label';

export default function PasswordField({
  id = 'password',
  value,
  onChange,
  error,
  disabled = false,
  required = true
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const handleKeyDown = (e) => {
    if (e.getModifierState && e.getModifierState('CapsLock')) {
      setCapsLockOn(true);
    } else {
      setCapsLockOn(false);
    }
  };

  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-bold text-slate-700">
          Password
        </Label>
        {capsLockOn && (
          <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1 animate-pulse">
            <AlertCircle size={10} /> Caps Lock is ON
          </span>
        )}
      </div>

      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
        <Input
          id={id}
          type={showPassword ? 'text' : 'password'}
          placeholder="Enter your password"
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyDown}
          disabled={disabled}
          required={required}
          autoComplete="current-password"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={`pl-10 pr-10 h-11 border-slate-300 focus:border-brandBlue focus:ring-2 focus:ring-brandBlue/20 rounded-xl text-xs font-semibold ${
            error ? 'border-red-400 bg-red-50/20' : ''
          }`}
        />

        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          title={showPassword ? 'Hide password' : 'Show password'}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-brandBlue p-1 rounded-md transition-colors"
          tabIndex={-1}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {error && (
        <p id={errorId} className="text-[11px] text-red-600 font-semibold flex items-center gap-1 pt-0.5 animate-in fade-in">
          <AlertCircle size={12} className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
