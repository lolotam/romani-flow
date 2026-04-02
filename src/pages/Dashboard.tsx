import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { jsonDatabase } from '@/lib/jsonDatabase';
import {
  FileText,
  Users,
  Building2,
  AlertTriangle,
  Calendar,
  Plus,
  Download,
  Settings,
  Clock,
  User,
  Trash2,
  Pin,
  PinOff
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layout } from '@/components/Layout';
import { useNavigate } from 'react-router-dom';
import type { DashboardStats, RecentActivity, ExpiringItem } from '@/types';

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

      // Save to localStorage for persistence
      localStorage.setItem('pinnedReminders', JSON.stringify(newPinned));
      return newPinned;
    });
  };

  // Delete reminder item
  const deleteReminderItem = (itemId: string) => {
    if (confirm(t('dashboard.reminders.actions.confirmDelete'))) {
      setDeletedItems(prev => {
        const newDeleted = [...prev, itemId];
        // Save to localStorage for persistence
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

    if (savedPinned) {
      setPinnedItems(JSON.parse(savedPinned));
    }
    if (savedDeleted) {
      setDeletedItems(JSON.parse(savedDeleted));
    }
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Force refresh by adding timestamp to avoid caching
        const timestamp = Date.now();
        console.log('🔄 Fetching fresh data at:', new Date().toISOString());

        // Fetch all documents to calculate stats with cache busting
        const { data: documents } = await jsonDatabase
          .from('documents')
          .select('*')
          .execute();

        // Fetch total employees
        const { data: employees } = await jsonDatabase
          .from('employees')
          .select('*')
          .execute();

        // Fetch total companies
        const { data: companies } = await jsonDatabase
          .from('companies')
          .select('*')
          .execute();

        const validCompanies = new Set(companies?.map(c => c.id) || []);

        // Filter out orphaned employees
        const actualEmployees = employees?.filter(emp =>
          !emp.company_id || validCompanies.has(emp.company_id)
        ) || [];

        const validEmployees = new Set(actualEmployees.map(e => e.id));

        // Filter out orphaned documents
        const actualDocuments = documents?.filter(doc => {
          if (doc.employee_id && !validEmployees.has(doc.employee_id)) return false;
          if (doc.company_id && !validCompanies.has(doc.company_id)) return false;
          return true;
        }) || [];

        const documentsCount = actualDocuments.length;
        const employeesCount = actualEmployees.length;
        const companiesCount = companies?.length || 0;

        // DEBUG: Log all counts for verification
        console.log('📈 DEBUG - Final counts:', {
          documents: documentsCount,
          employees: employeesCount,
          companies: companiesCount
        });

        // Calculate expiring and expired documents based on actual expiry dates
        let expiringCount = 0;
        let expiredCount = 0;

        if (actualDocuments.length > 0) {
          const today = new Date();
          actualDocuments.forEach(doc => {
            if (doc.expiry_date) {
              const expiryDate = new Date(doc.expiry_date);
              const diffTime = expiryDate.getTime() - today.getTime();
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              if (diffDays < 0) {
                expiredCount++;
              } else if (diffDays <= 30) {
                expiringCount++;
              }
            }
          });
        }

        setStats({
          totalDocuments: documentsCount,
          totalEmployees: employeesCount,
          totalCompanies: companiesCount,
          expiringDocuments: expiringCount,
          expiredDocuments: expiredCount
        });

        // Generate recent activities only if there are actual data
        const activities: RecentActivity[] = [];

        // Add real recent employees (only if they exist)
        if (actualEmployees.length > 0) {
          const recentEmployees = actualEmployees
            .filter(emp => emp.created_at)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 2);

          recentEmployees.forEach(emp => {
            activities.push({
              id: `emp_${emp.id}`,
              type: 'employee_added',
              description: t('dashboard.recentActivities.employeeAdded', { name: emp.name }),
              date: emp.created_at,
              user: t('dashboard.recentActivities.admin')
            });
          });
        }

        // Add real recent documents (only if they exist)
        if (actualDocuments.length > 0) {
          const recentDocuments = actualDocuments
            .filter(doc => doc.created_at)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 3);

          recentDocuments.forEach(doc => {
            activities.push({
              id: `doc_${doc.id}`,
              type: 'document_added',
              description: t('dashboard.recentActivities.documentAdded', { title: doc.title }),
              date: doc.created_at,
              user: t('dashboard.recentActivities.admin')
            });
          });
        }

        // Sort activities by date (most recent first)
        activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        setRecentActivities(activities.slice(0, 5)); // Keep only 5 most recent

        // Get expiring items
        const expiringItemsData: ExpiringItem[] = [];

        // Check employee residency expiry
        actualEmployees.forEach(employee => {
          if (employee.residency_expiry_date) {
            const today = new Date();
            const expiry = new Date(employee.residency_expiry_date);
            const diffTime = expiry.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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

          // Check driving license expiry
          if (employee.driving_license && employee.driving_license_expiry_date) {
            const today = new Date();
            const expiry = new Date(employee.driving_license_expiry_date);
            const diffTime = expiry.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 30) {
              expiringItemsData.push({
                id: `${employee.id}_license`,
                title: t('dashboard.reminders.types.drivingLicense'),
                type: 'employee',
                entityName: employee.name,
                expiryDate: employee.driving_license_expiry_date,
                daysLeft: diffDays,
                status: diffDays < 0 ? 'expired' : diffDays <= 7 ? 'critical' : 'warning'
              });
            }
          }
        });

        // Check document expiry
        actualDocuments.forEach(doc => {
          if (doc.expiry_date) {
            const today = new Date();
            const expiry = new Date(doc.expiry_date);
            const diffTime = expiry.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 30) {
              // Find the actual employee or company name
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
                entityName: entityName,
                expiryDate: doc.expiry_date,
                daysLeft: diffDays,
                status: diffDays < 0 ? 'expired' : diffDays <= 7 ? 'critical' : 'warning'
              });
            }
          }
        });

        // Sort by most urgent first
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
    {
      title: t('dashboard.stats.totalDocuments'),
      value: stats.totalDocuments,
      icon: FileText,
      gradient: 'bg-gradient-primary',
      description: t('dashboard.stats.description.totalDocuments')
    },
    {
      title: t('dashboard.stats.totalEmployees'),
      value: stats.totalEmployees,
      icon: Users,
      gradient: 'bg-gradient-medical',
      description: t('dashboard.stats.description.totalEmployees')
    },
    {
      title: t('dashboard.stats.totalCompanies'),
      value: stats.totalCompanies,
      icon: Building2,
      gradient: 'bg-gradient-corporate',
      description: t('dashboard.stats.description.totalCompanies')
    },
    {
      title: t('dashboard.stats.expiredDocuments'),
      value: stats.expiredDocuments,
      icon: AlertTriangle,
      gradient: 'bg-destructive',
      description: t('dashboard.stats.description.expiredDocuments')
    }
  ];

  const exportAllData = async () => {
    try {
      const [documentsResult, employeesResult, companiesResult] = await Promise.all([
        jsonDatabase.from('documents').select('*').execute(),
        jsonDatabase.from('employees').select('*').execute(),
        jsonDatabase.from('companies').select('*').execute()
      ]);

      const csvData = {
        documents: documentsResult.data || [],
        employees: employeesResult.data || [],
        companies: companiesResult.data || []
      };

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
    { titleKey: 'dashboard.quickActions.addDocument', icon: Plus, href: '/documents', action: () => window.location.href = '/documents' },
    { titleKey: 'dashboard.quickActions.addEmployee', icon: Users, href: '/employees', action: () => window.location.href = '/employees' },
    { titleKey: 'dashboard.quickActions.exportData', icon: Download, href: '#', action: exportAllData },
    { titleKey: 'dashboard.quickActions.settings', icon: Settings, href: '/settings', action: () => window.location.href = '/settings' }
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
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t('header.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
          {/* CureMed Logo */}
          <div className="mt-4 mb-6">
            <img
              src="/curemed-logo.svg"
              alt="CureMed Logo"
              className="mx-auto h-10 w-auto opacity-80 hover:opacity-100 transition-opacity duration-300"
            />
          </div>
        </div>

        {/* Main Content */}
        {/* Welcome Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h2 className="text-3xl font-bold text-foreground mb-2">
            {t('dashboard.welcome.title')}
          </h2>
          <p className="text-muted-foreground">
            {t('dashboard.welcome.date', { date: new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA') })}
          </p>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="relative overflow-hidden shadow-elegant hover:shadow-glow transition-all duration-300 transform hover:scale-105">
                <div className={`absolute top-0 right-0 w-32 h-32 ${stat.gradient} opacity-10 rounded-full -translate-y-16 translate-x-16`}></div>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {stat.value.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>


        {/* Alerts Section */}
        {(stats.expiringDocuments > 0 || stats.expiredDocuments > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-8"
          >
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
                    <p className="text-destructive">
                      {t('dashboard.alerts.expiredMessage', { count: stats.expiredDocuments })}
                    </p>
                  )}
                  {stats.expiringDocuments > 0 && (
                    <p className="text-warning">
                      {t('dashboard.alerts.expiringMessage', { count: stats.expiringDocuments })}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-8"
        >
          <h3 className="text-xl font-semibold text-foreground mb-4">
            {t('dashboard.quickActions.title')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickActions.map((action, index) => (
              <Card
                key={index}
                className="cursor-pointer shadow-soft hover:shadow-elegant transition-all duration-300 transform hover:scale-105 hover:bg-accent/50"
                onClick={action.action}
              >
                <CardContent className="flex items-center space-x-4 p-6">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <action.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{t(action.titleKey)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* Recent Activities and Reminders Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activities */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Calendar className="h-5 w-5" />
                  <span>{t('dashboard.recentActivities.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('dashboard.recentActivities.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recentActivities.length > 0 ? (
                  <div className="space-y-4">
                    {recentActivities.map((activity) => (
                      <div key={activity.id} className="flex items-start space-x-3 p-3 bg-muted/30 rounded-lg">
                        <div className="p-2 bg-primary/10 rounded-full">
                          {activity.type === 'employee_added' ? (
                            <User className="h-4 w-4 text-primary" />
                          ) : (
                            <FileText className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{activity.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(activity.date).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA')} - {activity.user}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('dashboard.recentActivities.noActivities')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Reminders */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5" />
                  <span>{t('dashboard.reminders.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('dashboard.reminders.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Filter out deleted items and sort by pinned status
                  const filteredItems = expiringItems
                    .filter(item => !deletedItems.includes(item.id))
                    .map(item => ({
                      ...item,
                      isPinned: pinnedItems.includes(item.id)
                    }))
                    .sort((a, b) => {
                      // Pinned items first, then by urgency
                      if (a.isPinned && !b.isPinned) return -1;
                      if (!a.isPinned && b.isPinned) return 1;
                      return a.daysLeft - b.daysLeft;
                    });

                  return filteredItems.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-left rtl:text-right w-12"></TableHead>
                            <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.type')}</TableHead>
                            <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.name')}</TableHead>
                            <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.expiryDate')}</TableHead>
                            <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.status')}</TableHead>
                            <TableHead className="text-left rtl:text-right w-20">{t('dashboard.reminders.table.actions')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredItems.slice(0, 5).map((item) => (
                            <TableRow key={item.id} className={item.isPinned ? 'bg-blue-50/50' : ''}>
                              <TableCell>
                                {item.isPinned && (
                                  <Pin className="h-4 w-4 text-blue-600" />
                                )}
                              </TableCell>
                              <TableCell className="font-medium">{item.title}</TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  {item.type === 'employee' ? (
                                    <User className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span>{item.entityName}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {new Date(item.expiryDate).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA')}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={
                                    item.status === 'expired'
                                      ? 'bg-red-500 text-white'
                                      : item.status === 'critical'
                                        ? 'bg-orange-500 text-white'
                                        : 'bg-yellow-500 text-white'
                                  }
                                >
                                  {item.daysLeft < 0
                                    ? t('dashboard.reminders.status.expired')
                                    : item.daysLeft === 0
                                      ? t('dashboard.reminders.status.expiringToday')
                                      : t('dashboard.reminders.status.daysLeft', { days: Math.abs(item.daysLeft) })}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => togglePinItem(item.id)}
                                    title={item.isPinned ? t('dashboard.reminders.actions.unpin') : t('dashboard.reminders.actions.pin')}
                                  >
                                    {item.isPinned ? (
                                      <PinOff className="h-3 w-3 text-blue-600" />
                                    ) : (
                                      <Pin className="h-3 w-3" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={() => deleteReminderItem(item.id)}
                                    title={t('dashboard.reminders.actions.delete')}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {filteredItems.length > 5 && (
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          {t('dashboard.reminders.moreItems', { count: filteredItems.length - 5 })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>{t('dashboard.reminders.noReminders')}</p>
                      <p className="text-sm">{t('dashboard.reminders.allDocumentsValid')}</p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </Layout>
  );
}