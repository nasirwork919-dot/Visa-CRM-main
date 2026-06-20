import React, { useState, useRef } from 'react';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  useSettings, DEFAULT_MESSAGES, FULL_THEMES, applyFullTheme,
  type MessageTemplates,
} from '@/hooks/use-settings';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Settings, MessageCircle, Receipt, MessageSquare, RotateCcw,
  ImageIcon, Upload, X, Palette, Check, Pipette,
} from 'lucide-react';

const TEMPLATE_VARS = ['{name}', '{service}', '{fee}', '{gst}', '{net}', '{paid}', '{balance}', '{this_payment}', '{date}', '{time}'];

const MESSAGE_CONFIGS: { key: keyof MessageTemplates; label: string; when: string }[] = [
  { key: 'welcome',          label: 'Welcome',          when: 'When a new lead is created' },
  { key: 'under_process',    label: 'Under Process',    when: 'Status → Under Process' },
  { key: 'submitted',        label: 'Submitted',        when: 'Status → Submitted' },
  { key: 'completed',        label: 'Completed',        when: 'Status → Completed' },
  { key: 'cancelled',        label: 'Cancelled',        when: 'Status → Cancelled' },
  { key: 'payment_received', label: 'Payment Received', when: 'When a payment is recorded' },
  { key: 'payment_reminder', label: 'Payment Reminder', when: 'Sent as a balance reminder' },
];

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: typeof FULL_THEMES[0];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      title={theme.label}
      className={cn(
        'group relative rounded-xl border-2 overflow-hidden transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary shadow-md scale-[1.03]'
          : 'border-transparent hover:border-muted-foreground/30 hover:scale-[1.02]',
      )}
    >
      {/* Mini layout preview */}
      <div className="flex h-[62px] w-[104px]" style={{ backgroundColor: theme.preview.bg }}>
        {/* Sidebar strip */}
        <div className="w-[22px] h-full flex flex-col gap-[3px] p-[4px]" style={{ backgroundColor: theme.preview.sidebar }}>
          <div className="h-[3px] rounded-full opacity-40" style={{ backgroundColor: theme.preview.primary }} />
          <div className="h-[3px] rounded-full w-3/4 opacity-20" style={{ backgroundColor: theme.preview.primary }} />
          <div className="h-[3px] rounded-full w-2/3 opacity-20" style={{ backgroundColor: theme.preview.primary }} />
          <div className="h-[3px] rounded-full w-3/4 opacity-20" style={{ backgroundColor: theme.preview.primary }} />
          <div className="h-[3px] rounded-full w-2/3 opacity-20" style={{ backgroundColor: theme.preview.primary }} />
        </div>
        {/* Content area */}
        <div className="flex-1 p-[5px] flex flex-col gap-[4px]">
          <div className="h-[4px] rounded-full w-10 opacity-30" style={{ backgroundColor: theme.dark ? '#ffffff' : '#000000' }} />
          <div className="h-[3px] rounded-full w-8 opacity-15" style={{ backgroundColor: theme.dark ? '#ffffff' : '#000000' }} />
          <div className="flex gap-[3px] mt-[2px]">
            <div className="h-[12px] rounded-[3px] w-[18px] flex items-center justify-center" style={{ backgroundColor: theme.preview.primary }}>
              <div className="h-[2px] w-[8px] rounded-full bg-white opacity-90" />
            </div>
            <div className="h-[12px] rounded-[3px] w-[14px]" style={{ backgroundColor: theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }} />
          </div>
          <div className="mt-[2px] h-[10px] rounded-[3px] w-full" style={{ backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} />
          <div className="h-[10px] rounded-[3px] w-full" style={{ backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} />
        </div>
      </div>
      {/* Label */}
      <div
        className="px-1.5 py-1 text-[11px] font-medium text-center leading-tight"
        style={{ backgroundColor: theme.preview.bg, color: theme.dark ? '#c8d4e8' : '#374151' }}
      >
        {theme.label}
      </div>
      {/* Selected checkmark */}
      {selected && (
        <div
          className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full flex items-center justify-center shadow"
          style={{ backgroundColor: theme.preview.primary }}
        >
          <Check className="h-2.5 w-2.5 text-white" />
        </div>
      )}
    </button>
  );
}

