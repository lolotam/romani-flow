import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/api/endpoints';
import type {
  DocumentType,
  DocumentWithRelations,
  EmployeeWithRelations,
  Ministry,
} from '@/types';
import { Layout } from '@/components/Layout';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { EmployeeDocumentForm } from '@/components/EmployeeDocumentForm';
import { EmployeeProfileHeader } from '@/components/employees/EmployeeProfileHeader';
import { EmployeeDocumentFilters } from '@/components/employees/EmployeeDocumentFilters';
import { EmployeeDocumentsGrid } from '@/components/employees/EmployeeDocumentsGrid';
import { Plus, FileText, ArrowRight, DownloadCloud } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canEdit } from '@/lib/permissions';

export default function EmployeeProfile() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const editable = canEdit(useAuth().user?.role);

  const [employee, setEmployee] = useState<EmployeeWithRelations | null>(null);
  const [documents, setDocuments] = useState<DocumentWithRelations[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDocumentFormOpen, setIsDocumentFormOpen] = useState(false);

  useEffect(() => {
    if (employeeId) {
      fetchEmployee();
      fetchDocuments();
      fetchDocumentTypes();
      fetchMinistries();
    }
  }, [employeeId]);

  const fetchEmployee = async () => {
    if (!employeeId) return;

    try {
      const { data, error } = await api
        .from<EmployeeWithRelations>('employees')
        .select(
          `
          *,
          companies (
            name,
            name_ar
          )
        `,
        )
        .eq('id', employeeId)
        .execute();

      if (error) throw error;
      if (data && data.length > 0) {
        setEmployee(data[0]);
      }
    } catch (error) {
      console.error('Error fetching employee:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل بيانات الموظف',
        variant: 'destructive',
      });
      navigate('/employees');
    }
  };

  const fetchDocuments = async () => {
    if (!employeeId) return;

    try {
      const { data, error } = await api
        .from<DocumentWithRelations>('documents')
        .select(
          `
          *,
          document_types (
            name,
            name_ar
          ),
          ministries (
            name,
            name_ar
          )
        `,
        )
        .eq('employee_id', employeeId)
        .order('created_at', 'desc')
        .execute();

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل الوثائق',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDocumentTypes = async () => {
    try {
      const { data, error } = await api
        .from<DocumentType>('document_types')
        .select('*')
        .order('name_ar', 'asc')
        .execute();

      if (error) throw error;
      setDocumentTypes(data || []);
    } catch (error) {
      console.error('Error fetching document types:', error);
    }
  };

  const fetchMinistries = async () => {
    try {
      const { data, error } = await api
        .from<Ministry>('ministries')
        .select('*')
        .order('name_ar', 'asc')
        .execute();

      if (error) throw error;
      setMinistries(data || []);
    } catch (error) {
      console.error('Error fetching ministries:', error);
    }
  };

  const filteredDocuments = useMemo(() => {
    return documents.filter(document => {
      const matchesSearch =
        document.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        document.document_types?.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
        document.notes?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || document.status === statusFilter;

      const matchesType = typeFilter === 'all' || document.document_type_id === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [documents, searchTerm, statusFilter, typeFilter]);

  const handleDocumentSelect = (documentId: string) => {
    setSelectedDocuments(prev =>
      prev.includes(documentId)
        ? prev.filter(id => id !== documentId)
        : [...prev, documentId],
    );
  };

  const handleSelectAll = () => {
    if (selectedDocuments.length === filteredDocuments.length) {
      setSelectedDocuments([]);
    } else {
      setSelectedDocuments(filteredDocuments.map(doc => doc.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocuments.length === 0) return;

    if (!confirm(`هل أنت متأكد من حذف ${selectedDocuments.length} وثيقة؟`)) return;

    try {
      // Delete each document individually
      for (const docId of selectedDocuments) {
        const { error } = await api.delete('documents', docId);
        if (error) throw error;
      }

      toast({
        title: 'تم بنجاح',
        description: `تم حذف ${selectedDocuments.length} وثيقة بنجاح`,
      });

      setSelectedDocuments([]);
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting documents:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في حذف الوثائق',
        variant: 'destructive',
      });
    }
  };

  const handleDocumentDelete = async (documentId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه الوثيقة؟')) return;

    try {
      const { error } = await api.delete('documents', documentId);

      if (error) throw error;

      toast({
        title: 'تم بنجاح',
        description: 'تم حذف الوثيقة بنجاح',
      });

      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في حذف الوثيقة',
        variant: 'destructive',
      });
    }
  };

  const handleDownloadDocument = async (document: DocumentWithRelations) => {
    if (!document.file_path) {
      toast({
        title: 'خطأ',
        description: 'لا يوجد ملف مرفق بهذه الوثيقة',
        variant: 'destructive',
      });
      return;
    }

    try {
      // The file lives on the server; it is streamed through the file endpoint.
      const link = window.document.createElement('a');
      link.href = endpoints.files.downloadUrl(document.id);
      link.download = document.file_name || document.title;
      link.click();
    } catch (error) {
      console.error('Error downloading document:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تنزيل الوثيقة',
        variant: 'destructive',
      });
    }
  };

  const handleDownloadAll = async () => {
    const documentsToDownload =
      selectedDocuments.length > 0
        ? documents.filter(doc => selectedDocuments.includes(doc.id))
        : filteredDocuments;

    if (documentsToDownload.length === 0) {
      toast({
        title: 'تحذير',
        description: 'لا توجد وثائق لتنزيلها',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'جاري التنزيل',
      description: `جاري تنزيل ${documentsToDownload.length} وثيقة...`,
    });

    for (const document of documentsToDownload) {
      if (document.file_path) {
        try {
          await handleDownloadDocument(document);
          // Add small delay between downloads
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error downloading ${document.title}:`, error);
        }
      }
    }

    toast({
      title: 'تم بنجاح',
      description: 'تم تنزيل جميع الوثائق المتاحة',
    });
  };

  const handleFilesAccepted = (files: File[]) => {
    if (files.length > 0) {
      setUploadedFile(files[0]);
      setIsDocumentFormOpen(true);
    }
  };

  const handleDocumentFormClose = () => {
    setIsDocumentFormOpen(false);
    setUploadedFile(null);
  };

  const handleDocumentSaved = () => {
    fetchDocuments();
    handleDocumentFormClose();
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

  if (!employee) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-destructive">موظف غير موجود</h1>
            <Button onClick={() => navigate('/employees')} className="mt-4">
              العودة لقائمة الموظفين
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header with employee info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <Button variant="ghost" onClick={() => navigate('/employees')} className="mb-4">
            <ArrowRight className="h-4 w-4 ml-2" />
            العودة لقائمة الموظفين
          </Button>

          <EmployeeProfileHeader employee={employee} />
        </motion.div>

        {/* Documents section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gradient">وثائق الموظف</h2>
              <p className="text-muted-foreground">
                إجمالي {documents.length} وثيقة
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleDownloadAll} variant="outline" size="sm">
                <DownloadCloud className="h-4 w-4 ml-2" />
                تنزيل {selectedDocuments.length > 0 ? 'المحددة' : 'الكل'}
              </Button>
              {editable && <Button
                onClick={() => setIsDocumentFormOpen(true)}
                className="shadow-elegant hover:shadow-glow transition-all"
              >
                <Plus className="h-4 w-4 ml-2" />
                إضافة وثيقة
              </Button>}
            </div>
          </div>

          {/* Filters */}
          <EmployeeDocumentFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            documentTypes={documentTypes}
            selectedCount={selectedDocuments.length}
            totalCount={filteredDocuments.length}
            onSelectAll={handleSelectAll}
            onBulkDelete={handleBulkDelete}
            onClearSelection={() => setSelectedDocuments([])}
          />

          {/* Documents grid */}
          <EmployeeDocumentsGrid
            documents={filteredDocuments}
            selectedDocumentIds={selectedDocuments}
            onToggleDocument={handleDocumentSelect}
            onDownload={handleDownloadDocument}
            onDelete={handleDocumentDelete}
          />

          {filteredDocuments.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">لا توجد وثائق</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || statusFilter !== 'all' || typeFilter !== 'all'
                  ? 'لا توجد وثائق تطابق معايير البحث'
                  : 'لم يتم إضافة أي وثائق بعد'}
              </p>
              {editable && <Button onClick={() => setIsDocumentFormOpen(true)}>
                <Plus className="h-4 w-4 ml-2" />
                إضافة أول وثيقة
              </Button>}
            </motion.div>
          )}
        </motion.div>

        {/* Upload Dropzone */}
        {editable && <UploadDropzone
          onFilesAccepted={handleFilesAccepted}
          acceptedFileTypes={[]}
          maxFiles={1}
          className="border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors p-8 rounded-lg bg-muted/10"
        />}

        {/* Document Form Dialog */}
        <EmployeeDocumentForm
          isOpen={isDocumentFormOpen}
          onClose={handleDocumentFormClose}
          onSave={handleDocumentSaved}
          employeeId={employeeId!}
          uploadedFile={uploadedFile}
        />
      </div>
    </Layout>
  );
}
