import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { jsonDatabase, Employee, Document } from '@/lib/jsonDatabase';
import { Layout } from '@/components/Layout';
import {
  getExpiringEmployees,
  getExpiringDocuments,
  sendExpiryNotification,
  checkAndSendNotifications,
  EmailNotificationSettings,
  ExpiryData
} from '@/lib/emailService';
import {
  Settings as SettingsIcon,
  Mail,
  Moon,
  Sun,
  Download,
  Edit,
  Pencil,
  Upload,
  Database,
  Clock,
  Building2,
  FileText,
  UserCog,
  Shield,
  Server,
  Archive,
  Trash2,
  RefreshCw
} from 'lucide-react';

interface EmailSettings {
  smtp_server: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  email_sender: string;
  email_receiver: string;
  enable_notifications: boolean;
  weekly_schedule: boolean;
  monthly_schedule: boolean;
}

interface Company {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
}

interface DocumentType {
  id: string;
  name: string;
  name_ar: string;
}

interface Ministry {
  id: string;
  name: string;
  name_ar: string;
}

interface Position {
  id: string;
  name: string;
  name_ar: string;
  value: string;
}

export default function Settings() {
  const { t, language, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState('email');
  const [darkMode, setDarkMode] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [newCompany, setNewCompany] = useState({ name: '', name_ar: '', description: '' });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingDocType, setEditingDocType] = useState<DocumentType | null>(null);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [newDocType, setNewDocType] = useState({ name: '', name_ar: '' });
  const [newMinistry, setNewMinistry] = useState({ name: '', name_ar: '' });
  const [newPosition, setNewPosition] = useState({ name: '', name_ar: '', value: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>({
    smtp_server: import.meta.env.VITE_SMTP_SERVER || 'smtp.gmail.com',
    smtp_port: parseInt(import.meta.env.VITE_SMTP_PORT) || 587,
    smtp_username: import.meta.env.VITE_SMTP_USERNAME || 'dr.vet.waleedtam@gmail.com',
    smtp_password: import.meta.env.VITE_SMTP_PASSWORD || 'bfbc oqpk qbrb svhc',
    email_sender: import.meta.env.VITE_EMAIL_SENDER || 'dr.vet.waleedtam@gmail.com',
    email_receiver: import.meta.env.VITE_EMAIL_RECEIVER || 'lolotam@gmail.com',
    enable_notifications: true,
    weekly_schedule: true,
    monthly_schedule: true
  });

  // Enhanced email notification state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [expiryData, setExpiryData] = useState<ExpiryData>({ employees: [], documents: [] });
  const [isCheckingExpiry, setIsCheckingExpiry] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [lastEmailSent, setLastEmailSent] = useState<string | null>(null);
  const [deletedReminders, setDeletedReminders] = useState<{ id: string, type: 'employee' | 'document' }[]>([]);
  const [isEraseDialogOpen, setIsEraseDialogOpen] = useState(false);
  const [eraseConfirmText, setEraseConfirmText] = useState('');

  const { toast } = useToast();


  fetchData();
  // Check for dark mode preference
  const isDark = localStorage.getItem('darkMode') === 'true';
  setDarkMode(isDark);
  if (isDark) {
    document.documentElement.classList.add('dark');
  }

  // Load deleted reminders
  const savedDeletedReminders = localStorage.getItem('romani_deleted_reminders');
  if (savedDeletedReminders) {
    try {
      setDeletedReminders(JSON.parse(savedDeletedReminders));
    } catch (e) {
      console.error('Failed to parse deleted reminders', e);
    }
  }
}, []);

const fetchData = async () => {
  try {
    const [companiesResult, docTypesResult, ministriesResult, positionsResult, employeesResult, documentsResult] = await Promise.all([
      jsonDatabase.from('companies').select('*').order('name', 'asc').execute(),
      jsonDatabase.from('document_types').select('*').order('name_ar', 'asc').execute(),
      jsonDatabase.from('ministries').select('*').order('name_ar', 'asc').execute(),
      jsonDatabase.from('positions').select('*').order('name_ar', 'asc').execute(),
      jsonDatabase.from('employees').select('*').execute(),
      jsonDatabase.from('documents').select('*').execute()
    ]);

    setCompanies(companiesResult.data || []);
    setDocumentTypes(docTypesResult.data || []);
    setMinistries(ministriesResult.data || []);
    setPositions(positionsResult.data || []);
    setEmployees(employeesResult.data || []);
    setDocuments(documentsResult.data || []);

    // Load last email sent timestamp
    const lastSent = localStorage.getItem('lastEmailSent');
    setLastEmailSent(lastSent);

    // Check for expiring items
    checkExpiringItems(employeesResult.data || [], documentsResult.data || []);
  } catch (error) {
    console.error('Error fetching data:', error);
  } finally {
    setIsLoading(false);
  }
};

const toggleDarkMode = () => {
  const newDarkMode = !darkMode;
  setDarkMode(newDarkMode);
  localStorage.setItem('darkMode', newDarkMode.toString());

  if (newDarkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  toast({
    title: t('settings.settingsToasts.themeChanged'),
    description: t('settings.settingsToasts.themeChangedDesc', {
      status: newDarkMode ? t('settings.settingsToasts.enabled') : t('settings.settingsToasts.disabled')
    })
  });
};

const addCompany = async () => {
  if (!newCompany.name.trim() || !newCompany.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.insert('companies', [{
      name: newCompany.name,
      name_ar: newCompany.name_ar,
      description: newCompany.description
    }]);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.companyAdded')
    });

    setNewCompany({ name: '', name_ar: '', description: '' });
    fetchData();
  } catch (error) {
    console.error('Error adding company:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.companyAddError'),
      variant: 'destructive'
    });
  }
};

