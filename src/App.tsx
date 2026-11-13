import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ClerkProvider, SignIn, SignUp } from '@clerk/react';
import { arSA, enUS } from '@clerk/localizations';
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ClerkAuthProvider } from './hooks/useClerkAuth';
import { ThemeProvider } from "./contexts/ThemeProvider";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import ProtectedRoute from "./components/ProtectedRoute";
import WorkspaceRequired from './components/WorkspaceRequired';
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import EmployeeProfile from "./pages/EmployeeProfile";
import EmployeeDocuments from "./pages/EmployeeDocuments";
import Documents from "./pages/Documents";
import CompanyDocuments from "./pages/CompanyDocuments";
import Settings from "./pages/Settings";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

export interface RuntimeAuthConfig {
  provider: 'legacy' | 'clerk';
  publishableKey: string | null;
}

const queryClient = new QueryClient();

function AuthLoading() {
  return <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
  </div>;
}

const AppRoutes = () => {
  const { isAuthenticated, isLoading, provider, workspaceRequired } = useAuth();

  if (provider === 'clerk' && isLoading) return <AuthLoading />;
  if (workspaceRequired) return <WorkspaceRequired />;

  return (
    <Routes>
      {/* Clerk's path routing renders its own steps (factor-one, sso-callback,
          verify-email-address) under these prefixes, so the routes take a splat. */}
      <Route path="/login/*" element={!isAuthenticated
        ? provider === 'clerk'
          ? <SignIn routing="path" path="/login" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
          : <Login />
        : <Navigate to="/dashboard" replace />} />
      <Route path="/sign-up/*" element={!isAuthenticated
        ? provider === 'clerk'
          ? <SignUp routing="path" path="/sign-up" signInUrl="/login" fallbackRedirectUrl="/dashboard" />
          : <NotFound />
        : <Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      } />
      <Route path="/employees" element={
        <ProtectedRoute>
          <Employees />
        </ProtectedRoute>
      } />
      <Route path="/employees/:employeeId" element={
        <ProtectedRoute>
          <EmployeeProfile />
        </ProtectedRoute>
      } />
      <Route path="/documents/employee/:employeeId" element={
        <ProtectedRoute>
          <EmployeeDocuments />
        </ProtectedRoute>
      } />
      {/* Legacy route redirect for backward compatibility */}
      <Route path="/employee-documents/:employeeId" element={
        <ProtectedRoute>
          <EmployeeDocuments />
        </ProtectedRoute>
      } />
      <Route path="/documents/company/:companyId" element={
        <ProtectedRoute>
          <CompanyDocuments />
        </ProtectedRoute>
      } />
      <Route path="/documents" element={
        <ProtectedRoute>
          <Documents />
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute>
          <Settings />
        </ProtectedRoute>
      } />
      <Route path="/" element={!isAuthenticated ? <Index /> : <Navigate to="/dashboard" replace />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

function LegacyApplication() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>;
}

function ClerkApplication({ publishableKey }: { publishableKey: string }) {
  const { language } = useLanguage();
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ClerkProvider
          publishableKey={publishableKey}
          localization={language === 'ar' ? arSA : enUS}
          signInUrl="/login"
          signUpUrl="/sign-up"
        >
          <ClerkAuthProvider>
            <AppRoutes />
          </ClerkAuthProvider>
        </ClerkProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>;
}

const App = ({ authConfig }: { authConfig: RuntimeAuthConfig }) => (
  <ThemeProvider>
    <LanguageProvider>
      {authConfig.provider === 'clerk'
        ? <ClerkApplication publishableKey={authConfig.publishableKey!} />
        : <LegacyApplication />}
    </LanguageProvider>
  </ThemeProvider>
);

export default App;