export default function SettingsPage() {
  const { settings, saveSettings } = useSettings();
  const { toast } = useToast();
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    waNumber: settings.waNumber,
    businessName: settings.businessName,
    serviceGSTRate: settings.serviceGSTRate,
    bankGSTRate: settings.bankGSTRate,
  });
  const [messages, setMessages] = useState<MessageTemplates>({ ...settings.messages });
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || '');
  const [colorTheme, setColorTheme] = useState(settings.colorTheme || 'sky-blue');
  const [customColor, setCustomColor] = useState(settings.customColor || '#1A5FB4');

  const setField = (k: keyof typeof form, v: string | number) =>
    setForm(f => ({ ...f, [k]: v }));

  const setMsg = (key: keyof MessageTemplates, value: string) =>
    setMessages(m => ({ ...m, [key]: value }));

  const resetMsg = (key: keyof MessageTemplates) =>
    setMessages(m => ({ ...m, [key]: DEFAULT_MESSAGES[key] }));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Please use an image under 1 MB.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePresetSelect = (name: string) => {
    setColorTheme(name);
    applyFullTheme(name);
  };

  const handleCustomColorChange = (hex: string) => {
    setCustomColor(hex);
    setColorTheme('custom');
    applyFullTheme('custom', hex);
  };

  const handleSave = () => {
    saveSettings({
      waNumber: form.waNumber.trim(),
      businessName: form.businessName.trim(),
      serviceGSTRate: form.serviceGSTRate !== '' ? Number(form.serviceGSTRate) : 18,
      bankGSTRate: form.bankGSTRate !== '' ? Number(form.bankGSTRate) : 18,
      messages,
      logoUrl,
      colorTheme,
      customColor,
    });
    applyFullTheme(colorTheme, customColor);
    toast({ title: 'Settings saved', description: 'All preferences have been updated.' });
  };

  const sR = form.serviceGSTRate !== '' ? Number(form.serviceGSTRate) : 18;
  const bR = form.bankGSTRate !== '' ? Number(form.bankGSTRate) : 18;

  const lightThemes = FULL_THEMES.filter(t => !t.dark);
  const darkThemes = FULL_THEMES.filter(t => t.dark);

  return (
    <SidebarLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure branding, appearance, WhatsApp number, GST rates, and message templates.
          </p>
        </div>

        {/* Branding & Appearance */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Branding */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-violet-600" />
                Branding
              </CardTitle>
              <CardDescription>Company logo shown in the sidebar header.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Company Logo</Label>
                <div className="mt-2 flex items-center gap-4">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Company logo"
                      className="h-12 max-w-[140px] object-contain rounded border p-1.5 bg-muted/40"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded border bg-muted/40 flex items-center justify-center shrink-0">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="logo-upload" className="cursor-pointer">
                      <Button variant="outline" size="sm" asChild>
                        <span>
                          <Upload className="h-3.5 w-3.5 mr-1.5" />
                          {logoUrl ? 'Change' : 'Upload Logo'}
                        </span>
                      </Button>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                    </label>
                    {logoUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setLogoUrl('')}
                      >
                        <X className="h-3 w-3 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">PNG, SVG, or JPG. Max 1 MB.</p>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp / Business */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-green-600" />
                WhatsApp &amp; Business
              </CardTitle>
              <CardDescription>Agency details shown in messages.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Business Name</Label>
                <Input
                  value={form.businessName}
                  onChange={e => setField('businessName', e.target.value)}
                  placeholder="e.g. Nasir Travel Agency"
                />
              </div>
              <div>
                <Label>WhatsApp Sender Number</Label>
                <Input
                  value={form.waNumber}
                  onChange={e => setField('waNumber', e.target.value)}
                  placeholder="e.g. 919876543210 (with country code)"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Include country code without + (e.g. 91 for India).
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Appearance — full width */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-indigo-600" />
              Appearance
            </CardTitle>
            <CardDescription>
              Choose a complete color scheme — backgrounds, sidebar, buttons, text, cards. Preview updates instantly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Light themes */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Light Themes</p>
              <div className="flex flex-wrap gap-3">
                {lightThemes.map(theme => (
                  <ThemeCard
                    key={theme.name}
                    theme={theme}
                    selected={colorTheme === theme.name}
                    onSelect={() => handlePresetSelect(theme.name)}
                  />
                ))}
              </div>
            </div>

            {/* Dark themes */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dark Themes</p>
              <div className="flex flex-wrap gap-3">
                {darkThemes.map(theme => (
                  <ThemeCard
                    key={theme.name}
                    theme={theme}
                    selected={colorTheme === theme.name}
                    onSelect={() => handlePresetSelect(theme.name)}
                  />
                ))}
              </div>
            </div>

            {/* Custom color picker */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Pipette className="h-3.5 w-3.5" />
                    Custom Color
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pick any color — generates a full light theme from it.
                  </p>
                </div>
                {colorTheme === 'custom' && (
                  <Badge variant="secondary" className="text-xs">Active</Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/* Styled color swatch that opens native color picker */}
                <div
                  className={cn(
                    'h-10 w-10 rounded-lg border-2 cursor-pointer shadow-sm transition-transform hover:scale-105',
                    colorTheme === 'custom' ? 'border-primary ring-2 ring-primary/30' : 'border-muted-foreground/30',
                  )}
                  style={{ backgroundColor: customColor }}
                  onClick={() => colorInputRef.current?.click()}
                  title="Click to open color picker"
                />
                <input
                  ref={colorInputRef}
                  type="color"
                  value={customColor}
                  onChange={e => handleCustomColorChange(e.target.value)}
                  className="sr-only"
                />
                <div className="flex-1">
                  <Input
                    value={customColor}
                    onChange={e => {
                      const v = e.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setCustomColor(v);
                        if (v.length === 7) handleCustomColorChange(v);
                      }
                    }}
                    placeholder="#1A5FB4"
                    className="font-mono text-sm h-10 w-32"
                  />
                </div>
                <Button
                  variant={colorTheme === 'custom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleCustomColorChange(customColor)}
                >
                  {colorTheme === 'custom' ? 'Previewing' : 'Use This Color'}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Selected: <span className="font-medium">
                {colorTheme === 'custom'
                  ? `Custom (${customColor})`
                  : FULL_THEMES.find(t => t.name === colorTheme)?.label || colorTheme}
              </span>. Click <strong>Save All Settings</strong> to persist.
            </p>
          </CardContent>
        </Card>

        {/* GST Rates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-600" />
              GST Rates
            </CardTitle>
            <CardDescription>
              Both GSTs extracted from the client's total. Bank GST applies only for non-cash payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Service GST Rate (%)</Label>
                <Input
                  type="number" min={0} max={100}
                  value={form.serviceGSTRate}
                  onChange={e => setField('serviceGSTRate', e.target.value)}
                  placeholder="18"
                />
                <p className="text-xs text-muted-foreground mt-1">All payments including cash. Default: 18%</p>
              </div>
              <div>
                <Label>Bank GST Rate (%)</Label>
                <Input
                  type="number" min={0} max={100}
                  value={form.bankGSTRate}
                  onChange={e => setField('bankGSTRate', e.target.value)}
                  placeholder="18"
                />
                <p className="text-xs text-muted-foreground mt-1">UPI / Bank / Cheque / Other only. Default: 18%</p>
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 border p-3 text-xs space-y-1 mt-4">
              <p className="font-semibold text-muted-foreground mb-2">Preview — ₹2,000 fee</p>
              <p className="font-medium">Cash:</p>
              <p className="pl-3">Service GST = ₹{Math.round(2000 * sR / (100 + sR))} &nbsp;|&nbsp; Net = ₹{Math.round(2000 * 100 / (100 + sR))}</p>
              <p className="font-medium mt-1">Bank/UPI:</p>
              <p className="pl-3">Service GST = ₹{Math.round(2000 * sR / (100 + sR + bR))} + Bank GST = ₹{Math.round(2000 * bR / (100 + sR + bR))} &nbsp;|&nbsp; Net = ₹{Math.round(2000 * 100 / (100 + sR + bR))}</p>
            </div>
          </CardContent>
        </Card>

        {/* Message Templates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              WhatsApp Message Templates
            </CardTitle>
            <CardDescription>
              Customize the message sent for each event. Use variables below — they are replaced automatically with lead data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2 p-3 bg-muted/40 rounded-lg border">
              <span className="text-xs text-muted-foreground self-center mr-1 font-medium">Available variables:</span>
              {TEMPLATE_VARS.map(v => (
                <Badge key={v} variant="secondary" className="font-mono text-xs cursor-default">{v}</Badge>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {MESSAGE_CONFIGS.map(({ key, label, when }) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-semibold">{label}</Label>
                      <p className="text-xs text-muted-foreground">{when}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => resetMsg(key)}
                      title="Reset to default"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <Textarea
                    value={messages[key]}
                    onChange={e => setMsg(key, e.target.value)}
                    rows={5}
                    className="font-mono text-xs resize-y"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} className="px-8">Save All Settings</Button>
      </div>
    </SidebarLayout>
  );
}
