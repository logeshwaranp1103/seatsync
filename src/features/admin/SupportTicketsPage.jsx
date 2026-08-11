import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { notificationService } from '../../services/notificationService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { HelpCircle, MessageSquare, Send, CheckCircle2, User, Clock, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SupportTicketsPage() {
  const { user: adminUser } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const data = (await db.read('seatsync_support_tickets')) || [];
      setTickets(data.reverse());
    } catch (err) {
      console.warn('Failed to load support tickets:', err);
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) {
      toast.error('Please enter a response.');
      return;
    }

    setLoading(true);
    try {
      const list = (await db.read('seatsync_support_tickets')) || [];
      const target = list.find(t => t.id === selectedTicket.id);
      if (target) {
        target.status = 'Resolved';
        target.replyMessage = replyText;
        target.resolvedBy = adminUser?.name || 'Administrator';
        target.resolvedAt = new Date().toISOString();
        await db.write('seatsync_support_tickets', list);

        if (target.studentId) {
          await notificationService.addNotification({
            userId: target.studentId,
            type: 'SUPPORT_TICKET_REPLIED',
            title: `Support Ticket Replied — ${target.subject}`,
            message: `Admin Response: ${replyText}`,
            priority: 'NORMAL'
          });
        }
      }

      toast.success('Reply dispatched and ticket resolved!');
      setSelectedTicket(null);
      setReplyText('');
      await loadTickets();
    } catch (err) {
      toast.error('Failed to send response.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <HelpCircle className="text-indigo-600" size={28} /> Feedback & Support Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Resolve student complaints, booking issues, seat condition reports, and technical support requests.
          </p>
        </div>
      </div>

      {/* TICKETS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <MessageSquare size={18} className="text-indigo-600" /> Student Support Tickets
        </h2>

        {tickets.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No open student support tickets.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Ticket ID</th>
                  <th className="py-3 px-3">Student Name</th>
                  <th className="py-3 px-3">Subject</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {(tickets || []).map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/80 text-slate-700">
                    <td className="py-3 px-3 font-bold text-navy">{t.id}</td>
                    <td className="py-3 px-3 font-sans font-bold text-navy">{t.studentName || 'Student'}</td>
                    <td className="py-3 px-3 font-sans max-w-xs truncate">{t.subject}</td>
                    <td className="py-3 px-3">
                      <Badge className={`text-[10px] font-bold ${
                        t.status === 'Resolved' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
                      }`}>
                        {t.status || 'Open'}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Button
                        onClick={() => setSelectedTicket(t)}
                        className="h-7 px-3 text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg"
                      >
                        Respond
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* RESPOND MODAL */}
      {selectedTicket && (
        <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center justify-between">
                <span>Respond to Ticket {selectedTicket.id}</span>
                <Badge className="bg-indigo-600 text-white text-xs font-bold">
                  {selectedTicket.status}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-mono">
                From: {selectedTicket.studentName}
              </DialogDescription>
            </DialogHeader>

            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1">
              <span className="font-bold text-navy block">{selectedTicket.subject}</span>
              <p className="text-slate-600">{selectedTicket.message}</p>
            </div>

            <form onSubmit={handleSendReply} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Admin Reply Message</label>
                <textarea
                  rows={3}
                  placeholder="Enter official resolution reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl focus:border-indigo-500 outline-none"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
              >
                <Send size={16} /> {loading ? 'Sending Reply...' : 'Dispatch Reply & Resolve Ticket →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
