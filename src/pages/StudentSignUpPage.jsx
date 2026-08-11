import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService, parseErrorMessage } from '../services/authService';
import { Card, CardContent } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import { Input } from '../components/shared/Input';
import { Label } from '../components/shared/Label';
import PasswordField from '../components/auth/PasswordField';
import { BookOpen, User, Mail, ShieldCheck, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StudentSignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    registrationNumber: '',
    department: 'Computer Science & Engineering',
    yearOfStudy: '2',
    gender: 'boy', // 'boy' | 'girl'
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (errorMsg) setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!form.fullName.trim()) return setErrorMsg('Full Name is required.');
    if (!form.registrationNumber.trim()) return setErrorMsg('Registration Number is required.');
    if (!form.email.trim() || !form.email.includes('@')) return setErrorMsg('Valid college email is required.');
    if (!form.gender) return setErrorMsg('Please select your gender (Boy or Girl).');
    if (form.password.length < 6) return setErrorMsg('Password must be at least 6 characters.');
    if (form.password !== form.confirmPassword) return setErrorMsg('Passwords do not match.');

    setLoading(true);
    try {
      await authService.registerStudent({
        fullName: form.fullName.trim(),
        registrationNumber: form.registrationNumber.trim(),
        department: form.department,
        yearOfStudy: Number(form.yearOfStudy),
        gender: form.gender === 'girl' ? 'female' : 'male',
        email: form.email.trim(),
        password: form.password
      });

      toast.success('Registration successful! You can now sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      const msg = parseErrorMessage(err, 'Failed to complete registration.');
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-navy to-indigo-950 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans relative overflow-hidden">
      <div className="w-full max-w-md relative z-10 my-auto">
        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-brandBlue to-indigo-500 text-white shadow-xl shadow-brandBlue/30 border border-white/20 mb-1">
            <BookOpen size={24} />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Create Student Account
          </h1>
          <p className="text-xs text-blue-200 font-medium">
            Register your college credentials for library seat access
          </p>
        </div>

        <Card className="border border-slate-200/90 bg-white shadow-2xl rounded-3xl p-6 sm:p-8 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2 animate-in fade-in">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Full Name</Label>
              <Input
                name="fullName"
                type="text"
                placeholder="e.g. Subash P"
                value={form.fullName}
                onChange={handleChange}
                className="h-10 text-xs rounded-xl border-slate-300"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Registration Number</Label>
              <Input
                name="registrationNumber"
                type="text"
                placeholder="e.g. 2024CSE001"
                value={form.registrationNumber}
                onChange={handleChange}
                className="h-10 text-xs font-bold font-mono rounded-xl border-slate-300"
                required
              />
            </div>

            {/* GENDER SELECTION (MANDATORY FOR STUDENTS) */}
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Gender (Required for Seat Allocation)</Label>
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, gender: 'boy' })}
                  className={`h-10 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                    form.gender === 'boy'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  👦 Boy
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, gender: 'girl' })}
                  className={`h-10 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                    form.gender === 'girl'
                      ? 'bg-pink-600 text-white border-pink-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  👧 Girl
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Department</Label>
                <select
                  name="department"
                  value={form.department}
                  onChange={handleChange}
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
                >
                  <option value="Computer Science & Engineering">CSE</option>
                  <option value="Electronics & Communication">ECE</option>
                  <option value="Information Technology">IT</option>
                  <option value="AI & Data Science">AI & DS</option>
                  <option value="Mechanical Engineering">Mech</option>
                  <option value="Electrical & Electronics">EEE</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Year</Label>
                <select
                  name="yearOfStudy"
                  value={form.yearOfStudy}
                  onChange={handleChange}
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
                >
                  <option value="1">1st Year</option>
                  <option value="2">2nd Year</option>
                  <option value="3">3rd Year</option>
                  <option value="4">4th Year</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">College Email</Label>
              <Input
                name="email"
                type="email"
                placeholder="student@college.edu"
                value={form.email}
                onChange={handleChange}
                className="h-10 text-xs rounded-xl border-slate-300"
                required
              />
            </div>

            <PasswordField
              id="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              disabled={loading}
              required
            />

            <PasswordField
              id="confirmPassword"
              label="Confirm Password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              disabled={loading}
              required
            />

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-brandBlue hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-brandBlue/20 mt-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">Creating Account...</span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Complete Registration <ArrowRight size={16} />
                </span>
              )}
            </Button>
          </form>

          <div className="text-center pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500 font-medium">
              Already have a student account?{' '}
              <Link to="/login" className="text-brandBlue font-bold hover:underline">
                Sign In
              </Link>
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}
