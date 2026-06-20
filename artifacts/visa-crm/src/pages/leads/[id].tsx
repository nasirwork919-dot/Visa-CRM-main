import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import {
  useLead, useLeadNotes, useLeadPayments, useLeadDocuments, useLeadHistory,
  useCreateLeadNote, useCreateLeadPayment, useUpdateLeadPayment, useUpdateLead, useDeleteLead,
  useLeadServices, useCreateLeadService, useUpdateLeadService, useDeleteLeadService,
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

  const { data: leadServices } = useLeadServices(id || '');
  const createSvc = useCreateLeadService();
  const updateSvc = useUpdateLeadService();
  const deleteSvc = useDeleteLeadService();

  const createNote = useCreateLeadNote();
  const createPayment = useCreateLeadPayment();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();

  const [noteText, setNoteText] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'Cash', note: '', payment_date: '', service_tag: '' });
  const [paymentWA, setPaymentWA] = useState<{ url: string; amount: string } | null>(null);
  const [editPayment, setEditPayment] = useState<any>(null);
  const [editPayForm, setEditPayForm] = useState({ amount: '', method: 'Cash', note: '', payment_date: '' });
  const updatePayment = useUpdateLeadPayment();
  const [uploading, setUploading] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [addSvcForm, setAddSvcForm] = useState({ service_name: '', base_fee: '', payment_method: 'Cash', notes: '', amount_paid: '' });
  const [editSvc, setEditSvc] = useState<any>(null);
  const [editSvcForm, setEditSvcForm] = useState({ service_name: '', base_fee: '', payment_method: 'Cash', notes: '', amount_paid: '' });
  const [setupTotal, setSetupTotal] = useState('');
  const [setupPaid, setSetupPaid] = useState('');
  const { settings } = useSettings();

  if (isLoading) return <SidebarLayout><div className="flex items-center justify-center h-64">Loading...</div></SidebarLayout>;
  if (!lead) return <SidebarLayout><div className="p-8 text-muted-foreground">Lead not found.</div></SidebarLayout>;

  const hasServices = leadServices && leadServices.length > 0;
  const svcBreakdown = hasServices
    ? leadServices!.map((ls: any) => ({ ...ls, ...calcGST(ls.base_fee || 0, ls.payment_method, settings.serviceGSTRate, settings.bankGSTRate) }))
    : [{ ...lead, ...calcGST(lead.base_fee || 0, lead.payment_method, settings.serviceGSTRate, settings.bankGSTRate), service_name: lead.service_name || '' }];
  const totalFee = svcBreakdown.reduce((s: number, ls: any) => s + ls.totalAmount, 0);
  const totalGST = svcBreakdown.reduce((s: number, ls: any) => s + ls.gstAmount, 0);
  const totalNetFee = svcBreakdown.reduce((s: number, ls: any) => s + ls.netFee, 0);
  const balance = Math.max(0, totalFee - (lead.amount_paid || 0));
  const isUPI = lead.payment_method === 'UPI/Transfer';
  const service = calcGST(lead.base_fee || 0, lead.payment_method, settings.serviceGSTRate, settings.bankGSTRate);

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
      setPayForm({ amount: '', method: 'Cash', note: '', payment_date: '', service_tag: '' });

      const now = new Date();
      const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const updatedLead = { ...lead, amount_paid: newPaid, base_fee: totalFee };
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
      const updatedLead = { ...lead, amount_paid: newLeadPaid, base_fee: totalFee };
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
      // Also create a lead_services record so it shows in the breakdown
      await supabase.from('lead_services').delete().eq('lead_id', id!);
      await supabase.from('lead_services').insert({ lead_id: id!, service_name: lead.service_name || 'Service', base_fee: total, payment_method: lead.payment_method || 'Cash', notes: null });
      toast({ title: 'Service fee saved' });
      setSetupTotal('');
      setSetupPaid('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const syncLeadTotals = async (leadId: string) => {
    const { data: svcs } = await supabase.from('lead_services').select('*').eq('lead_id', leadId);
    if (!svcs || svcs.length === 0) return;
    const totals = svcs.map((ls: any) => calcGST(ls.base_fee || 0, ls.payment_method, settings.serviceGSTRate, settings.bankGSTRate));
    const totalBase = svcs.reduce((s: number, ls: any) => s + (ls.base_fee || 0), 0);
    const totalGstAmt = totals.reduce((s: number, t: any) => s + t.gstAmount, 0);
    const totalAmt = totals.reduce((s: number, t: any) => s + t.totalAmount, 0);
    const combinedName = svcs.filter((s: any) => s.service_name).map((s: any) => s.service_name).join(' + ');
    await updateLead.mutateAsync({ id: leadId, updates: { base_fee: totalBase, gst_amount: totalGstAmt, total_amount: totalAmt, service_name: combinedName } });
  };

  const handleAddService = async () => {
    const fee = Number(addSvcForm.base_fee) || 0;
    if (!addSvcForm.service_name && !fee) { toast({ title: 'Enter service name or fee', variant: 'destructive' }); return; }
    const paidAmt = Number(addSvcForm.amount_paid) || 0;
    try {
      await createSvc.mutateAsync({ lead_id: id!, service_name: addSvcForm.service_name, base_fee: fee, payment_method: addSvcForm.payment_method, notes: addSvcForm.notes || null });
      await syncLeadTotals(id!);

      if (paidAmt > 0) {
        const newTotalPaid = (lead.amount_paid || 0) + paidAmt;
        await createPayment.mutateAsync({
          lead_id: id!,
          amount: paidAmt,
          method: addSvcForm.payment_method,
          note: addSvcForm.service_name ? `Payment for ${addSvcForm.service_name}` : 'Service payment',
          payment_date: null,
          received_by: profile?.id,
        });
        await updateLead.mutateAsync({ id: id!, updates: { amount_paid: newTotalPaid } });
        const now = new Date();
        const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const { data: svcs } = await supabase.from('lead_services').select('*').eq('lead_id', id!);
        const newTotalFee = svcs ? svcs.reduce((s: number, ls: any) => s + calcGST(ls.base_fee || 0, ls.payment_method, settings.serviceGSTRate, settings.bankGSTRate).totalAmount, 0) : fee;
        const updatedLeadForWA = { ...lead, amount_paid: newTotalPaid, base_fee: newTotalFee };
        const waUrl = (lead.whatsapp || lead.phone)
          ? buildWAUrl(updatedLeadForWA, 'payment_received', { this_payment: formatINR(paidAmt), date, time })
          : null;
        toast({ title: 'Service added & payment recorded' });
        if (waUrl && waUrl !== '#') setPaymentWA({ url: waUrl, amount: formatINR(paidAmt) });
      } else {
        // No payment, but still offer WA to send service booking confirmation
        const now = new Date();
        const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const { data: svcs } = await supabase.from('lead_services').select('*').eq('lead_id', id!);
        const newTotalFee2 = svcs ? svcs.reduce((s: number, ls: any) => s + calcGST(ls.base_fee || 0, ls.payment_method, settings.serviceGSTRate, settings.bankGSTRate).totalAmount, 0) : fee;
        const waLeadForSvc = { ...lead, base_fee: newTotalFee2 };
        const waUrl2 = (lead.whatsapp || lead.phone)
          ? buildWAUrl(waLeadForSvc, 'welcome', { date, time })
          : null;
        toast({
          title: 'Service added',
          description: waUrl2 && waUrl2 !== '#' ? 'Send booking confirmation on WhatsApp.' : undefined,
          action: waUrl2 && waUrl2 !== '#' ? (
            <a href={waUrl2} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 rounded-md border border-[#25D366] px-3 py-1.5 text-xs font-medium text-[#25D366] hover:bg-green-50 transition-colors">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          ) : undefined,
        });
      }
      setAddSvcForm({ service_name: '', base_fee: '', payment_method: 'Cash', notes: '', amount_paid: '' });
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const handleUpdateService = async () => {
    if (!editSvc) return;
    const paidAmt = Number(editSvcForm.amount_paid) || 0;
    try {
      await updateSvc.mutateAsync({ id: editSvc.id, updates: { service_name: editSvcForm.service_name, base_fee: Number(editSvcForm.base_fee) || 0, payment_method: editSvcForm.payment_method, notes: editSvcForm.notes || null } });
      await syncLeadTotals(id!);

      if (paidAmt > 0) {
        const newTotalPaid = (lead.amount_paid || 0) + paidAmt;
        await createPayment.mutateAsync({
          lead_id: id!,
          amount: paidAmt,
          method: editSvcForm.payment_method,
          note: editSvcForm.service_name ? `Payment for ${editSvcForm.service_name}` : 'Service payment',
          payment_date: null,
          received_by: profile?.id,
        });
        await updateLead.mutateAsync({ id: id!, updates: { amount_paid: newTotalPaid } });
        const now = new Date();
        const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const { data: svcs } = await supabase.from('lead_services').select('*').eq('lead_id', id!);
        const newTotalFee = svcs ? svcs.reduce((s: number, ls: any) => s + calcGST(ls.base_fee || 0, ls.payment_method, settings.serviceGSTRate, settings.bankGSTRate).totalAmount, 0) : 0;
        const updatedLeadForWA = { ...lead, amount_paid: newTotalPaid, base_fee: newTotalFee };
        const waUrl = (lead.whatsapp || lead.phone)
          ? buildWAUrl(updatedLeadForWA, 'payment_received', { this_payment: formatINR(paidAmt), date, time })
          : null;
        toast({ title: 'Service updated & payment recorded' });
        if (waUrl && waUrl !== '#') setPaymentWA({ url: waUrl, amount: formatINR(paidAmt) });
      } else {
        toast({ title: 'Service updated' });
      }
      setEditSvc(null);
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
  };

  const handleDeleteService = async (svcId: string) => {
    try {
      await deleteSvc.mutateAsync({ id: svcId, leadId: id! });
      await syncLeadTotals(id!);
      toast({ title: 'Service removed' });
    } catch (e: any) { toast({ title: 'Error', description: e.message, variant: 'destructive' }); }
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

        {/* Services & Finance Overview */}
        <div className="space-y-2">
          {svcBreakdown.map((ls: any, idx: number) => (
            <div key={ls.id || idx} className="rounded-lg border bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{ls.service_name || 'Service'}</p>
                  {ls.notes && <span className="text-xs text-muted-foreground">— {ls.notes}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ls.payment_method}
                  {ls.gstAmount > 0 ? ` · GST ${formatINR(ls.gstAmount)} · Net ${formatINR(ls.netFee)}` : ' · No GST'}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Charges</p>
                  <p className="text-lg font-bold font-mono">{formatINR(ls.totalAmount)}</p>
                </div>
                {can('leads_edit') && ls.id && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                      onClick={() => { setEditSvc(ls); setEditSvcForm({ service_name: ls.service_name || '', base_fee: String(ls.base_fee || ''), payment_method: ls.payment_method || 'Cash', notes: ls.notes || '', amount_paid: '' }); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteService(ls.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {/* Summary bar */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 grid grid-cols-3 divide-x">
            <div className="pr-4">
              <p className="text-xs text-muted-foreground">Total Charges</p>
              <p className="text-2xl font-bold font-mono">{totalFee > 0 ? formatINR(totalFee) : '—'}</p>
              {totalGST > 0 && <p className="text-xs text-amber-700 mt-0.5">incl. GST {formatINR(totalGST)}</p>}
            </div>
            <div className="px-4">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-2xl font-bold font-mono text-green-600">{formatINR(lead.amount_paid || 0)}</p>
            </div>
            <div className="pl-4">
              <p className="text-xs text-muted-foreground">Balance</p>
              {totalFee === 0 && (lead.amount_paid || 0) > 0 ? (
                <p className="text-2xl font-bold font-mono text-amber-600">No fee</p>
              ) : (
                <p className={`text-2xl font-bold font-mono ${balance > 0 ? 'text-destructive' : totalFee > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {balance > 0 ? formatINR(balance) : totalFee > 0 ? '✓ Paid' : '—'}
                </p>
              )}
            </div>
          </div>
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
                  {can('leads_edit') && (
                    <div className="mt-4 pt-4 border-t space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Service</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Service Name</Label>
                          <Input className="mt-1 h-8 text-sm" placeholder="e.g. UAE Visa" value={addSvcForm.service_name}
                            onChange={e => setAddSvcForm(f => ({ ...f, service_name: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Fee (₹)</Label>
                          <Input className="mt-1 h-8 text-sm" type="number" placeholder="0" value={addSvcForm.base_fee}
                            onChange={e => setAddSvcForm(f => ({ ...f, base_fee: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Method</Label>
                          <Select value={addSvcForm.payment_method} onValueChange={v => setAddSvcForm(f => ({ ...f, payment_method: v }))}>
                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Notes (optional)</Label>
                          <Input className="mt-1 h-8 text-sm" placeholder="e.g. EK521" value={addSvcForm.notes}
                            onChange={e => setAddSvcForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Amount Paid (₹)</Label>
                          <Input className="mt-1 h-8 text-sm" type="number" placeholder="0 (optional)" value={addSvcForm.amount_paid}
                            onChange={e => setAddSvcForm(f => ({ ...f, amount_paid: e.target.value }))} />
                        </div>
                      </div>
                      <Button size="sm" onClick={handleAddService} disabled={createSvc.isPending || createPayment.isPending || updateLead.isPending}>
                        {(createSvc.isPending || createPayment.isPending) ? 'Adding…' : '+ Add Service'}
                      </Button>
                    </div>
                  )}
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
            {totalFee === 0 && can('leads_edit') ? (
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
            ) : totalFee === 0 ? (
              /* No edit permission + no fee set */
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                <span className="font-bold mt-0.5">⚠</span>
                <p>Total service fee not set. Ask an admin to edit this lead and add the fee.</p>
              </div>
            ) : null}

            {can('pay_record') && totalFee > 0 && balance === 0 && (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
                <span className="text-green-600 font-bold">✓</span>
                <p>This lead is <strong>fully paid</strong>. No further payment is required.</p>
              </div>
            )}

            {can('pay_record') && !(totalFee > 0 && balance === 0) && (
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
                  {leadServices && leadServices.length > 1 && (
                    <div className={payForm.method === 'Cash' ? '' : 'col-span-2'}>
                      <Label>For Service</Label>
                      <Select value={payForm.service_tag} onValueChange={v => setPayForm(f => ({
                        ...f,
                        service_tag: v,
                        note: v && v !== '__all__' ? `Payment for ${v}` : f.note,
                      }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="All services" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">— All services</SelectItem>
                          {leadServices.map((ls: any) => (
                            <SelectItem key={ls.id} value={ls.service_name || ls.id}>
                              {ls.service_name || 'Unnamed'} · {formatINR(ls.base_fee || 0)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-lg font-bold font-mono">{formatINR(p.amount)}</p>
                          <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground font-medium">{p.method || 'Cash'}</span>
                          {p.note && p.note.startsWith('Payment for ') && (
                            <span className="text-xs rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-blue-700 font-medium truncate max-w-[200px]">
                              {p.note.replace('Payment for ', '')}
                            </span>
                          )}
                        </div>
                        {p.note && !p.note.startsWith('Payment for ') && (
                          <p className="text-xs text-muted-foreground mt-0.5">{p.note}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.payment_date
                            ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                            : new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {can('pay_record') && (
                        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => {
                          setEditPayment(p);
                          setEditPayForm({ amount: String(p.amount), method: p.method || 'Cash', note: p.note || '', payment_date: p.payment_date || '' });
                        }}>
                          <Pencil className="h-4 w-4" />
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

      {/* Edit service dialog */}
      <Dialog open={!!editSvc} onOpenChange={open => { if (!open) setEditSvc(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Service Name</Label>
              <Input className="mt-1" value={editSvcForm.service_name} onChange={e => setEditSvcForm(f => ({ ...f, service_name: e.target.value }))} />
            </div>
            <div>
              <Label>Fee (₹)</Label>
              <Input className="mt-1" type="number" value={editSvcForm.base_fee} onChange={e => setEditSvcForm(f => ({ ...f, base_fee: e.target.value }))} />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={editSvcForm.payment_method} onValueChange={v => setEditSvcForm(f => ({ ...f, payment_method: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input className="mt-1" value={editSvcForm.notes} onChange={e => setEditSvcForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div>
              <Label>Amount Paid Now (₹) <span className="text-muted-foreground font-normal text-xs">— optional, records a new payment</span></Label>
              <Input className="mt-1" type="number" placeholder="0" value={editSvcForm.amount_paid} onChange={e => setEditSvcForm(f => ({ ...f, amount_paid: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSvc(null)}>Cancel</Button>
            <Button onClick={handleUpdateService} disabled={updateSvc.isPending || createPayment.isPending || updateLead.isPending}>
              {(updateSvc.isPending || createPayment.isPending) ? 'Saving…' : 'Save'}
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
