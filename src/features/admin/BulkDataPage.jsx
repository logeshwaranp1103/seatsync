import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { adminService } from '../../services/adminService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BulkDataPage() {
  const { user: adminUser } = useAuth();
  const [step, setStep] = useState('UPLOAD'); // UPLOAD, PREVIEW, COMPLETE
  const [importType, setImportType] = useState('STUDENTS');
  const [fileText, setFileText] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const sampleCsvTemplates = {
    STUDENTS: `name,email,collegeId,department\nJohn Doe,john@college.edu,24AD088,Artificial Intelligence\nJane Smith,jane@college.edu,24AD089,Computer Science`,
    STAFF: `name,email,staffId,department\nOfficer Robert,robert@college.edu,LIB-005,Library Access Control`,
    SEATS: `seatNumber,floorName,roomName\nS-101,Ground Floor,Main Quiet Reading Hall\nS-102,Ground Floor,Main Quiet Reading Hall`
  };

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(sampleCsvTemplates[importType]);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `seatsync_bulk_${importType.toLowerCase()}_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Downloaded ${importType} CSV template.`);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      setFileText(text);

      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        toast.error('CSV file is empty or missing data rows.');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map((line, idx) => {
        const vals = line.split(',').map(v => v.trim());
        const rowObj = { _rowId: idx + 1, isValid: true, error: null };
        headers.forEach((h, i) => {
          rowObj[h] = vals[i] || '';
        });
        if (!rowObj.name && !rowObj.seatNumber) {
          rowObj.isValid = false;
          rowObj.error = 'Missing primary identifier';
        }
        return rowObj;
      });

      setParsedRows(rows);
      setStep('PREVIEW');
      toast.success(`Validated ${rows.length} rows in CSV!`);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    const validRows = parsedRows.filter(r => r.isValid);
    if (validRows.length === 0) {
      toast.error('No valid rows to import.');
      return;
    }

    setLoading(true);
    try {
      if (importType === 'STUDENTS' || importType === 'STAFF') {
        const users = (await db.read('seatsync_users')) || [];
        validRows.forEach(r => {
          users.push({
            id: `USR-${Date.now()}-${r._rowId}`,
            name: r.name,
            email: r.email,
            role: importType === 'STUDENTS' ? 'STUDENT' : 'LIBRARIAN',
            collegeId: r.collegeId || r.staffId,
            department: r.department || 'General'
          });
        });
        await db.write('seatsync_users', users);
      } else if (importType === 'SEATS') {
        const seats = (await db.read('seatsync_seats')) || [];
        validRows.forEach(r => {
          seats.push({
            id: `SEAT-${Date.now()}-${r._rowId}`,
            seatNumber: r.seatNumber,
            floorName: r.floorName || 'Ground Floor',
            roomName: r.roomName || 'Main Reading Hall',
            status: 'available'
          });
        });
        await db.write('seatsync_seats', seats);
      }

      await adminService.logAudit({
        userName: adminUser?.name || 'Administrator',
        action: 'BULK_DATA_IMPORTED',
        affectedRecord: `Imported ${validRows.length} ${importType} records`,
        result: 'SUCCESS',
        notes: `Bulk import wizard step complete`
      });

      setStep('COMPLETE');
      toast.success(`Successfully imported ${validRows.length} records!`);
    } catch (err) {
      toast.error('Import failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="text-indigo-600" size={28} /> Bulk Data Import Wizard
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Staged CSV import wizard: Upload → Validate → Preview → Confirm → Execute.
          </p>
        </div>

        <Button onClick={handleDownloadTemplate} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-10 px-4">
          <Download size={16} className="mr-1.5" /> Download CSV Template
        </Button>
      </div>

      {/* STEP INDICATOR */}
      <div className="flex items-center justify-between p-4 bg-white border border-slate-200/80 rounded-2xl text-xs font-bold font-mono shadow-xs">
        <span className={step === 'UPLOAD' ? 'text-indigo-600 font-black' : 'text-slate-400'}>1. UPLOAD CSV</span>
        <span>→</span>
        <span className={step === 'PREVIEW' ? 'text-indigo-600 font-black' : 'text-slate-400'}>2. VALIDATE & PREVIEW</span>
        <span>→</span>
        <span className={step === 'COMPLETE' ? 'text-emerald-600 font-black' : 'text-slate-400'}>3. CONFIRM & IMPORT</span>
      </div>

      {/* STEP 1: UPLOAD */}
      {step === 'UPLOAD' && (
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-8 shadow-xs text-center space-y-6">
          <div className="space-y-2 max-w-sm mx-auto">
            <label className="text-xs font-bold text-slate-700 block">Select Data Entity Type</label>
            <select
              value={importType}
              onChange={(e) => setImportType(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
            >
              <option value="STUDENTS">Students Roster</option>
              <option value="STAFF">Librarian Staff Roster</option>
              <option value="SEATS">Seat Inventory Records</option>
            </select>
          </div>

          <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-500 rounded-3xl p-8 max-w-md mx-auto space-y-4 bg-slate-50/60 transition-colors">
            <Upload size={36} className="text-indigo-600 mx-auto" />
            <div>
              <p className="text-sm font-bold text-navy">Upload CSV File</p>
              <p className="text-xs text-slate-500 font-medium">Select a valid .csv file from your computer</p>
            </div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
            />
          </div>
        </Card>
      )}

      {/* STEP 2: PREVIEW */}
      {step === 'PREVIEW' && (
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-navy">Data Row Validation Preview</h2>
            <Badge className="bg-teal-600 text-white text-xs">
              Rows: {parsedRows.length}
            </Badge>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-[10px] uppercase">
                  <th className="py-2 px-3">Row #</th>
                  <th className="py-2 px-3">Name / Code</th>
                  <th className="py-2 px-3">Email / Detail</th>
                  <th className="py-2 px-3">Validation Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(parsedRows || []).map(r => (
                  <tr key={r._rowId} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500">#{r._rowId}</td>
                    <td className="py-2 px-3 text-navy font-sans font-bold">{r.name || r.seatNumber}</td>
                    <td className="py-2 px-3 text-slate-600">{r.email || r.floorName || '-'}</td>
                    <td className="py-2 px-3">
                      <Badge className={r.isValid ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}>
                        {r.isValid ? 'VALID' : r.error}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => setStep('UPLOAD')} variant="outline" className="border-slate-300 text-slate-600 h-10 text-xs font-bold rounded-xl flex-1">
              ← Cancel & Choose Another File
            </Button>
            <Button onClick={handleConfirmImport} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 rounded-xl flex-1 shadow-xs">
              {loading ? 'Importing...' : 'Confirm & Import Valid Records →'}
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 3: COMPLETE */}
      {step === 'COMPLETE' && (
        <Card className="border border-emerald-200 bg-white rounded-2xl p-8 shadow-xs text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="text-xl font-extrabold text-navy">Bulk Import Successfully Executed!</h2>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            The imported data records are now live and synchronized across the platform.
          </p>
          <Button onClick={() => setStep('UPLOAD')} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-6 rounded-xl">
            Import More Records
          </Button>
        </Card>
      )}
    </div>
  );
}
