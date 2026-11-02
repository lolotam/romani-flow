import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { endpoints } from '@/lib/api';
import {
  FileText,
  Users,
  Building2,
  AlertTriangle,
  Plus,
  Download,
  Settings,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layout } from '@/components/Layout';
import { useNavigate } from 'react-router-dom';
import { useDashboardData } from '@/hooks/useDashboardData';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { RecentActivities } from '@/components/dashboard/RecentActivities';
import { RemindersTable } from '@/components/dashboard/RemindersTable';

export default function Dashboard() {
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);
  const [deletedItems, setDeletedItems] = useState<string[]>([]);
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { stats, activities: recentActivities, expiringItems, isLoading } = useDashboardData(t);

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

  const statCards = [
    { title: t('dashboard.stats.totalDocuments'), value: stats.totalDocuments, icon: FileText, gradient: 'bg-gradient-primary', description: t('dashboard.stats.description.totalDocuments') },
    { title: t('dashboard.stats.totalEmployees'), value: stats.totalEmployees, icon: Users, gradient: 'bg-gradient-medical', description: t('dashboard.stats.description.totalEmployees') },
    { title: t('dashboard.stats.totalCompanies'), value: stats.totalCompanies, icon: Building2, gradient: 'bg-gradient-corporate', description: t('dashboard.stats.description.totalCompanies') },
    { title: t('dashboard.stats.expiredDocuments'), value: stats.expiredDocuments, icon: AlertTriangle, gradient: 'bg-destructive', description: t('dashboard.stats.description.expiredDocuments') }
  ];

  const exportAllData = async () => {
    try {
      const exported = await endpoints.backup.export();
      if (exported.error) {
        toast({ title: t('common.error'), description: exported.error.message });
        return;
      }
      const blob = new Blob([JSON.stringify(exported.data, null, 2)], { type: 'application/json' });
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
