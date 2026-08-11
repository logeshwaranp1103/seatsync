import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  AlertOctagon, Plus, ShieldAlert, FileText, Search, User, MapPin, Clock, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function IncidentReportsPage() {
  const { user: staffUser } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);

  // Form State
  const [category, setCategory] = useState('Noise Complaint');
  const [location, setLocation] = useState('Main Reading Hall');
  const [studentName, setStudentName] = useState('');
  const [severity, setSeverity] = useState('Medium');
  const [description, setDescription] = useState('');
  const [actionTaken, setActionTaken] = useState('Verbal Warning Issued');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = (await db.read('seatsync_incidents')) || [];
      setIncidents(data.reverse());
    } catch (err) {
      console.warn('Failed to load incident reports:', err);
    }
  };

  const handleCreateIncident = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error('Please describe the incident.');
      return;
    }

    setLoading(true);
    try {
      await librarianService.createIncidentReport({
        category,
        location,
        studentName,
        severity,
        description,
        actionTaken,
        staffUser
      });

      toast.success('Incident report logged successfully!');
      setIsModalOpen(false);
      setDescription('');
      setStudentName('');
      await loadData();
    } catch (err) {
      toast.error('Failed to log incident report.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <AlertOctagon className="text-teal-600" size={28} /> Library Operational Incident Log
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Record, investigate, and maintain audit records of library misconduct, property misuse, or safety concerns.
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-xs flex items-center gap-2"
        >
          <Plus size={16} /> Log Operational Incident
        </Button>
      </div>

      {/* INCIDENTS TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <FileText size={18} className="text-teal-600" /> Recorded Incident Reports
        </h2>

        {incidents.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">No operational incidents logged.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">ID</th>
                  <th className="py-3 px-3">Date/Time</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Location</th>
                  <th className="py-3 px-3">Student</th>
                  <th className="py-3 px-3">Severity</th>
                  <th className="py-3 px-3">Action Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {incidents.map(inc => (
                  <tr
                    key={inc.id}
                    onClick={() => setSelectedIncident(inc)}
                    className="hover:bg-slate-50 text-slate-700 cursor-pointer"
                  >
                    <td className="py-3 px-3 font-bold text-navy">{inc.id}</td>
                    <td className="py-3 px-3 text-slate-500 text-[11px]">{new Date(inc.createdAt).toLocaleString()}</td>
                    <td className="py-3 px-3 text-slate-800 font-sans font-semibold">{inc.category}</td>
                    <td className="py-3 px-3 text-slate-600 font-sans">{inc.location}</td>
                    <td className="py-3 px-3 text-teal-600 font-bold font-sans">{inc.studentName || 'N/A'}</td>
                    <td className="py-3 px-3">
                      <Badge className={`text-[10px] font-bold ${
                        inc.severity === 'Critical' || inc.severity === 'High' ? 'bg-red-600 text-white' :
                        inc.severity === 'Medium' ? 'bg-amber-600 text-white' :
                        'bg-slate-500 text-white'
                      }`}>
                        {inc.severity}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-sans truncate max-w-xs">{inc.actionTaken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CREATE MODAL */}
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <AlertOctagon className="text-teal-600" size={20} /> Log Operational Incident
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Record staff incident notes for library administrative review.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateIncident} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Incident Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
                >
                  <option value="Noise Complaint">Noise Complaint</option>
                  <option value="Invalid Booking Attempt">Invalid Booking Attempt</option>
                  <option value="Seat Misuse / Unattended Belongings">Seat Misuse / Unattended Belongings</option>
                  <option value="Property Damage">Property Damage</option>
                  <option value="Student Misconduct">Student Misconduct</option>
                  <option value="Safety Concern">Safety Concern</option>
                  <option value="Other">Other Operational Concern</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Location</label>
                  <Input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Student Name / Reg ID (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. Rahul Sharma (24AD042)"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Incident Description</label>
                <Input
                  type="text"
                  placeholder="Provide clear details of what occurred..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Action Taken</label>
                <Input
                  type="text"
                  placeholder="e.g. Verbal warning, seat vacated..."
                  value={actionTaken}
                  onChange={(e) => setActionTaken(e.target.value)}
                  className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2"
              >
                {loading ? 'Submitting...' : 'Save Incident Report →'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* DETAILS DRAWER */}
      {selectedIncident && (
        <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center justify-between">
                <span>Incident {selectedIncident.id}</span>
                <Badge className="bg-amber-600 text-white text-xs font-bold">
                  {selectedIncident.severity}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Logged on {new Date(selectedIncident.createdAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2 text-xs font-sans">
              <p className="text-slate-600">Category: <span className="font-bold text-navy">{selectedIncident.category}</span></p>
              <p className="text-slate-600">Location: <span className="font-bold text-navy">{selectedIncident.location}</span></p>
              <p className="text-slate-600">Student: <span className="font-bold text-teal-600">{selectedIncident.studentName || 'N/A'}</span></p>
              <p className="text-slate-600 pt-1">Description: <span className="text-slate-800 block mt-0.5">{selectedIncident.description}</span></p>
              <p className="text-slate-600 pt-1">Action Taken: <span className="text-slate-800 block mt-0.5">{selectedIncident.actionTaken}</span></p>
            </div>

            <Button
              onClick={() => setSelectedIncident(null)}
              className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs h-10 rounded-xl"
            >
              Close Record
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
