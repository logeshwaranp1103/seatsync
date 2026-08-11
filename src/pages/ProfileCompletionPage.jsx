import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService, parseErrorMessage } from '../services/authService';
import { Card } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import { Input } from '../components/shared/Input';
import { Label } from '../components/shared/Label';
import { BookOpen, User, GraduationCap, AlertCircle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ProfileCompletionPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const [form, setForm] = useState({
    fullName: user?.name || user?.fullName || '',
    registrationNumber: user?.collegeId || user?.registration_number || '',
    department: user?.department || 'Computer Science & Engineering',
    yearOfStudy: String(user?.yearOfStudy || '2')
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

    setLoading(true);
    try {
      const updated = await authService.updateMyProfile({
        fullName: form.fullName.trim(),
        registrationNumber: form.registrationNumber.trim(),
        department: form.department,
        yearOfStudy: Number(form.yearOfStudy)
      });

      // Update session user state
      if (user) {
        const updatedUser = {
          ...user,
          name: updated?.full_name || form.fullName.trim(),
          fullName: updated?.full_name || form.fullName.trim(),
          collegeId: updated?.registration_number || form.registrationNumber.trim(),
          registration_number: updated?.registration_number || form.registrationNumber.trim(),
          department: updated?.department || form.department,
          yearOfStudy: updated?.year_of_study || Number(form.yearOfStudy),
          needsProfileCompletion: false
        };
        setUser(updatedUser);
        localStorage.setItem('seatsync_session', JSON.stringify(updatedUser));
      }

      toast.success('Profile completed successfully! Welcome to SeatSync.');
      navigate('/student/dashboard', { replace: true });
    } catch (err) {
      const msg = parseErrorMessage(err, 'Failed to update profile. Please try again.');
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
            <GraduationCap size={24} />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Complete Student Profile
          </h1>
          <p className="text-xs text-blue-200 font-medium">
            Please enter your college registration number before booking seats.
          </p>
        </div>

        <Card className="border border-slate-200/90 bg-white shadow-2xl rounded-3xl p-6 sm:p-8 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2 animate-in fade-in">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="e.g. 7376252AD344"
                value={form.registrationNumber}
                onChange={handleChange}
                className="h-10 text-xs font-bold font-mono rounded-xl border-slate-300"
                required
              />
              <p className="text-[10px] text-slate-400 font-medium">Your official college registration/roll number</p>
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

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-xs font-bold bg-brandBlue hover:bg-blue-700 text-white rounded-xl shadow-md mt-2 flex items-center justify-center gap-1.5"
            >
              {loading ? 'Saving Profile...' : 'Save & Continue to Dashboard →'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
