import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, UserCheck, ShieldCheck, GraduationCap } from 'lucide-react';

export default function DemoAccessPanel({ onAutofill }) {
  const [expanded, setExpanded] = useState(false);

  // Render ONLY in local development mode
  if (import.meta.env.DEV !== true) return null;

  return (
    <div className="border-t border-slate-200/80 pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between py-1 px-2 text-[11px] font-bold text-slate-500 hover:text-navy hover:bg-slate-50 rounded-xl transition-colors focus:outline-none"
      >
        <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
          <Sparkles size={12} className="text-amber-500" /> Dev Quick Fill (Fills Input Credentials Only)
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="mt-2.5 grid grid-cols-3 gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => onAutofill('student@college.edu', 'Student123!')}
            className="p-2.5 rounded-xl bg-blue-50/80 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-all text-center group cursor-pointer"
          >
            <span className="block text-[10px] font-extrabold text-blue-900 flex items-center justify-center gap-1">
              <GraduationCap size={11} className="text-brandBlue" /> Student
            </span>
            <span className="text-[9px] font-mono font-bold text-blue-700 block mt-0.5">student@college.edu</span>
          </button>

          <button
            type="button"
            onClick={() => onAutofill('STAFF001', 'Staff123!')}
            className="p-2.5 rounded-xl bg-teal-50/80 border border-teal-200 hover:bg-teal-100 hover:border-teal-300 transition-all text-center group cursor-pointer"
          >
            <span className="block text-[10px] font-extrabold text-teal-900 flex items-center justify-center gap-1">
              <UserCheck size={11} className="text-teal-600" /> Librarian
            </span>
            <span className="text-[9px] font-mono font-bold text-teal-700 block mt-0.5">STAFF001</span>
          </button>

          <button
            type="button"
            onClick={() => onAutofill('ADM001', 'Admin123!')}
            className="p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-all text-center group cursor-pointer"
          >
            <span className="block text-[10px] font-extrabold text-indigo-900 flex items-center justify-center gap-1">
              <ShieldCheck size={11} className="text-indigo-600" /> Admin
            </span>
            <span className="text-[9px] font-mono font-bold text-indigo-700 block mt-0.5">ADM001</span>
          </button>
        </div>
      )}
    </div>
  );
}
