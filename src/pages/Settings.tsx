import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Mail, Moon, Building2, FileText, UserCog, Shield, Database } from 'lucide-react';

import type { EmailSettingsData, Company, DocumentType, Ministry, Position } from '@/components/settings/types';
import EmailSettingsComponent from '@/components/settings/EmailSettings';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import CompaniesSettings from '@/components/settings/CompaniesSettings';
import PositionsSettings from '@/components/settings/PositionsSettings';
import DocumentTypesSettings from '@/components/settings/DocumentTypesSettings';
import MinistriesSettings from '@/components/settings/MinistriesSettings';
import BackupSettings from '@/components/settings/BackupSettings';

export default function Settings() {
  const { t, language, isRTL } = useLanguage();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('email');
  const [darkMode, setDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Data state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);

  // Form state
  const [newCompany, setNewCompany] = useState({ name: '', name_ar: '', description: '' });
  const [newDocType, setNewDocType] = useState({ name: '', name_ar: '' });
  const [newMinistry, setNewMinistry] = useState({ name: '', name_ar: '' });
  const [newPosition, setNewPosition] = useState({ name: '', name_ar: '', value: '' });

  // Edit state
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingDocType, setEditingDocType] = useState<DocumentType | null>(null);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);

  // Email state
  const [emailSettings, setEmailSettings] = useState<EmailSettingsData>({
    smtp_server: import.meta.env.VITE_SMTP_SERVER || 'smtp.gmail.com',
    smtp_port: parseInt(import.meta.env.VITE_SMTP_PORT) || 587,
    smtp_username: import.meta.env.VITE_SMTP_USERNAME || '',
    smtp_password: import.meta.env.VITE_SMTP_PASSWORD || '',
    email_sender: import.meta.env.VITE_EMAIL_SENDER || '',
    email_receiver: import.meta.env.VITE_EMAIL_RECEIVER || '',
    enable_notifications: true,
    weekly_schedule: true,
    monthly_schedule: true
  });
  const [expiryData, setExpiryData] = useState<ExpiryData>({ employees: [], documents: [] });
  const [isCheckingExpiry, setIsCheckingExpiry] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [lastEmailSent, setLastEmailSent] = useState<string | null>(null);
  const [deletedReminders, setDeletedReminders] = useState<{ id: string, type: 'employee' | 'document' }[]>([]);

  useEffect(() => {
    fetchData();
    const isDark = localStorage.getItem('darkMode') === 'true';
    setDarkMode(isDark);
    if (isDark) document.documentElement.classList.add('dark');

    const savedDeletedReminders = localStorage.getItem('romani_deleted_reminders');
    if (savedDeletedReminders) {
      try { setDeletedReminders(JSON.parse(savedDeletedReminders)); } catch (e) { /* ignore */ }
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

      const lastSent = localStorage.getItem('lastEmailSent');
      setLastEmailSent(lastSent);
      checkExpiringItems(employeesResult.data || [], documentsResult.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkExpiringItems = (employeeData: Employee[], documentData: Document[]) => {
    const expiringEmployees = getExpiringEmployees(employeeData);
    const expiringDocuments = getExpiringDocuments(documentData, employeeData);
    const savedDeleted = localStorage.getItem('romani_deleted_reminders');
    let currentDeleted: { id: string, type: 'employee' | 'document' }[] = [];
    if (savedDeleted) { try { currentDeleted = JSON.parse(savedDeleted); } catch (e) { /* ignore */ } }
    setExpiryData({
      employees: expiringEmployees.filter(emp => !currentDeleted.some(d => d.id === emp.id && d.type === 'employee')),
      documents: expiringDocuments.filter(doc => !currentDeleted.some(d => d.id === doc.id && d.type === 'document'))
    });
  };

  // Dark mode
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem('darkMode', newDarkMode.toString());
    if (newDarkMode) { document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
    toast({ title: t('settings.settingsToasts.themeChanged'), description: t('settings.settingsToasts.themeChangedDesc', { status: newDarkMode ? t('settings.settingsToasts.enabled') : t('settings.settingsToasts.disabled') }) });
  };

  // CRUD helpers
  const crudAction = async (action: () => Promise<void>, successKey: string, errorKey: string, resetFn?: () => void) => {
    try {
      await action();
      toast({ title: t('settings.settingsToasts.success'), description: t(`settings.settingsToasts.${successKey}`) });
      resetFn?.();
      fetchData();
    } catch (error) {
      console.error(error);
      toast({ title: t('settings.settingsToasts.error'), description: t(`settings.settingsToasts.${errorKey}`), variant: 'destructive' });
    }
  };

  const validateRequired = (...fields: string[]) => {
    if (fields.some(f => !f.trim())) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.settingsToasts.requiredFields'), variant: 'destructive' });
      return false;
    }
    return true;
  };

  // Companies
  const addCompany = () => {
    if (!validateRequired(newCompany.name, newCompany.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.insert('companies', [{ name: newCompany.name, name_ar: newCompany.name_ar, description: newCompany.description }]); if (error) throw error; }, 'companyAdded', 'companyAddError', () => setNewCompany({ name: '', name_ar: '', description: '' }));
  };
  const updateCompany = () => {
    if (!editingCompany || !validateRequired(editingCompany.name, editingCompany.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.update('companies', editingCompany.id, { name: editingCompany.name, name_ar: editingCompany.name_ar, description: editingCompany.description }); if (error) throw error; }, 'companyUpdated', 'companyUpdateError', () => setEditingCompany(null));
  };
  const deleteCompany = (company: Company) => {
    if (!confirm(t('settings.settingsToasts.companyDeleteConfirm', { name: company.name_ar }))) return;
    crudAction(async () => { const { error } = await jsonDatabase.delete('companies', company.id); if (error) throw error; }, 'companyDeleted', 'companyDeleteError');
  };

  // Document Types
  const addDocumentType = () => {
    if (!validateRequired(newDocType.name, newDocType.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.insert('document_types', [newDocType]); if (error) throw error; }, 'documentTypeAdded', 'documentTypeAddError', () => setNewDocType({ name: '', name_ar: '' }));
  };
  const updateDocumentType = () => {
    if (!editingDocType || !validateRequired(editingDocType.name, editingDocType.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.update('document_types', editingDocType.id, { name: editingDocType.name, name_ar: editingDocType.name_ar }); if (error) throw error; }, 'documentTypeUpdated', 'documentTypeUpdateError', () => setEditingDocType(null));
  };
  const deleteDocumentType = (docType: DocumentType) => {
    if (!confirm(t('settings.settingsToasts.documentTypeDeleteConfirm', { name: docType.name_ar }))) return;
    crudAction(async () => { const { error } = await jsonDatabase.delete('document_types', docType.id); if (error) throw error; }, 'documentTypeDeleted', 'documentTypeDeleteError');
  };

  // Ministries
  const addMinistry = () => {
    if (!validateRequired(newMinistry.name, newMinistry.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.insert('ministries', [newMinistry]); if (error) throw error; }, 'ministryAdded', 'ministryAddError', () => setNewMinistry({ name: '', name_ar: '' }));
  };
  const updateMinistry = () => {
    if (!editingMinistry || !validateRequired(editingMinistry.name, editingMinistry.name_ar)) return;
    crudAction(async () => { const { error } = await jsonDatabase.update('ministries', editingMinistry.id, { name: editingMinistry.name, name_ar: editingMinistry.name_ar }); if (error) throw error; }, 'ministryUpdated', 'ministryUpdateError', () => setEditingMinistry(null));
  };
  const deleteMinistry = (ministry: Ministry) => {
    if (!confirm(t('settings.settingsToasts.ministryDeleteConfirm', { name: ministry.name_ar }))) return;
    crudAction(async () => { const { error } = await jsonDatabase.delete('ministries', ministry.id); if (error) throw error; }, 'ministryDeleted', 'ministryDeleteError');
  };

  // Positions
  const addPosition = () => {
    if (!validateRequired(newPosition.name, newPosition.name_ar, newPosition.value)) return;
    crudAction(async () => { const { error } = await jsonDatabase.insert('positions', [newPosition]); if (error) throw error; }, 'positionAdded', 'positionAddError', () => setNewPosition({ name: '', name_ar: '', value: '' }));
  };
  const updatePosition = () => {
    if (!editingPosition || !validateRequired(editingPosition.name, editingPosition.name_ar, editingPosition.value)) return;
    crudAction(async () => { const { error } = await jsonDatabase.update('positions', editingPosition.id, { name: editingPosition.name, name_ar: editingPosition.name_ar, value: editingPosition.value }); if (error) throw error; }, 'positionUpdated', 'positionUpdateError', () => setEditingPosition(null));
  };
  const deletePosition = (position: Position) => {
    if (!confirm(t('settings.settingsToasts.positionDeleteConfirm', { name: position.name_ar }))) return;
    crudAction(async () => { const { error } = await jsonDatabase.delete('positions', position.id); if (error) throw error; }, 'positionDeleted', 'positionDeleteError');
  };

  // Backup
  const exportBackup = async () => {
    try {
      const [documentsResult, employeesResult, companiesResult, docTypesResult, ministriesResult] = await Promise.all([
        jsonDatabase.from('documents').select('*').execute(),
        jsonDatabase.from('employees').select('*').execute(),
        jsonDatabase.from('companies').select('*').execute(),
        jsonDatabase.from('document_types').select('*').execute(),
        jsonDatabase.from('ministries').select('*').execute()
      ]);
      const backup = { timestamp: new Date().toISOString(), version: '1.0', data: { documents: documentsResult.data || [], employees: employeesResult.data || [], companies: companiesResult.data || [], document_types: docTypesResult.data || [], ministries: ministriesResult.data || [] } };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `romani-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: t('settings.settingsToasts.backupExported'), description: t('settings.settingsToasts.backupExportedDesc') });
    } catch (error) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.settingsToasts.backupExportError'), variant: 'destructive' });
    }
  };

  const handleEraseAllData = (confirmText: string) => {
    if (confirmText !== 'DELETE ALL') return;
    localStorage.removeItem('romani_json_database');
    localStorage.removeItem('romani_deleted_reminders');
    toast({ title: t('settings.settingsToasts.success'), description: t('settings.backup.eraseSuccess') });
    setTimeout(() => window.location.reload(), 1000);
  };

  // Email
  const saveEmailSettings = () => {
    localStorage.setItem('emailSettings', JSON.stringify(emailSettings));
    toast({ title: t('settings.settingsToasts.success'), description: t('settings.settingsToasts.emailSettingsSaved') });
  };

  const handleCheckExpiry = async () => {
    setIsCheckingExpiry(true);
    try {
      await fetchData();
      toast({ title: t('settings.settingsToasts.checkCompleted'), description: t('settings.settingsToasts.checkCompletedDesc', { employees: expiryData.employees.length, documents: expiryData.documents.length }) });
    } catch (error) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.settingsToasts.checkError'), variant: 'destructive' });
    } finally { setIsCheckingExpiry(false); }
  };

  const handleSendTestEmail = async () => {
    setIsSendingEmail(true);
    try {
      const notificationSettings: EmailNotificationSettings = { enabled: emailSettings.enable_notifications, monthlyReminder: emailSettings.monthly_schedule, weeklyReminder: emailSettings.weekly_schedule, expiredNotification: true, emailRecipient: emailSettings.email_receiver };
      const result = await sendExpiryNotification(expiryData, notificationSettings);
      if (result.success) {
        const currentTime = new Date().toLocaleString('ar-EG');
        localStorage.setItem('lastEmailSent', currentTime);
        setLastEmailSent(currentTime);
        toast({ title: t('settings.settingsToasts.emailSent'), description: result.message });
      } else {
        toast({ title: t('settings.settingsToasts.emailSendError'), description: result.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.settingsToasts.emailError', { error }), variant: 'destructive' });
    } finally { setIsSendingEmail(false); }
  };

  const handleAutoNotifications = async () => {
    const notificationSettings: EmailNotificationSettings = { enabled: emailSettings.enable_notifications, monthlyReminder: emailSettings.monthly_schedule, weeklyReminder: emailSettings.weekly_schedule, expiredNotification: true, emailRecipient: emailSettings.email_receiver };
    await checkAndSendNotifications(employees, documents, notificationSettings);
  };

  const deleteReminderItem = (id: string, type: 'employee' | 'document') => {
    const newDeleted = [...deletedReminders, { id, type }];
    setDeletedReminders(newDeleted);
    localStorage.setItem('romani_deleted_reminders', JSON.stringify(newDeleted));
    setExpiryData(prev => ({
      employees: type === 'employee' ? prev.employees.filter(e => e.id !== id) : prev.employees,
      documents: type === 'document' ? prev.documents.filter(d => d.id !== id) : prev.documents
    }));
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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient">{t('settings.title')}</h1>
            <p className="text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 lg:grid-cols-7">
              <TabsTrigger value="email" className="flex items-center space-x-2"><Mail className="h-4 w-4" /><span>{t('settings.tabs.email')}</span></TabsTrigger>
              <TabsTrigger value="appearance" className="flex items-center space-x-2"><Moon className="h-4 w-4" /><span>{t('settings.tabs.appearance')}</span></TabsTrigger>
              <TabsTrigger value="companies" className="flex items-center space-x-2"><Building2 className="h-4 w-4" /><span>{t('settings.tabs.companies')}</span></TabsTrigger>
              <TabsTrigger value="positions" className="flex items-center space-x-2"><UserCog className="h-4 w-4" /><span>{t('settings.tabs.positions')}</span></TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center space-x-2"><FileText className="h-4 w-4" /><span>{t('settings.tabs.documents')}</span></TabsTrigger>
              <TabsTrigger value="ministries" className="flex items-center space-x-2"><Shield className="h-4 w-4" /><span>{t('settings.tabs.ministries')}</span></TabsTrigger>
              <TabsTrigger value="backup" className="flex items-center space-x-2"><Database className="h-4 w-4" /><span>{t('settings.tabs.backup')}</span></TabsTrigger>
            </TabsList>

            <TabsContent value="email">
              <EmailSettingsComponent
                emailSettings={emailSettings} onEmailSettingsChange={setEmailSettings}
                onSave={saveEmailSettings} onTestEmail={handleSendTestEmail}
                onCheckExpiry={handleCheckExpiry} onSendReport={handleSendTestEmail}
                onAutoNotifications={handleAutoNotifications} onDeleteReminder={deleteReminderItem}
                isCheckingExpiry={isCheckingExpiry} isSendingEmail={isSendingEmail}
                lastEmailSent={lastEmailSent} employees={employees} expiryData={expiryData}
              />
            </TabsContent>

            <TabsContent value="appearance">
              <AppearanceSettings darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
            </TabsContent>

            <TabsContent value="companies">
              <CompaniesSettings companies={companies} newCompany={newCompany} onNewCompanyChange={setNewCompany} onAdd={addCompany} onEdit={setEditingCompany} onDelete={deleteCompany} />
            </TabsContent>

            <TabsContent value="positions">
              <PositionsSettings positions={positions} newPosition={newPosition} onNewPositionChange={setNewPosition} onAdd={addPosition} onEdit={setEditingPosition} onDelete={deletePosition} />
            </TabsContent>

            <TabsContent value="documents">
              <DocumentTypesSettings documentTypes={documentTypes} newDocType={newDocType} onNewDocTypeChange={setNewDocType} onAdd={addDocumentType} onEdit={setEditingDocType} onDelete={deleteDocumentType} />
            </TabsContent>

            <TabsContent value="ministries">
              <MinistriesSettings ministries={ministries} newMinistry={newMinistry} onNewMinistryChange={setNewMinistry} onAdd={addMinistry} onEdit={setEditingMinistry} onDelete={deleteMinistry} />
            </TabsContent>

            <TabsContent value="backup">
              <BackupSettings onExportBackup={exportBackup} onEraseAllData={handleEraseAllData} />
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
                <div><Label>{t('settings.companies.nameArabic')}</Label><Input value={editingCompany.name_ar} onChange={(e) => setEditingCompany({ ...editingCompany, name_ar: e.target.value })} /></div>
                <div><Label>{t('settings.companies.nameEnglish')}</Label><Input value={editingCompany.name} onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })} /></div>
                <div><Label>{t('settings.companies.description')}</Label><Textarea value={editingCompany.description || ''} onChange={(e) => setEditingCompany({ ...editingCompany, description: e.target.value })} /></div>
                <Button onClick={updateCompany} className="w-full">{t('settings.actions.saveChanges')}</Button>
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
                <div><Label>{t('settings.documentTypes.nameArabic')}</Label><Input value={editingDocType.name_ar} onChange={(e) => setEditingDocType({ ...editingDocType, name_ar: e.target.value })} /></div>
                <div><Label>{t('settings.documentTypes.nameEnglish')}</Label><Input value={editingDocType.name} onChange={(e) => setEditingDocType({ ...editingDocType, name: e.target.value })} /></div>
                <Button onClick={updateDocumentType} className="w-full">{t('settings.actions.saveChanges')}</Button>
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
                <div><Label>{t('settings.ministries.nameArabic')}</Label><Input value={editingMinistry.name_ar} onChange={(e) => setEditingMinistry({ ...editingMinistry, name_ar: e.target.value })} /></div>
                <div><Label>{t('settings.ministries.nameEnglish')}</Label><Input value={editingMinistry.name} onChange={(e) => setEditingMinistry({ ...editingMinistry, name: e.target.value })} /></div>
                <Button onClick={updateMinistry} className="w-full">{t('settings.actions.saveChanges')}</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Position Dialog */}
        <Dialog open={!!editingPosition} onOpenChange={() => setEditingPosition(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings.positions.editTitle')}</DialogTitle>
              <DialogDescription>{t('settings.positions.editDescription')}</DialogDescription>
            </DialogHeader>
            {editingPosition && (
              <div className="grid grid-cols-1 gap-4 py-4">
                <div><Label>{t('settings.positions.nameArabic')}</Label><Input value={editingPosition.name_ar} onChange={(e) => setEditingPosition({ ...editingPosition, name_ar: e.target.value })} /></div>
                <div><Label>{t('settings.positions.nameEnglish')}</Label><Input value={editingPosition.name} onChange={(e) => setEditingPosition({ ...editingPosition, name: e.target.value })} /></div>
                <div><Label>{t('settings.positions.value')}</Label><Input value={editingPosition.value} onChange={(e) => setEditingPosition({ ...editingPosition, value: e.target.value })} /></div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingPosition(null)}>{t('settings.actions.cancel')}</Button>
              <Button onClick={updatePosition}>{t('settings.actions.saveChanges')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
