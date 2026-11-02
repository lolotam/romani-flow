import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Download, Mail, Trash2, User } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SendDocumentDialog } from '@/components/email/SendDocumentDialog';
import { DocumentFilters } from '@/components/documents/DocumentFilters';
import { DocumentSections } from '@/components/documents/DocumentSections';
import { DocumentEditorDialog, DocumentUploadDialog } from '@/components/documents/DocumentDialogs';
import { DocumentPreviewDialog } from '@/components/documents/DocumentPreviewDialog';
import { useDocuments } from '@/hooks/useDocuments';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentWithRelations } from '@/lib/api';

export default function Documents() {
  const { t, language } = useLanguage();
  const data = useDocuments();
  const { isDeleting, deleteDocuments, downloadDocument, emailLabel } = useDocumentActions(data.removeDocuments);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentWithRelations | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentWithRelations | null>(null);
  const [emailDocuments, setEmailDocuments] = useState<DocumentWithRelations[]>([]);

  const handleFilesAccepted = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0]; // Take the first file.
      setUploadedFile(file);
      setEditingDocument(null);
      setIsUploadDialogOpen(false);
    }
  };
  const handleDocumentFormClose = () => {
    setUploadedFile(null);
    setEditingDocument(null);
  };
  const handleEditDocument = (document: DocumentWithRelations) => {
    setUploadedFile(null);
    setEditingDocument(document);
  };
  const handleEmailDocument = (document: DocumentWithRelations) => {
    setViewingDocument(null);
    setEmailDocuments([document]);
  };
  const cardActions = {
    handleViewDocument: setViewingDocument,
    handleEditDocument,
    handleDownloadDocument: downloadDocument,
    handleDeleteDocument: (id: string) => { void deleteDocuments([id]); },
    handleEmailDocument,
    toggleDocumentSelection: data.toggleDocumentSelection,
    emailLabel,
    isDeleting,
  };

  if (data.isLoading) {
    return <Layout>
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label={language === 'ar' ? 'جارٍ التحميل' : 'Loading'}>
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    </Layout>;
  }

  return <Layout>
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gradient text-slate-950">{t('documents.title')}</h1>
          <p className="text-muted-foreground">{t('documents.viewAndManage', { count: data.documents.length })}</p>
        </div>
        <DocumentUploadDialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}
          onFilesAccepted={handleFilesAccepted} />
      </motion.div>

      {data.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('documents.messages.loadError')}: {data.error}</span>
            <Button variant="outline" size="sm" onClick={() => { void data.reload(); }}>
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <DocumentFilters searchTerm={data.searchTerm} setSearchTerm={data.setSearchTerm}
        selectedStatus={data.selectedStatus} setSelectedStatus={data.setSelectedStatus}
        selectedType={data.selectedType} setSelectedType={data.setSelectedType}
        viewMode={data.viewMode} setViewMode={data.setViewMode} documentTypes={data.documentTypes} />

      {/* Bulk Actions */}
      {data.selectedDocuments.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-sm font-medium">{t('documents.bulk.selected', { count: data.selectedDocuments.length })}</span>
                <Button variant="ghost" size="sm" onClick={data.clearSelection} disabled={isDeleting}>
                  {t('documents.bulk.clearSelection')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEmailDocuments(data.selectedDocuments)} disabled={isDeleting}>
                  <Mail className="h-4 w-4 ml-1" />{emailLabel}
                </Button>
                <Button variant="outline" size="sm" onClick={async () => {
                  for (const document of data.selectedDocuments) await downloadDocument(document);
                }} disabled={isDeleting}>
                  <Download className="h-4 w-4 ml-1" />{t('documents.bulk.download')}
                </Button>
                <Button variant="destructive" size="sm" disabled={isDeleting}
                  onClick={() => { void deleteDocuments(data.selectedDocuments.map((document) => document.id)); }}>
                  <Trash2 className="h-4 w-4 ml-1" />{t('documents.bulk.delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Main Content */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Tabs value={data.activeTab} onValueChange={data.setActiveTab} className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <TabsList className="grid w-fit grid-cols-2">
              <TabsTrigger value="company" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />{t('documents.tabs.companyDocuments')}
              </TabsTrigger>
              <TabsTrigger value="employee" className="flex items-center gap-2">
                <User className="h-4 w-4" />{t('documents.tabs.employeeDocuments')}
              </TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={data.selectAllDocuments} disabled={isDeleting}>
              {t('documents.bulk.selectAll', { count: data.filteredDocuments.length })}
            </Button>
          </div>
          <TabsContent value={data.activeTab}>
            <DocumentSections companies={data.companies} documentsByCompany={data.documentsByCompany}
              employeesByCompany={data.employeesByCompany} activeTab={data.activeTab} viewMode={data.viewMode}
              selectedIds={data.selectedDocuments.map((document) => document.id)} actions={cardActions} />
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* Document Form Dialog */}
      {(uploadedFile || editingDocument) && (
        <DocumentEditorDialog uploadedFile={uploadedFile} fileName={uploadedFile?.name ?? editingDocument?.file_name ?? ''}
          onClose={handleDocumentFormClose} onSuccess={data.reload} documentTypes={data.documentTypes}
          companies={data.companies} employees={data.employees} ministries={data.ministries} editingDocument={editingDocument} />
      )}

      <DocumentPreviewDialog document={viewingDocument} onClose={() => setViewingDocument(null)}
        handleDownloadDocument={downloadDocument} handleEmailDocument={handleEmailDocument} emailLabel={emailLabel} />

      {emailDocuments.length > 0 && (
        <SendDocumentDialog open onOpenChange={(open) => { if (!open) setEmailDocuments([]); }}
          documents={emailDocuments} />
      )}
    </div>
  </Layout>;
}
