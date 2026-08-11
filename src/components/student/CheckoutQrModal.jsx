import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { X, Clock, MapPin, CheckCircle2, AlertTriangle, ShieldCheck, QrCode, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export default function CheckoutQrModal({ isOpen, onClose, passData, onCheckoutCompleted }) {
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes default
  const [isExpired, setIsExpired] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const expiresAt = passData?.expiresAt;
  const bookingId = passData?.bookingId;

  // Live countdown ticker
  useEffect(() => {
    if (!isOpen || !expiresAt) return;

    const calculateRemaining = () => {
      const target = new Date(expiresAt).getTime();
      const now = new Date().getTime();
      const diffSeconds = Math.max(0, Math.floor((target - now) / 1000));
      setTimeLeft(diffSeconds);

      if (diffSeconds <= 0) {
        setIsExpired(true);
      } else {
        setIsExpired(false);
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);
    return () => clearInterval(interval);
  }, [isOpen, expiresAt]);

  // Realtime Supabase Subscription for Instant Checkout Completion
  useEffect(() => {
    if (!isOpen || !bookingId) return;

    const channel = supabase
      .channel(`checkout_qr_${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`
        },
        (payload) => {
          const newStatus = String(payload.new?.status || '').toLowerCase();
          if (['completed', 'checked_out'].includes(newStatus)) {
            setIsCompleted(true);
            toast.success('✓ Checkout verified! Seat released successfully.');
            if (onCheckoutCompleted) {
              onCheckoutCompleted(payload.new);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'booking_qr_tokens',
          filter: `booking_id=eq.${bookingId}`
        },
        (payload) => {
          if (payload.new?.used_at) {
            setIsCompleted(true);
            toast.success('✓ Checkout pass scanned and verified by librarian.');
            if (onCheckoutCompleted) {
              onCheckoutCompleted();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, bookingId, onCheckoutCompleted]);

  const formattedTimeLeft = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [timeLeft]);

  if (!isOpen || !passData) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-sm overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 my-auto pb-safe"
        >
          {/* Header Bar */}
          <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-600 px-6 py-5 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-md">
                <QrCode className="w-6 h-6 text-amber-200" />
              </div>
              <div>
                <h2 id="checkout-modal-title" className="text-xl font-bold tracking-tight">Checkout Pass</h2>
                <p className="text-xs text-amber-100 font-medium">Single-Use Exit Credential</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/20 transition-colors text-amber-100 hover:text-white"
              aria-label="Close Checkout Pass Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Status Banner */}
            {isCompleted ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 text-emerald-800 animate-in fade-in">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Checkout Successful</h4>
                  <p className="text-xs text-emerald-700">Your seat has been released and booking completed.</p>
                </div>
              </div>
            ) : isExpired ? (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center gap-3 text-rose-800 animate-in fade-in">
                <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Checkout Pass Expired</h4>
                  <p className="text-xs text-rose-700">Please close this window and click Request Checkout QR again.</p>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                  <span className="text-xs font-semibold text-amber-900">Waiting for librarian scan</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-100/80 rounded-lg text-amber-900 font-mono font-bold text-xs">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <span>{formattedTimeLeft}</span>
                </div>
              </div>
            )}

            {/* High-Contrast QR Code Box */}
            <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200 rounded-3xl shadow-inner relative">
              {isCompleted ? (
                <div className="py-8 flex flex-col items-center gap-3 text-emerald-600">
                  <div className="p-4 bg-emerald-100 rounded-full">
                    <CheckCircle2 className="w-16 h-16" />
                  </div>
                  <span className="font-bold text-lg text-slate-800">Seat Released</span>
                </div>
              ) : isExpired ? (
                <div className="py-8 flex flex-col items-center gap-3 text-rose-500">
                  <AlertTriangle className="w-16 h-16" />
                  <span className="font-bold text-slate-700">QR Expired</span>
                </div>
              ) : (
                <div className="p-4 bg-white rounded-2xl shadow-md border border-slate-200">
                  <QRCodeSVG
                    value={passData.payload || `seatsync://checkout/${passData.token}`}
                    size={210}
                    level="H"
                    includeMargin={true}
                  />
                </div>
              )}

              {/* Subtitle Token Info */}
              <div className="mt-3 text-center">
                <span className="text-[11px] font-mono font-semibold text-slate-400 tracking-wider uppercase">
                  {passData.bookingCode || passData.bookingId?.substring(0, 8)} • CHECKOUT PASS
                </span>
              </div>
            </div>

            {/* Booking & Seat Details Summary */}
            <div className="grid grid-cols-2 gap-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-100 text-xs">
              <div>
                <span className="text-slate-400 font-medium block">Student</span>
                <span className="font-semibold text-slate-800 truncate block">{passData.studentName || 'Student'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Seat Number</span>
                <span className="font-bold text-amber-700 block">{passData.seatNumber || 'S-01'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Location</span>
                <span className="font-medium text-slate-700 truncate block">{passData.roomName || 'Reading Room'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Slot Time</span>
                <span className="font-medium text-slate-700 block">{passData.slotTime || 'Today'}</span>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-slate-100/70 p-3.5 rounded-2xl text-[11.5px] text-slate-600 flex items-start gap-2.5 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>
                Show this QR to the librarian at the exit desk. Your seat will be released only after the QR is successfully scanned.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="pt-1">
              <button
                onClick={onClose}
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-semibold rounded-xl text-sm transition-all shadow-md"
              >
                {isCompleted ? 'Done' : 'Close Pass'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
