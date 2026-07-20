import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useEffect } from "react";
import { loadSettings, applyFullTheme, syncSettingsFromDB } from "@/hooks/use-settings";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import CommandCenter from "@/pages/command-center";
import Leads from "@/pages/leads/index";
import LeadDetail from "@/pages/leads/[id]";
import WalkIns from "@/pages/walk-ins";
import Payments from "@/pages/payments";
import Services from "@/pages/services";
import Reports from "@/pages/reports";
import Team from "@/pages/team";
import Roles from "@/pages/roles";
import ActivityLog from "@/pages/activity-log";
import SettingsPage from "@/pages/settings";
import WhatsAppBotPage from "@/pages/whatsapp-bot";

const queryClient = new QueryClient();

// Protected Route wrapper
const ProtectedRoute = ({ component: Component, ...rest }: any) => {
  const { user, loading } = useAuth();
  
  if (loading) return <div className="h-screen w-full flex items-center justify-center">Loading...</div>;
  
  if (!user) return <Redirect to="/login" />;
  
  return <Component {...rest} />;
};

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/command-center"><ProtectedRoute component={CommandCenter} /></Route>
      <Route path="/leads"><ProtectedRoute component={Leads} /></Route>
      <Route path="/leads/:id"><ProtectedRoute component={LeadDetail} /></Route>
      <Route path="/walk-ins"><ProtectedRoute component={WalkIns} /></Route>
      <Route path="/payments"><ProtectedRoute component={Payments} /></Route>
      <Route path="/services"><ProtectedRoute component={Services} /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
      <Route path="/team"><ProtectedRoute component={Team} /></Route>
      <Route path="/roles"><ProtectedRoute component={Roles} /></Route>
      <Route path="/activity-log"><ProtectedRoute component={ActivityLog} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
      <Route path="/whatsapp-bot"><ProtectedRoute component={WhatsAppBotPage} /></Route>
      <Route path="/">
        {() => {
          const { user, loading } = useAuth();
          if (loading) return null;
          return user ? <Redirect to="/dashboard" /> : <Redirect to="/login" />;
        }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ThemeApplier() {
  useEffect(() => {
    // Apply local settings immediately (no flash)
    const s = loadSettings();
    applyFullTheme(s.colorTheme || 'sky-blue', s.customColor);
    // Then sync from DB so logo/theme/settings are shared across all users
    syncSettingsFromDB();
  }, []);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <ThemeApplier />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