const updateCompany = async () => {
  if (!editingCompany || !editingCompany.name.trim() || !editingCompany.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.update('companies', editingCompany.id, {
      name: editingCompany.name,
      name_ar: editingCompany.name_ar,
      description: editingCompany.description
    });

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.companyUpdated')
    });

    setEditingCompany(null);
    fetchData();
  } catch (error) {
    console.error('Error updating company:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.companyUpdateError'),
      variant: 'destructive'
    });
  }
};

const deleteCompany = async (company: Company) => {
  if (!confirm(t('settings.settingsToasts.companyDeleteConfirm', { name: company.name_ar }))) return;

  try {
    const { error } = await jsonDatabase.delete('companies', company.id);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.companyDeleted')
    });

    fetchData();
  } catch (error) {
    console.error('Error deleting company:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.companyDeleteError'),
      variant: 'destructive'
    });
  }
};

const addDocumentType = async () => {
  if (!newDocType.name.trim() || !newDocType.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.insert('document_types', [newDocType]);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.documentTypeAdded')
    });

    setNewDocType({ name: '', name_ar: '' });
    fetchData();
  } catch (error) {
    console.error('Error adding document type:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.documentTypeAddError'),
      variant: 'destructive'
    });
  }
};

const addMinistry = async () => {
  if (!newMinistry.name.trim() || !newMinistry.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.insert('ministries', [newMinistry]);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.ministryAdded')
    });

    setNewMinistry({ name: '', name_ar: '' });
    fetchData();
  } catch (error) {
    console.error('Error adding ministry:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.ministryAddError'),
      variant: 'destructive'
    });
  }
};

const updateDocumentType = async () => {
  if (!editingDocType || !editingDocType.name.trim() || !editingDocType.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.update('document_types', editingDocType.id, {
      name: editingDocType.name,
      name_ar: editingDocType.name_ar
    });

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.documentTypeUpdated')
    });

    setEditingDocType(null);
    fetchData();
  } catch (error) {
    console.error('Error updating document type:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.documentTypeUpdateError'),
      variant: 'destructive'
    });
  }
};

const deleteDocumentType = async (docType: DocumentType) => {
  if (!confirm(t('settings.settingsToasts.documentTypeDeleteConfirm', { name: docType.name_ar }))) return;

  try {
    const { error } = await jsonDatabase.delete('document_types', docType.id);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.documentTypeDeleted')
    });

    fetchData();
  } catch (error) {
    console.error('Error deleting document type:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.documentTypeDeleteError'),
      variant: 'destructive'
    });
  }
};

const updateMinistry = async () => {
  if (!editingMinistry || !editingMinistry.name.trim() || !editingMinistry.name_ar.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.update('ministries', editingMinistry.id, {
      name: editingMinistry.name,
      name_ar: editingMinistry.name_ar
    });

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.ministryUpdated')
    });

    setEditingMinistry(null);
    fetchData();
  } catch (error) {
    console.error('Error updating ministry:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.ministryUpdateError'),
      variant: 'destructive'
    });
  }
};

const deleteMinistry = async (ministry: Ministry) => {
  if (!confirm(t('settings.settingsToasts.ministryDeleteConfirm', { name: ministry.name_ar }))) return;

  try {
    const { error } = await jsonDatabase.delete('ministries', ministry.id);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.ministryDeleted')
    });

    fetchData();
  } catch (error) {
    console.error('Error deleting ministry:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.ministryDeleteError'),
      variant: 'destructive'
    });
  }
};

const addPosition = async () => {
  if (!newPosition.name.trim() || !newPosition.name_ar.trim() || !newPosition.value.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.insert('positions', [newPosition]);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.positionAdded')
    });

    setNewPosition({ name: '', name_ar: '', value: '' });
    fetchData();
  } catch (error) {
    console.error('Error adding position:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.positionAddError'),
      variant: 'destructive'
    });
  }
};

