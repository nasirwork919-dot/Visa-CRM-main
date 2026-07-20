import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Briefcase,
  Settings,
  LogOut,
  Menu,
  ShieldAlert,
  BarChart,
  UserPlus,
  ClipboardList,
  Bot
} from 'lucide-react';
import { useAuth, PermissionGuard } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { loadSettings } from '@/hooks/use-settings';

function BrandLogo({ logoUrl, businessName, size = 'md' }: { logoUrl: string; businessName: string; size?: 'sm' | 'md' }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={businessName || 'Logo'}
        className={size === 'sm' ? 'h-8 max-w-[120px] object-contain' : 'h-9 max-w-[140px] object-contain'}
      />
    );
  }
  return (
    <>
      <Briefcase className={size === 'sm' ? 'h-5 w-5' : 'h-6 w-6'} />
      <span>{businessName || 'VisaCRM'}</span>
    </>
  );
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { profile, signOut } = useAuth();
  const [appSettings, setAppSettings] = useState(loadSettings);

  useEffect(() => {
    const handler = () => setAppSettings(loadSettings());
    window.addEventListener('crm-settings-changed', handler);
    return () => window.removeEventListener('crm-settings-changed', handler);
  }, []);

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dash_view' },
    { name: 'Command Center', href: '/command-center', icon: ShieldAlert, permission: 'dash_mis' },
    { name: 'Leads', href: '/leads', icon: Users, permission: 'leads_view_own' },
    { name: 'Walk-ins', href: '/walk-ins', icon: UserPlus, permission: 'walkin_view' },
    { name: 'Payments', href: '/payments', icon: CreditCard, permission: 'pay_view' },
    { name: 'Services', href: '/services', icon: Briefcase, permission: 'svc_view' },
    { name: 'Reports', href: '/reports', icon: BarChart, permission: 'dash_mis' },
    { name: 'Team', href: '/team', icon: Users, permission: 'users_view' },
    { name: 'Roles', href: '/roles', icon: Settings, permission: 'roles_manage' },
    { name: 'Activity Log', href: '/activity-log', icon: ClipboardList, permission: 'roles_manage' },
    { name: 'WhatsApp Bot', href: '/whatsapp-bot', icon: Bot, permission: 'roles_manage' },
    { name: 'Settings', href: '/settings', icon: Settings, permission: 'roles_manage' },
  ];

  const NavLinks = () => (
    <div className="flex flex-col gap-1 w-full">
      {navItems.map((item) => (
        <PermissionGuard key={item.name} permission={item.permission}>
          <Link href={item.href} className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
            location.startsWith(item.href)
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}>
            <item.icon className="h-4 w-4" />
            {item.name}
          </Link>
        </PermissionGuard>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[232px] flex-col border-r bg-card shrink-0">
        <div className="h-16 flex items-center px-6 border-b shrink-0">
          <div className="font-bold text-xl tracking-tight text-primary flex items-center gap-2">
            <BrandLogo logoUrl={appSettings.logoUrl} businessName={appSettings.businessName} size="md" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3">
          <NavLinks />
        </div>

        <div className="p-4 border-t mt-auto shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-primary uppercase">
                {profile?.full_name?.substring(0, 2) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{profile?.full_name}</span>
              <span className="text-xs text-muted-foreground truncate">{profile?.role_name}</span>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Header & Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="md:hidden h-14 flex items-center justify-between px-4 border-b bg-card shrink-0">
          <div className="font-bold text-lg text-primary flex items-center gap-2">
            <BrandLogo logoUrl={appSettings.logoUrl} businessName={appSettings.businessName} size="sm" />
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-2">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
              <div className="h-16 flex items-center px-6 border-b shrink-0">
                <div className="font-bold text-xl text-primary flex items-center gap-2">
                  <BrandLogo logoUrl={appSettings.logoUrl} businessName={appSettings.businessName} size="md" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-4 px-3">
                <NavLinks />
              </div>
              <div className="p-4 border-t mt-auto shrink-0">
                <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
