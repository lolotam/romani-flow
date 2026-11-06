import { useLastSubmissionState } from '@/hooks/useLastSubmission';
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/contexts/ThemeProvider';
import { motion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { api, endpoints } from '@/lib/api';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { Mail, Moon, Building2, FileText, UserCog, Shield, Database, QrCode } from 'lucide-react';

import type { Company, DocumentType, Ministry, Position } from '@/components/settings/types';
import EmailSettingsComponent from '@/components/settings/EmailSettings';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import CompaniesSettings from '@/components/settings/CompaniesSettings';
import PositionsSettings from '@/components/settings/PositionsSettings';
import DocumentTypesSettings from '@/components/settings/DocumentTypesSettings';
import MinistriesSettings from '@/components/settings/MinistriesSettings';
import BackupSettings from '@/components/settings/BackupSettings';
import WhatsAppPairingSettings from '@/components/settings/WhatsAppPairingSettings';
import WhatsAppSettings from '@/components/settings/WhatsAppSettings';

export default function Settings() {
  const { t, isRTL } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('email');
  const [whatsappRefreshKey, setWhatsAppRefreshKey] = useState(0);
  const refreshWhatsAppSettings = useCallback(() => setWhatsAppRefreshKey(value => value + 1), []);
  const [isLoading, setIsLoading] = useState(true);

  // Data state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  // Form state
  const [newCompany, setNewCompany] = useLastSubmissionState('companies', { name: '', name_ar: '', description: '' });
  const [newDocType, setNewDocType] = useLastSubmissionState('document_types', { name: '', name_ar: '' });
  const [newMinistry, setNewMinistry] = useLastSubmissionState('ministries', { name: '', name_ar: '' });
  const [newPosition, setNewPosition] = useLastSubmissionState('positions', { name: '', name_ar: '', value: '' });

  // Edit state
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingDocType, setEditingDocType] = useState<DocumentType | null>(null);
  const [editingMinistry, setEditingMinistry] = useState<Ministry | null>(null);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [companiesResult, docTypesResult, ministriesResult, positionsResult] = await Promise.all([
        api.from<Company>('companies').select('*').order('name', 'asc').execute(),
        api.from<DocumentType>('document_types').select('*').order('name_ar', 'asc').execute(),
        api.from<Ministry>('ministries').select('*').order('name_ar', 'asc').execute(),
        api.from<Position>('positions').select('*').order('name_ar', 'asc').execute(),
      ]);

      setCompanies(companiesResult.data || []);
      setDocumentTypes(docTypesResult.data || []);
      setMinistries(ministriesResult.data || []);
      setPositions(positionsResult.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Dark mode — delegate to ThemeProvider
  const toggleDarkMode = () => {
    toggleTheme();
    toast({ title: t('settings.settingsToasts.themeChanged'), description: t('settings.settingsToasts.themeChangedDesc', { status: theme === 'light' ? t('settings.settingsToasts.enabled') : t('settings.settingsToasts.disabled') }) });
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
    crudAction(async () => { const { error } = await api.insert('companies', { name: newCompany.name, name_ar: newCompany.name_ar, description: newCompany.description }); if (error) throw error; }, 'companyAdded', 'companyAddError');
  };
  const updateCompany = () => {
    if (!editingCompany || !validateRequired(editingCompany.name, editingCompany.name_ar)) return;
    crudAction(async () => { const { error } = await api.update('companies', editingCompany.id, { name: editingCompany.name, name_ar: editingCompany.name_ar, description: editingCompany.description }); if (error) throw error; }, 'companyUpdated', 'companyUpdateError', () => setEditingCompany(null));
  };
  const deleteCompany = (company: Company) => {
    if (!confirm(t('settings.settingsToasts.companyDeleteConfirm', { name: company.name_ar }))) return;
    crudAction(async () => { const { error } = await api.delete('companies', company.id); if (error) throw error; }, 'companyDeleted', 'companyDeleteError');
  };

  // Document Types
  const addDocumentType = () => {
    if (!validateRequired(newDocType.name, newDocType.name_ar)) return;
    crudAction(async () => { const { error } = await api.insert('document_types', newDocType); if (error) throw error; }, 'documentTypeAdded', 'documentTypeAddError');
  };
  const updateDocumentType = () => {
    if (!editingDocType || !validateRequired(editingDocType.name, editingDocType.name_ar)) return;
    crudAction(async () => { const { error } = await api.update('document_types', editingDocType.id, { name: editingDocType.name, name_ar: editingDocType.name_ar }); if (error) throw error; }, 'documentTypeUpdated', 'documentTypeUpdateError', () => setEditingDocType(null));
  };
  const deleteDocumentType = (docType: DocumentType) => {
    if (!confirm(t('settings.settingsToasts.documentTypeDeleteConfirm', { name: docType.name_ar }))) return;
    crudAction(async () => { const { error } = await api.delete('document_types', docType.id); if (error) throw error; }, 'documentTypeDeleted', 'documentTypeDeleteError');
  };

  // Ministries
  const addMinistry = () => {
    if (!validateRequired(newMinistry.name, newMinistry.name_ar)) return;
    crudAction(async () => { const { error } = await api.insert('ministries', newMinistry); if (error) throw error; }, 'ministryAdded', 'ministryAddError');
  };
  const updateMinistry = () => {
    if (!editingMinistry || !validateRequired(editingMinistry.name, editingMinistry.name_ar)) return;
    crudAction(async () => { const { error } = await api.update('ministries', editingMinistry.id, { name: editingMinistry.name, name_ar: editingMinistry.name_ar }); if (error) throw error; }, 'ministryUpdated', 'ministryUpdateError', () => setEditingMinistry(null));
  };
  const deleteMinistry = (ministry: Ministry) => {
    if (!confirm(t('settings.settingsToasts.ministryDeleteConfirm', { name: ministry.name_ar }))) return;
    crudAction(async () => { const { error } = await api.delete('ministries', ministry.id); if (error) throw error; }, 'ministryDeleted', 'ministryDeleteError');
  };

  // Positions
  const addPosition = () => {
    if (!validateRequired(newPosition.name, newPosition.name_ar, newPosition.value)) return;
    crudAction(async () => { const { error } = await api.insert('positions', newPosition); if (error) throw error; }, 'positionAdded', 'positionAddError');
  };
  const updatePosition = () => {
    if (!editingPosition || !validateRequired(editingPosition.name, editingPosition.name_ar, editingPosition.value)) return;
    crudAction(async () => { const { error } = await api.update('positions', editingPosition.id, { name: editingPosition.name, name_ar: editingPosition.name_ar, value: editingPosition.value }); if (error) throw error; }, 'positionUpdated', 'positionUpdateError', () => setEditingPosition(null));
  };
  const deletePosition = (position: Position) => {
    if (!confirm(t('settings.settingsToasts.positionDeleteConfirm', { name: position.name_ar }))) return;
    crudAction(async () => { const { error } = await api.delete('positions', position.id); if (error) throw error; }, 'positionDeleted', 'positionDeleteError');
  };

  // Backup
  const exportBackup = async () => {
    const { data, error } = await endpoints.backup.export();
    if (error || !data) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.settingsToasts.backupExportError'), variant: 'destructive' });
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `romani-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: t('settings.settingsToasts.backupExported'), description: t('settings.settingsToasts.backupExportedDesc') });
  };

  const handleEraseAllData = async (confirmText: string) => {
    if (confirmText !== 'DELETE ALL') return;
    const { data, error } = await endpoints.backup.erase();
    if (error) {
      toast({ title: t('settings.settingsToasts.error'), description: error.message, variant: 'destructive' });
      return;
    }
    if (data && data.filesPendingCleanup > 0) {
      toast({ title: t('settings.settingsToasts.error'), description: t('settings.backup.cleanupPending'), variant: 'destructive' });
      return;
    }
    toast({ title: t('settings.settingsToasts.success'), description: t('settings.backup.eraseSuccess') });
    setTimeout(() => window.location.reload(), 1000);
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
      <div dir={isRTL ? 'rtl' : 'ltr'} className="p-4 sm:p-6 space-y-6 text-start">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient">{t('settings.title')}</h1>
            <p className="text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Tabs dir={isRTL ? 'rtl' : 'ltr'} value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-1">
              <TabsTrigger value="email" className="flex items-center gap-2"><Mail className="h-4 w-4" /><span>{t('settings.tabs.email')}</span></TabsTrigger>
              {user?.role === 'admin' && <TabsTrigger value="whatsapp" className="flex items-center gap-2"><QrCode className="h-4 w-4" /><span>{t('settings.tabs.whatsapp')}</span></TabsTrigger>}
              <TabsTrigger value="appearance" className="flex items-center gap-2"><Moon className="h-4 w-4" /><span>{t('settings.tabs.appearance')}</span></TabsTrigger>
              <TabsTrigger value="companies" className="flex items-center gap-2"><Building2 className="h-4 w-4" /><span>{t('settings.tabs.companies')}</span></TabsTrigger>
              <TabsTrigger value="positions" className="flex items-center gap-2"><UserCog className="h-4 w-4" /><span>{t('settings.tabs.positions')}</span></TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-2"><FileText className="h-4 w-4" /><span>{t('settings.tabs.documents')}</span></TabsTrigger>
              <TabsTrigger value="ministries" className="flex items-center gap-2"><Shield className="h-4 w-4" /><span>{t('settings.tabs.ministries')}</span></TabsTrigger>
              <TabsTrigger value="backup" className="flex items-center gap-2"><Database className="h-4 w-4" /><span>{t('settings.tabs.backup')}</span></TabsTrigger>
            </TabsList>

            <TabsContent value="email">
              <EmailSettingsComponent />
            </TabsContent>
            {user?.role === 'admin' && <TabsContent value="whatsapp" className="space-y-5"><WhatsAppPairingSettings onDisconnectSettled={refreshWhatsAppSettings} /><WhatsAppSettings refreshKey={whatsappRefreshKey} /></TabsContent>}

            <TabsContent value="appearance">
              <AppearanceSettings darkMode={theme === 'dark'} onToggleDarkMode={toggleDarkMode} />
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
                <div><Label>{t('settings.companies.nameEnglish')}</Label><Input dir="ltr" value={editingCompany.name} onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })} /></div>
                <div><Label>{t('settings.companies.descriptionLabel')}</Label><Textarea value={editingCompany.description || ''} onChange={(e) => setEditingCompany({ ...editingCompany, description: e.target.value })} /></div>
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
                <div><Label>{t('settings.documentTypes.nameEnglish')}</Label><Input dir="ltr" value={editingDocType.name} onChange={(e) => setEditingDocType({ ...editingDocType, name: e.target.value })} /></div>
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
                <div><Label>{t('settings.ministries.nameEnglish')}</Label><Input dir="ltr" value={editingMinistry.name} onChange={(e) => setEditingMinistry({ ...editingMinistry, name: e.target.value })} /></div>
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
                <div><Label>{t('settings.positions.nameEnglish')}</Label><Input dir="ltr" value={editingPosition.name} onChange={(e) => setEditingPosition({ ...editingPosition, name: e.target.value })} /></div>
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