const updatePosition = async () => {
  if (!editingPosition || !editingPosition.name.trim() || !editingPosition.name_ar.trim() || !editingPosition.value.trim()) {
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.requiredFields'),
      variant: 'destructive'
    });
    return;
  }

  try {
    const { error } = await jsonDatabase.update('positions', editingPosition.id, {
      name: editingPosition.name,
      name_ar: editingPosition.name_ar,
      value: editingPosition.value
    });

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.positionUpdated')
    });

    setEditingPosition(null);
    fetchData();
  } catch (error) {
    console.error('Error updating position:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.positionUpdateError'),
      variant: 'destructive'
    });
  }
};

const deletePosition = async (position: Position) => {
  if (!confirm(t('settings.settingsToasts.positionDeleteConfirm', { name: position.name_ar }))) return;

  try {
    const { error } = await jsonDatabase.delete('positions', position.id);

    if (error) throw error;

    toast({
      title: t('settings.settingsToasts.success'),
      description: t('settings.settingsToasts.positionDeleted')
    });

    fetchData();
  } catch (error) {
    console.error('Error deleting position:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.positionDeleteError'),
      variant: 'destructive'
    });
  }
};


const exportBackup = async () => {
  try {
    const [documentsResult, employeesResult, companiesResult, docTypesResult, ministriesResult] = await Promise.all([
      jsonDatabase.from('documents').select('*').execute(),
      jsonDatabase.from('employees').select('*').execute(),
      jsonDatabase.from('companies').select('*').execute(),
      jsonDatabase.from('document_types').select('*').execute(),
      jsonDatabase.from('ministries').select('*').execute()
    ]);

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: {
        documents: documentsResult.data || [],
        employees: employeesResult.data || [],
        companies: companiesResult.data || [],
        document_types: docTypesResult.data || [],
        ministries: ministriesResult.data || []
      }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `romani-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: t('settings.settingsToasts.backupExported'),
      description: t('settings.settingsToasts.backupExportedDesc')
    });
  } catch (error) {
    console.error('Error exporting backup:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.backupExportError'),
      variant: 'destructive'
    });
  }
};

const saveEmailSettings = () => {
  // Save email settings to localStorage (in production, save to database)
  localStorage.setItem('emailSettings', JSON.stringify(emailSettings));
  toast({
    title: t('settings.settingsToasts.success'),
    description: t('settings.settingsToasts.emailSettingsSaved')
  });
};

const checkExpiringItems = (employeeData: Employee[], documentData: Document[]) => {
  const expiringEmployees = getExpiringEmployees(employeeData);
  const expiringDocuments = getExpiringDocuments(documentData, employeeData);

  // Get current deleted reminders to filter out
  const savedDeleted = localStorage.getItem('romani_deleted_reminders');
  let currentDeleted: { id: string, type: 'employee' | 'document' }[] = [];
  if (savedDeleted) {
    try {
      currentDeleted = JSON.parse(savedDeleted);
    } catch (e) { }
  }

  setExpiryData({
    employees: expiringEmployees.filter(emp => !currentDeleted.some(d => d.id === emp.id && d.type === 'employee')),
    documents: expiringDocuments.filter(doc => !currentDeleted.some(d => d.id === doc.id && d.type === 'document'))
  });
};

const deleteReminderItem = (id: string, type: 'employee' | 'document') => {
  const newDeleted = [...deletedReminders, { id, type }];
  setDeletedReminders(newDeleted);
  localStorage.setItem('romani_deleted_reminders', JSON.stringify(newDeleted));

  // Update current view
  setExpiryData(prev => ({
    employees: type === 'employee' ? prev.employees.filter(e => e.id !== id) : prev.employees,
    documents: type === 'document' ? prev.documents.filter(d => d.id !== id) : prev.documents
  }));
};

const handleEraseAllData = async () => {
  if (eraseConfirmText !== 'DELETE ALL') {
    return;
  }

  try {
    // Clear localStorage items
    localStorage.removeItem('romani_json_database');
    localStorage.removeItem('romani_deleted_reminders');
    // Keep dark mode and language settings if desired, or wipe everything

    toast({
      title: t('settings.settingsToasts.success') || t('settings.backup.eraseSuccess'),
      description: t('settings.backup.eraseSuccess')
    });

    setIsEraseDialogOpen(false);

    // Reload page to reflect empty state completely
    setTimeout(() => {
      window.location.reload();
    }, 1000);

  } catch (error) {
    console.error('Error erasing data:', error);
    toast({
      title: t('settings.settingsToasts.error') || t('settings.backup.eraseError'),
      description: t('settings.backup.eraseError'),
      variant: 'destructive'
    });
  }
};

// Manual expiry check
const handleCheckExpiry = async () => {
  setIsCheckingExpiry(true);
  try {
    await fetchData(); // Refresh data and check expiry
    toast({
      title: t('settings.settingsToasts.checkCompleted'),
      description: t('settings.settingsToasts.checkCompletedDesc', {
        employees: expiryData.employees.length,
        documents: expiryData.documents.length
      })
    });
  } catch (error) {
    console.error('Error checking expiry:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.checkError'),
      variant: 'destructive'
    });
  } finally {
    setIsCheckingExpiry(false);
  }
};

// Send test email with current expiry data
const handleSendTestEmail = async () => {
  setIsSendingEmail(true);
  try {
    const notificationSettings: EmailNotificationSettings = {
      enabled: emailSettings.enable_notifications,
      monthlyReminder: emailSettings.monthly_schedule,
      weeklyReminder: emailSettings.weekly_schedule,
      expiredNotification: true,
      emailRecipient: emailSettings.email_receiver
    };

    const result = await sendExpiryNotification(expiryData, notificationSettings);

    if (result.success) {
      const currentTime = new Date().toLocaleString('ar-EG');
      localStorage.setItem('lastEmailSent', currentTime);
      setLastEmailSent(currentTime);

      toast({
        title: t('settings.settingsToasts.emailSent'),
        description: result.message
      });
    } else {
      toast({
        title: t('settings.settingsToasts.emailSendError'),
        description: result.message,
        variant: 'destructive'
      });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    toast({
      title: t('settings.settingsToasts.error'),
      description: t('settings.settingsToasts.emailError', { error }),
      variant: 'destructive'
    });
  } finally {
    setIsSendingEmail(false);
  }
};

// Test email functionality by sending a test notification
const testEmail = async () => {
  await handleSendTestEmail();
};

// Automatic check and send notifications
const handleAutoNotifications = async () => {
  const notificationSettings: EmailNotificationSettings = {
    enabled: emailSettings.enable_notifications,
    monthlyReminder: emailSettings.monthly_schedule,
    weeklyReminder: emailSettings.weekly_schedule,
    expiredNotification: true,
    emailRecipient: emailSettings.email_receiver
  };

  await checkAndSendNotifications(employees, documents, notificationSettings);
};

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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-gradient">{t('settings.title')}</h1>
          <p className="text-muted-foreground">
            {t('settings.subtitle')}
          </p>
        </div>
      </motion.div>

      {/* Settings Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-7">
            <TabsTrigger value="email" className="flex items-center space-x-2">
              <Mail className="h-4 w-4" />
              <span>{t('settings.tabs.email')}</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex items-center space-x-2">
              <Moon className="h-4 w-4" />
              <span>{t('settings.tabs.appearance')}</span>
            </TabsTrigger>
            <TabsTrigger value="companies" className="flex items-center space-x-2">
              <Building2 className="h-4 w-4" />
              <span>{t('settings.tabs.companies')}</span>
            </TabsTrigger>
            <TabsTrigger value="positions" className="flex items-center space-x-2">
              <UserCog className="h-4 w-4" />
              <span>{t('settings.tabs.positions')}</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>{t('settings.tabs.documents')}</span>
            </TabsTrigger>
            <TabsTrigger value="ministries" className="flex items-center space-x-2">
              <Shield className="h-4 w-4" />
              <span>{t('settings.tabs.ministries')}</span>
            </TabsTrigger>
            <TabsTrigger value="backup" className="flex items-center space-x-2">
              <Database className="h-4 w-4" />
              <span>{t('settings.tabs.backup')}</span>
            </TabsTrigger>
          </TabsList>

          {/* Email Settings */}
          <TabsContent value="email" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Mail className="h-5 w-5" />
                  <span>{t('settings.email.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.email.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="smtp_server">{t('settings.email.smtpServer')}</Label>
                    <Input
                      id="smtp_server"
                      value={emailSettings.smtp_server}
                      onChange={(e) => setEmailSettings({ ...emailSettings, smtp_server: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="smtp_port">{t('settings.email.smtpPort')}</Label>
                    <Input
                      id="smtp_port"
                      type="number"
                      value={emailSettings.smtp_port}
                      onChange={(e) => setEmailSettings({ ...emailSettings, smtp_port: parseInt(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="smtp_username">{t('settings.email.smtpUsername')}</Label>
                    <Input
                      id="smtp_username"
                      value={emailSettings.smtp_username}
                      onChange={(e) => setEmailSettings({ ...emailSettings, smtp_username: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="smtp_password">{t('settings.email.smtpPassword')}</Label>
                    <Input
                      id="smtp_password"
                      type="password"
                      value={emailSettings.smtp_password}
                      onChange={(e) => setEmailSettings({ ...emailSettings, smtp_password: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email_sender">{t('settings.email.emailSender')}</Label>
                    <Input
                      id="email_sender"
                      type="email"
                      value={emailSettings.email_sender}
                      onChange={(e) => setEmailSettings({ ...emailSettings, email_sender: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="email_receiver">{t('settings.email.emailReceiver')}</Label>
                    <Input
                      id="email_receiver"
                      type="email"
                      value={emailSettings.email_receiver}
                      onChange={(e) => setEmailSettings({ ...emailSettings, email_receiver: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enable_notifications">{t('settings.email.enableNotifications')}</Label>
                    <Switch
                      id="enable_notifications"
                      checked={emailSettings.enable_notifications}
                      onCheckedChange={(checked) => setEmailSettings({ ...emailSettings, enable_notifications: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="weekly_schedule">{t('settings.email.weeklySchedule')}</Label>
                    <Switch
                      id="weekly_schedule"
                      checked={emailSettings.weekly_schedule}
                      onCheckedChange={(checked) => setEmailSettings({ ...emailSettings, weekly_schedule: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="monthly_schedule">{t('settings.email.monthlySchedule')}</Label>
                    <Switch
                      id="monthly_schedule"
                      checked={emailSettings.monthly_schedule}
                      onCheckedChange={(checked) => setEmailSettings({ ...emailSettings, monthly_schedule: checked })}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={saveEmailSettings} className="flex-1">
                    {t('settings.email.saveEmailSettings')}
                  </Button>
                  <Button onClick={testEmail} variant="outline" className="flex-1">
                    {t('settings.email.testEmailButton')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Expiry Monitoring & Email Scheduler */}
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5" />
                  <span>{t('settings.email.monitoringTitle')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.email.monitoringDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Current Status */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <span className="font-medium">{t('settings.email.totalEmployees')}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-2xl font-bold text-blue-600">{employees.length}</span>
                      <p className="text-sm text-muted-foreground">{t('settings.email.registeredEmployee')}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                      <span className="font-medium">{t('settings.email.expiringResidencies')}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-2xl font-bold text-orange-600">{expiryData.employees.length}</span>
                      <p className="text-sm text-muted-foreground">{t('settings.email.withinMonth')}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <span className="font-medium">{t('settings.email.expiringDocuments')}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-2xl font-bold text-red-600">{expiryData.documents.length}</span>
                      <p className="text-sm text-muted-foreground">{t('settings.email.withinMonth')}</p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button
                    onClick={handleCheckExpiry}
                    disabled={isCheckingExpiry}
                    variant="outline"
                    className="flex items-center space-x-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isCheckingExpiry ? 'animate-spin' : ''}`} />
                    <span>{isCheckingExpiry ? t('settings.email.checkingExpiry') : t('settings.email.checkExpiry')}</span>
                  </Button>

                  <Button
                    onClick={handleSendTestEmail}
                    disabled={isSendingEmail || !emailSettings.enable_notifications}
                    variant="default"
                    className="flex items-center space-x-2"
                  >
                    <Mail className="h-4 w-4" />
                    <span>{isSendingEmail ? t('settings.email.sendingReport') : t('settings.email.sendImmediateReport')}</span>
                  </Button>

                  <Button
                    onClick={handleAutoNotifications}
                    disabled={!emailSettings.enable_notifications}
                    variant="secondary"
                    className="flex items-center space-x-2"
                  >
                    <Clock className="h-4 w-4" />
                    <span>{t('settings.email.enableAutoAlerts')}</span>
                  </Button>
                </div>

                {/* Last Email Sent */}
                {lastEmailSent && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-sm font-medium text-green-700 dark:text-green-400">
                        {t('settings.email.lastEmailSent')} {lastEmailSent}
                      </span>
                    </div>
                  </div>
                )}

                {/* Expiry Details Tables */}
                {(expiryData.employees.length > 0 || expiryData.documents.length > 0) && (
                  <div className="space-y-6 pt-4 border-t">
                    <h3 className="text-lg font-semibold">{t('settings.email.expiryDetails')}</h3>

                    {/* Expiring Employees */}
                    {expiryData.employees.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="font-medium text-orange-600">{t('settings.email.expiringResidenciesList')} ({expiryData.employees.length})</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-start p-2 font-medium">{t('settings.email.employeeName')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.residencyExpiryDate')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.timeRemaining')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.status')}</th>
                                <th className="text-end p-2 font-medium">{t('settings.email.actions')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expiryData.employees.slice(0, 5).map((emp, index) => (
                                <tr key={emp.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
                                  <td className="p-2 font-medium">{emp.name}</td>
                                  <td className="p-2">
                                    {emp.residency_expiry_date ? new Date(emp.residency_expiry_date).toLocaleDateString('ar-EG') : '-'}
                                  </td>
                                  <td className="p-2">
                                    {Math.abs(emp.daysUntilExpiry)} {emp.daysUntilExpiry < 0 ? t('settings.email.dayExpired') : t('settings.email.day')}
                                  </td>
                                  <td className="p-2">
                                    <span className={`px-2 py-1 rounded-full text-xs ${emp.daysUntilExpiry < 0
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                      : emp.daysUntilExpiry <= 7
                                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                      }`}>
                                      {emp.daysUntilExpiry < 0 ? t('settings.email.expired') : emp.daysUntilExpiry <= 7 ? t('settings.email.danger') : t('settings.email.warning')}
                                    </span>
                                  </td>
                                  <td className="p-2 text-end">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => deleteReminderItem(emp.id, 'employee')}
                                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {expiryData.employees.length > 5 && (
                            <p className="text-xs text-muted-foreground mt-2">
                              {t('settings.email.moreItemsInReport', { count: expiryData.employees.length - 5 })}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Expiring Documents */}
                    {expiryData.documents.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="font-medium text-red-600">{t('settings.email.expiringDocumentsList')} ({expiryData.documents.length})</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-start p-2 font-medium">{t('settings.email.documentName')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.employee')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.expiryDate')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.timeRemaining')}</th>
                                <th className="text-start p-2 font-medium">{t('settings.email.status')}</th>
                                <th className="text-end p-2 font-medium">{t('settings.email.actions')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expiryData.documents.slice(0, 5).map((doc, index) => (
                                <tr key={doc.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
                                  <td className="p-2 font-medium">{doc.title}</td>
                                  <td className="p-2">{doc.employee?.name || '-'}</td>
                                  <td className="p-2">
                                    {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('ar-EG') : '-'}
                                  </td>
                                  <td className="p-2">
                                    {Math.abs(doc.daysUntilExpiry)} {doc.daysUntilExpiry < 0 ? t('settings.email.dayExpired') : t('settings.email.day')}
                                  </td>
                                  <td className="p-2">
                                    <span className={`px-2 py-1 rounded-full text-xs ${doc.daysUntilExpiry < 0
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                      : doc.daysUntilExpiry <= 7
                                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                      }`}>
                                      {doc.daysUntilExpiry < 0 ? t('settings.email.expired') : doc.daysUntilExpiry <= 7 ? t('settings.email.danger') : t('settings.email.warning')}
                                    </span>
                                  </td>
                                  <td className="p-2 text-end">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => deleteReminderItem(doc.id, 'document')}
                                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {expiryData.documents.length > 5 && (
                            <p className="text-xs text-muted-foreground mt-2">
                              {t('settings.email.moreDocumentsInReport', { count: expiryData.documents.length - 5 })}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Email Configuration Note */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">{t('settings.email.emailConfigNote')}</h4>
                  <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <li>{t('settings.email.emailConfigNotes.verifySmtp')}</li>
                    <li>{t('settings.email.emailConfigNotes.autoAlertsWhen')}</li>
                    <li className="mr-4">{t('settings.email.emailConfigNotes.monthBeforeExpiry')}</li>
                    <li className="mr-4">{t('settings.email.emailConfigNotes.weekBeforeExpiry')}</li>
                    <li className="mr-4">{t('settings.email.emailConfigNotes.actualExpiry')}</li>
                    <li>{t('settings.email.emailConfigNotes.immediateReport')}</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Settings */}
          <TabsContent value="appearance" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  {darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                  <span>{t('settings.appearance.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.appearance.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="dark-mode">{t('settings.appearance.darkMode')}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.appearance.darkModeDescription')}
                    </p>
                  </div>
                  <Switch
                    id="dark-mode"
                    checked={darkMode}
                    onCheckedChange={toggleDarkMode}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Companies Management */}
          <TabsContent value="companies" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Building2 className="h-5 w-5" />
                  <span>{t('settings.companies.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.companies.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="company_name_ar">{t('settings.companies.nameArabic')}</Label>
                    <Input
                      id="company_name_ar"
                      value={newCompany.name_ar}
                      onChange={(e) => setNewCompany({ ...newCompany, name_ar: e.target.value })}
                      placeholder={t('settings.companies.nameArabicPlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="company_name_en">{t('settings.companies.nameEnglish')}</Label>
                    <Input
                      id="company_name_en"
                      value={newCompany.name}
                      onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                      placeholder={t('settings.companies.nameEnglishPlaceholder')}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addCompany} className="w-full">
                      {t('settings.companies.addNew')}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="company_description">{t('settings.companies.description')}</Label>
                  <Textarea
                    id="company_description"
                    value={newCompany.description}
                    onChange={(e) => setNewCompany({ ...newCompany, description: e.target.value })}
                    placeholder={t('settings.companies.descriptionPlaceholder')}
                  />
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-3">{t('settings.companies.currentCompaniesCount', { count: companies.length })}</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {companies.map((company) => (
                      <div key={company.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{company.name_ar}</p>
                          <p className="text-sm text-muted-foreground">{company.name}</p>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCompany(company)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteCompany(company)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Positions Management */}
          <TabsContent value="positions" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <UserCog className="h-5 w-5" />
                  <span>{t('settings.positions.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.positions.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="position_name_ar">{t('settings.positions.nameArabic')}</Label>
                    <Input
                      id="position_name_ar"
                      value={newPosition.name_ar}
                      onChange={(e) => setNewPosition({ ...newPosition, name_ar: e.target.value })}
                      placeholder={t('settings.positions.nameArabicPlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="position_name_en">{t('settings.positions.nameEnglish')}</Label>
                    <Input
                      id="position_name_en"
                      value={newPosition.name}
                      onChange={(e) => setNewPosition({ ...newPosition, name: e.target.value })}
                      placeholder={t('settings.positions.nameEnglishPlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="position_value">{t('settings.positions.value')}</Label>
                    <Input
                      id="position_value"
                      value={newPosition.value}
                      onChange={(e) => setNewPosition({ ...newPosition, value: e.target.value })}
                      placeholder={t('settings.positions.valuePlaceholder')}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addPosition} className="w-full">
                      {t('settings.positions.addNew')}
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-3">{t('settings.positions.currentPositionsCount', { count: positions.length })}</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {positions.map((position) => (
                      <div key={position.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{position.name_ar}</p>
                          <p className="text-sm text-muted-foreground">{position.name} ({position.value})</p>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingPosition(position)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deletePosition(position)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Document Types Management */}
          <TabsContent value="documents" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>{t('settings.documentTypes.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.documentTypes.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="doc_name_en">{t('settings.documentTypes.nameEnglish')}</Label>
                    <Input
                      id="doc_name_en"
                      value={newDocType.name}
                      onChange={(e) => setNewDocType({ ...newDocType, name: e.target.value })}
                      placeholder={t('settings.documentTypes.nameEnglishPlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="doc_name_ar">{t('settings.documentTypes.nameArabic')}</Label>
                    <Input
                      id="doc_name_ar"
                      value={newDocType.name_ar}
                      onChange={(e) => setNewDocType({ ...newDocType, name_ar: e.target.value })}
                      placeholder={t('settings.documentTypes.nameArabicPlaceholder')}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addDocumentType} className="w-full">
                      {t('settings.documentTypes.addNew')}
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-3">{t('settings.documentTypes.currentTypesCount', { count: documentTypes.length })}</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {documentTypes.map((docType) => (
                      <div key={docType.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{docType.name_ar}</p>
                          <p className="text-sm text-muted-foreground">{docType.name}</p>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingDocType(docType)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteDocumentType(docType)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ministries Management */}
          <TabsContent value="ministries" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="h-5 w-5" />
                  <span>{t('settings.ministries.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.ministries.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="ministry_name_en">{t('settings.ministries.nameEnglish')}</Label>
                    <Input
                      id="ministry_name_en"
                      value={newMinistry.name}
                      onChange={(e) => setNewMinistry({ ...newMinistry, name: e.target.value })}
                      placeholder={t('settings.ministries.nameEnglishPlaceholder')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ministry_name_ar">{t('settings.ministries.nameArabic')}</Label>
                    <Input
                      id="ministry_name_ar"
                      value={newMinistry.name_ar}
                      onChange={(e) => setNewMinistry({ ...newMinistry, name_ar: e.target.value })}
                      placeholder={t('settings.ministries.nameArabicPlaceholder')}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addMinistry} className="w-full">
                      {t('settings.ministries.addNew')}
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-3">{t('settings.ministries.currentMinistriesCount', { count: ministries.length })}</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {ministries.map((ministry) => (
                      <div key={ministry.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{ministry.name_ar}</p>
                          <p className="text-sm text-muted-foreground">{ministry.name}</p>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingMinistry(ministry)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteMinistry(ministry)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Backup & Restore */}
          <TabsContent value="backup" className="space-y-6">
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="h-5 w-5" />
                  <span>{t('settings.backup.title')}</span>
                </CardTitle>
                <CardDescription>
                  {t('settings.backup.description')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('settings.backup.backupSection')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.backup.backupDescription')}
                    </p>
                    <Button onClick={exportBackup} className="w-full">
                      <Download className="h-4 w-4 ml-2" />
                      {t('settings.backup.exportBackup')}
                    </Button>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('settings.backup.restoreSection')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.backup.restoreDescription')}
                    </p>
                    <div className="space-y-2">
                      <Input type="file" accept=".json" />
                      <Button className="w-full" variant="outline">
                        <Upload className="h-4 w-4 ml-2" />
                        {t('settings.backup.importBackup')}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="text-lg font-semibold mb-3">{t('settings.backup.automaticBackups')}</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{t('settings.backup.dailyBackups')}</p>
                        <p className="text-sm text-muted-foreground">{t('settings.backup.dailyBackupsDesc')}</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{t('settings.backup.backupNotifications')}</p>
                        <p className="text-sm text-muted-foreground">{t('settings.backup.backupNotificationsDesc')}</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="pt-4 border-t border-red-200 dark:border-red-900/50 mt-6">
                  <h3 className="text-lg font-semibold mb-3 text-red-600">{t('settings.backup.eraseData')}</h3>
                  <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-400">{t('settings.backup.eraseDataDescription')}</p>
                    </div>

                    <Dialog open={isEraseDialogOpen} onOpenChange={setIsEraseDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="destructive" className="shrink-0">
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('settings.backup.eraseButton')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle className="text-red-600">{t('settings.backup.eraseConfirmTitle')}</DialogTitle>
                          <DialogDescription>
                            {t('settings.backup.eraseConfirmDescription')}
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                          <Input
                            value={eraseConfirmText}
                            onChange={(e) => setEraseConfirmText(e.target.value)}
                            placeholder={t('settings.backup.eraseConfirmPlaceholder')}
                            className="border-red-200 focus-visible:ring-red-500"
                          />

                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => {
                              setIsEraseDialogOpen(false);
                              setEraseConfirmText('');
                            }}>
                              {t('settings.backup.eraseCancel')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleEraseAllData}
                              disabled={eraseConfirmText !== 'DELETE ALL'}
                            >
                              {t('settings.backup.eraseConfirmButton')}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* Edit Company Dialog */}
      <Dialog open={!!editingCompany} onOpenChange={() => setEditingCompany(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.companies.title')}</DialogTitle>
            <DialogDescription>{t('settings.companies.description')}</DialogDescription>
          </DialogHeader>
          {editingCompany && (
            <div className="space-y-4">
              <div>
                <Label>الاسم بالعربية</Label>
                <Input
                  value={editingCompany.name_ar}
                  onChange={(e) => setEditingCompany({ ...editingCompany, name_ar: e.target.value })}
                />
              </div>
              <div>
                <Label>الاسم بالإنجليزية</Label>
                <Input
                  value={editingCompany.name}
                  onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('settings.companies.description')}</Label>
                <Textarea
                  value={editingCompany.description || ''}
                  onChange={(e) => setEditingCompany({ ...editingCompany, description: e.target.value })}
                />
              </div>
              <Button onClick={updateCompany} className="w-full">
                {t('settings.actions.saveChanges')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Document Type Dialog */}
      <Dialog open={!!editingDocType} onOpenChange={() => setEditingDocType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.documentTypes.editTitle')}</DialogTitle>
            <DialogDescription>{t('settings.documentTypes.editDescription')}</DialogDescription>
          </DialogHeader>
          {editingDocType && (
            <div className="space-y-4">
              <div>
                <Label>{t('settings.documentTypes.nameArabic')}</Label>
                <Input
                  value={editingDocType.name_ar}
                  onChange={(e) => setEditingDocType({ ...editingDocType, name_ar: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('settings.documentTypes.nameEnglish')}</Label>
                <Input
                  value={editingDocType.name}
                  onChange={(e) => setEditingDocType({ ...editingDocType, name: e.target.value })}
                />
              </div>
              <Button onClick={updateDocumentType} className="w-full">
                {t('settings.actions.saveChanges')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Ministry Dialog */}
      <Dialog open={!!editingMinistry} onOpenChange={() => setEditingMinistry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.ministries.editTitle')}</DialogTitle>
            <DialogDescription>{t('settings.ministries.editDescription')}</DialogDescription>
          </DialogHeader>
          {editingMinistry && (
            <div className="space-y-4">
              <div>
                <Label>{t('settings.ministries.nameArabic')}</Label>
                <Input
                  value={editingMinistry.name_ar}
                  onChange={(e) => setEditingMinistry({ ...editingMinistry, name_ar: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('settings.ministries.nameEnglish')}</Label>
                <Input
                  value={editingMinistry.name}
                  onChange={(e) => setEditingMinistry({ ...editingMinistry, name: e.target.value })}
                />
              </div>
              <Button onClick={updateMinistry} className="w-full">
                {t('settings.actions.saveChanges')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Position Dialog */}
      <Dialog open={!!editingPosition} onOpenChange={() => setEditingPosition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.positions.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.positions.editDescription')}
            </DialogDescription>
          </DialogHeader>
          {editingPosition && (
            <div className="grid grid-cols-1 gap-4 py-4">
              <div>
                <Label htmlFor="edit-position-name-ar">{t('settings.positions.nameArabic')}</Label>
                <Input
                  id="edit-position-name-ar"
                  value={editingPosition.name_ar}
                  onChange={(e) => setEditingPosition({ ...editingPosition, name_ar: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-position-name-en">{t('settings.positions.nameEnglish')}</Label>
                <Input
                  id="edit-position-name-en"
                  value={editingPosition.name}
                  onChange={(e) => setEditingPosition({ ...editingPosition, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-position-value">{t('settings.positions.value')}</Label>
                <Input
                  id="edit-position-value"
                  value={editingPosition.value}
                  onChange={(e) => setEditingPosition({ ...editingPosition, value: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingPosition(null)}>
              {t('settings.actions.cancel')}
            </Button>
            <Button onClick={updatePosition}>
              {t('settings.actions.saveChanges')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  </Layout>
);
}