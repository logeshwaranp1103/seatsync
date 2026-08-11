import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { dashboardService } from '../../services/dashboardService';
import { bookingService } from '../../services/bookingService';
import { waitlistService } from '../../services/waitlistService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { QRCodeCanvas } from 'qrcode.react';
import { buildEntryQrPayload } from '../../utils/qrPayload.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Link, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow, parse, isAfter, isBefore } from 'date-fns';
import { motion, useReducedMotion } from 'framer-motion';
import {
    Users, MapPin, Clock, Clock3, Calendar, AlertTriangle, AlertCircle, ListOrdered,
    ChevronRight, Activity, BookOpen, CheckCircle2, Bell, Sparkles,
    Search, BookmarkCheck, History, User, Info, ArrowRight, ShieldCheck, XCircle,
    Sliders, HelpCircle, Layers, LogOut, ArrowUpRight, QrCode, ChevronUp, Download,
    LogIn, Timer, CheckCheck, Hourglass
} from 'lucide-react';
import toast from 'react-hot-toast';
import WaitlistModal from '../../components/student/WaitlistModal';
import CheckoutQrModal from '../../components/student/CheckoutQrModal';
import { ModernSlotCard, ModernSlotCardSkeleton } from '../../components/student/ModernSlotCard';
import { formatSlotTime, formatSlotRange, getSlotPeriod, formatSlotTitle, sortSlotsChronologically } from '../../utils/timeUtils.js';

function getBookingState(booking) {
    if (!booking) return null;
    const rawStatus = (booking.status || '').toLowerCase();
    if (rawStatus === 'checked_in') return 'CHECKED_IN';
    if (rawStatus === 'completed' || rawStatus === 'checked_out') return 'COMPLETED';
    if (rawStatus === 'cancelled') return 'CANCELLED';
    if (rawStatus === 'checkout_pending') return 'CHECKOUT_PENDING';

    const now = new Date();
    const datePart = booking.bookingDate || format(now, 'yyyy-MM-dd');
    let startDateTime = null;
    let endDateTime = null;

    if (booking.slotTime && booking.slotTime.includes('–')) {
        const [rawStart, rawEnd] = booking.slotTime.split('–').map(s => s.trim());
        try {
            startDateTime = parse(`${datePart} ${rawStart}`, 'yyyy-MM-dd hh:mm a', new Date());
            endDateTime = parse(`${datePart} ${rawEnd}`, 'yyyy-MM-dd hh:mm a', new Date());
        } catch {
            startDateTime = null;
        }
    }

    if (!startDateTime && booking.slotId) {
        const slotMap = {
            'SLOT-01': { start: '08:00 AM', end: '09:00 AM' },
            'SLOT-02': { start: '09:00 AM', end: '10:00 AM' },
            'SLOT-03': { start: '10:00 AM', end: '11:00 AM' },
            'SLOT-04': { start: '11:00 AM', end: '12:00 PM' },
            'SLOT-05': { start: '12:00 PM', end: '01:00 PM' },
            'SLOT-06': { start: '01:00 PM', end: '02:00 PM' },
            'SLOT-07': { start: '02:00 PM', end: '03:00 PM' },
            'SLOT-08': { start: '03:00 PM', end: '04:00 PM' },
            'SLOT-09': { start: '04:00 PM', end: '05:00 PM' },
            'SLOT-10': { start: '05:00 PM', end: '06:00 PM' }
        };
        const def = slotMap[booking.slotId];
        if (def) {
            try {
                startDateTime = parse(`${datePart} ${def.start}`, 'yyyy-MM-dd hh:mm a', new Date());
                endDateTime = parse(`${datePart} ${def.end}`, 'yyyy-MM-dd hh:mm a', new Date());
            } catch {
                startDateTime = null;
            }
        }
    }

    if (!startDateTime) {
        return rawStatus === 'active' ? 'ACTIVE' : 'UPCOMING';
    }

    if (isAfter(now, endDateTime)) return 'COMPLETED';
    if (isAfter(now, startDateTime) && isBefore(now, endDateTime)) return 'ACTIVE';
    return 'UPCOMING';
}

const format12HourTime = formatSlotTime;


