import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Building2, Download, FileText, Mail, Trash2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentCard } from '@/components/documents/DocumentCard';
import { DocumentFilters } from '@/components/documents/DocumentFilters';
import { DocumentEditorDialog, DocumentUploadDialog } from '@/components/documents/DocumentDialogs';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { SendDocumentDialog } from '@/components/email/SendDocumentDialog';
import { useDocuments } from '@/hooks/useDocuments';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentWithRelations } from '@/lib/api';

// Remount scoped state when navigating directly between company routes.
export default function CompanyDocuments() {
  const { companyId } = useParams<{ companyId: string }>();
  return companyId ? <CompanyDocumentsPage key={companyId} companyId={companyId} /> : <CompanyNotFound />;
}

function CompanyNotFound() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const label = (ar: string, en: string) => language === 'ar' ? ar : en;
  return <Layout>
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">{label('الشركة غير موجودة', 'Company not found')}</h2>
        <Button onClick={() => navigate('/documents')}>{label('العودة إلى الوثائق', 'Back to documents')}</Button>
      </div>
    </div>
  </Layout>;
}

function CompanyDocumentsPage({ companyId }: { companyId: string }) {
  const { t, language, isRTL } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const data = useDocuments(undefined, companyId);
  const { deleteDocuments, downloadDocument, isDeleting } = useDocumentActions(data.removeDocuments);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentWithRelations | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentWithRelations | null>(null);
  const [emailDocuments, setEmailDocuments] = useState<DocumentWithRelations[]>([]);
  const company = data.companies.find((item) => item.id === companyId);
  const label = (ar: string, en: string) => language === 'ar' ? ar : en;
  const emailLabel = label('إرسال بالبريد الإلكتروني', 'Send by email');
  const companyNotFoundLabel = label('الشركة غير موجودة', 'Company not found');
  const canEmailSelection = data.selectedDocuments.length > 0 && data.selectedDocuments.every((doc) => !!doc.file_path);

  useEffect(() => {
    if (data.isLoading || data.error || company) return;
    toast({ title: t('documents.messages.error'),
      description: companyNotFoundLabel, variant: 'destructive' });
    navigate('/documents');
  }, [data.isLoading, data.error, company, companyNotFoundLabel, navigate, t, toast]);

  const closeEditor = () => { setUploadedFile(null); setEditingDocument(null); };
  const sendDocuments = (documents: DocumentWithRelations[]) => {
    // Refuse mixed batches rather than silently omitting selected documents.
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

  if (!data.error && !company) return <CompanyNotFound />;
  const companyName = language === 'ar' ? company?.name_ar || company?.name : company?.name;

  return <Layout>
    <div className="p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {data.error && <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('documents.messages.loadError')}: {data.error}</span>
          <Button variant="outline" size="sm" onClick={() => { void data.reload(); }}>{label('إعادة المحاولة', 'Retry')}</Button>
        </AlertDescription>
      </Alert>}
      {company && <>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/documents')} className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" /><span>{label('العودة', 'Back')}</span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gradient text-slate-950 flex items-center gap-2">
                <Building2 className="h-8 w-8" /><span>{label(`وثائق ${companyName}`, `${companyName} documents`)}</span>
              </h1>
              <p className="text-muted-foreground">
                {label(`عرض وإدارة جميع وثائق الشركة (${data.documents.length} وثيقة)`,
                  `View and manage all company documents (${data.documents.length})`)}
              </p>
            </div>
          </div>
          <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen}
            copy={{ trigger: t('documents.uploadNew'),
              title: label(`رفع وثيقة جديدة لشركة ${companyName}`, `Upload a new document for ${companyName}`),
              description: t('documents.chooseFiles') }}
            onFilesAccepted={(files) => {
              if (!files[0]) return;
              setEditingDocument(null);
              setUploadedFile(files[0]);
              setUploadOpen(false);
            }} />
        </motion.div>

        <DocumentFilters searchTerm={data.searchTerm} setSearchTerm={data.setSearchTerm}
          selectedStatus={data.selectedStatus} setSelectedStatus={data.setSelectedStatus}
          selectedType={data.selectedType} setSelectedType={data.setSelectedType}
          viewMode={data.viewMode} setViewMode={data.setViewMode} documentTypes={data.documentTypes} />

        {data.selectedDocuments.length > 0 && <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium">{t('documents.bulk.selected', { count: data.selectedDocuments.length })}</span>
              <Button variant="ghost" size="sm" onClick={data.clearSelection} disabled={isDeleting}>
                {t('documents.bulk.clearSelection')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!canEmailSelection || isDeleting}
                onClick={() => sendDocuments(data.selectedDocuments)}><Mail className="h-4 w-4 ml-1" />{emailLabel}</Button>
              <Button variant="outline" size="sm" disabled={isDeleting} onClick={async () => {
                for (const doc of data.selectedDocuments) await downloadDocument(doc);
              }}><Download className="h-4 w-4 ml-1" />{t('documents.bulk.download')}</Button>
              <Button variant="destructive" size="sm" disabled={isDeleting}
                onClick={() => { void deleteDocuments(data.selectedDocuments.map((doc) => doc.id)); }}>
                <Trash2 className="h-4 w-4 ml-1" />{t('documents.bulk.delete')}
              </Button>
            </div>
            {!canEmailSelection && <span className="text-sm text-muted-foreground" role="status">
              {label('اختر مستندات لها ملفات مرفوعة لإرسالها بالبريد.', 'Select documents with uploaded files to send by email.')}
            </span>}
          </CardContent>
        </Card>}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="text-xl font-semibold">{t('documents.title')}</h2>
            <Button variant="outline" size="sm" onClick={data.selectAllDocuments} disabled={!data.filteredDocuments.length || isDeleting}>
              {t('documents.bulk.selectAll', { count: data.filteredDocuments.length })}
            </Button>
          </div>
          {data.filteredDocuments.length === 0 ? <Card className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">{t('documents.company.noDocumentsInSection')}</p>
          </Card> : <div className={data.viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2'}>
            {data.filteredDocuments.map((doc) => <DocumentCard key={doc.id} doc={doc} showMinistry
              selected={data.selectedDocuments.some((selected) => selected.id === doc.id)} {...cardActions} />)}
          </div>}
        </motion.div>

        {(uploadedFile || editingDocument) && <DocumentEditorDialog
          uploadedFile={uploadedFile} fileName={uploadedFile?.name ?? editingDocument?.file_name ?? ''}
          editingDocument={editingDocument} preselectedCompanyId={companyId} onClose={closeEditor}
          onSuccess={data.reload} documentTypes={data.documentTypes} companies={data.companies}
          employees={data.employees} ministries={data.ministries} />}

        <DocumentPreviewDialog document={viewingDocument} onClose={() => setViewingDocument(null)}
          handleDownloadDocument={downloadDocument} handleEmailDocument={cardActions.handleEmailDocument} emailLabel={emailLabel} />
        {emailDocuments.length > 0 && <SendDocumentDialog open documents={emailDocuments}
          onOpenChange={(open) => { if (!open) setEmailDocuments([]); }} />}
      </>}
    </div>
  </Layout>;
}
