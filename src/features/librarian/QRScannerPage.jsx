import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../auth/AuthProvider';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  QrCode, CheckCircle2, AlertTriangle, Search, LogOut, LogIn,
  Camera, CameraOff, RefreshCw, X, ShieldCheck, Clock, MapPin,
  ChevronDown, ChevronUp, User, Sparkles, Filter, Lock, Check,
  UserCheck, Layers, Calendar, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

function formatISTDateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const dateStr = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  return `${dateStr} • ${timeStr} IST`;
}

export default function QRScannerPage() {
  const { user: staffUser } = useAuth();
  
  // Verification Mode: 'entry' | 'checkout' | 'manual'
  const [activeMode, setActiveMode] = useState('entry');
  
  // Manual Input Mode: 'register' | 'booking' (Token tab completely removed)
  const [manualInputMode, setManualInputMode] = useState('register');
  const [manualInput, setManualInput] = useState('');
  
  const [loading, setLoading] = useState(false);
  
  // Selection state for multiple candidate bookings
  const [candidateBookings, setCandidateBookings] = useState([]);
  
  // Booking preview target state before check-in confirmation
  const [previewBooking, setPreviewBooking] = useState(null);
  
  // Final execution result state
  const [scanResult, setScanResult] = useState(null);
  
  // WebRTC Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null); // 'permission_denied' | 'unavailable' | 'in_use' | null
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [scanningStatus, setScanningStatus] = useState('idle'); // 'idle' | 'scanning' | 'verifying'
  
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const isProcessingRef = useRef(false);
  const lastScannedTokenRef = useRef('');

  // Recent Verifications Activity Feed
  const [recentVerifications, setRecentVerifications] = useState([]);
  const [activityFilter, setActivityFilter] = useState('ALL');
  const [activityCollapsibleOpen, setActivityCollapsibleOpen] = useState(true);

  const [currentISTTime, setCurrentISTTime] = useState(formatISTDateTime());

  // Clock tick for header
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentISTTime(formatISTDateTime());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Clean up media stream on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  // Stop camera when verification mode changes to manual
  useEffect(() => {
    if (activeMode === 'manual' && isCameraActive) {
      stopCameraStream();
    }
  }, [activeMode]);

  // Check available cameras
  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoInputDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoInputDevices.length > 1) {
          setHasMultipleCameras(true);
        }
      }).catch(() => {});
    }
  }, []);

  const [mediaStream, setMediaStream] = useState(null);

  // Attach stream to video element as soon as videoRef mounts in DOM
  useEffect(() => {
    if (isCameraActive && videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play().catch(err => console.warn('Video playback warning:', err));
    }
  }, [mediaStream, isCameraActive]);

  // Real-Time Native BarcodeDetector QR Frame Scanning Loop
  useEffect(() => {
    let animationFrameId;
    let barcodeDetector = null;

    if ('BarcodeDetector' in window) {
      try {
        barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch { /* proceed */ }
    }

    const scanFrame = async () => {
      if (isCameraActive && videoRef.current && videoRef.current.readyState === 4) {
        if (barcodeDetector && !isProcessingRef.current) {
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const rawVal = barcodes[0].rawValue;
              if (rawVal && rawVal !== lastScannedTokenRef.current) {
                isProcessingRef.current = true;
                lastScannedTokenRef.current = rawVal;
                stopCameraStream();
                handleQrScanDetected(rawVal);
              }
            }
          } catch { /* proceed */ }
        }
      }
      if (isCameraActive && !isProcessingRef.current) {
        animationFrameId = requestAnimationFrame(scanFrame);
      }
    };

    if (isCameraActive && !isProcessingRef.current) {
      animationFrameId = requestAnimationFrame(scanFrame);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isCameraActive]);

  const startCameraStream = async () => {
    setCameraError(null);
    setScanningStatus('scanning');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('unavailable');
        setIsCameraActive(false);
        toast.error('Unable to access the camera');
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      mediaStreamRef.current = stream;
      setMediaStream(stream);
      setIsCameraActive(true);
      toast.success('Camera scanner active. Position student QR pass inside frame.');
    } catch (err) {
      console.warn('Camera access error:', err);
      setIsCameraActive(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('permission_denied');
        toast.error('Camera permission was denied');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('unavailable');
        toast.error('Unable to access the camera');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError('in_use');
        toast.error('Camera is currently being used by another application.');
      } else {
        setCameraError('unavailable');
        toast.error('Unable to access the camera');
      }
    }
  };

  const stopCameraStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setMediaStream(null);
    setIsCameraActive(false);
    setScanningStatus('idle');
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopCameraStream();
      toast.success('Camera scanner stopped.');
    } else {
      startCameraStream();
    }
  };

  const switchCameraFacing = () => {
    stopCameraStream();
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    setTimeout(() => {
      startCameraStream();
    }, 200);
  };

  // QR SCAN DETECTED HANDLER
  const handleQrScanDetected = async (rawQrValue) => {
    setLoading(true);
    setScanningStatus('verifying');
    setScanResult(null);
    setPreviewBooking(null);
    setCandidateBookings([]);

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      if (activeMode === 'checkout') {
        const checkoutRes = await librarianService.scanCheckoutQr(rawQrValue);
        if (!checkoutRes.success) {
          setScanResult({
            valid: false,
            statusCode: checkoutRes.statusCode || 'INVALID_CHECKOUT_QR',
            message: checkoutRes.message || 'Invalid checkout QR code pass',
            verifiedAt: nowTimeStr
          });
          toast.error(checkoutRes.message || 'Invalid checkout QR code pass');
          return;
        }

        const b = checkoutRes.booking;
        const structuredResult = {
          valid: true,
          statusCode: 'SUCCESS',
          message: checkoutRes.message || `Checkout completed for ${b.studentName}! Seat ${b.seatNumber} released.`,
          booking: b,
          verifiedAt: nowTimeStr,
          method: 'qr'
        };

        setScanResult(structuredResult);
        setRecentVerifications(prev => [{
          id: `checkout-${Date.now()}`,
          timeStr: nowTimeStr,
          reference: b.bookingCode || b.id,
          studentName: b.studentName || 'Student',
          action: 'Seat Checkout',
          seatNumber: b.seatNumber || 'N/A',
          result: 'Verified Checkout',
          statusClass: 'bg-amber-100 text-amber-800 border-amber-300'
        }, ...prev.slice(0, 9)]);
        toast.success(structuredResult.message);
        return;
      }

      const res = await librarianService.scanEntryQr(rawQrValue, staffUser?.library_id);

      if (!res.valid) {
        setScanResult({
          valid: false,
          statusCode: res.statusCode || 'INVALID_QR',
          message: res.message || 'QR code is invalid or does not contain a booking reference',
          verifiedAt: nowTimeStr
        });
        toast.error(res.message || 'QR code is invalid or does not contain a booking reference');
        return;
      }

      // Show preview for QR check-in
      setPreviewBooking({
        ...res.booking,
        checkInMethod: 'qr',
        scannedPayload: rawQrValue
      });
      toast.success('Eligible booking found for QR scan. Confirm check-in below.');
    } catch (err) {
      console.warn('QR scan processing error:', err);
      setScanResult({
        valid: false,
        statusCode: 'DATABASE_ERROR',
        message: err.message || 'Database verification failed',
        verifiedAt: nowTimeStr
      });
      toast.error(err.message || 'Database verification failed');
    } finally {
      setLoading(false);
      setScanningStatus('idle');
    }
  };

  // MANUAL LOOKUP SUBMIT HANDLER
  const handleManualLookupSubmit = async (e) => {
    if (e) e.preventDefault();
    const trimmedInput = (manualInput || '').trim();

    if (!trimmedInput) {
      toast.error('Please enter a search identifier.');
      return;
    }

    setLoading(true);
    setScanResult(null);
    setPreviewBooking(null);
    setCandidateBookings([]);

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      if (manualInputMode === 'booking') {
        // 1. Manual Lookup by Booking ID
        const res = await librarianService.lookupBookingById(trimmedInput, staffUser?.library_id);

        if (!res.success || !res.booking) {
          setScanResult({
            valid: false,
            statusCode: res.statusCode || 'BOOKING_NOT_FOUND',
            message: res.message || 'Booking not found',
            verifiedAt: nowTimeStr
          });
          toast.error(res.message || 'Booking not found');
          return;
        }

        if (!res.isEligible) {
          setScanResult({
            valid: false,
            statusCode: res.eligibilityCode || 'NOT_ELIGIBLE',
            message: res.eligibilityMessage || 'Booking is not eligible for check-in.',
            booking: res.booking,
            verifiedAt: nowTimeStr
          });
          toast.error(res.eligibilityMessage || 'Booking is not eligible for check-in.');
          return;
        }

        // Single eligible booking found -> Show Confirmation Preview
        setPreviewBooking({
          ...res.booking,
          checkInMethod: 'booking_id'
        });
        toast.success('Booking reference found. Review details and confirm check-in.');

      } else {
        // 2. Manual Lookup by Register Number / College ID
        const res = await librarianService.lookupBookingsByRegisterNumber(trimmedInput, staffUser?.library_id);

        if (!res.success && res.statusCode === 'STUDENT_NOT_FOUND') {
          setScanResult({
            valid: false,
            statusCode: 'STUDENT_NOT_FOUND',
            message: 'Student register number not found',
            verifiedAt: nowTimeStr
          });
          toast.error('Student register number not found');
          return;
        }

        const matches = res.matches || [];
        if (matches.length === 0) {
          setScanResult({
            valid: false,
            statusCode: 'NO_ELIGIBLE_BOOKING',
            message: 'No eligible booking found for this student.',
            verifiedAt: nowTimeStr
          });
          toast.error('No eligible booking found for this student.');
          return;
        }

        const eligibleMatches = matches.filter(m => m.isEligible);

        if (eligibleMatches.length === 0) {
          const first = matches[0];
          setScanResult({
            valid: false,
            statusCode: first.eligibilityCode || 'NO_ELIGIBLE_BOOKING',
            message: first.eligibilityMessage || 'No eligible booking found for this student.',
            booking: first,
            verifiedAt: nowTimeStr
          });
          toast.error(first.eligibilityMessage || 'No eligible booking found for this student.');
          return;
        }

        if (eligibleMatches.length === 1) {
          // Exactly 1 eligible booking -> Show Confirmation Preview
          setPreviewBooking({
            ...eligibleMatches[0],
            checkInMethod: 'register_id'
          });
          toast.success('Student booking found. Review details and confirm check-in.');
        } else {
          // Multiple eligible bookings -> Show Selection List
          setCandidateBookings(eligibleMatches);
          toast('Multiple bookings found—select the correct booking', { icon: 'ℹ️' });
        }
      }
    } catch (err) {
      console.warn('Manual lookup error:', err);
      setScanResult({
        valid: false,
        statusCode: 'DATABASE_ERROR',
        message: err.message || 'Database verification failed',
        verifiedAt: nowTimeStr
      });
      toast.error('Database verification failed');
    } finally {
      setLoading(false);
    }
  };

  // CONFIRM CHECK-IN ACTION (ATOMIC DB RPC CALL)
  const handleConfirmCheckIn = async (bookingToConfirm) => {
    if (!bookingToConfirm || !bookingToConfirm.id) return;
    setLoading(true);

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const method = bookingToConfirm.checkInMethod || (activeMode === 'entry' ? 'qr' : manualInputMode);

    try {
      const res = await librarianService.checkInBooking({
        bookingId: bookingToConfirm.id,
        method: method,
        scannedPayload: bookingToConfirm.scannedPayload || null
      });

      if (!res.success && !res.alreadyCheckedIn) {
        setScanResult({
          valid: false,
          statusCode: res.statusCode || 'CHECKIN_FAILED',
          message: res.message || 'Check-in failed.',
          verifiedAt: nowTimeStr
        });
        toast.error(res.message || 'Check-in failed.');
        return;
      }

      const verifiedBooking = res.booking || bookingToConfirm;
      const structuredResult = {
        valid: true,
        alreadyCheckedIn: res.alreadyCheckedIn,
        statusCode: res.alreadyCheckedIn ? 'ALREADY_CHECKED_IN' : 'SUCCESS',
        message: res.message || `Entry verified for ${verifiedBooking.studentName}! Seat ${verifiedBooking.seatNumber} marked checked-in.`,
        booking: verifiedBooking,
        verifiedAt: nowTimeStr,
        method: method
      };

      setScanResult(structuredResult);
      setPreviewBooking(null);
      setCandidateBookings([]);

      // Append to Recent Verifications Activity Feed
      const activityItem = {
        id: `scan-${Date.now()}`,
        timeStr: nowTimeStr,
        reference: verifiedBooking.bookingCode || verifiedBooking.studentRegistrationNumber || verifiedBooking.id,
        studentName: verifiedBooking.studentName || 'Student',
        action: 'Entry Check-In',
        seatNumber: verifiedBooking.seatNumber || 'N/A',
        result: res.alreadyCheckedIn ? 'Already Checked In' : 'Verified Check-In',
        statusClass: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };

      setRecentVerifications(prev => [activityItem, ...prev.slice(0, 9)]);
      toast.success(structuredResult.message);
    } catch (err) {
      console.warn('Confirm check-in error:', err);
      toast.error(err.message || 'Database verification failed');
      setScanResult({
        valid: false,
        statusCode: 'DATABASE_ERROR',
        message: err.message || 'Database verification failed',
        verifiedAt: nowTimeStr
      });
    } finally {
      setLoading(false);
    }
  };

  // CONFIRM CHECKOUT ACTION
  const handleConfirmCheckout = async (booking) => {
    setLoading(true);
    try {
      await librarianService.checkOutBooking({ bookingId: booking.id, method: 'manual' });
      toast.success(`Checkout completed for ${booking.studentName}! Seat ${booking.seatNumber} released.`);
      handleScanNextStudent();
    } catch (err) {
      toast.error(err.message || 'Failed to complete checkout.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanNextStudent = () => {
    setManualInput('');
    setScanResult(null);
    setPreviewBooking(null);
    setCandidateBookings([]);
    setScanningStatus('idle');
    lastScannedTokenRef.current = '';
    isProcessingRef.current = false;
    if (activeMode === 'entry') {
      startCameraStream();
    }
  };

  const filteredVerifications = useMemo(() => {
    if (activityFilter === 'ALL') return recentVerifications;
    if (activityFilter === 'ENTRY') return recentVerifications.filter(v => v.action.includes('Entry') && v.result.includes('Verified'));
    if (activityFilter === 'CHECKOUT') return recentVerifications.filter(v => v.action.includes('Checkout') && v.result.includes('Verified'));
    if (activityFilter === 'FAILED') return recentVerifications.filter(v => v.result.includes('Failed') || v.result.includes('Expired'));
    return recentVerifications;
  }, [recentVerifications, activityFilter]);

  const placeholderText = useMemo(() => {
    if (manualInputMode === 'register') return 'Enter student register number (e.g. 24AD042)...';
    return 'Enter booking code or UUID (e.g. BK-1785)...';
  }, [manualInputMode]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

      {/* 1. PAGE HEADER & STATUS BAR */}
      <div className="pb-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200 text-teal-600 flex items-center justify-center shadow-xs shrink-0">
              <QrCode size={24} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">
                QR Pass Scanner & Entry Verification
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                Verify student entry passes, check-ins, and registration IDs securely via Supabase.
              </p>
            </div>
          </div>

          {/* Scanner Ready & Location Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-slate-100 border border-slate-300 text-slate-700 font-mono text-[11px] font-bold px-3 py-1 rounded-xl">
              <MapPin size={12} className="mr-1 text-teal-600 inline" /> Main Library • Entry Desk
            </Badge>
            <Badge className="bg-emerald-50 border border-emerald-300 text-emerald-700 font-mono text-[11px] font-extrabold px-3 py-1 rounded-xl flex items-center gap-1.5 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Scanner Ready</span>
            </Badge>
            <span className="text-[11px] font-mono text-slate-400 hidden lg:inline">{currentISTTime}</span>
          </div>
        </div>
      </div>

      {/* 2. VERIFICATION MODE CONTROLS (SEGMENTED CONTROL) */}
      <div className="bg-slate-200/80 p-1.5 rounded-2xl max-w-xl flex gap-1 shadow-inner">
        <button
          type="button"
          onClick={() => { setActiveMode('entry'); setPreviewBooking(null); setCandidateBookings([]); setScanResult(null); }}
          className={`
            flex-1 h-10 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2
            ${activeMode === 'entry'
              ? 'bg-white text-navy shadow-xs ring-1 ring-slate-300/60'
              : 'text-slate-600 hover:text-navy hover:bg-slate-100/50'
            }
          `}
        >
          <LogIn size={16} className={activeMode === 'entry' ? 'text-teal-600' : 'text-slate-400'} />
          <span>Entry QR</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveMode('checkout'); setPreviewBooking(null); setCandidateBookings([]); setScanResult(null); }}
          className={`
            flex-1 h-10 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2
            ${activeMode === 'checkout'
              ? 'bg-white text-navy shadow-xs ring-1 ring-slate-300/60'
              : 'text-slate-600 hover:text-navy hover:bg-slate-100/50'
            }
          `}
        >
          <LogOut size={16} className={activeMode === 'checkout' ? 'text-amber-600' : 'text-slate-400'} />
          <span>Checkout QR</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveMode('manual'); setPreviewBooking(null); setCandidateBookings([]); setScanResult(null); }}
          className={`
            flex-1 h-10 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2
            ${activeMode === 'manual'
              ? 'bg-white text-navy shadow-xs ring-1 ring-slate-300/60'
              : 'text-slate-600 hover:text-navy hover:bg-slate-100/50'
            }
          `}
        >
          <Search size={16} className={activeMode === 'manual' ? 'text-brandBlue' : 'text-slate-400'} />
          <span>Manual Lookup</span>
        </button>
      </div>

      {/* 3. TWO-COLUMN VERIFICATION LAYOUT (DESKTOP) */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: CAMERA SCANNER PANEL (~60% / 7 COLS) */}
        <Card className="lg:col-span-7 border border-slate-200/90 bg-white rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-navy uppercase tracking-wider flex items-center gap-2">
                <Camera size={18} className="text-teal-600" /> Camera Scanner Console
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Point student mobile QR pass inside the live camera framing overlay.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isCameraActive && hasMultipleCameras && (
                <Button
                  type="button"
                  onClick={switchCameraFacing}
                  variant="outline"
                  className="h-9 text-[11px] font-bold rounded-xl border-slate-300 text-slate-600 min-h-[44px]"
                >
                  <RefreshCw size={12} className="mr-1" /> Switch Cam
                </Button>
              )}

              <Button
                type="button"
                onClick={toggleCamera}
                className={`h-11 px-4 text-xs font-extrabold rounded-xl transition-all shadow-xs min-h-[44px] ${
                  isCameraActive
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-teal-600 hover:bg-teal-700 text-white'
                }`}
              >
                {isCameraActive ? <CameraOff size={14} className="mr-1.5" /> : <Camera size={14} className="mr-1.5" />}
                {isCameraActive ? 'Stop Camera' : 'Start Camera'}
              </Button>
            </div>
          </div>

          {/* CAMERA VIEWPORT (RESPONSIVE 4:3 RATIO DARK VIEWPORT) */}
          <div className="relative w-full aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center shadow-inner group">
            
            {isCameraActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />

                {/* QR FRAMING OVERLAY WITH CORNER MARKS */}
                <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] flex items-center justify-center">
                  <div className="w-56 h-56 sm:w-64 sm:h-64 border-2 border-dashed border-teal-400/80 rounded-2xl relative shadow-2xl overflow-hidden">
                    
                    {/* Corner Accent Marks */}
                    <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-teal-400 rounded-tl-lg"></div>
                    <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-teal-400 rounded-tr-lg"></div>
                    <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-teal-400 rounded-bl-lg"></div>
                    <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-teal-400 rounded-br-lg"></div>

                    {/* Laser Scanning Bar Animation */}
                    <motion.div
                      animate={{ y: [0, 220, 0] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                      className="w-full h-1 bg-gradient-to-r from-transparent via-teal-400 to-transparent shadow-[0_0_12px_#14B8A6]"
                    />
                  </div>
                </div>

                {/* Status Bar Badge inside Camera Viewport */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between bg-slate-900/80 backdrop-blur-md px-3.5 py-2 rounded-xl text-white text-xs font-mono border border-slate-700/60">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping"></span>
                    <span>Scanning live camera feed...</span>
                  </span>
                  <span className="text-[10px] text-teal-300 uppercase font-bold tracking-wider">Mode: {activeMode.toUpperCase()}</span>
                </div>
              </>
            ) : (
              /* INACTIVE / PERMISSION FALLBACK INTERFACE */
              <div className="p-6 text-center space-y-4 max-w-sm mx-auto">
                {cameraError === 'permission_denied' ? (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center justify-center mx-auto">
                      <Lock size={28} />
                    </div>
                    <h3 className="text-sm font-extrabold text-white">Camera permission was denied</h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                      Camera permission was denied in your browser settings. Enable camera access or use <strong>Manual Lookup</strong> on the right.
                    </p>
                    <Button onClick={startCameraStream} className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-11 px-4 rounded-xl min-h-[44px]">
                      Allow Camera Access
                    </Button>
                  </div>
                ) : cameraError === 'unavailable' ? (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center mx-auto">
                      <AlertTriangle size={28} />
                    </div>
                    <h3 className="text-sm font-extrabold text-white">Unable to access the camera</h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                      No supported webcam or camera hardware was detected. Use the Manual Lookup console on the right.
                    </p>
                  </div>
                ) : cameraError === 'in_use' ? (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center mx-auto">
                      <CameraOff size={28} />
                    </div>
                    <h3 className="text-sm font-extrabold text-white">Camera In Use</h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                      The camera is being used by another application or browser tab. Close other apps and try again.
                    </p>
                    <Button onClick={startCameraStream} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-11 px-4 rounded-xl min-h-[44px]">
                      Retry Camera Stream
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800 text-teal-400 border border-slate-700 flex items-center justify-center mx-auto shadow-md">
                      <Camera size={28} />
                    </div>
                    <h3 className="text-sm font-extrabold text-white">Camera Scanner is Off</h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                      Position student mobile QR pass in front of the lens. Video feed is processed locally and securely.
                    </p>
                    <Button onClick={startCameraStream} className="bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs h-11 px-5 rounded-xl shadow-md min-h-[44px]">
                      <Camera size={16} className="mr-1.5 inline" /> Start Camera Scanner
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* RIGHT COLUMN: MANUAL VERIFICATION PANEL (~40% / 5 COLS) */}
        <Card className="lg:col-span-5 border border-slate-200/90 bg-white rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-navy uppercase tracking-wider flex items-center gap-2">
              <Search size={18} className="text-brandBlue" /> Manual Verification Console
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Verify student entry when camera scanning is unavailable.
            </p>
          </div>

          {/* MANUAL INPUT MODE TABS (Register / College ID & Booking ID only) */}
          <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => { setManualInputMode('register'); setPreviewBooking(null); setCandidateBookings([]); setScanResult(null); }}
              className={`flex-1 py-2 text-xs font-extrabold rounded-lg transition-all min-h-[44px] ${
                manualInputMode === 'register' ? 'bg-white text-navy shadow-xs' : 'text-slate-500 hover:text-navy'
              }`}
            >
              Register / College ID
            </button>
            <button
              type="button"
              onClick={() => { setManualInputMode('booking'); setPreviewBooking(null); setCandidateBookings([]); setScanResult(null); }}
              className={`flex-1 py-2 text-xs font-extrabold rounded-lg transition-all min-h-[44px] ${
                manualInputMode === 'booking' ? 'bg-white text-navy shadow-xs' : 'text-slate-500 hover:text-navy'
              }`}
            >
              Booking ID
            </button>
          </div>

          <form onSubmit={handleManualLookupSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                {manualInputMode === 'register' ? 'Student Register / College ID' : 'Booking Code / Reservation ID'}
              </label>
              
              <div className="relative">
                <Input
                  type="text"
                  placeholder={placeholderText}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="h-11 font-mono text-xs bg-slate-50 border-slate-300 text-navy pr-9 rounded-2xl focus:border-teal-600 min-h-[44px]"
                />
                {manualInput && (
                  <button
                    type="button"
                    onClick={() => setManualInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !manualInput.trim()}
              className="w-full h-11 bg-brandBlue hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px]"
            >
              {loading ? (
                <span className="flex items-center gap-2 font-mono">
                  <RefreshCw size={14} className="animate-spin" /> Querying Supabase...
                </span>
              ) : (
                <>
                  <Search size={16} /> Find Booking
                </>
              )}
            </Button>
          </form>
        </Card>
      </div>

      {/* 4. MULTIPLE BOOKINGS CANDIDATE SELECTION LIST */}
      {candidateBookings && candidateBookings.length > 1 && (
        <Card className="border-2 border-amber-300 bg-amber-50/50 rounded-3xl p-6 shadow-md space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-amber-200 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shrink-0">
                <Layers size={20} />
              </div>
              <div>
                <h3 className="text-base font-black text-amber-950">Multiple Bookings Found</h3>
                <p className="text-xs text-amber-900 font-medium">
                  Select the correct booking to preview and confirm check-in.
                </p>
              </div>
            </div>
            <Badge className="bg-amber-600 text-white font-mono font-extrabold text-xs px-3 py-1 rounded-xl">
              {candidateBookings.length} Eligible Bookings
            </Badge>
          </div>

          <div className="grid gap-3">
            {candidateBookings.map((b) => (
              <div
                key={b.id}
                onClick={() => { setPreviewBooking({ ...b, checkInMethod: 'register_id' }); toast.success(`Selected Booking ${b.bookingCode || b.id}`); }}
                className="p-4 bg-white hover:bg-blue-50/60 border border-amber-200 hover:border-brandBlue rounded-2xl transition-all cursor-pointer shadow-xs flex flex-wrap items-center justify-between gap-4 group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-navy flex items-center justify-center font-bold font-mono border border-slate-200 group-hover:bg-brandBlue group-hover:text-white transition-colors">
                    {b.seatNumber || 'Seat'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-extrabold text-navy">{b.studentName}</strong>
                      <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                        {b.studentRegistrationNumber || b.registration_number || 'N/A'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5 flex flex-wrap items-center gap-2">
                      <span>Ref: <strong>{b.bookingCode || b.id}</strong></span>
                      <span>•</span>
                      <span>{b.roomName || 'Reading Hall'} ({b.floorName || 'Ground Floor'})</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono text-xs">
                    <span className="text-slate-400 block text-[10px] uppercase font-extrabold">Slot Window</span>
                    <strong className="text-navy">{b.slotTime || b.slotName}</strong>
                  </div>
                  <Button variant="outline" size="sm" className="h-9 px-3 text-xs font-extrabold rounded-xl border-brandBlue text-brandBlue group-hover:bg-brandBlue group-hover:text-white">
                    Select <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. BOOKING CONFIRMATION PREVIEW CARD */}
      {previewBooking && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
        >
          <Card className="border-2 border-indigo-300 bg-gradient-to-r from-indigo-50/60 via-white to-blue-50/40 rounded-3xl p-6 shadow-lg space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-md shrink-0">
                  {previewBooking.avatarUrl ? (
                    <img src={previewBooking.avatarUrl} alt="Student Avatar" className="w-full h-full rounded-2xl object-cover" />
                  ) : (
                    previewBooking.studentName ? previewBooking.studentName.charAt(0).toUpperCase() : 'S'
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider block">Booking Confirmation Preview</span>
                  <h3 className="text-lg font-black text-navy">{previewBooking.studentName}</h3>
                </div>
              </div>

              <Badge className="bg-emerald-600 text-white font-mono font-extrabold text-xs px-3.5 py-1 rounded-xl flex items-center gap-1">
                <ShieldCheck size={14} /> READY FOR CHECK-IN
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-indigo-100 shadow-2xs text-xs font-mono">
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Register / College ID</span>
                <strong className="text-indigo-600 font-bold text-sm">{previewBooking.studentRegistrationNumber || previewBooking.registration_number || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Department</span>
                <strong className="text-navy font-bold">{previewBooking.department || 'N/A'}</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Booking Code</span>
                <strong className="text-teal-600 font-bold">{previewBooking.bookingCode || previewBooking.id}</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Assigned Seat</span>
                <strong className="text-teal-600 font-black text-base">{previewBooking.seatNumber || 'S-01'}</strong>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Library</span>
                <strong className="text-navy font-bold">{previewBooking.libraryName || 'Central Library'}</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Room / Floor</span>
                <strong className="text-slate-800">{previewBooking.roomName || 'Reading Hall'} ({previewBooking.floorName || 'Ground'})</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Booking Date</span>
                <strong className="text-slate-800">{previewBooking.bookingDate || 'Today'}</strong>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Slot Window</span>
                <strong className="text-slate-800">{previewBooking.slotTime || previewBooking.slotName}</strong>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-indigo-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewBooking(null)}
                className="h-11 px-5 text-xs font-bold rounded-2xl border-slate-300 text-slate-700 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={loading}
                onClick={() => handleConfirmCheckIn(previewBooking)}
                className="h-11 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl shadow-md flex items-center gap-2 min-h-[44px]"
              >
                {loading ? (
                  <span className="flex items-center gap-2 font-mono">
                    <RefreshCw size={14} className="animate-spin" /> Verifying...
                  </span>
                ) : (
                  <>
                    <CheckCircle2 size={18} /> Confirm Check-In
                  </>
                )}
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* 6. PROMINENT VERIFICATION RESULT PANEL */}
      <AnimatePresence mode="wait">
        {scanResult && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            aria-live="polite"
          >
            <Card className="border border-slate-200/90 bg-white rounded-3xl p-6 shadow-md overflow-hidden">
              {!scanResult.valid ? (
                /* FAILED VERIFICATION STATE (RED) */
                <div className="p-5 bg-rose-50 border-2 border-rose-300 text-navy rounded-2xl space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-sm font-bold">
                      <AlertTriangle size={22} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-black text-rose-900">Verification Failed</h3>
                      <p className="text-xs text-rose-800 font-extrabold leading-relaxed">
                        {scanResult.message}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-rose-200/80">
                    <Button
                      onClick={handleScanNextStudent}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs h-11 px-5 rounded-2xl shadow-xs min-h-[44px]"
                    >
                      Try Again / Scan Next Student →
                    </Button>
                  </div>
                </div>
              ) : scanResult.isCheckout ? (
                /* CHECKOUT RESULT STATE */
                <div className="p-5 bg-amber-50/80 border-2 border-amber-300 text-navy rounded-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold">
                        <CheckCircle2 size={20} />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-amber-950">✓ Checkout Completed</h3>
                        <span className="text-[11px] font-mono text-amber-800 font-medium">Checked out at {scanResult.verifiedAt}</span>
                      </div>
                    </div>

                    <Badge className="bg-amber-600 text-white font-mono font-extrabold text-xs px-3 py-1 rounded-xl">
                      RELEASED SEAT
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-amber-200/80 text-xs font-mono">
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Student Name</span>
                      <strong className="text-navy font-bold">{scanResult.booking?.studentName || 'Student'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Released Desk</span>
                      <strong className="text-amber-700 font-extrabold text-sm">{scanResult.booking?.seatNumber || 'Seat'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Booking Code</span>
                      <strong className="text-teal-600 font-bold">{scanResult.booking?.bookingCode || scanResult.booking?.id}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <Button
                      onClick={() => handleConfirmCheckout(scanResult.booking)}
                      disabled={loading}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs h-11 px-6 rounded-2xl shadow-sm min-h-[44px]"
                    >
                      Confirm Checkout & Release Seat →
                    </Button>
                    
                    <Button
                      onClick={handleScanNextStudent}
                      variant="outline"
                      className="border-slate-300 text-slate-700 font-bold text-xs h-11 rounded-2xl min-h-[44px]"
                    >
                      Scan Next Student
                    </Button>
                  </div>
                </div>
              ) : (
                /* VERIFIED ENTRY CHECK-IN SUCCESS RESULT STATE (GREEN) */
                <div className="p-5 bg-emerald-50/80 border-2 border-emerald-300 text-navy rounded-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                        <CheckCircle2 size={22} />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-emerald-950">✓ Entry Check-In Verified</h3>
                        <span className="text-[11px] font-mono text-emerald-800 font-medium">Verified & Checked In at {scanResult.verifiedAt}</span>
                      </div>
                    </div>

                    <Badge className="bg-emerald-600 text-white font-mono font-extrabold text-xs px-3.5 py-1 rounded-xl">
                      {scanResult.alreadyCheckedIn ? 'ALREADY CHECKED IN' : 'ENTRY VERIFIED'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-emerald-200/80 text-xs font-mono">
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Student Name</span>
                      <strong className="text-navy font-bold font-sans text-sm">{scanResult.booking?.studentName || 'Student'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Register ID</span>
                      <strong className="text-indigo-600 font-bold">{scanResult.booking?.studentRegistrationNumber || scanResult.booking?.registration_number || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Assigned Seat</span>
                      <strong className="text-teal-600 font-extrabold text-sm">{scanResult.booking?.seatNumber || 'Seat'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block uppercase font-extrabold">Slot Window</span>
                      <strong className="text-slate-800">{scanResult.booking?.slotTime || scanResult.booking?.slotName || 'Morning Slot'}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-emerald-200/80">
                    <Button
                      onClick={handleScanNextStudent}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs h-11 px-6 rounded-2xl shadow-sm min-h-[44px]"
                    >
                      Scan / Lookup Next Student →
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 7. RECENT VERIFICATION ACTIVITY FEED */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold text-navy uppercase tracking-wider flex items-center gap-2">
              <Clock size={16} className="text-teal-600" /> Recent Verifications Log
            </h2>
            <Badge className="bg-slate-100 text-slate-600 font-mono text-[10px] font-bold">
              {recentVerifications.length} Logs
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex gap-1 bg-slate-100 p-0.5 rounded-xl text-[10px] font-bold">
              {['ALL', 'ENTRY', 'CHECKOUT', 'FAILED'].map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActivityFilter(f)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activityFilter === f ? 'bg-white text-navy shadow-xs' : 'text-slate-500 hover:text-navy'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setActivityCollapsibleOpen(prev => !prev)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              {activityCollapsibleOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        {activityCollapsibleOpen && (
          <div>
            {filteredVerifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 font-mono">
                No recent verification events logged for this session.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 uppercase text-[10px] font-extrabold tracking-wider">
                      <th className="p-3">Time</th>
                      <th className="p-3">Reference / Register ID</th>
                      <th className="p-3">Action</th>
                      <th className="p-3">Desk Seat</th>
                      <th className="p-3">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {filteredVerifications.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50 text-slate-700">
                        <td className="p-3 text-slate-400 font-medium">{log.timeStr}</td>
                        <td className="p-3 font-bold text-navy font-sans">{log.reference}</td>
                        <td className="p-3">
                          <span className={`font-bold ${log.action.includes('Checkout') ? 'text-amber-600' : 'text-teal-600'}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 font-extrabold text-navy">{log.seatNumber}</td>
                        <td className="p-3">
                          <Badge className={`text-[10px] font-bold ${log.statusClass}`}>
                            {log.result}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

    </div>
  );
}