export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const shouldReduceMotion = useReducedMotion();

    const [stats, setStats] = useState(null);
    const [libraryInfo, setLibraryInfo] = useState(null);
    const [slotsAvailability, setSlotsAvailability] = useState([]);
    const [seatsList, setSeatsList] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [loading, setLoading] = useState(true);

    const [cancelTarget, setCancelTarget] = useState(null);
    const [cancelling, setCancelling] = useState(false);

    const [waitlistSummaries, setWaitlistSummaries] = useState({});
    const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);
    const [waitlistModalMode, setWaitlistModalMode] = useState('confirm');
    const [targetWaitlistSlot, setTargetWaitlistSlot] = useState(null);

    const [expandedQrBookingId, setExpandedQrBookingId] = useState(null);

    const toggleQrPass = (bookingId) => {
        setExpandedQrBookingId(currentId =>
            String(currentId) === String(bookingId) ? null : bookingId
        );
    };

    const tomorrowDateStr = bookingService.getTomorrowDateStr();

    const fetchWaitlistSummaries = async (slotsList) => {
        try {
            const summaryPromises = slotsList.map(slot =>
                waitlistService.getWaitlistSummaryForSlot(tomorrowDateStr, slot.id, user?.id)
                    .then(res => ({ slotId: slot.id, res }))
                    .catch(() => ({ slotId: slot.id, res: {} }))
            );
            const results = await Promise.all(summaryPromises);
            const summaries = {};
            results.forEach(({ slotId, res }) => { summaries[slotId] = res; });
            setWaitlistSummaries(summaries);
        } catch (err) {
            console.warn('Failed to fetch waitlist summaries in Dashboard:', err);
        }
    };

    const fetchData = useCallback(async () => {
        if (!user) return;
        try {
            setLoading(true);
            const [userStats, libData, slotsData, seatsData] = await Promise.all([
                dashboardService.getStudentStats(user.id).catch(() => ({ tomorrowsBookings: 0, completedReservations: 0, activeBooking: null, upcomingBooking: null, totalStudyHours: 0 })),
                dashboardService.getLibraryInfo().catch(() => ({ libraryName: 'Central Library', operatingHours: '08:00 AM – 10:00 PM', totalSeats: 40 })),
                bookingService.getSlotsAvailability(tomorrowDateStr, user.id).catch(() => []),
                db.read('seatsync_seats').catch(() => [])
            ]);

            setStats(userStats);
            setLibraryInfo(libData);
            setSlotsAvailability(slotsData || []);
            if (seatsData) setSeatsList(seatsData);
            setLastUpdated(new Date());
            fetchWaitlistSummaries(slotsData || []);
        } catch (error) {
            console.error('Error fetching dashboard data', error);
        } finally {
            setLoading(false);
        }
    }, [user, tomorrowDateStr]);

    const [showCheckoutQr, setShowCheckoutQr] = useState(false);
    const [checkoutToken, setCheckoutToken] = useState(null);
    const [isGeneratingCheckoutQr, setIsGeneratingCheckoutQr] = useState(false);

    useEffect(() => {
        if (!user) return;
        try {
            const storedToken = localStorage.getItem('seatsync_checkout_token');
            if (storedToken) {
                const parsed = JSON.parse(storedToken);
                const activeId = stats?.activeBooking?.id;
                if (parsed && parsed.bookingId === activeId && parsed.studentId === user.id) {
                    setCheckoutToken(parsed);
                }
            }
        } catch (err) {
            console.warn('Failed to rehydrate checkout token:', err);
        }
    }, [user, stats?.activeBooking?.id]);

    const handleRequestCheckout = useCallback(async (booking) => {
        if (!booking || !user) return;
        setIsGeneratingCheckoutQr(true);
        try {
            if (checkoutToken && checkoutToken.bookingId === booking.id && new Date(checkoutToken.expiresAt || 0) > new Date()) {
                setShowCheckoutQr(true);
                return;
            }

            const res = await bookingService.requestCheckoutQr(booking.id);
            if (!res.success) {
                toast.error(res.message || 'Failed to generate Checkout QR pass.');
                return;
            }

            setCheckoutToken(res.checkoutPass);
            setShowCheckoutQr(true);
            toast.success('Checkout QR generated — show it to the librarian.');
            fetchData();
        } catch (err) {
            console.error('Checkout request failed:', err);
            toast.error(err.message || 'Failed to generate Checkout QR pass.');
        } finally {
            setIsGeneratingCheckoutQr(false);
        }
    }, [user, checkoutToken, fetchData]);

    useEffect(() => {
        fetchData();
    }, [user]);

    useSync((event) => {
        if (event?.type === 'storage_change' || event?.type === 'login' || event?.type?.startsWith('WAITLIST_')) {
            fetchData();
        }
    });

    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) return 'Good Morning';
        if (hour >= 12 && hour < 17) return 'Good Afternoon';
        return 'Good Evening';
    }, []);

    const handleViewWaitingList = (event, slot) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        setTargetWaitlistSlot(slot);
        setWaitlistModalMode('details');
        setWaitlistModalOpen(true);
    };

    const handleJoinWaitingList = (event, slot) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        setTargetWaitlistSlot(slot);
        setWaitlistModalMode('confirm');
        setWaitlistModalOpen(true);
    };

    const handleCancelBooking = async () => {
        if (!cancelTarget) return;
        setCancelling(true);
        try {
            await bookingService.cancelBooking(cancelTarget.id, user.id);
            toast.success('Booking cancelled successfully');
            setCancelTarget(null);
            fetchData();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel booking');
        } finally {
            setCancelling(false);
        }
    };

    const uniqueSlotsAvailability = useMemo(() => {
        if (!slotsAvailability || !Array.isArray(slotsAvailability)) return [];
        const map = new Map();
        for (const slot of slotsAvailability) {
            const key = slot.slot_occurrence_id || slot.slotOccurrenceId || slot.id;
            if (key && !map.has(key)) {
                map.set(key, slot);
            }
        }
        return sortSlotsChronologically(Array.from(map.values()));
    }, [slotsAvailability]);

    const handleSelectSeat = (e, slot) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const occurrenceId = slot.slot_occurrence_id || slot.slotOccurrenceId || slot.id;
        navigate(`/student/book?slotOccurrenceId=${encodeURIComponent(occurrenceId)}`);
    };

    const activeWaitlistSummary = useMemo(() => {
        const entries = Object.entries(waitlistSummaries);
        for (const [slotId, summary] of entries) {
            if (summary?.isStudentWaiting && summary?.studentEntry) {
                const slot = slotsAvailability.find(s => s.id === slotId || s.slot_occurrence_id === slotId);
                if (slot) return { slot, summary };
            }
        }
        return null;
    }, [waitlistSummaries, slotsAvailability]);

    const libraryDetails = useMemo(() => {
        const totalSeats = libraryInfo?.totalSeats || (seatsList.length > 0 ? seatsList.filter(s => s.status === 'active').length : 40);
        const totalAvail = slotsAvailability.reduce((acc, s) => acc + (s.availableCount || 0), 0);
        const maxCapacity = slotsAvailability.length > 0 ? slotsAvailability.length * totalSeats : 160;
        
        const nextSlot = slotsAvailability.find(s => !s.isFullyBooked) || null;
        const availCount = nextSlot ? nextSlot.availableCount : Math.min(totalSeats, Math.round((totalAvail / Math.max(maxCapacity, 1)) * totalSeats));
        const occupiedCount = Math.max(0, totalSeats - availCount);
        const pct = Math.round((availCount / Math.max(totalSeats, 1)) * 100);

        const now = new Date();
        const currentHour = now.getHours();
        const currentMins = now.getMinutes();
        const isClosed = currentHour < 8 || currentHour >= 22;
        const minutesUntilClose = (22 - currentHour) * 60 - currentMins;
        const hrsLeft = Math.floor(minutesUntilClose / 60);
        const minsLeft = minutesUntilClose % 60;
        const isClosingSoon = !isClosed && minutesUntilClose <= 60;

        let statusLabel = 'Open Today';
        let statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        let timeText = `Closes in ${hrsLeft > 0 ? `${hrsLeft} hr ` : ''}${minsLeft} min`;

        if (isClosed) {
            statusLabel = 'Closed';
            statusBadgeClass = 'bg-red-50 text-red-700 border-red-200';
            timeText = 'Opens tomorrow at 08:00 AM';
        } else if (isClosingSoon) {
            statusLabel = 'Closing Soon';
            statusBadgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
        }

        let occupancyBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        let occupancyText = 'High availability';
        if (availCount === 0) {
            occupancyBadgeClass = 'bg-red-100 text-red-800 border-red-300';
            occupancyText = 'Full';
        } else if (pct < 20) {
            occupancyBadgeClass = 'bg-red-100 text-red-800 border-red-300';
            occupancyText = 'Nearly Full';
        } else if (pct <= 50) {
            occupancyBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
            occupancyText = 'Limited';
        }

        let progressColor = 'bg-emerald-500';
        let availabilityDesc = 'High availability — many seats are open.';
        if (pct === 0) {
            progressColor = 'bg-red-500';
            availabilityDesc = 'Fully booked — join the waiting list.';
        } else if (pct < 20) {
            progressColor = 'bg-red-500';
            availabilityDesc = 'Nearly full — only a few seats remain.';
        } else if (pct <= 50) {
            progressColor = 'bg-amber-500';
            availabilityDesc = 'Limited availability — book soon.';
        } else {
            progressColor = 'bg-emerald-500';
            availabilityDesc = 'Good availability — multiple zones have open seats.';
        }

        let bestZoneText = 'Zone B • Group Study';
        let bestZoneAvail = Math.max(1, Math.round(availCount * 0.6));
        if (seatsList.length > 0) {
            const activeSeats = seatsList.filter(s => s.status === 'active');
            const zoneACount = activeSeats.filter(s => s.zoneId === 'zone-a').length;
            const zoneBCount = activeSeats.filter(s => s.zoneId === 'zone-b').length;
            
            const ratio = totalSeats > 0 ? availCount / totalSeats : 1;
            const availA = Math.round(zoneACount * ratio);
            const availB = Math.round(zoneBCount * ratio);

            if (availB >= availA && availB > 0) {
                bestZoneText = `Zone B • Group Study`;
                bestZoneAvail = availB;
            } else if (availA > 0) {
                bestZoneText = `Zone A • Quiet Study`;
                bestZoneAvail = availA;
            } else {
                bestZoneText = `No zone currently available`;
                bestZoneAvail = 0;
            }
        }

        let noticeType = 'blue';
        let noticeMessage = 'Check-in opens 15 minutes before your reserved slot.';
        let noticeTitle = 'Library Guideline';

        if (isClosed) {
            noticeType = 'red';
            noticeTitle = 'Library Closed';
            noticeMessage = 'The library is currently closed. Bookings are available for tomorrow.';
        } else if (isClosingSoon) {
            noticeType = 'amber';
            noticeTitle = 'Closing Soon Notice';
            noticeMessage = 'The library closes in less than one hour.';
        } else if (slotsAvailability.length > 0 && slotsAvailability.every(s => s.isFullyBooked)) {
            noticeType = 'amber';
            noticeTitle = 'High Demand';
            noticeMessage = 'All upcoming slots are full. Waiting lists are available.';
        } else if (currentHour >= 18) {
            noticeType = 'blue';
            noticeTitle = 'Quiet Hours Active';
            noticeMessage = 'Quiet Study Hours begin in Zone A at 6:00 PM.';
        } else {
            noticeType = 'blue';
            noticeTitle = 'Smart Tip';
            noticeMessage = libraryInfo?.notice || 'Check-in opens 15 minutes before your reserved slot.';
        }

        let ctaLabel = 'View Seat Availability';
        let ctaPath = '/student/find-seat';
        if (isClosed) {
            ctaLabel = 'View Tomorrow’s Slots';
            ctaPath = '/student/find-seat';
        } else if (slotsAvailability.length > 0 && slotsAvailability.every(s => s.isFullyBooked)) {
            ctaLabel = 'View Waiting Lists';
            ctaPath = '/student/waitlist';
        } else if (pct < 20) {
            ctaLabel = 'Find an Available Seat';
            ctaPath = '/student/find-seat';
        }

        return {
            totalSeats,
            availCount,
            occupiedCount,
            pct,
            isClosed,
            isClosingSoon,
            statusLabel,
            statusBadgeClass,
            timeText,
            occupancyBadgeClass,
            occupancyText,
            nextSlot,
            bestZoneText,
            bestZoneAvail,
            progressColor,
            availabilityDesc,
            noticeType,
            noticeTitle,
            noticeMessage,
            ctaLabel,
            ctaPath
        };
    }, [libraryInfo, slotsAvailability, seatsList]);

    const activeOrUpcoming = stats?.activeBooking || stats?.upcomingBooking;
    const bookingState = useMemo(() => getBookingState(activeOrUpcoming), [activeOrUpcoming]);

    if (loading) {
        return (
            <div className="space-y-6 max-w-7xl mx-auto animate-pulse">
                <div className="h-48 bg-white rounded-3xl border border-slate-200 p-6"></div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-slate-200"></div>)}
                </div>
                <div className="grid lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 h-72 bg-white rounded-2xl border border-slate-200"></div>
                    <div className="h-72 bg-white rounded-2xl border border-slate-200"></div>
                </div>
            </div>
        );
    }

    const getSlotAvailabilityStatus = (slot) => {
        const slotStatus = String(slot.occurrenceStatus ?? slot.status ?? (slot.isDisabledByAdmin ? "DISABLED" : "ACTIVE")).toUpperCase();
        const isSlotCancelled = slotStatus === "DISABLED" || slotStatus === "CANCELLED" || slot.isDisabledByAdmin === true || slot.isDisabled === true;

        if (isSlotCancelled) {
            return {
                text: 'Cancelled',
                percent: 0,
                color: 'bg-slate-300',
                badgeClass: 'bg-red-100 text-red-800 border-red-300 font-bold',
                isSlotCancelled: true
            };
        }

        const avail = Number(slot.availableCount || 0);
        const total = Number(slot.totalCount || 40);
        const pct = Math.round((avail / total) * 100);

        if (avail === 0) {
            return {
                text: 'Full',
                percent: 0,
                color: 'bg-red-500',
                badgeClass: 'bg-red-100 text-red-800 border-red-300 font-bold',
                isSlotCancelled: false
            };
        }
        if (pct <= 25) {
            return {
                text: 'Filling Fast',
                percent: pct,
                color: 'bg-amber-500',
                badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-bold',
                isSlotCancelled: false
            };
        }
        return {
            text: `${avail} Open`,
            percent: pct,
            color: 'bg-emerald-500',
            badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
            isSlotCancelled: false
        };
    };

    return (
        <div className="space-y-8 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

            {/* 1. HERO WELCOME BANNER */}
            <div className="relative rounded-3xl bg-gradient-to-r from-navy via-slate-900 to-indigo-950 p-6 sm:p-8 text-white overflow-hidden shadow-xl border border-slate-800">
                <div className="relative z-10 space-y-4 max-w-3xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-blue-200 border border-white/10">
                        <Sparkles size={14} className="text-amber-400" /> SeatSync Student Dashboard
                    </div>
                    <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight">
                        {greeting}, <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">{user?.name}</span>
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
                        Reserve your tomorrow's library seat, track active passes, and manage your waiting list queues smoothly.
                    </p>

                    <div className="pt-2 flex flex-wrap items-center gap-3">
                        <Button
                            onClick={() => navigate('/student/find-seat')}
                            className="bg-brandBlue hover:bg-blue-600 text-white font-bold h-10 px-5 rounded-xl text-xs shadow-md shadow-brandBlue/30 border border-blue-400/30"
                        >
                            Book Tomorrow's Seat <ArrowRight size={14} className="ml-1.5" />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => navigate('/student/reservations')}
                            className="bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold h-10 px-4 rounded-xl text-xs backdrop-blur-sm"
                        >
                            My Reservations
                        </Button>
                    </div>
                </div>

                <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-15 pointer-events-none flex items-center justify-center">
                    <BookOpen size={280} className="text-white" />
                </div>
            </div>

            {/* 2. STATS CARDS GRID */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border border-slate-200/90 shadow-xs hover:border-brandBlue/40 transition-all rounded-2xl bg-white">
                    <CardContent className="p-4 sm:p-5 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center shrink-0 border border-blue-100">
                            <BookmarkCheck size={22} />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Tomorrow's Booking</p>
                            <h3 className="text-lg font-black text-navy mt-0.5">
                                {stats?.tomorrowsBookings > 0 ? (
                                    <span className="text-emerald-700 flex items-center gap-1">
                                        Confirmed <CheckCircle2 size={16} />
                                    </span>
                                ) : (
                                    <span className="text-slate-400">None</span>
                                )}
                            </h3>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-slate-200/90 shadow-xs hover:border-emerald-500/40 transition-all rounded-2xl bg-white">
                    <CardContent className="p-4 sm:p-5 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                            <Activity size={22} />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed Sessions</p>
                            <h3 className="text-xl font-black text-navy mt-0.5">{stats?.completedReservations || 0}</h3>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-slate-200/90 shadow-xs hover:border-amber-500/40 transition-all rounded-2xl bg-white">
                    <CardContent className="p-4 sm:p-5 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-100">
                            <Users size={22} />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Waiting List Queue</p>
                            <h3 className="text-xl font-black text-navy mt-0.5">
                                {activeWaitlistSummary ? (
                                    <span className="text-amber-700 font-bold">Pos #{activeWaitlistSummary.summary.studentPosition}</span>
                                ) : (
                                    <span className="text-slate-400">Not queued</span>
                                )}
                            </h3>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-slate-200/90 shadow-xs hover:border-purple-500/40 transition-all rounded-2xl bg-white">
                    <CardContent className="p-4 sm:p-5 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-100">
                            <Clock size={22} />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Study Hours Logged</p>
                            <h3 className="text-xl font-black text-navy mt-0.5">{Math.round(stats?.totalStudyHours || 0)} hrs</h3>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* 3. MAIN DASHBOARD CONTENT GRID */}
            <div className="grid lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2 space-y-8">

                    {/* ACTIVE OR UPCOMING BOOKING PASS CARD */}
                    {activeOrUpcoming ? (
                        <Card className="border-2 border-brandBlue/30 shadow-md rounded-2xl bg-white overflow-hidden">
                            <CardHeader className="bg-gradient-to-r from-blue-50/80 to-slate-50 border-b border-slate-200/80 pb-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Badge className={`font-bold text-xs px-3 py-1 text-white ${
                                            bookingState === 'CHECKED_IN' ? 'bg-emerald-600' :
                                            bookingState === 'ACTIVE' ? 'bg-brandBlue' : 'bg-slate-700'
                                        }`}>
                                            {bookingState === 'CHECKED_IN' ? '✓ CHECKED IN' : bookingState === 'ACTIVE' ? 'Active Session' : 'Upcoming Pass'}
                                        </Badge>
                                        <span className="text-xs font-mono font-bold text-slate-500">ID: {activeOrUpcoming.bookingCode || activeOrUpcoming.id}</span>
                                    </div>
                                    <span className="text-xs font-bold text-slate-600 font-mono">
                                        Date: {activeOrUpcoming.bookingDate}
                                    </span>
                                </div>
                            </CardHeader>

                            <CardContent className="p-6 space-y-6">
                                <div className="grid sm:grid-cols-3 gap-4 bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Seat</span>
                                        <span className="text-xl font-black text-navy flex items-center gap-1.5">
                                            <MapPin size={18} className="text-brandBlue" /> {(() => {
                                              const sn = activeOrUpcoming.seatNumber;
                                              if (!sn) return 'S-01';
                                              const str = String(sn).trim();
                                              if (str.length > 20 || str.includes('-4cbf-') || str.match(/^[0-9a-f-]{36}$/i)) {
                                                return 'S-01';
                                              }
                                              return str;
                                            })()}
                                        </span>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Time Slot</span>
                                        <span className="text-sm font-bold text-navy font-mono flex items-center gap-1">
                                            <Clock size={15} className="text-brandBlue" /> {activeOrUpcoming.slotTime}
                                        </span>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Floor / Zone</span>
                                        <span className="text-sm font-bold text-navy">
                                            {activeOrUpcoming.floorName || 'Ground Floor'}
                                        </span>
                                    </div>
                                </div>

                                {/* QR Pass Expansion */}
                                {expandedQrBookingId === activeOrUpcoming.id && (
                                    <div className="p-5 bg-blue-50/60 border border-blue-200 rounded-2xl text-center space-y-4 animate-in fade-in duration-200 flex flex-col items-center">
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 inline-block shadow-sm">
                                            <QRCodeCanvas
                                                id={`qr-canvas-dash-${activeOrUpcoming.id}`}
                                                value={buildEntryQrPayload(activeOrUpcoming.qrToken || activeOrUpcoming.id)}
                                                size={160}
                                                level="H"
                                                includeMargin={true}
                                            />
                                        </div>
                                        <div className="space-y-1 text-center">
                                            <p className="text-xs font-bold text-navy font-mono">TOKEN: {activeOrUpcoming.qrToken || activeOrUpcoming.id}</p>
                                            <p className="text-[11px] text-slate-500 font-medium">Show this pass to the librarian at the entrance desk.</p>
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => toggleQrPass(activeOrUpcoming.id)}
                                        className="h-10 text-xs font-bold border-brandBlue/30 text-brandBlue hover:bg-blue-50 rounded-xl"
                                    >
                                        <QrCode size={14} className="mr-1.5" />
                                        {expandedQrBookingId === activeOrUpcoming.id ? 'Hide Entry Pass' : 'View Entry Pass'}
                                    </Button>

                                    {bookingState === 'CHECKED_IN' || bookingState === 'ACTIVE' ? (
                                        <Button
                                            type="button"
                                            disabled={isGeneratingCheckoutQr}
                                            onClick={() => handleRequestCheckout(activeOrUpcoming)}
                                            className="h-10 text-xs font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl shadow-xs disabled:opacity-50"
                                        >
                                            <LogOut size={14} className="mr-1.5" />
                                            {isGeneratingCheckoutQr ? 'Generating Checkout QR...' : 'Request Checkout QR'}
                                        </Button>
                                    ) : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setCancelTarget(activeOrUpcoming)}
                                            className="h-10 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                                        >
                                            Cancel Booking
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="border border-slate-200/90 shadow-xs rounded-2xl bg-white p-8 text-center space-y-4">
                            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center mx-auto border border-blue-100">
                                <BookmarkCheck size={28} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-bold text-navy">No Active Booking Found</h3>
                                <p className="text-xs text-slate-500 font-medium max-w-md mx-auto">
                                    You don't have any seat reserved for tomorrow. Select a slot to reserve your seat.
                                </p>
                            </div>
                            <Button
                                onClick={() => navigate('/student/find-seat')}
                                className="bg-brandBlue hover:bg-blue-700 text-white font-bold h-10 px-6 rounded-xl text-xs shadow-sm"
                            >
                                Book a Seat Now <ArrowRight size={14} className="ml-1.5" />
                            </Button>
                        </Card>
                    )}

                    {/* TOMORROW'S SLOTS PREVIEW GRID */}
                    <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <div className="flex items-center gap-3">
                                    <Clock3 className="h-6 w-6 text-blue-600 shrink-0" />
                                    <h2 className="text-2xl font-bold tracking-tight text-slate-950">
                                        Tomorrow’s Available Slots
                                    </h2>
                                </div>

                                <p className="mt-1 text-sm font-medium text-slate-500">
                                    {format(new Date(tomorrowDateStr), 'EEEE, d MMMM')} • Fixed 1-hour sessions
                                </p>
                            </div>

                            <div className="text-sm font-medium text-slate-600">
                                <span className="font-bold text-slate-950">
                                    {libraryInfo?.totalSeats || (uniqueSlotsAvailability[0]?.operationalSeats) || 40}
                                </span>
                                {' '}student seats
                            </div>
                        </div>

                        {loading ? (
                            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {[1, 2, 3, 4, 5, 6].map(i => (
                                    <ModernSlotCardSkeleton key={i} />
                                ))}
                            </div>
                        ) : (
                            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {uniqueSlotsAvailability.map((slot, index) => (
                                    <ModernSlotCard
                                        key={slot.slot_occurrence_id || slot.id}
                                        slot={slot}
                                        context="dashboard"
                                        waitlistSummary={waitlistSummaries[slot.id] || {}}
                                        index={index}
                                        onSelectSlot={handleSelectSeat}
                                        onViewReservation={() => navigate('/student/reservations')}
                                        onJoinWaitlist={(e, s) => handleJoinWaitingList(e, s)}
                                        onViewWaitlist={(e, s) => handleViewWaitingList(e, s)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* SIDE COLUMN */}
                <div className="space-y-8">
                    {/* LIBRARY INFORMATION CARD */}
                    <Card id="info-panel" className="border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden">
                        <CardHeader className="pb-3 border-b border-slate-100 bg-slate-50/80">
                            <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                                <Info size={18} className="text-brandBlue" /> Library Information
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5 space-y-4 text-xs">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-3 border-b border-slate-100">
                                <span className="text-slate-500 font-semibold">Current Status</span>
                                <div className="flex flex-wrap items-center gap-1.5 justify-end">
                                    <span className={`font-bold text-xs px-2.5 py-0.5 rounded-full flex items-center gap-1.5 ${libraryDetails.statusBadgeClass}`}>
                                        <span className={`h-2 w-2 rounded-full ${libraryDetails.isClosed ? 'bg-red-500' : libraryDetails.isClosingSoon ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                                        {libraryDetails.statusLabel}
                                    </span>
                                    {!libraryDetails.isClosed && (
                                        <span className="text-[11px] font-semibold text-slate-500 font-mono">
                                            • {libraryDetails.timeText}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                <span className="text-slate-500 font-semibold">Today’s Hours</span>
                                <span className="font-bold text-navy font-mono text-right">
                                    {libraryDetails.isClosed 
                                        ? 'Closed Today • Opens tomorrow at 08:00 AM' 
                                        : (libraryInfo?.operatingHours || '08:00 AM – 10:00 PM')}
                                </span>
                            </div>

                            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                <span className="text-slate-500 font-semibold">Live Occupancy</span>
                                <div className="text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                        <span className="font-bold text-navy">{libraryDetails.occupiedCount} of {libraryDetails.totalSeats} seats occupied</span>
                                        <Badge variant="outline" className={`text-[10px] font-extrabold px-2 py-0.5 ${libraryDetails.occupancyBadgeClass}`}>
                                            {libraryDetails.occupancyText}
                                        </Badge>
                                    </div>
                                    <span className="text-[11px] font-semibold text-slate-500 block mt-0.5">
                                        {libraryDetails.availCount} seats currently available
                                    </span>
                                </div>
                            </div>

                            <div className="flex justify-between items-start pb-3 border-b border-slate-100 gap-2">
                                <span className="text-slate-500 font-semibold shrink-0">Next Available Slot</span>
                                <div className="text-right">
                                    {libraryDetails.nextSlot ? (
                                        <>
                                            <span className="font-bold text-navy block font-mono">{libraryDetails.nextSlot.label} • {libraryDetails.nextSlot.startTime}</span>
                                            <span className="text-[11px] font-semibold text-emerald-700 block mt-0.5">{libraryDetails.nextSlot.availableCount} seats available</span>
                                        </>
                                    ) : slotsAvailability.length > 0 && slotsAvailability.every(s => s.isFullyBooked) ? (
                                        <>
                                            <span className="font-bold text-amber-800 block">All upcoming slots are full</span>
                                            <span className="text-[11px] font-semibold text-amber-600 block mt-0.5">Waiting list available</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="font-bold text-slate-700 block">No more slots today</span>
                                            <span className="text-[11px] font-semibold text-slate-500 block mt-0.5">Check tomorrow’s availability</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                                <span className="text-slate-500 font-semibold">Best Available Zone</span>
                                <div className="text-right">
                                    <span className="font-bold text-navy">{libraryDetails.bestZoneText}</span>
                                    {libraryDetails.bestZoneAvail > 0 && (
                                        <span className="text-[11px] font-semibold text-slate-500 block mt-0.5">{libraryDetails.bestZoneAvail} seats available</span>
                                    )}
                                </div>
                            </div>

                            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="text-navy">Current Availability</span>
                                    <span className="text-slate-600 font-mono">{libraryDetails.availCount} of {libraryDetails.totalSeats} seats available ({libraryDetails.pct}%)</span>
                                </div>

                                <div
                                    role="progressbar"
                                    aria-valuenow={libraryDetails.pct}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label="Seat availability progress"
                                    className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden"
                                >
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ${libraryDetails.progressColor}`}
                                        style={{ width: `${libraryDetails.pct}%` }}
                                    />
                                </div>

                                <p className="text-[11px] text-slate-600 font-medium pt-0.5">
                                    {libraryDetails.availabilityDesc}
                                </p>
                            </div>

                            <div className={`p-3 rounded-xl border space-y-1 ${
                                libraryDetails.noticeType === 'red' ? 'bg-red-50 border-red-200 text-red-950' :
                                libraryDetails.noticeType === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-950' :
                                libraryDetails.noticeType === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-950' :
                                'bg-blue-50 border-blue-200 text-blue-950'
                            }`}>
                                <div className={`font-bold flex items-center gap-1.5 ${
                                    libraryDetails.noticeType === 'red' ? 'text-red-900' :
                                    libraryDetails.noticeType === 'amber' ? 'text-amber-900' :
                                    libraryDetails.noticeType === 'green' ? 'text-emerald-900' :
                                    'text-blue-900'
                                }`}>
                                    {libraryDetails.noticeType === 'red' ? <AlertTriangle size={14} className="text-red-600 shrink-0" /> :
                                     libraryDetails.noticeType === 'amber' ? <Clock size={14} className="text-amber-600 shrink-0" /> :
                                     libraryDetails.noticeType === 'green' ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" /> :
                                     <Info size={14} className="text-brandBlue shrink-0" />}
                                    <span>{libraryDetails.noticeTitle}</span>
                                </div>
                                <p className="text-[11px] leading-relaxed font-medium">
                                    {libraryDetails.noticeMessage}
                                </p>
                            </div>

                            <Button
                                type="button"
                                onClick={() => navigate(libraryDetails.ctaPath)}
                                className="w-full h-10 text-xs font-bold bg-brandBlue hover:bg-blue-700 text-white rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all"
                            >
                                {libraryDetails.ctaLabel} <ArrowUpRight size={14} />
                            </Button>

                            <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 font-medium" aria-live="polite">
                                <span className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live availability
                                </span>
                                <span>Updated just now</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
                <DialogContent className="sm:max-w-md rounded-2xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
                            <AlertTriangle className="text-red-500" size={20} /> Cancel Reservation?
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 pt-1">
                            Are you sure you want to cancel your seat booking for <strong>{cancelTarget?.seatNumber}</strong>?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                        <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling} className="rounded-xl text-xs">
                            Keep Booking
                        </Button>
                        <Button onClick={handleCancelBooking} disabled={cancelling} className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs">
                            {cancelling ? 'Cancelling...' : 'Yes, Cancel Pass'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <WaitlistModal
                isOpen={waitlistModalOpen}
                onClose={() => setWaitlistModalOpen(false)}
                mode={waitlistModalMode}
                slot={targetWaitlistSlot}
                dateStr={tomorrowDateStr}
                user={user}
                summary={targetWaitlistSlot ? waitlistSummaries[targetWaitlistSlot.id] : null}
                onSuccess={fetchData}
            />

            <CheckoutQrModal
                isOpen={showCheckoutQr}
                onClose={() => setShowCheckoutQr(false)}
                passData={checkoutToken}
                onCheckoutCompleted={() => {
                    fetchData();
                    setShowCheckoutQr(false);
                }}
            />
        </div>
    );
}
