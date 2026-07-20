import { useState, useEffect } from 'react';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smartphone, Wifi, WifiOff, RefreshCw, Bot, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

const BOT_API = (import.meta.env.VITE_WA_BOT_URL as string) || 'http://localhost:3001';

interface BotStatus {
  connected: boolean;
  phone: string | null;
  qr: string | null;
}

export default function WhatsAppBotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const { toast } = useToast();

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

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch(`${BOT_API}/disconnect`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      toast({ title: 'Disconnected', description: 'Scan the QR code to connect a new number.' });
      // Poll faster right after disconnect
      setTimeout(fetchStatus, 1500);
      setTimeout(fetchStatus, 4000);
    } catch {
      toast({ title: 'Error', description: 'Could not reach the bot. Is it running?', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
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
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            WhatsApp AI Bot
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered lead qualification via WhatsApp. Automatically qualifies leads and adds them to the CRM.
          </p>
        </div>

        {/* Status Card */}
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
              {status?.connected
                ? <Wifi className="h-5 w-5 text-green-500" />
                : <WifiOff className="h-5 w-5 text-muted-foreground" />}
              {statusBadge()}
              {status?.phone && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Smartphone className="h-3.5 w-3.5" />
                  +{status.phone}
                </span>
              )}
            </div>

            {lastChecked && (
              <p className="text-xs text-muted-foreground">
                Last checked: {lastChecked.toLocaleTimeString()}
              </p>
            )}
          </CardContent>
        </Card>

        {/* QR Code Card — shown when disconnected and QR is available */}
        {!offline && status && !status.connected && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scan to Connect</CardTitle>
            </CardHeader>
            <CardContent>
              {status.qr ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Open WhatsApp on your phone → <strong>Settings → Linked Devices → Link a Device</strong> → scan below:
                  </p>
                  <div className="border rounded-lg p-4 inline-block bg-white">
                    <img src={status.qr} alt="WhatsApp QR Code" className="w-56 h-56" />
                  </div>
                  <p className="text-xs text-muted-foreground">QR code refreshes automatically every few seconds</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating QR code... Please wait.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Connected — active status + disconnect button */}
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
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Incoming messages are handled by the AI. Qualified leads are automatically added to the CRM.
                    </p>
                  </div>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="shrink-0 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground">
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                      Disconnect
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will log out the current number (+{status.phone}) and show a new QR code to connect a different number.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Yes, Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bot offline instructions */}
        {offline && (
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <p className="text-sm font-medium mb-2">Bot is not running</p>
              <p className="text-sm text-muted-foreground mb-3">
                Start the bot from the terminal to enable WhatsApp AI replies:
              </p>
              <div className="bg-muted rounded-md px-3 py-2 font-mono text-sm">
                pm2 restart wa-bot
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Or first time: <span className="font-mono">cd E:\Visa-CRM-main\wa-bot &amp;&amp; node bot.js</span>
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </SidebarLayout>
  );
}
