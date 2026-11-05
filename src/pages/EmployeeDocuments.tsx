import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Mail, Upload } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentCard } from '@/components/documents/DocumentCard';
import { DocumentFilters } from '@/components/documents/DocumentFilters';
import { DocumentEditorDialog, DocumentUploadDialog } from '@/components/documents/DocumentDialogs';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { EmployeeDocumentsHeader } from '@/components/employees/EmployeeDocumentsHeader';
import { SendDocumentDialog } from '@/components/email/SendDocumentDialog';
import { useDocuments } from '@/hooks/useDocuments';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import type { DocumentWithRelations } from '@/lib/api';

// Remount scoped state when navigating directly between employee routes.
export default function EmployeeDocuments() {
  const { employeeId } = useParams<{ employeeId: string }>();
  return employeeId ? <EmployeeDocumentsPage key={employeeId} employeeId={employeeId} /> : <EmployeeNotFound />;
}

function EmployeeNotFound() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return <Layout>
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-destructive">{t('employeeDocuments.employeeNotFound')}</h1>
        <Button onClick={() => navigate('/employees')} className="mt-4">{t('employeeDocuments.backToList')}</Button>
      </div>
    </div>
  </Layout>;
}

function EmployeeDocumentsPage({ employeeId }: { employeeId: string }) {
  const { t, language, isRTL } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const data = useDocuments(employeeId);
  const { deleteDocuments, downloadDocument, isDeleting } = useDocumentActions(
    data.removeDocuments, t('employeeDocuments.deleteConfirm'),
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentWithRelations | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentWithRelations | null>(null);
  const [emailDocuments, setEmailDocuments] = useState<DocumentWithRelations[]>([]);
  const employee = data.employees[0];
  const label = (ar: string, en: string) => language === 'ar' ? ar : en;
  const emailLabel = label('إرسال بالبريد الإلكتروني', 'Send by email');
  // Refuse mixed batches rather than silently omitting selected documents.
  const canEmailSelection = data.selectedDocuments.length > 0 && data.selectedDocuments.every((doc) => !!doc.file_path);

  useEffect(() => {
    if (employee?.is_active !== false) return;
    toast({ title: t('employeeDocuments.unauthorized'), description: t('employeeDocuments.inactiveEmployee'), variant: 'destructive' });
    navigate('/employees');
  }, [employee?.is_active, navigate, t, toast]);

  const closeEditor = () => { setUploadedFile(null); setEditingDocument(null); };
  const sendDocuments = (documents: DocumentWithRelations[]) => {
    if (!documents.length || documents.some((doc) => !doc.file_path)) return;
    setViewingDocument(null);
    setEmailDocuments(documents);
  };
  const cardActions = {
    handleViewDocument: setViewingDocument,
    handleEditDocument: (doc: DocumentWithRelations) => { setUploadedFile(null); setEditingDocument(doc); },
    handleDownloadDocument: downloadDocument,
    handleDeleteDocument: (id: string) => { void deleteDocuments([id]); },
    handleEmailDocument: (doc: DocumentWithRelations) => sendDocuments([doc]),
    toggleDocumentSelection: data.toggleDocumentSelection,
    emailLabel, isDeleting,
  };

  if (data.isLoading) return <Layout>
    <div className="min-h-screen flex items-center justify-center" role="status" aria-label={label('جارٍ التحميل', 'Loading')}>
      <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
    </div>
  </Layout>;

  if (!data.error && !employee) return <EmployeeNotFound />;
  if (employee?.is_active === false) return null;

  return <Layout>
    <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {data.error && <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('documents.messages.loadError')}: {data.error}</span>
          <Button variant="outline" size="sm" onClick={() => { void data.reload(); }}>{label('إعادة المحاولة', 'Retry')}</Button>
        </AlertDescription>
      </Alert>}
      {employee && <>
        <motion.div initial={false} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-6 rounded-2xl border border-teal-300/50 bg-gradient-to-br from-teal-100 via-emerald-50 to-sky-100 p-6 shadow-sm dark:border-teal-800 dark:from-teal-950 dark:via-emerald-950 dark:to-slate-900">
          <EmployeeDocumentsHeader employee={employee} documentCount={data.documents.length} onPhotoChange={data.reload} />
          <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen}
            copy={{ trigger: t('employeeDocuments.uploadNew'), title: t('employeeDocuments.uploadTitle', { name: employee.name }),
              description: t('employeeDocuments.uploadDesc') }}
            onFilesAccepted={(files) => {
              if (!files[0]) return;
              setEditingDocument(null);
              setUploadedFile(files[0]);
              setUploadOpen(false);
            }} />
        </motion.div>

        <DocumentFilters scope="employeeDocuments" searchTerm={data.searchTerm} setSearchTerm={data.setSearchTerm}
          selectedStatus={data.selectedStatus} setSelectedStatus={data.setSelectedStatus}
          selectedType={data.selectedType} setSelectedType={data.setSelectedType}
          viewMode={data.viewMode} setViewMode={data.setViewMode} documentTypes={data.documentTypes} />

        <div className="flex flex-wrap justify-between items-center gap-3">
          <Button variant="outline" size="sm" onClick={data.selectAllDocuments} disabled={!data.filteredDocuments.length || isDeleting}>
            {t('documents.bulk.selectAll', { count: data.filteredDocuments.length })}
          </Button>
          {data.selectedDocuments.length > 0 && <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-3 flex flex-wrap items-center gap-3">
              <span className="text-sm">{t('documents.bulk.selected', { count: data.selectedDocuments.length })}</span>
              <Button variant="ghost" size="sm" onClick={data.clearSelection}>{t('documents.bulk.clearSelection')}</Button>
              <Button variant="outline" size="sm" disabled={!canEmailSelection || isDeleting}
                onClick={() => sendDocuments(data.selectedDocuments)}><Mail className="h-4 w-4 ml-1" />{emailLabel}</Button>
              {!canEmailSelection && <span className="text-sm text-muted-foreground" role="status">
                {label('اختر مستندات لها ملفات مرفوعة لإرسالها بالبريد.', 'Select documents with uploaded files to send by email.')}
              </span>}
            </CardContent>
          </Card>}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {data.filteredDocuments.length === 0 ? <Card className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">{t('employeeDocuments.noDocuments')}</h3>
            <p className="text-muted-foreground mb-4">{t(data.searchTerm || data.selectedStatus !== 'all' || data.selectedType !== 'all'
              ? 'employeeDocuments.noDocumentsDesc' : 'employeeDocuments.noDocumentsEmpty')}</p>
            <Button onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4 ml-2" />{t('employeeDocuments.uploadFirst')}</Button>
          </Card> : <div className={data.viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2'}>
            {data.filteredDocuments.map((doc) => <DocumentCard key={doc.id} doc={doc} showMinistry
              selected={data.selectedDocuments.some((selected) => selected.id === doc.id)} {...cardActions} />)}
          </div>}
        </motion.div>

        {(uploadedFile || editingDocument) && <DocumentEditorDialog
          uploadedFile={uploadedFile} fileName={uploadedFile?.name ?? editingDocument?.file_name ?? ''}
          editingDocument={editingDocument} preselectedEmployeeId={employeeId} onClose={closeEditor}
          onSuccess={data.reload} documentTypes={data.documentTypes} companies={data.companies}
          employees={[employee]} ministries={data.ministries} />}

        <DocumentPreviewDialog document={viewingDocument} onClose={() => setViewingDocument(null)}
          handleDownloadDocument={downloadDocument} handleEmailDocument={cardActions.handleEmailDocument} emailLabel={emailLabel} />
        {emailDocuments.length > 0 && <SendDocumentDialog open documents={emailDocuments}
          onOpenChange={(open) => { if (!open) setEmailDocuments([]); }} />}
      </>}
    </div>
  </Layout>;
}
