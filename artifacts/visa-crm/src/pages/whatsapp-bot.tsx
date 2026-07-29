import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smartphone, Wifi, WifiOff, RefreshCw, Bot, LogOut, Loader2, Eye, EyeOff, Save, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { PermissionGuard } from '@/context/AuthContext';
import { useAuth } from '@/context/AuthContext';

const BOT_API = (import.meta.env.VITE_WA_BOT_URL as string) || 'http://localhost:3001';

const DEFAULT_SYSTEM_PROMPT = `You are a friendly visa application assistant for Euro World Global Transit Private Limited. Your job is to qualify leads via WhatsApp by collecting their information naturally.

Collect these details one at a time in a conversational way:
1. Customer's full name
2. Which visa/service they need (e.g., Dubai Tourist Visa, Saudi Umrah Visa, UK Visit Visa, Schengen Visa, etc.)
3. Travel date (approximate is fine)
4. Number of travelers
5. Whether their passport is ready (yes/no)

Rules:
- Ask only ONE question per message
- Be warm, professional, and brief
- CRITICAL: Always respond in the EXACT same language the customer is writing in
  - If they write in Arabic → respond in Arabic
  - If they write in Urdu → respond in Urdu
  - If they write in Hindi → respond in Hindi
  - If they write in English → respond in English
- Do NOT switch languages mid-conversation
- Do NOT discuss fees or pricing
- Do NOT promise visa approval
- Once you have all 5 details, call the create_lead tool immediately

After creating the lead, send the confirmation in the customer's language:
- English: "Thank you [name]! Your details have been registered. Our team will contact you within 2 hours regarding your [service] application. For urgent queries, please reply here."
- Arabic: "شكراً لك [name]! تم تسجيل بياناتك. سيتواصل معك فريقنا خلال ساعتين بخصوص طلب تأشيرة [service]. للاستفسارات العاجلة، يرجى الرد هنا."
- Urdu: "شکریہ [name]! آپ کی معلومات درج ہو گئی ہیں۔ ہماری ٹیم 2 گھنٹوں میں آپ کی [service] درخواست کے بارے میں آپ سے رابطہ کرے گی۔ فوری سوالات کے لیے یہاں جواب دیں۔"
- Hindi: "धन्यवाद [name]! आपकी जानकारी दर्ज हो गई है। हमारी टीम 2 घंटे के भीतर आपके [service] आवेदन के बारे में संपर्क करेगी। तत्काल प्रश्नों के लिए यहाँ उत्तर दें।"`;

interface BotStatus {
  connected: boolean;
  phone: string | null;
  qr: string | null;
}

interface BotSettings {
  system_prompt: string;
  claude_api_key: string;
  updated_by?: string;
  updated_at?: string;
}

