import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { jsonDatabase } from '@/lib/jsonDatabase';
import {
  FileText,
  Users,
  Building2,
  AlertTriangle,
  Plus,
  Download,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layout } from '@/components/Layout';
import { useNavigate } from 'react-router-dom';
import type { DashboardStats, RecentActivity, ExpiringItem } from '@/types';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { RecentActivities } from '@/components/dashboard/RecentActivities';
import { RemindersTable } from '@/components/dashboard/RemindersTable';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalDocuments: 0,
    totalEmployees: 0,
    totalCompanies: 0,
    expiringDocuments: 0,
    expiredDocuments: 0
  });
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);
  const [deletedItems, setDeletedItems] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { logout } = useAuth();
  const { toast } = useToast();
  const { t, language, isRTL } = useLanguage();
  const navigate = useNavigate();

  // Pin/Unpin reminder item
  const togglePinItem = (itemId: string) => {
    setPinnedItems(prev => {
      const newPinned = prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId];
      localStorage.setItem('pinnedReminders', JSON.stringify(newPinned));
      return newPinned;
    });
  };

  // Delete reminder item
  const deleteReminderItem = (itemId: string) => {
    if (confirm(t('dashboard.reminders.actions.confirmDelete'))) {
      setDeletedItems(prev => {
        const newDeleted = [...prev, itemId];
        localStorage.setItem('deletedReminders', JSON.stringify(newDeleted));
        return newDeleted;
      });
      toast({
        title: t('common.success'),
        description: t('dashboard.reminders.deleteSuccess')
      });
    }
  };

  // Load pinned and deleted items from localStorage on mount
  useEffect(() => {
    const savedPinned = localStorage.getItem('pinnedReminders');
    const savedDeleted = localStorage.getItem('deletedReminders');
    if (savedPinned) setPinnedItems(JSON.parse(savedPinned));
    if (savedDeleted) setDeletedItems(JSON.parse(savedDeleted));
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [{ data: documents }, { data: employees }, { data: companies }] = await Promise.all([
          jsonDatabase.from('documents').select('*').execute(),
          jsonDatabase.from('employees').select('*').execute(),
          jsonDatabase.from('companies').select('*').execute(),
        ]);

        const validCompanies = new Set(companies?.map(c => c.id) || []);
        const actualEmployees = employees?.filter(emp =>
          !emp.company_id || validCompanies.has(emp.company_id)
        ) || [];
        const validEmployees = new Set(actualEmployees.map(e => e.id));
        const actualDocuments = documents?.filter(doc => {
          if (doc.employee_id && !validEmployees.has(doc.employee_id)) return false;
          if (doc.company_id && !validCompanies.has(doc.company_id)) return false;
          return true;
        }) || [];

        // Calculate expiring/expired
        let expiringCount = 0;
        let expiredCount = 0;
        const today = new Date();

        actualDocuments.forEach(doc => {
          if (doc.expiry_date) {
            const diffDays = Math.ceil((new Date(doc.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) expiredCount++;
            else if (diffDays <= 30) expiringCount++;
          }
        });

        setStats({
          totalDocuments: actualDocuments.length,
          totalEmployees: actualEmployees.length,
          totalCompanies: companies?.length || 0,
          expiringDocuments: expiringCount,
          expiredDocuments: expiredCount
        });

        // Recent activities
        const activities: RecentActivity[] = [];
        if (actualEmployees.length > 0) {
          actualEmployees
            .filter(emp => emp.created_at)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 2)
            .forEach(emp => {
              activities.push({
                id: `emp_${emp.id}`,
                type: 'employee_added',
                description: t('dashboard.recentActivities.employeeAdded', { name: emp.name }),
                date: emp.created_at,
                user: t('dashboard.recentActivities.admin')
              });
            });
        }
        if (actualDocuments.length > 0) {
          actualDocuments
            .filter(doc => doc.created_at)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 3)
            .forEach(doc => {
              activities.push({
                id: `doc_${doc.id}`,
                type: 'document_added',
                description: t('dashboard.recentActivities.documentAdded', { title: doc.title }),
                date: doc.created_at,
                user: t('dashboard.recentActivities.admin')
              });
            });
        }
        activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setRecentActivities(activities.slice(0, 5));

        // Expiring items
        const expiringItemsData: ExpiringItem[] = [];

        actualEmployees.forEach(employee => {
          if (employee.residency_expiry_date) {
            const diffDays = Math.ceil((new Date(employee.residency_expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) {
              expiringItemsData.push({
                id: employee.id,
                title: t('dashboard.reminders.types.residency'),
                type: 'employee',
                entityName: employee.name,
                expiryDate: employee.residency_expiry_date,
                daysLeft: diffDays,
                status: diffDays < 0 ? 'expired' : diffDays <= 7 ? 'critical' : 'warning'
              });
            }
          }
          if ((employee as any).driving_license && (employee as any).driving_license_expiry_date) {
            const diffDays = Math.ceil((new Date((employee as any).driving_license_expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) {
              expiringItemsData.push({
                id: `${employee.id}_license`,
                title: t('dashboard.reminders.types.drivingLicense'),
                type: 'employee',
                entityName: employee.name,
                expiryDate: (employee as any).driving_license_expiry_date,
                daysLeft: diffDays,
                status: diffDays < 0 ? 'expired' : diffDays <= 7 ? 'critical' : 'warning'
              });
            }
          }
        });

        actualDocuments.forEach(doc => {
          if (doc.expiry_date) {
            const diffDays = Math.ceil((new Date(doc.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) {
              let entityName = t('common.notSpecified');
              if (doc.employee_id) {
                const employee = employees?.find(emp => emp.id === doc.employee_id);
                entityName = employee?.name || t('common.unknown');
              } else if (doc.company_id) {
                const company = companies?.find(comp => comp.id === doc.company_id);
                entityName = company?.name || t('common.unknown');
              }
              expiringItemsData.push({
                id: doc.id,
                title: doc.title,
                type: doc.employee_id ? 'employee' : 'company',
                entityName,
                expiryDate: doc.expiry_date,
                daysLeft: diffDays,
                status: diffDays < 0 ? 'expired' : diffDays <= 7 ? 'critical' : 'warning'
              });
            }
          }
        });

        expiringItemsData.sort((a, b) => a.daysLeft - b.daysLeft);
        setExpiringItems(expiringItemsData);
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [t]);

  const statCards = [
    { title: t('dashboard.stats.totalDocuments'), value: stats.totalDocuments, icon: FileText, gradient: 'bg-gradient-primary', description: t('dashboard.stats.description.totalDocuments') },
    { title: t('dashboard.stats.totalEmployees'), value: stats.totalEmployees, icon: Users, gradient: 'bg-gradient-medical', description: t('dashboard.stats.description.totalEmployees') },
    { title: t('dashboard.stats.totalCompanies'), value: stats.totalCompanies, icon: Building2, gradient: 'bg-gradient-corporate', description: t('dashboard.stats.description.totalCompanies') },
    { title: t('dashboard.stats.expiredDocuments'), value: stats.expiredDocuments, icon: AlertTriangle, gradient: 'bg-destructive', description: t('dashboard.stats.description.expiredDocuments') }
  ];

  const exportAllData = async () => {
    try {
      const [documentsResult, employeesResult, companiesResult] = await Promise.all([
        jsonDatabase.from('documents').select('*').execute(),
        jsonDatabase.from('employees').select('*').execute(),
        jsonDatabase.from('companies').select('*').execute()
      ]);
      const csvData = { documents: documentsResult.data || [], employees: employeesResult.data || [], companies: companiesResult.data || [] };
      const blob = new Blob([JSON.stringify(csvData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `romani-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  };

  const quickActions = [
    { titleKey: 'dashboard.quickActions.addDocument', icon: Plus, href: '/documents', action: () => navigate('/documents') },
    { titleKey: 'dashboard.quickActions.addEmployee', icon: Users, href: '/employees', action: () => navigate('/employees') },
    { titleKey: 'dashboard.quickActions.exportData', icon: Download, href: '#', action: exportAllData },
    { titleKey: 'dashboard.quickActions.settings', icon: Settings, href: '/settings', action: () => navigate('/settings') }
  ];

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-foreground">{t('header.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
          <div className="mt-4 mb-6">
            <img src="/curemed-logo.svg" alt="CureMed Logo" className="mx-auto h-10 w-auto opacity-80 hover:opacity-100 transition-opacity duration-300" />
          </div>
        </div>

        {/* Welcome */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-2">{t('dashboard.welcome.title')}</h2>
          <p className="text-muted-foreground">
            {t('dashboard.welcome.date', { date: new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA') })}
          </p>
        </motion.div>

        <StatsGrid statCards={statCards} language={language} />

        {/* Alerts */}
        {(stats.expiringDocuments > 0 || stats.expiredDocuments > 0) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mb-8">
            <Card className="border-warning bg-warning/5 shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-warning">
                  <AlertTriangle className="h-5 w-5" />
                  <span>{t('dashboard.alerts.title')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.expiredDocuments > 0 && (
                    <p className="text-destructive">{t('dashboard.alerts.expiredMessage', { count: stats.expiredDocuments })}</p>
                  )}
                  {stats.expiringDocuments > 0 && (
                    <p className="text-warning">{t('dashboard.alerts.expiringMessage', { count: stats.expiringDocuments })}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <QuickActions actions={quickActions} t={t} />

        {/* Recent Activities and Reminders Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentActivities activities={recentActivities} language={language} t={t} />
          <RemindersTable
            items={expiringItems}
            pinnedItems={pinnedItems}
            deletedItems={deletedItems}
            onTogglePin={togglePinItem}
            onDelete={deleteReminderItem}
            language={language}
            t={t}
          />
        </div>
      </div>
    </Layout>
  );
}
