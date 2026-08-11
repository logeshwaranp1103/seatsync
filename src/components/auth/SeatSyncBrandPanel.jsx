import React from 'react';
import { BookOpen, CheckCircle2, QrCode, Users, Layers, Sparkles } from 'lucide-react';
import LibraryStatusBadge from './LibraryStatusBadge';

export default function SeatSyncBrandPanel() {
  return (
    <div className="flex flex-col justify-between h-full p-6 sm:p-8 lg:p-10 text-white relative overflow-hidden select-none">
      {/* Background Decorative Seat Carrel Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #38bdf8 1px, transparent 0)`,
          backgroundSize: '24px 24px'
        }}
        aria-hidden="true"
      />

      {/* Top Header & Logo */}
      <div className="space-y-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-brandBlue via-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-brandBlue/30 border border-white/20 shrink-0">
            <BookOpen size={22} />
          </div>
          <div>
            <div className="flex items-center gap-1 leading-none">
              <span className="text-2xl font-black tracking-tight text-white">Seat</span>
              <span className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">Sync</span>
            </div>
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-blue-200/80 block mt-1">
              Smart Library Booking System
            </span>
          </div>
        </div>

        {/* Dynamic Operating Hours Status Badge */}
        <div>
          <LibraryStatusBadge />
        </div>
      </div>

      {/* Center Value Proposition */}
      <div className="my-8 relative z-10 space-y-6">
        <div className="space-y-3 max-w-lg">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/20 text-blue-300 text-xs font-semibold backdrop-blur-md">
            <Sparkles size={12} className="text-amber-400" />
            <span>Campus Digital Infrastructure</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-[1.15]">
            Your smarter way to <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-teal-200 to-indigo-200">study.</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed max-w-md">
            Reserve library seats, manage your sessions, and access the library through one secure platform.
          </p>
        </div>

        {/* 3 Compact Benefit Items */}
        <div className="space-y-3.5 pt-2 max-w-md">
          <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md transition-all hover:bg-white/[0.07]">
            <div className="h-8 w-8 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0 border border-blue-400/30">
              <Layers size={16} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                Live Seat Availability
                <CheckCircle2 size={13} className="text-teal-400" />
              </h3>
              <p className="text-[11px] text-slate-300 font-medium leading-tight mt-0.5">
                Check seat status across zones before visiting the library.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md transition-all hover:bg-white/[0.07]">
            <div className="h-8 w-8 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 border border-teal-400/30">
              <QrCode size={16} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                Quick QR Access
                <CheckCircle2 size={13} className="text-teal-400" />
              </h3>
              <p className="text-[11px] text-slate-300 font-medium leading-tight mt-0.5">
                Use secure QR passes for entry check-in and checkout.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md transition-all hover:bg-white/[0.07]">
            <div className="h-8 w-8 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 border border-purple-400/30">
              <Users size={16} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                Smart Waiting List
                <CheckCircle2 size={13} className="text-teal-400" />
              </h3>
              <p className="text-[11px] text-slate-300 font-medium leading-tight mt-0.5">
                Get notified automatically when a seat becomes available.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer System Note */}
      <div className="relative z-10 text-[11px] text-slate-400 font-medium border-t border-white/10 pt-4 flex items-center justify-between">
        <span>SeatSync Central University Portal</span>
        <span className="font-mono text-blue-300/80">v2.5 Secured</span>
      </div>
    </div>
  );
}
