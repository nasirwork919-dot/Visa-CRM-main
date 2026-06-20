import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import {
  useLead, useLeadNotes, useLeadPayments, useLeadDocuments, useLeadHistory,
  useCreateLeadNote, useCreateLeadPayment, useUpdateLeadPayment, useUpdateLead, useDeleteLead,
} from '@/hooks/use-leads';
import { useAuth } from '@/context/AuthContext';
import { LeadStatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatINR, calcGST } from '@/utils/gst';
import { useSettings } from '@/hooks/use-settings';
import { buildWAUrl } from '@/utils/whatsapp';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, MessageCircle, Phone, Mail, Upload, FileText, Clock, ExternalLink, Trash2, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

const STATUSES = ['Under Process', 'Follow-up', 'Submitted', 'Completed', 'Cancelled'];
const PAYMENT_METHODS = ['Cash', 'UPI/Transfer', 'Cheque', 'Bank Transfer', 'Other'];

function whatsappLink(phone: string, name: string) {
  const msg = encodeURIComponent(`Hi ${name}, this is regarding your visa application.`);
  const wa = phone.replace(/\D/g, '');
  return `https://wa.me/${wa.length === 10 ? '91' + wa : wa}?text=${msg}`;
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, profile } = useAuth();
  const { toast } = useToast();

  const { data: lead, isLoading } = useLead(id || '');
  const { data: notes } = useLeadNotes(id || '');
  const { data: payments } = useLeadPayments(id || '');
  const { data: documents } = useLeadDocuments(id || '');
  const { data: history } = useLeadHistory(id || '');

  const createNote = useCreateLeadNote();
  const createPayment = useCreateLeadPayment();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();

  const [noteText, setNoteText] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'Cash', note: '', payment_date: '' });
  const [paymentWA, setPaymentWA] = useState<{ url: string; amount: string } | null>(null);
  const [editPayment, setEditPayment] = useState<any>(null);
  const [editPayForm, setEditPayForm] = useState({ amount: '', method: 'Cash', note: '', payment_date: '' });
  const updatePayment = useUpdateLeadPayment();
  const [uploading, setUploading] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [setupTotal, setSetupTotal] = useState('');
  const [setupPaid, setSetupPaid] = useState('');
  const { settings } = useSettings();

  if (isLoading) return <SidebarLayout><div className="flex items-center justify-center h-64">Loading...</div></SidebarLayout>;
  if (!lead) return <SidebarLayout><div className="p-8 text-muted-foreground">Lead not found.</div></SidebarLayout>;

  const isUPI = lead.payment_method === 'UPI/Transfer';
  const service = calcGST(lead.base_fee || 0, lead.payment_method, settings.serviceGSTRate, settings.bankGSTRate);
  const balance = Math.max(0, service.totalAmount - (lead.amount_paid || 0));

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await createNote.mutateAsync({
        lead_id: id,
        note: noteText,
        created_by: profile?.id,
        author_name: profile?.full_name,
      });
      setNoteText('');
      toast({ title: 'Note added' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleAddPayment = async () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) { toast({ title: 'Enter a valid amount', variant: 'destructive' }); return; }
    try {
      const newPaid = (lead.amount_paid || 0) + amount;
      await createPayment.mutateAsync({
        lead_id: id,
        amount,
        method: payForm.method,
        note: payForm.note,
        payment_date: payForm.payment_date || null,
        received_by: profile?.id,
      });
      await updateLead.mutateAsync({ id: id!, updates: { amount_paid: newPaid } });
      setPayForm({ amount: '', method: 'Cash', note: '', payment_date: '' });

      const now = new Date();
      const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const updatedLead = { ...lead, amount_paid: newPaid };
      const waUrl = (lead.whatsapp || lead.phone)
        ? buildWAUrl(updatedLead, 'payment_received', { this_payment: formatINR(amount), date, time })
        : null;

      toast({ title: `Payment of ${formatINR(amount)} recorded` });
      if (waUrl && waUrl !== '#') {
        setPaymentWA({ url: waUrl, amount: formatINR(amount) });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdatePayment = async () => {
    if (!editPayment) return;
    const newAmount = Number(editPayForm.amount);
    if (!newAmount || newAmount <= 0) { toast({ title: 'Enter a valid amount', variant: 'destructive' }); return; }
    const oldAmount = editPayment.amount;
    const newLeadPaid = Math.max(0, (lead.amount_paid || 0) - oldAmount + newAmount);
    try {
      await updatePayment.mutateAsync({
        id: editPayment.id,
        updates: { amount: newAmount, method: editPayForm.method, note: editPayForm.note || null, payment_date: editPayForm.payment_date || null },
      });
      await updateLead.mutateAsync({ id: id!, updates: { amount_paid: newLeadPaid } });

      const now = new Date();
      const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const updatedLead = { ...lead, amount_paid: newLeadPaid };
      const waUrl = (lead.whatsapp || lead.phone)
        ? buildWAUrl(updatedLead, 'payment_received', { this_payment: formatINR(newAmount), date, time })
        : null;

      toast({ title: `Payment updated to ${formatINR(newAmount)}` });
      if (waUrl && waUrl !== '#') setPaymentWA({ url: waUrl, amount: formatINR(newAmount) });
      setEditPayment(null);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleStatusChange = async () => {
    if (!newStatus || newStatus === lead.status) return;
    try {
      await updateLead.mutateAsync({ id: id!, updates: { status: newStatus }, logStatus: true });
      const updatedLead = { ...lead, status: newStatus };
      setNewStatus('');
      const phone = lead.phone || lead.whatsapp;
      const waUrl = phone ? buildWAUrl(updatedLead, 'status_update') : null;
      toast({
        title: `Status updated to ${newStatus}`,
        description: waUrl && waUrl !== '#'
          ? 'Tap the button to notify the customer on WhatsApp.'
          : undefined,
        action: waUrl && waUrl !== '#' ? (
          <a href={waUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 rounded-md border border-[#25D366] px-3 py-1.5 text-xs font-medium text-[#25D366] hover:bg-green-50 transition-colors">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        ) : undefined,
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleSetFee = async () => {
    const total = Number(setupTotal);
    if (!total || total <= 0) { toast({ title: 'Enter a valid total amount', variant: 'destructive' }); return; }
    const hasPaymentRecords = (payments?.length || 0) > 0;
    const paidVal = hasPaymentRecords ? (lead.amount_paid || 0) : (Number(setupPaid) || 0);
    try {
      const svc = calcGST(total, lead.payment_method, settings.serviceGSTRate, settings.bankGSTRate);
      await updateLead.mutateAsync({
        id: id!,
        updates: {
          base_fee: total,
          amount_paid: paidVal,
          gst_amount: svc.gstAmount,
          total_amount: svc.totalAmount,
        },
      });
      toast({ title: 'Service fee saved' });
      setSetupTotal('');
      setSetupPaid('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLead.mutateAsync({ id: id!, pax_name: lead.pax_name });
      window.location.href = '/leads';
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB.', variant: 'destructive' });
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const path = `leads/${id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('lead-documents').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('lead-documents').getPublicUrl(path);
      await supabase.from('lead_documents').insert([{
        lead_id: id,
        name: file.name,
        file_url: publicUrl,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: profile?.id,
      }]);
      toast({ title: 'Document uploaded' });
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Link href="/leads">
            <Button variant="ghost" size="icon" className="mt-1"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{lead.pax_name}</h1>
              <LeadStatusBadge status={lead.status} />
              {can('roles_manage') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete Lead
                </Button>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
              {lead.phone && (
                <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone className="h-3.5 w-3.5" />{lead.phone}
                </a>
              )}
              {(lead.phone || lead.whatsapp) && (
                <a href={whatsappLink(lead.phone || lead.whatsapp, lead.pax_name)} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1 text-[#25D366] hover:opacity-80">
                  <MessageCircle className="h-3.5 w-3.5" />WhatsApp
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-foreground">
                  <Mail className="h-3.5 w-3.5" />{lead.email}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Finance Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Service Fee</p>
            <p className="text-lg font-bold font-mono">{formatINR(lead.base_fee || 0)}</p>
          </CardContent></Card>

          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {isUPI ? `Total GST (${settings.serviceGSTRate + settings.bankGSTRate}%)` : 'GST'}
            </p>
            <p className="text-lg font-bold font-mono text-amber-700">{isUPI ? formatINR(service.totalGST) : '—'}</p>
            {isUPI && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Svc {formatINR(service.serviceGST)} + Bank {formatINR(service.bankGST)}
              </p>
            )}
          </CardContent></Card>

          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Net Income</p>
            <p className="text-lg font-bold font-mono text-green-700">{formatINR(service.netFee)}</p>
          </CardContent></Card>

          <Card><CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Balance</p>
            {(lead.base_fee || 0) === 0 && (lead.amount_paid || 0) > 0 ? (
              <p className="text-lg font-bold font-mono text-amber-600">No fee set</p>
            ) : (
              <p className={`text-lg font-bold font-mono ${balance > 0 ? 'text-destructive' : (lead.total_amount || 0) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {balance > 0 ? formatINR(balance) : (lead.total_amount || 0) > 0 ? '✓ Paid' : '—'}
              </p>
            )}
          </CardContent></Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="notes">Notes {notes?.length ? `(${notes.length})` : ''}</TabsTrigger>
            <TabsTrigger value="payments">Payments {payments?.length ? `(${payments.length})` : ''}</TabsTrigger>
            <TabsTrigger value="documents">Documents {documents?.length ? `(${documents.length})` : ''}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Passenger Info</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <InfoRow label="Full Name" value={lead.pax_name} />
                  <InfoRow label="Phone" value={lead.phone} />
                  <InfoRow label="Alt. Phone" value={lead.alt_phone} />
                  <InfoRow label="Email" value={lead.email} />
                  <InfoRow label="Passport No." value={lead.passport_no} />
                  <InfoRow label="Date of Birth" value={lead.dob} />
                  <InfoRow label="Nationality" value={lead.nationality} />
                  <InfoRow label="No. of PAX" value={String(lead.pax_count || 1)} />
                  <div className="col-span-2"><InfoRow label="Address" value={lead.address} /></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Trip Info</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <InfoRow label="Service" value={lead.service_name} />
                  <InfoRow label="Destination" value={lead.destination} />
                  <InfoRow label="Travel Date" value={lead.travel_date} />
                  <InfoRow label="Return Date" value={lead.return_date} />
                  <InfoRow label="Source" value={lead.source} />
                  <InfoRow label="Assigned Agent" value={lead.agent_name} />
                  <div className="col-span-2"><InfoRow label="Notes for Assignee" value={lead.assignee_notes} /></div>
                  <div className="col-span-2"><InfoRow label="Notes" value={lead.notes} /></div>
                </CardContent>
              </Card>

              {/* Fee breakdown detail */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Fee Breakdown</CardTitle>
                  {lead.payment_method && (
                    <p className="text-xs text-muted-foreground">Payment via {lead.payment_method}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 text-sm max-w-sm">
                    <div className="flex justify-between font-semibold">
                      <span>Service Fee (client pays)</span>
                      <span className="font-mono">{formatINR(lead.base_fee || 0)}</span>
                    </div>
                    {isUPI ? (
                    <>
                      <div className="flex justify-between text-xs text-amber-700 pl-4">
                        <span>↳ Service GST ({settings.serviceGSTRate}%)</span>
                        <span className="font-mono">― {formatINR(service.serviceGST)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-blue-700 pl-4">
                        <span>↳ Bank GST ({settings.bankGSTRate}%)</span>
                        <span className="font-mono">― {formatINR(service.bankGST)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-xs text-muted-foreground pl-4">
                      <span>GST</span>
                      <span className="font-mono">— (not applicable)</span>
                    </div>
                  )}
                    <div className="flex justify-between text-xs pl-4 text-muted-foreground border-t pt-1.5">
                      <span>Total GST deducted</span>
                      <span className="font-mono">― {formatINR(service.totalGST)}</span>
                    </div>
                    <div className="flex justify-between text-xs pl-4 font-medium text-green-700">
                      <span>Your net income</span>
                      <span className="font-mono">{formatINR(service.netFee)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-1">
                      <span className="text-muted-foreground">Amount Paid</span>
                      <span className="font-mono">{formatINR(lead.amount_paid || 0)}</span>
                    </div>
                    <div className={`flex justify-between font-bold border-t pt-2 ${balance > 0 ? 'text-destructive' : (lead.total_amount || 0) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                      <span>{balance > 0 ? 'Balance Due' : (lead.total_amount || 0) > 0 ? 'Fully Paid' : 'No fee set'}</span>
                      <span className="font-mono">{balance > 0 ? formatINR(balance) : (lead.total_amount || 0) > 0 ? '✓' : '—'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {can('leads_edit') && (
                <Card className="md:col-span-2">
                  <CardHeader><CardTitle className="text-base">Change Status</CardTitle></CardHeader>
                  <CardContent className="flex gap-3">
                    <Select value={newStatus || lead.status} onValueChange={setNewStatus}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleStatusChange} disabled={!newStatus || newStatus === lead.status || updateLead.isPending}>
                      Update Status
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="mt-4 space-y-4">
            {can('leads_edit') && (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <Textarea
                    placeholder="Add a note..."
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                  />
                  <Button onClick={handleAddNote} disabled={!noteText.trim() || createNote.isPending}>
                    Add Note
                  </Button>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {notes?.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No notes yet.</p>}
              {notes?.map((note: any) => (
                <Card key={note.id}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-sm">{note.note}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {note.author_name || 'Unknown'} · {new Date(note.created_at).toLocaleString('en-IN')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="mt-4 space-y-4">
            {/* Fee setup — shown only when no fee was set during lead creation */}
            {(lead.base_fee || 0) === 0 && can('leads_edit') ? (
              <Card className="border-amber-200 bg-amber-50/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-amber-800">Set Service Fee</CardTitle>
                  <p className="text-xs text-amber-700">Total fee was not set when this lead was created. Fill it in here.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 items-end">
                    <div>
                      <Label>Total Amount (₹)</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 25000"
                        value={setupTotal}
                        onChange={e => setSetupTotal(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Paid (₹)</Label>
                      {(payments?.length || 0) > 0 ? (
                        <div className="mt-1">
                          <p className="font-bold font-mono text-green-600 py-2">{formatINR(lead.amount_paid || 0)}</p>
                          <p className="text-xs text-muted-foreground">From {payments!.length} payment record{payments!.length > 1 ? 's' : ''}</p>
                        </div>
                      ) : (
                        <Input
                          type="number"
                          placeholder="0"
                          value={setupPaid}
                          onChange={e => setSetupPaid(e.target.value)}
                          className="mt-1"
                        />
                      )}
                    </div>
                    <div>
                      <Label>Remaining</Label>
                      {(() => {
                        const total = Number(setupTotal) || 0;
                        const paid = (payments?.length || 0) > 0 ? (lead.amount_paid || 0) : (Number(setupPaid) || 0);
                        const rem = total - paid;
                        if (total === 0) return <p className="font-bold font-mono text-muted-foreground mt-1 py-2">—</p>;
                        if (rem > 0) return <p className="font-bold font-mono text-destructive mt-1 py-2">{formatINR(rem)}</p>;
                        if (rem < 0) return <p className="font-bold font-mono text-amber-600 mt-1 py-2">+{formatINR(Math.abs(rem))} advance</p>;
                        return <p className="font-bold font-mono text-green-600 mt-1 py-2">✓ Fully Paid</p>;
                      })()}
                    </div>
                  </div>
                  <Button
                    onClick={handleSetFee}
                    disabled={!setupTotal || Number(setupTotal) <= 0 || updateLead.isPending}
                  >
                    {updateLead.isPending ? 'Saving…' : 'Save Fee'}
                  </Button>
                </CardContent>
              </Card>
            ) : (lead.base_fee || 0) === 0 ? (
              /* No edit permission + no fee set */
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                <span className="font-bold mt-0.5">⚠</span>
                <p>Total service fee not set. Ask an admin to edit this lead and add the fee.</p>
              </div>
            ) : (
              /* Normal summary when fee is set */
              <Card className="bg-muted/30">
                <CardContent className="pt-4 pb-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Fee</p>
                      <p className="font-bold font-mono">{formatINR(service.totalAmount)}</p>
                      {isUPI && <p className="text-[10px] text-amber-700 mt-0.5">incl. GST {formatINR(service.gstAmount)}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Paid</p>
                      <p className="font-bold font-mono text-green-600">{formatINR(lead.amount_paid || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Balance</p>
                      <p className={`font-bold font-mono ${balance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {balance > 0 ? formatINR(balance) : '✓ Paid'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {can('pay_record') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Record Payment</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount (₹)</Label>
                    <Input type="number" placeholder="0" value={payForm.amount}
                      onChange={e => { setPayForm(f => ({ ...f, amount: e.target.value })); setPaymentWA(null); }} />
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select value={payForm.method} onValueChange={v => setPayForm(f => ({ ...f, method: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {payForm.method === 'Cash' && (
                    <div>
                      <Label>Cash Date</Label>
                      <Input type="date" value={payForm.payment_date}
                        onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} />
                    </div>
                  )}
                  <div className={payForm.method === 'Cash' ? '' : 'col-span-2'}>
                    <Label>Note (optional)</Label>
                    <Input placeholder="e.g., advance, final payment..." value={payForm.note}
                      onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} />
                  </div>
                  <div className="col-span-2 flex items-center gap-3 flex-wrap">
                    <Button onClick={handleAddPayment} disabled={createPayment.isPending || updateLead.isPending}>
                      {createPayment.isPending || updateLead.isPending ? 'Saving…' : 'Record Payment'}
                    </Button>
                    {paymentWA && (
                      <a
                        href={paymentWA.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setPaymentWA(null)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#25D366] bg-[#25D366]/10 px-3 py-2 text-sm font-medium text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
                      >
                        <MessageCircle className="h-4 w-4" />
                        Send Receipt on WhatsApp
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              {payments?.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No payments recorded.</p>}
              {payments?.map((p: any) => (
                <Card key={p.id}>
                  <CardContent className="pt-3 pb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold font-mono">{formatINR(p.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.method}{p.payment_date ? ` · ${p.payment_date}` : ''}{p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString('en-IN')}</p>
                      {can('pay_record') && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => {
                            setEditPayment(p);
                            setEditPayForm({ amount: String(p.amount), method: p.method || 'Cash', note: p.note || '', payment_date: p.payment_date || '' });
                          }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="mt-4 space-y-4">
            {can('docs_upload') && (
              <Card>
                <CardContent className="pt-4">
                  <Label htmlFor="doc-upload" className="cursor-pointer">
                    <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/50 transition-colors">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to upload a document</p>
                      <p className="text-xs text-muted-foreground">PDF, JPG, PNG up to 5MB</p>
                    </div>
                    <Input id="doc-upload" type="file" className="hidden" onChange={handleUpload} disabled={uploading}
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  </Label>
                  {uploading && <p className="text-sm text-center mt-2 text-muted-foreground">Uploading...</p>}
                </CardContent>
              </Card>
            )}
            <div className="space-y-2">
              {documents?.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No documents uploaded.</p>}
              {documents?.map((doc: any) => (
                <Card key={doc.id}>
                  <CardContent className="pt-3 pb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{doc.name}</p>
                        <p className="text-xs text-muted-foreground">{(doc.file_size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">View</Button>
                    </a>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-4">
            <div className="space-y-2">
              {history?.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No history available.</p>}
              {history?.map((h: any) => (
                <div key={h.id} className="flex items-start gap-3 py-3 border-b last:border-0">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm"><LeadStatusBadge status={h.status} /></p>
                    {h.note && <p className="text-xs text-muted-foreground mt-1">{h.note}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(h.created_at).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit payment dialog */}
      <Dialog open={!!editPayment} onOpenChange={open => { if (!open) setEditPayment(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Amount (₹)</Label>
              <Input type="number" value={editPayForm.amount}
                onChange={e => setEditPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={editPayForm.method} onValueChange={v => setEditPayForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={editPayForm.payment_date}
                onChange={e => setEditPayForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input value={editPayForm.note}
                onChange={e => setEditPayForm(f => ({ ...f, note: e.target.value }))}
                placeholder="e.g., advance..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPayment(null)}>Cancel</Button>
            <Button onClick={handleUpdatePayment} disabled={updatePayment.isPending || updateLead.isPending}>
              {updatePayment.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Delete Lead
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the lead for <strong>{lead.pax_name}</strong> and all
              associated notes, payments, documents, and history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLead.isPending}
            >
              {deleteLead.isPending ? 'Deleting…' : 'Delete Lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarLayout>
  );
}
