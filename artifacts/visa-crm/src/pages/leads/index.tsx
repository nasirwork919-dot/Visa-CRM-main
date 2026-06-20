import React, { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { useLeads, useCreateLead, useUpdateLead, useLeadDocuments, useDeleteLead, useBulkDeleteLeads, useLeadServices } from '@/hooks/use-leads';
import { useServices } from '@/hooks/use-services';
import { useProfiles } from '@/hooks/use-team';
import { useAuth } from '@/context/AuthContext';
import { LeadStatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { formatINR, calcGST } from '@/utils/gst';
import { useSettings } from '@/hooks/use-settings';
import { Link } from 'wouter';
import { Plus, Search, Download, Phone, MessageCircle, Upload, FileText, X, SlidersHorizontal, AlertTriangle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { openWhatsApp, buildWAUrl } from '@/utils/whatsapp';

const STATUSES = ['All', 'Under Process', 'Follow-up', 'Submitted', 'Completed', 'Cancelled'];
const SOURCES = ['All', 'Walk-in', 'Referral', 'Online', 'Phone', 'WhatsApp', 'Other'];
const PAYMENT_METHODS = ['Cash', 'UPI/Transfer', 'Cheque', 'Bank Transfer', 'Other'];

function whatsappLink(phone: string, name: string) {
  const msg = encodeURIComponent(`Hi ${name}, this is regarding your visa application.`);
  const wa = phone.replace(/\D/g, '');
  return `https://wa.me/${wa.length === 10 ? '91' + wa : wa}?text=${msg}`;
}

function parsePhone(raw: string) {
  if (!raw) return { code: '+91', number: '' };
  if (!raw.startsWith('+')) return { code: '+91', number: raw };
  // Space-separated format (new): "+91 9822553417"
  const spaceIdx = raw.indexOf(' ');
  if (spaceIdx > 1) return { code: raw.slice(0, spaceIdx), number: raw.slice(spaceIdx + 1) };
  // Legacy (no space): determine code length by total digit count
  const digits = raw.slice(1);
  if (digits.length >= 13) return { code: '+' + digits.slice(0, 3), number: digits.slice(3) };
  if (digits.length === 12) return { code: '+' + digits.slice(0, 2), number: digits.slice(2) };
  if (digits.length <= 11) return { code: '+' + digits.slice(0, 1), number: digits.slice(1) };
  return { code: '+91', number: digits };
}

type ServiceItem = {
  _key: string;
  id?: string;
  service_id: string;
  service_name: string;
  base_fee: string;
  payment_method: string;
  notes: string;
};
function mkSvcItem(overrides?: Partial<ServiceItem>): ServiceItem {
  return { _key: Math.random().toString(36).slice(2), id: undefined, service_id: '', service_name: '', base_fee: '', payment_method: 'Cash', notes: '', ...overrides };
}

function LeadFormModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead?: any }) {
  const { profile, can } = useAuth();
  const { settings } = useSettings();
  const { data: services } = useServices();
  const { data: agents } = useProfiles();
  const { data: existingDocs } = useLeadDocuments(lead?.id || '');
  const { data: existingServices } = useLeadServices(lead?.id || '');
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>([mkSvcItem()]);
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const { toast } = useToast();
  const isEdit = !!lead;

  const [tab, setTab] = useState('pax');
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; name: string }[]>([]);
  const [countryCode, setCountryCode] = useState('+91');
  const [altCountryCode, setAltCountryCode] = useState('+91');
  const [waCountryCode, setWaCountryCode] = useState('+91');
  const [sameWA, setSameWA] = useState(true);       // phone == whatsapp
  const [altAsWA, setAltAsWA] = useState(false);    // alt_phone == whatsapp
  const [showAlt, setShowAlt] = useState(false);    // show alt phone field
  const [duplicateLeads, setDuplicateLeads] = useState<any[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [waLead, setWaLead] = useState<any>(null);  // newly created lead pending WA send

  const blankForm = () => {
    const parsed = parsePhone(lead?.phone || '');
    const parsedAlt = parsePhone(lead?.alt_phone || '');
    const parsedWA = parsePhone(lead?.whatsapp || '');
    return {
    pax_name: lead?.pax_name || '',
    phone: parsed.number,
    whatsapp: parsedWA.number,
    alt_phone: parsedAlt.number,
    email: lead?.email || '',
    address: lead?.address || '',
    passport_no: lead?.passport_no || '',
    dob: lead?.dob || '',
    nationality: lead?.nationality || '',
    service_id: lead?.service_id || '',
    service_name: lead?.service_name || '',
    destination: lead?.destination || '',
    travel_date: lead?.travel_date || '',
    return_date: lead?.return_date || '',
    pax_count: lead?.pax_count || 1,
    source: lead?.source || 'Walk-in',
    status: lead?.status || 'Under Process',
    assigned_to: lead?.assigned_to || profile?.id || '',
    agent_name: lead?.agent_name || profile?.full_name || '',
    notes: lead?.notes || '',
    assignee_notes: lead?.assignee_notes || '',
    base_fee: lead?.base_fee || '',
    amount_paid: lead?.amount_paid || '',
    payment_method: lead?.payment_method || 'Cash',
  };};

  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    setTab('pax');
    setPendingFiles([]);
    setDuplicateLeads([]);
    setShowDuplicateDialog(false);
    setWaLead(null);
    const parsed = parsePhone(lead?.phone || '');
    const parsedAlt = parsePhone(lead?.alt_phone || '');
    const parsedWA = parsePhone(lead?.whatsapp || '');
    setCountryCode(parsed.code);
    setAltCountryCode(parsedAlt.code);
    setWaCountryCode(parsedWA.code);
    // Determine WhatsApp source for edit mode
    const waIsSameAsPhone = !lead?.whatsapp || lead?.whatsapp === lead?.phone;
    const waIsSameAsAlt = !!(lead?.alt_phone && lead?.whatsapp === lead?.alt_phone);
    setSameWA(isEdit ? waIsSameAsPhone : true);
    setAltAsWA(isEdit ? (waIsSameAsAlt && !waIsSameAsPhone) : false);
    setShowAlt(isEdit ? !!lead?.alt_phone : false);
    setForm(blankForm());
  }, [lead?.id, open]);

  useEffect(() => {
    if (!open) return;
    if (isEdit && existingServices && existingServices.length > 0) {
      setServiceItems(existingServices.map((s: any) => mkSvcItem({
        _key: s.id,
        id: s.id,
        service_id: s.service_id || '',
        service_name: s.service_name || '',
        base_fee: String(s.base_fee || ''),
        payment_method: s.payment_method || 'Cash',
        notes: s.notes || '',
      })));
    } else if (!isEdit && open) {
      setServiceItems([mkSvcItem()]);
    }
  }, [open, isEdit, existingServices?.length]);

  const baseFee = Number(form.base_fee) || 0;
  const isUPI = form.payment_method === 'UPI/Transfer';
  const service = calcGST(baseFee, form.payment_method, settings.serviceGSTRate, settings.bankGSTRate);
  const grandTotal = service.totalAmount;
  const balance = Math.max(0, grandTotal - (Number(form.amount_paid) || 0));

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleServiceChange = (id: string) => {
    if (id === '__other__') {
      set('service_id', '__other__');
      set('service_name', '');
      setServiceItems(prev => prev.map((s, i) => i === 0 ? { ...s, service_id: '__other__', service_name: '' } : s));
    } else {
      const svc = services?.find(s => s.id === id);
      set('service_id', id);
      set('service_name', svc?.name || '');
      if (svc?.country) set('destination', svc.country);
      setServiceItems(prev => prev.map((s, i) => i === 0 ? { ...s, service_id: id, service_name: svc?.name || '' } : s));
    }
  };

  const handleAgentChange = (id: string) => {
    const agent = agents?.find(a => a.id === id);
    set('assigned_to', id);
    set('agent_name', agent?.full_name || '');
  };

  const handlePhoneBlur = async () => {
    if (!form.phone || isEdit) return;
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 7) return;
    const { data } = await supabase
      .from('leads')
      .select('id, pax_name, service_name, status, phone')
      .or(`phone.ilike.%${digits},alt_phone.ilike.%${digits}`)
      .limit(5);
    if (data && data.length > 0) {
      setDuplicateLeads(data);
      setShowDuplicateDialog(true);
    }
  };

  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      toast({
        title: 'File too large',
        description: `Max 5MB per file. Skipped: ${oversized.map(f => f.name).join(', ')}`,
        variant: 'destructive',
      });
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    setPendingFiles(prev => [...prev, ...valid.map(f => ({ file: f, name: f.name }))]);
    e.target.value = '';
  };

  const removeFile = (idx: number) => setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  const uploadPendingDocs = async (leadId: string) => {
    for (const { file, name } of pendingFiles) {
      const path = `leads/${leadId}/${Date.now()}_${name}`;
      const { error: uploadErr } = await supabase.storage.from('lead-documents').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('lead-documents').getPublicUrl(path);
      await supabase.from('lead_documents').insert([{
        lead_id: leadId,
        name,
        file_url: publicUrl,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: profile?.id,
      }]);
    }
  };

  const handleSubmit = async () => {
    if (!form.pax_name) {
      toast({ title: 'Name is required', description: 'Please enter the passenger name.', variant: 'destructive' });
      return;
    }
    try {
      setUploading(true);
      const nullDate = (v: string) => v?.trim() || null;
      const fullPhone = form.phone ? `${countryCode} ${form.phone}` : '';
      const fullAltPhone = form.alt_phone ? `${altCountryCode} ${form.alt_phone}` : null;
      const fullWA = sameWA ? fullPhone
        : altAsWA && fullAltPhone ? fullAltPhone
        : form.whatsapp ? `${waCountryCode} ${form.whatsapp}` : fullPhone;
      const svcTotals = serviceItems.map(s => calcGST(Number(s.base_fee)||0, s.payment_method, settings.serviceGSTRate, settings.bankGSTRate));
      const totalBaseFee = serviceItems.reduce((sum, s) => sum + (Number(s.base_fee)||0), 0);
      const totalGSTAmt = svcTotals.reduce((sum, s) => sum + s.gstAmount, 0);
      const totalAmountCalc = svcTotals.reduce((sum, s) => sum + s.totalAmount, 0);
      const primaryMethod = serviceItems[0]?.payment_method || 'Cash';
      const combinedServiceName = serviceItems.filter(s => s.service_name).map(s => s.service_name).join(' + ') || '';
      const primaryServiceId = serviceItems[0]?.service_id && serviceItems[0].service_id !== '__other__' ? serviceItems[0].service_id : null;
      const payload = {
        ...form,
        phone: fullPhone,
        whatsapp: fullWA,
        alt_phone: fullAltPhone,
        service_id: primaryServiceId,
        service_name: combinedServiceName,
        payment_method: primaryMethod,
        base_fee: totalBaseFee,
        amount_paid: Number(form.amount_paid) || 0,
        gst_amount: totalGSTAmt,
        total_amount: totalAmountCalc,
        pax_count: Number(form.pax_count) || 1,
        dob: nullDate(form.dob),
        travel_date: nullDate(form.travel_date),
        return_date: nullDate(form.return_date),
      };
      let leadId = lead?.id;
      if (isEdit) {
        const statusChanged = payload.status !== lead.status;
        const paymentChanged = Number(payload.base_fee) !== Number(lead.base_fee) || Number(payload.amount_paid) !== Number(lead.amount_paid);
        await updateLead.mutateAsync({ id: lead.id, updates: payload, logStatus: statusChanged });
        if (pendingFiles.length > 0 && leadId) await uploadPendingDocs(leadId);
        // Sync service items
        if (leadId) {
          await supabase.from('lead_services').delete().eq('lead_id', leadId);
          for (const item of serviceItems) {
            if (item.service_name || Number(item.base_fee) > 0) {
              await supabase.from('lead_services').insert({
                lead_id: leadId,
                service_id: item.service_id && item.service_id !== '__other__' ? item.service_id : null,
                service_name: item.service_name,
                base_fee: Number(item.base_fee) || 0,
                payment_method: item.payment_method,
                notes: item.notes || null,
              });
            }
          }
        }
        toast({ title: 'Lead updated successfully' });
        if (statusChanged && (payload.whatsapp || payload.phone)) {
          setTimeout(() => openWhatsApp({ ...lead, ...payload }, 'status_update'), 300);
        }
        if (paymentChanged && (payload.whatsapp || payload.phone)) {
          setWaLead({ ...lead, ...payload, __waType: 'payment', __prevPaid: lead.amount_paid || 0 });
          // stay open for WA button
        } else {
          onClose();
        }
      } else {
        const created = await createLead.mutateAsync(payload);
        leadId = (created as any)?.id || lead?.id;
        if (pendingFiles.length > 0 && leadId) await uploadPendingDocs(leadId);
        // Sync service items
        if (leadId) {
          await supabase.from('lead_services').delete().eq('lead_id', leadId);
          for (const item of serviceItems) {
            if (item.service_name || Number(item.base_fee) > 0) {
              await supabase.from('lead_services').insert({
                lead_id: leadId,
                service_id: item.service_id && item.service_id !== '__other__' ? item.service_id : null,
                service_name: item.service_name,
                base_fee: Number(item.base_fee) || 0,
                payment_method: item.payment_method,
                notes: item.notes || null,
              });
            }
          }
        }
        toast({ title: 'Lead created successfully' });
        if (created && (payload.whatsapp || payload.phone)) {
          setWaLead(created);
          // stay open — user will close after tapping WhatsApp or Skip
        } else {
          onClose();
        }
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Lead' : 'New Lead'}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="pax">PAX Info</TabsTrigger>
            <TabsTrigger value="service">Service</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="docs">
              Docs {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ''}
            </TabsTrigger>
          </TabsList>

          {/* PAX Tab */}
          <TabsContent value="pax" className="space-y-4 mt-4">
            {!isEdit && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                Fill in the basics below and hit <strong>Save</strong> — you can complete the remaining details later by editing the lead.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Full Name</Label>
                <Input value={form.pax_name} onChange={e => set('pax_name', e.target.value)} placeholder="Passenger name" />
              </div>
              {/* Phone (left) + WhatsApp (right) */}
              <div>
                <Label>Phone *</Label>
                <div className="flex">
                  <Input tabIndex={-1} className="w-[72px] rounded-r-none text-center px-2" value={countryCode}
                    onChange={e => setCountryCode(e.target.value)} placeholder="+91" />
                  <Input className="rounded-l-none flex-1" value={form.phone}
                    onChange={e => set('phone', e.target.value)} onBlur={handlePhoneBlur}
                    placeholder="98765 43210" />
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Checkbox id="sameWA" checked={sameWA}
                    onCheckedChange={v => { setSameWA(!!v); if (v) setAltAsWA(false); }} />
                  <label htmlFor="sameWA" className="text-xs text-muted-foreground cursor-pointer select-none">
                    Same number for WhatsApp
                  </label>
                </div>
              </div>

              <div>
                <Label>WhatsApp</Label>
                <div className="flex">
                  <Input tabIndex={-1} className="w-[72px] rounded-r-none text-center px-2"
                    value={sameWA ? countryCode : altAsWA ? altCountryCode : waCountryCode}
                    onChange={e => setWaCountryCode(e.target.value)}
                    disabled={sameWA || altAsWA}
                    placeholder="+91" />
                  <Input className="rounded-l-none flex-1"
                    value={sameWA ? form.phone : altAsWA ? form.alt_phone : form.whatsapp}
                    onChange={e => set('whatsapp', e.target.value)}
                    disabled={sameWA || altAsWA}
                    placeholder="WhatsApp number" />
                </div>
                {altAsWA && (
                  <p className="text-xs text-muted-foreground mt-1.5">Auto-filled from alt phone</p>
                )}
              </div>

              {/* Alt Phone (below phone, full width) */}
              {showAlt ? (
                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <Label>Alt. Phone <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => { setShowAlt(false); set('alt_phone', ''); setAltAsWA(false); }}>
                      <X className="h-3 w-3 mr-1" /> Remove
                    </Button>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1">
                      <Input tabIndex={-1} className="w-[72px] rounded-r-none text-center px-2" value={altCountryCode}
                        onChange={e => setAltCountryCode(e.target.value)} placeholder="+91" />
                      <Input className="rounded-l-none flex-1" value={form.alt_phone}
                        onChange={e => set('alt_phone', e.target.value)} placeholder="Second number" />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Checkbox id="altWA" checked={altAsWA}
                        onCheckedChange={v => { setAltAsWA(!!v); if (v) setSameWA(false); }} />
                      <label htmlFor="altWA" className="text-xs text-muted-foreground cursor-pointer select-none">
                        Use for WhatsApp
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="col-span-2">
                  <Button variant="ghost" size="sm" className="text-muted-foreground h-8 px-3"
                    onClick={() => setShowAlt(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Phone Number
                  </Button>
                </div>
              )}
              <div className="col-span-2">
                <Label>Service</Label>
                <Select value={form.service_id} onValueChange={handleServiceChange}>
                  <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                  <SelectContent>
                    {services?.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name} — {s.country}</SelectItem>
                    ))}
                    <SelectItem value="__other__">Other</SelectItem>
                  </SelectContent>
                </Select>
                {form.service_id === '__other__' && (
                  <Input
                    className="mt-2"
                    value={form.service_name}
                    onChange={e => set('service_name', e.target.value)}
                    placeholder="Enter service name..."
                  />
                )}
              </div>
              <div>
                <Label>Assign To</Label>
                <Select value={form.assigned_to} onValueChange={handleAgentChange} disabled={!can('leads_assign')}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>
                    {agents?.map(a => <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes for Assignee</Label>
                <Input value={form.assignee_notes} onChange={e => set('assignee_notes', e.target.value)} placeholder="Instructions for the agent..." />
              </div>
              <div className="col-span-2">
                <Label>Destination</Label>
                <Input value={form.destination} onChange={e => set('destination', e.target.value)} placeholder="e.g. Dubai" />
              </div>
            </div>
          </TabsContent>

          {/* Service Tab */}
          <TabsContent value="service" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Email</Label>
                <Input value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" type="email" />
              </div>
              <div>
                <Label>Passport No.</Label>
                <Input value={form.passport_no} onChange={e => set('passport_no', e.target.value)} />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input value={form.dob} onChange={e => set('dob', e.target.value)} type="date" />
              </div>
              <div>
                <Label>Nationality</Label>
                <Input value={form.nationality} onChange={e => set('nationality', e.target.value)} placeholder="Indian" />
              </div>
              <div>
                <Label>No. of PAX</Label>
                <Input value={form.pax_count} onChange={e => set('pax_count', e.target.value)} type="number" min={1} />
              </div>
              <div className="col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
              <div className="col-span-2 border-t pt-3">
                <p className="text-xs text-muted-foreground font-medium mb-3">Trip Details</p>
              </div>
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={v => set('source', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.filter(s => s !== 'All').map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.filter(s => s !== 'All').map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Travel Date</Label>
                <Input value={form.travel_date} onChange={e => set('travel_date', e.target.value)} type="date" />
              </div>
              <div>
                <Label>Return Date</Label>
                <Input value={form.return_date} onChange={e => set('return_date', e.target.value)} type="date" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any special requirements..." />
              </div>
            </div>
          </TabsContent>

          {/* Payment Tab */}
          <TabsContent value="payment" className="space-y-4 mt-4">
            {/* Service items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">Services &amp; Fees</Label>
                <Button variant="outline" size="sm" onClick={() => setServiceItems(prev => [...prev, mkSvcItem()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Service
                </Button>
              </div>
              <div className="space-y-3">
                {serviceItems.map((item, idx) => (
                  <div key={item._key} className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <Label className="text-xs">Service Name</Label>
                        <div className="flex gap-2 mt-1">
                          <Select value={item.service_id} onValueChange={sid => {
                            const svc = services?.find((s: any) => s.id === sid);
                            setServiceItems(prev => prev.map((s, i) => i === idx ? { ...s, service_id: sid, service_name: svc?.name || s.service_name } : s));
                            if (svc?.country && idx === 0) set('destination', svc.country);
                          }}>
                            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                            <SelectContent>
                              {services?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                              <SelectItem value="__other__">Other / Custom</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            className="flex-1 h-8 text-sm"
                            placeholder="Service name…"
                            value={item.service_name}
                            onChange={e => setServiceItems(prev => prev.map((s, i) => i === idx ? { ...s, service_name: e.target.value } : s))}
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Fee (₹)</Label>
                        <Input className="mt-1 h-8 text-sm" type="number" placeholder="0" value={item.base_fee}
                          onChange={e => setServiceItems(prev => prev.map((s, i) => i === idx ? { ...s, base_fee: e.target.value } : s))} />
                      </div>
                      <div>
                        <Label className="text-xs">Method</Label>
                        <Select value={item.payment_method} onValueChange={v => setServiceItems(prev => prev.map((s, i) => i === idx ? { ...s, payment_method: v } : s))}>
                          <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Notes (optional)</Label>
                        <Input className="mt-1 h-8 text-sm" placeholder="e.g. EK521, Hotel Dubai…" value={item.notes}
                          onChange={e => setServiceItems(prev => prev.map((s, i) => i === idx ? { ...s, notes: e.target.value } : s))} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      {(() => {
                        const fee = Number(item.base_fee) || 0;
                        if (!fee) return <span className="text-xs text-muted-foreground">Enter fee to see breakdown</span>;
                        const gst = calcGST(fee, item.payment_method, settings.serviceGSTRate, settings.bankGSTRate);
                        if (gst.gstAmount > 0) return <span className="text-xs text-amber-700">GST {formatINR(gst.gstAmount)} · Net {formatINR(gst.netFee)}</span>;
                        return <span className="text-xs text-muted-foreground">Fee {formatINR(fee)} · No GST</span>;
                      })()}
                      {serviceItems.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive hover:text-destructive"
                          onClick={() => setServiceItems(prev => prev.filter((_, i) => i !== idx))}>
                          <X className="h-3.5 w-3.5 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const total = serviceItems.reduce((sum, s) => sum + calcGST(Number(s.base_fee)||0, s.payment_method, settings.serviceGSTRate, settings.bankGSTRate).totalAmount, 0);
                const totalGST = serviceItems.reduce((sum, s) => sum + calcGST(Number(s.base_fee)||0, s.payment_method, settings.serviceGSTRate, settings.bankGSTRate).gstAmount, 0);
                if (!total) return null;
                return (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm flex justify-between items-center mt-2">
                    <span className="font-semibold">Grand Total</span>
                    <span className="font-bold font-mono">
                      {formatINR(total)}
                      {totalGST > 0 && <span className="text-xs text-amber-700 ml-2">(GST {formatINR(totalGST)})</span>}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Amount paid */}
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <Label>Amount Paid (₹)</Label>
                <Input value={form.amount_paid} onChange={e => set('amount_paid', e.target.value)} type="number" placeholder="0" className="mt-1" />
              </div>
              <div className="flex items-end pb-1">
                {(() => {
                  const total = serviceItems.reduce((sum, s) => sum + calcGST(Number(s.base_fee)||0, s.payment_method, settings.serviceGSTRate, settings.bankGSTRate).totalAmount, 0);
                  const paid = Number(form.amount_paid) || 0;
                  const bal = total - paid;
                  if (!total) return null;
                  return <p className={`text-sm font-medium ${bal > 0 ? 'text-destructive' : 'text-green-600'}`}>Balance: {bal > 0 ? formatINR(bal) : '✓ Fully Paid'}</p>;
                })()}
              </div>
            </div>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="docs" className="space-y-4 mt-4">
            <div className="space-y-3">
              {/* Existing saved documents (edit mode only) */}
              {isEdit && existingDocs && existingDocs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Saved Documents</p>
                  {existingDocs.map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 bg-muted/30">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        <p className="text-xs text-muted-foreground">{(doc.file_size / 1024).toFixed(1)} KB</p>
                      </div>
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" type="button">View</Button>
                      </a>
                    </div>
                  ))}
                </div>
              )}

              <Label htmlFor="new-lead-doc-upload" className="cursor-pointer block">
                <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/50 transition-colors">
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">Click to attach documents</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG, DOC — max 5MB per file</p>
                </div>
                <Input id="new-lead-doc-upload" type="file" className="hidden" multiple
                  onChange={handleFileSelect} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
              </Label>

              {pendingFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">{pendingFiles.length} file(s) queued for upload:</p>
                  {pendingFiles.map(({ file, name }, idx) => (
                    <div key={idx} className="flex items-center gap-3 rounded-lg border px-3 py-2 bg-background">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {pendingFiles.length === 0 && (!isEdit || !existingDocs?.length) && (
                <p className="text-center text-sm text-muted-foreground py-2">No documents attached yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {waLead ? (() => {
            const isPayment = waLead.__waType === 'payment';
            const now = new Date();

            // For new-lead WA (welcome), merge current form values so any payment
            // details filled in the Payment tab after clicking "Create Lead" are used
            const currentFee = form.base_fee !== '' ? Number(form.base_fee) : (waLead.base_fee || 0);
            const currentPaid = form.amount_paid !== '' ? Number(form.amount_paid) : (waLead.amount_paid || 0);
            const effectiveLead = isPayment ? waLead : {
              ...waLead,
              base_fee: currentFee,
              amount_paid: currentPaid,
              payment_method: form.payment_method || waLead.payment_method || 'Cash',
              service_name: form.service_name || waLead.service_name || '',
            };

            const paymentDelta = isPayment
              ? Math.max(0, Number(waLead.amount_paid || 0) - Number(waLead.__prevPaid || 0))
              : 0;
            const extraVars = isPayment ? {
              this_payment: formatINR(paymentDelta > 0 ? paymentDelta : Number(waLead.amount_paid || 0)),
              date: now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
              time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
            } : undefined;

            const waUrl = buildWAUrl(effectiveLead, isPayment ? 'payment_received' : 'welcome', extraVars);

            const handleSendWA = async () => {
              // If payment details were filled after lead creation, save them to DB
              if (!isPayment && (currentFee !== (waLead.base_fee || 0) || currentPaid !== (waLead.amount_paid || 0))) {
                try {
                  const svc = calcGST(currentFee, form.payment_method, settings.serviceGSTRate, settings.bankGSTRate);
                  await updateLead.mutateAsync({
                    id: waLead.id,
                    updates: {
                      base_fee: currentFee,
                      amount_paid: currentPaid,
                      payment_method: form.payment_method || 'Cash',
                      service_name: form.service_name || waLead.service_name || '',
                      gst_amount: svc.gstAmount,
                      total_amount: svc.totalAmount,
                    },
                  });
                } catch {
                  // non-critical — WA still opens
                }
              }
              window.open(waUrl, '_blank');
              setWaLead(null);
              onClose();
            };

            return (
              <div className="flex items-center gap-2 w-full justify-end flex-wrap">
                <Button variant="outline" onClick={() => { setWaLead(null); onClose(); }}>Skip</Button>
                <Button
                  onClick={handleSendWA}
                  className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  {isPayment ? 'Send Payment Receipt on WhatsApp' : 'Send Welcome on WhatsApp'}
                </Button>
              </div>
            );
          })() : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createLead.isPending || updateLead.isPending || uploading}>
                {uploading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lead'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Duplicate phone number warning */}
    <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" /> Number Already Registered
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This phone number is linked to {duplicateLeads.length} existing lead(s):
        </p>
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {duplicateLeads.map(dl => (
            <div key={dl.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{dl.pax_name}</p>
                <p className="text-xs text-muted-foreground">{dl.service_name || '—'} · {dl.status}</p>
                <p className="text-xs text-muted-foreground">{dl.phone}</p>
              </div>
              <Link href={`/leads/${dl.id}`} onClick={() => { setShowDuplicateDialog(false); onClose(); }}>
                <Button variant="outline" size="sm" className="ml-2 shrink-0">Open Lead</Button>
              </Link>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
            Continue Adding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

const PAY_STATUSES = ['All', 'Fully Paid', 'Partially Paid', 'Unpaid'];

export default function Leads() {
  const { can } = useAuth();
  const { data: services } = useServices();
  const { data: agents } = useProfiles();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [source, setSource] = useState('All');
  const [agent, setAgent] = useState('All');
  const [serviceFilter, setServiceFilter] = useState('All');
  const [payStatus, setPayStatus] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<any>(null);
  const [deletingLead, setDeletingLead] = useState<any>(null);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const deleteLead = useDeleteLead();
  const bulkDelete = useBulkDeleteLeads();
  const { toast } = useToast();

  const { data: leads, isLoading } = useLeads({ status, source, search, agent: agent !== 'All' ? agent : undefined });

  const displayLeads = (leads || []).filter(l => {
    if (dateFrom && new Date(l.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(l.created_at) > new Date(dateTo + 'T23:59:59')) return false;
    if (serviceFilter !== 'All' && l.service_name !== serviceFilter) return false;
    if (payStatus !== 'All') {
      const balance = Math.max(0, (l.total_amount || 0) - (l.amount_paid || 0));
      const paid = l.amount_paid || 0;
      if (payStatus === 'Fully Paid' && balance > 0) return false;
      if (payStatus === 'Partially Paid' && (balance === 0 || paid === 0)) return false;
      if (payStatus === 'Unpaid' && paid > 0) return false;
    }
    return true;
  });

  const hasActiveFilters = search || status !== 'All' || source !== 'All' || agent !== 'All' || serviceFilter !== 'All' || payStatus !== 'All' || dateFrom || dateTo;
  const clearFilters = () => { setSearch(''); setStatus('All'); setSource('All'); setAgent('All'); setServiceFilter('All'); setPayStatus('All'); setDateFrom(''); setDateTo(''); };

  const allSelected = displayLeads.length > 0 && displayLeads.every(l => selectedLeads.has(l.id));
  const someSelected = displayLeads.some(l => selectedLeads.has(l.id));

  const exportCSV = () => {
    if (!leads) return;
    const headers = ['Name', 'Phone', 'Service', 'Status', 'Source', 'Agent', 'Service Fee', 'GST', 'Grand Total', 'Paid', 'Balance'];
    const rows = leads.map(l => {
      const svc = calcGST(l.base_fee || 0, l.payment_method || 'Cash');
      const grandTotal = svc.totalAmount;
      return [
        l.pax_name, l.phone, l.service_name, l.status, l.source, l.agent_name,
        l.base_fee, svc.totalGST, grandTotal, l.amount_paid,
        Math.max(0, grandTotal - (l.amount_paid || 0))
      ];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* On mobile: button row first so it's immediately tappable at the top */}
          <div className="flex gap-2 sm:order-last">
            {can('leads_export') && (
              <Button variant="outline" onClick={exportCSV} size="sm">
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            )}
            {can('leads_create') && (
              <Button autoFocus onClick={() => { setEditLead(null); setModalOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> New Lead
              </Button>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground">Manage and track client applications.</p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search name or phone..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Services" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Services</SelectItem>
                  {services?.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger className="w-[155px]"><SelectValue placeholder="All Agents" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Agents</SelectItem>
                  {agents?.map(a => <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={payStatus} onValueChange={setPayStatus}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>{PAY_STATUSES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
              {(['Today', '7d', '30d'] as const).map((label) => {
                const to = new Date().toISOString().split('T')[0];
                const days = label === 'Today' ? 0 : label === '7d' ? 7 : 30;
                const from = days === 0 ? to : new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
                return (
                  <Button key={label} size="sm" variant={dateFrom === from && dateTo === to ? 'default' : 'outline'}
                    onClick={() => { setDateFrom(from); setDateTo(to); }}
                    className="h-9 px-3 text-xs">{label}</Button>
                );
              })}
              <div className="flex items-center gap-2">
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px]" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px]" />
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              )}
            </div>
            {hasActiveFilters && (
              <p className="text-xs text-muted-foreground">
                <SlidersHorizontal className="inline h-3 w-3 mr-1" />
                {displayLeads.length} of {leads?.length || 0} leads shown
              </p>
            )}
          </CardContent>
        </Card>

        {/* Bulk action bar */}
        {selectedLeads.size > 0 && can('roles_manage') && (
          <div className="flex items-center justify-between bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2.5">
            <span className="text-sm font-medium text-destructive">
              {selectedLeads.size} lead{selectedLeads.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedLeads(new Set())}>Clear</Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete {selectedLeads.size} Lead{selectedLeads.size > 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  {can('roles_manage') && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedLeads(new Set(displayLeads.map(l => l.id)));
                          else setSelectedLeads(new Set());
                        }}
                      />
                    </TableHead>
                  )}
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayLeads.length === 0 && (
                  <TableRow><TableCell colSpan={can('roles_manage') ? 8 : 7} className="text-center py-12 text-muted-foreground">No leads found.</TableCell></TableRow>
                )}
                {displayLeads.map(lead => {
                  const { totalAmount: grandTotal } = calcGST(lead.base_fee || 0, lead.payment_method || 'Cash');
                  const bal = Math.max(0, grandTotal - (lead.amount_paid || 0));
                  return (
                    <TableRow key={lead.id} data-selected={selectedLeads.has(lead.id) || undefined} className={selectedLeads.has(lead.id) ? 'bg-destructive/5' : undefined}>
                      {can('roles_manage') && (
                        <TableCell>
                          <Checkbox
                            checked={selectedLeads.has(lead.id)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedLeads);
                              if (checked) next.add(lead.id); else next.delete(lead.id);
                              setSelectedLeads(next);
                            }}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <p className="font-medium">{lead.pax_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {lead.phone && (
                            <a href={`tel:${lead.phone}`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />{lead.phone}
                            </a>
                          )}
                          {(lead.whatsapp || lead.phone) && (
                            <a href={whatsappLink(lead.whatsapp || lead.phone, lead.pax_name)}
                              target="_blank" rel="noopener noreferrer"
                              className="text-[#25D366] hover:opacity-80">
                              <MessageCircle className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{lead.service_name || '—'}</p>
                        {lead.destination && <p className="text-xs text-muted-foreground">{lead.destination}</p>}
                      </TableCell>
                      <TableCell><LeadStatusBadge status={lead.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{lead.agent_name || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatINR(grandTotal)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span className={bal > 0 ? 'text-destructive font-semibold' : 'text-green-600'}>
                          {bal > 0 ? formatINR(bal) : grandTotal > 0 ? '✓' : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/leads/${lead.id}`}>
                            <Button variant="ghost" size="sm">View</Button>
                          </Link>
                          {can('leads_edit') && (
                            <Button variant="ghost" size="sm" onClick={() => { setEditLead(lead); setModalOpen(true); }}>Edit</Button>
                          )}
                          {can('roles_manage') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                              onClick={() => setDeletingLead(lead)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <LeadFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditLead(null); }}
        lead={editLead}
      />

      {/* Bulk delete confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={open => { if (!open) setBulkDeleteOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Delete {selectedLeads.size} Lead{selectedLeads.size > 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{selectedLeads.size}</strong> lead{selectedLeads.size > 1 ? 's' : ''} and all their notes, payments, documents, and history? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={async () => {
                const toDelete = displayLeads
                  .filter(l => selectedLeads.has(l.id))
                  .map(l => ({ id: l.id, pax_name: l.pax_name }));
                try {
                  await bulkDelete.mutateAsync(toDelete);
                  toast({ title: `${toDelete.length} lead${toDelete.length > 1 ? 's' : ''} deleted` });
                  setSelectedLeads(new Set());
                  setBulkDeleteOpen(false);
                } catch (e: any) {
                  toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
                }
              }}
            >
              {bulkDelete.isPending ? 'Deleting…' : `Delete ${selectedLeads.size} Lead${selectedLeads.size > 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deletingLead} onOpenChange={open => { if (!open) setDeletingLead(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Delete Lead
            </DialogTitle>
            <DialogDescription>
              Permanently delete the lead for <strong>{deletingLead?.pax_name}</strong>?
              All notes, payments, documents, and history will also be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeletingLead(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteLead.isPending}
              onClick={async () => {
                try {
                  await deleteLead.mutateAsync({ id: deletingLead.id, pax_name: deletingLead.pax_name });
                  toast({ title: `Lead "${deletingLead.pax_name}" deleted` });
                  setDeletingLead(null);
                } catch (e: any) {
                  toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
                }
              }}
            >
              {deleteLead.isPending ? 'Deleting…' : 'Delete Lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarLayout>
  );
}