export default function WhatsAppBotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<BotSettings>({ system_prompt: DEFAULT_SYSTEM_PROMPT, claude_api_key: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchStatus = async () => {
    try {
      const res = await fetch(BOT_API, { signal: AbortSignal.timeout(2000) });
      const data: BotStatus = await res.json();
      setStatus(data);
      setOffline(false);
    } catch {
      setOffline(true);
      setStatus(null);
    }
    setLastChecked(new Date());
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('wa_bot_settings').select('*').eq('id', 'default').maybeSingle();
    if (data) {
      setSettings({
        system_prompt: data.system_prompt || DEFAULT_SYSTEM_PROMPT,
        claude_api_key: data.claude_api_key || '',
        updated_by: data.updated_by,
        updated_at: data.updated_at,
      });
    }
    setSettingsLoaded(true);
  };

  useEffect(() => {
    fetchStatus();
    loadSettings();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch(`${BOT_API}/disconnect`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      toast({ title: 'Disconnected', description: 'Scan the QR code to connect a new number.' });
      setTimeout(fetchStatus, 1500);
    } catch {
      toast({ title: 'Error', description: 'Could not reach the bot.', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const { error } = await supabase.from('wa_bot_settings').upsert({
        id: 'default',
        system_prompt: settings.system_prompt,
        claude_api_key: settings.claude_api_key || null,
        updated_at: new Date().toISOString(),
        updated_by: profile?.full_name || profile?.email || 'Admin',
      });
      if (error) throw error;
      toast({ title: 'Settings saved', description: 'The bot will use the new instructions within 5 minutes.' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  };

  const statusBadge = () => {
    if (offline) return <Badge variant="outline" className="text-muted-foreground">Bot Offline</Badge>;
    if (!status) return <Badge variant="outline">Checking...</Badge>;
    if (status.connected) return <Badge className="bg-green-500 hover:bg-green-600">Connected</Badge>;
    if (status.qr) return <Badge variant="secondary">Waiting for QR Scan</Badge>;
    return <Badge variant="destructive">Disconnected</Badge>;
  };

  return (
    <SidebarLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            WhatsApp AI Bot
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered lead qualification via WhatsApp.
          </p>
        </div>

        {/* Connection Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Connection Status</CardTitle>
              <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-7 px-2">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              {status?.connected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-muted-foreground" />}
              {statusBadge()}
              {status?.phone && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Smartphone className="h-3.5 w-3.5" />+{status.phone}
                </span>
              )}
            </div>
            {lastChecked && <p className="text-xs text-muted-foreground">Last checked: {lastChecked.toLocaleTimeString()}</p>}
          </CardContent>
        </Card>

        {/* QR Code */}
        {!offline && status && !status.connected && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Scan to Connect</CardTitle></CardHeader>
            <CardContent>
              {status.qr ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Open WhatsApp → <strong>Settings → Linked Devices → Link a Device</strong></p>
                  <div className="border rounded-lg p-4 inline-block bg-white">
                    <img src={status.qr} alt="WhatsApp QR Code" className="w-56 h-56" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Generating QR code...
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active + Disconnect */}
        {status?.connected && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center shrink-0">
                    <Bot className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Bot is active</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Incoming messages are handled by the AI. Qualified leads are automatically added to the CRM.</p>
                  </div>
                </div>
                <PermissionGuard permission="roles_manage">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground">
                        <LogOut className="h-3.5 w-3.5 mr-1.5" />Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will log out +{status.phone} and show a new QR code to connect a different number.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting} className="bg-destructive hover:bg-destructive/90">
                          {disconnecting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Yes, Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </PermissionGuard>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bot Offline */}
        {offline && (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <p className="text-sm font-medium mb-2">Bot is not running</p>
              <p className="text-sm text-muted-foreground mb-3">The bot is hosted on Railway and should start automatically. If offline for more than a few minutes, check Railway dashboard.</p>
              <div className="bg-muted rounded-md px-3 py-2 font-mono text-sm">https://railway.com/project/8fc51769-81c1-459d-b358-cc836a4b2fcf</div>
            </CardContent>
          </Card>
        )}

        {/* Bot Settings — admin only */}
        <PermissionGuard permission="roles_manage">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Bot Settings
              </CardTitle>
              {settings.updated_by && settings.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Last updated by {settings.updated_by} on {new Date(settings.updated_at).toLocaleString()}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Claude API Key */}
              <div className="space-y-2">
                <Label htmlFor="api-key">Claude API Key</Label>
                <p className="text-xs text-muted-foreground">Replace this to use a different Claude API key. Leave blank to use the Railway environment variable.</p>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-ant-api03-... (leave blank to use default)"
                    value={settings.claude_api_key}
                    onChange={e => setSettings(s => ({ ...s, claude_api_key: e.target.value }))}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <Label htmlFor="system-prompt">Bot Instructions</Label>
                <p className="text-xs text-muted-foreground">
                  This is the personality and behaviour guide for the AI. Edit it to change how the bot greets customers, what information it collects, or what tone it uses.
                </p>
                <Textarea
                  id="system-prompt"
                  rows={16}
                  value={settings.system_prompt}
                  onChange={e => setSettings(s => ({ ...s, system_prompt: e.target.value }))}
                  className="font-mono text-sm resize-y"
                  placeholder="Enter bot instructions..."
                />
                <p className="text-xs text-muted-foreground text-right">{settings.system_prompt.length} characters</p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSettings(s => ({ ...s, system_prompt: DEFAULT_SYSTEM_PROMPT }))}
                >
                  Reset to Default
                </Button>
                <Button onClick={handleSaveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </PermissionGuard>
      </div>
    </SidebarLayout>
  );
}
