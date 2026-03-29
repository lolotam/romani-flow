import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { jsonDatabase } from '@/lib/jsonDatabase';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { calculateDocumentStatus } from '@/lib/statusUtils';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { DocumentForm } from '@/components/DocumentForm';
import {
  FileText,
  Plus,
  Search,
  Filter,
  Download,
  Trash2,
  Eye,
  Edit,
  Upload,
  Calendar,
  Building2,
  User,
  Grid,
  List,
  MoreVertical,
  ArrowLeft,
  UserCheck,
  Camera,
  ImagePlus,
  X
} from 'lucide-react';

interface Document {
  id: string;
  title: string;
  file_name?: string;
  file_path?: string;
  status?: 'valid' | 'expiring_soon' | 'expired';
  issue_date?: string;
  expiry_date?: string;
  notes?: string;
  employee_id?: string;
  company_id?: string;
  document_type_id: string;
  ministry_id?: string;
  created_at: string;
  updated_at: string;
  document_types?: {
    name: string;
    name_ar: string;
  };
  ministries?: {
    name: string;
    name_ar: string;
  };
}

interface Employee {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  company_id: string;
  photo?: string;
  is_active?: boolean;
  companies?: {
    name: string;
    name_ar: string;
  };
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

interface Company {
  id: string;
  name: string;
  name_ar: string;
}

export default function EmployeeDocuments() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [isPhotoUploadOpen, setIsPhotoUploadOpen] = useState(false);
  const [employeePhoto, setEmployeePhoto] = useState<string | null>(null);
  const { toast } = useToast();
  const { t, language } = useLanguage();

  useEffect(() => {
    if (employeeId) {
      fetchEmployee();
      fetchDocuments();
      fetchDocumentTypes();
      fetchMinistries();
      fetchCompanies();
    }
  }, [employeeId]);

  const fetchEmployee = async () => {
    try {
      const { data, error } = await jsonDatabase
        .from('employees')
        .select(`
          *,
          companies (
            name,
            name_ar
          )
        `)
        .eq('id', employeeId)
        .execute();

      if (error) throw error;
      if (data && data.length > 0) {
        const employee = data[0];

        // Check if employee is active
        if (employee.is_active === false) {
          toast({
            title: t('employeeDocuments.unauthorized'),
            description: t('employeeDocuments.inactiveEmployee'),
            variant: 'destructive'
          });
          navigate('/employees');
          return;
        }

        setEmployee(employee);
        setEmployeePhoto(employee.photo || null);
      }
    } catch (error) {
      console.error('Error fetching employee:', error);
      toast({
        title: t('common.error'),
        description: t('employees.messages.loadError'),
        variant: 'destructive'
      });
    }
  };

  const fetchDocuments = async () => {
    try {
      const { data, error } = await jsonDatabase
        .from('documents')
        .select(`
          *,
          document_types (
            name,
            name_ar
          ),
          ministries (
            name,
            name_ar
          )
        `)
        .eq('employee_id', employeeId)
        .order('created_at', 'desc')
        .execute();

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: t('common.error'),
        description: t('documents.messages.loadError'),
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDocumentTypes = async () => {
    try {
      const { data, error } = await jsonDatabase
        .from('document_types')
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
      const { data, error } = await jsonDatabase
        .from('ministries')
        .select('*')
        .order('name_ar', 'asc')
        .execute();

      if (error) throw error;
      setMinistries(data || []);
    } catch (error) {
      console.error('Error fetching ministries:', error);
    }
  };

  const fetchCompanies = async () => {
    try {
      const { data, error } = await jsonDatabase
        .from('companies')
        .select('*')
        .order('name', 'asc')
        .execute();

      if (error) throw error;
      setCompanies(data || []);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };

  const filteredDocuments = useMemo(() => {
    let filtered = documents.filter(doc => {
      const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.document_types?.name_ar.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = selectedStatus === 'all' || doc.status === selectedStatus;
      const matchesType = selectedType === 'all' || doc.document_type_id === selectedType;

      return matchesSearch && matchesStatus && matchesType;
    });

    return filtered;
  }, [documents, searchTerm, selectedStatus, selectedType]);

  const handleFilesAccepted = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0];
      setUploadedFile(file);
      setUploadedFileName(file.name);
      setIsUploadDialogOpen(false);
      setShowDocumentForm(true);
    }
  };

  const handleDocumentFormClose = () => {
    setShowDocumentForm(false);
    setUploadedFile(null);
    setUploadedFileName('');
    setEditingDocument(null);
  };

  const handleDocumentSaved = async () => {
    await fetchDocuments();
    // Also update the employee to reflect new document count
    await fetchEmployee();
    handleDocumentFormClose();
  };

  const handleEditDocument = (doc: Document) => {
    setEditingDocument(doc);
    setShowDocumentForm(true);
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm(t('employeeDocuments.deleteConfirm'))) return;

    try {
      const { error } = await jsonDatabase.delete('documents', docId);

      if (error) throw error;

      toast({
        title: t('common.success'),
        description: t('documents.messages.deleteSuccess')
      });

      await Promise.all([fetchDocuments(), fetchEmployee()]);
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: t('common.error'),
        description: t('documents.messages.deleteError'),
        variant: 'destructive'
      });
    }
  };

  const handleViewDocument = (doc: Document) => {
    setSelectedDocument(doc);
    setIsViewDialogOpen(true);
  };

  const handleDownloadDocument = async (doc: Document) => {
    if (!doc.file_path) {
      toast({
        title: t('common.error'),
        description: t('documents.messages.noFileError'),
        variant: 'destructive'
      });
      return;
    }

    try {
      let downloadUrl: string;

      // Check if file_path is base64 data URL or regular file path
      if (doc.file_path.startsWith('data:')) {
        // Base64 data URL - use directly
        downloadUrl = doc.file_path;
      } else {
        // Legacy file path - convert to blob URL for compatibility
        try {
          const response = await fetch(doc.file_path);
          const blob = await response.blob();
          downloadUrl = URL.createObjectURL(blob);
        } catch {
          // If fetch fails, try using the path directly
          downloadUrl = doc.file_path;
        }
      }

      // Create download link
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = doc.file_name || 'document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up blob URL if created
      if (!doc.file_path.startsWith('data:') && downloadUrl !== doc.file_path) {
        URL.revokeObjectURL(downloadUrl);
      }

      toast({
        title: t('common.success'),
        description: t('documents.messages.downloadSuccess') || 'Document downloaded successfully'
      });
    } catch (error) {
      console.error('Error downloading document:', error);
      toast({
        title: t('common.error'),
        description: t('documents.messages.downloadError'),
        variant: 'destructive'
      });
    }
  };

  const handlePhotoUpload = async (files: File[]) => {
    if (files.length === 0) return;

    const file = files[0];

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: t('common.error'),
        description: t('documents.messages.fileTypeError'),
        variant: 'destructive'
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t('common.error'),
        description: t('documents.messages.fileSizeError'),
        variant: 'destructive'
      });
      return;
    }

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;

        // Update employee photo in database
        const { error } = await jsonDatabase
          .update('employees', employeeId!, { photo: base64Data });

        if (error) throw error;

        setEmployeePhoto(base64Data);
        setIsPhotoUploadOpen(false);

        toast({
          title: t('common.success'),
          description: t('employeeDocuments.photoUploadSuccess')
        });
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: t('common.error'),
        description: t('documents.messages.saveError'),
        variant: 'destructive'
      });
    }
  };

    const handleRemovePhoto = async () => {
      if (!confirm(t('employeeDocuments.photoDeleteConfirm'))) return;

      try {
        const { error } = await jsonDatabase
          .update('employees', employeeId!, { photo: null });

        if (error) throw error;

        setEmployeePhoto(null);

        toast({
          title: t('common.success'),
          description: t('employeeDocuments.photoDeleteSuccess')
        });
      } catch (error) {
        console.error('Error removing photo:', error);
        toast({
          title: t('common.error'),
          description: t('documents.messages.deleteError'),
          variant: 'destructive'
        });
      }
    };

    const DocumentCard = ({ doc }: { doc: Document }) => (
      <Card className="group hover:shadow-elegant transition-all duration-300 relative">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg font-semibold line-clamp-2">
                {doc.title}
              </CardTitle>
              <CardDescription className="mt-1">
                {doc.document_types?.name_ar}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusBadge status={calculateDocumentStatus(doc.expiry_date)} />
            {doc.ministries && (
              <Badge variant="outline" className="text-xs">
                {doc.ministries.name_ar}
              </Badge>
            )}
          </div>

          {doc.expiry_date && (
            <div className="flex items-center text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 ml-2" />
              <span>{t('documents.card.expiresOn')} {new Date(doc.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB').replace(/\//g, '-')}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex space-x-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handleViewDocument(doc)}
                title={t('employeeDocuments.view')}
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handleEditDocument(doc)}
                title={t('employeeDocuments.edit')}
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => handleDownloadDocument(doc)}
                title={t('employeeDocuments.download')}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleDeleteDocument(doc.id)}
                title={t('employeeDocuments.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );

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
              <h1 className="text-2xl font-bold text-destructive">{t('employeeDocuments.employeeNotFound')}</h1>
              <Button onClick={() => navigate('/employees')} className="mt-4">
                {t('employeeDocuments.backToList')}
              </Button>
            </div>
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
            className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6"
          >
            <div className="flex flex-col sm:flex-row items-start gap-6 flex-1">
              {/* Employee Photo Section */}
              <div className="flex-shrink-0">
                <div className="relative group">
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-primary/20 overflow-hidden bg-gray-50 shadow-elegant hover:shadow-glow transition-all duration-300">
                    {employeePhoto ? (
                      <img
                        src={employeePhoto}
                        alt={employee.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
                        <User className="h-10 w-10 text-primary/60" />
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1">
                    <Button
                      size="sm"
                      className="h-8 w-8 rounded-full shadow-lg"
                      onClick={() => setIsPhotoUploadOpen(true)}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                  {employeePhoto && (
                    <div className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 w-6 rounded-full"
                        onClick={handleRemovePhoto}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Employee Info Section */}
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/employees')}
                    className="hover:bg-accent"
                  >
                    <ArrowLeft className="h-4 w-4 ml-1" />
                    {t('employeeDocuments.back')}
                  </Button>
                </div>
                <div className="relative inline-block">
                  <h1 className="text-3xl font-bold text-gradient">{t('employeeDocuments.title', { name: employee.name })}</h1>
                  <div className="absolute -top-2 -left-2 bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg">
                    {documents.length}
                  </div>
                </div>
                <div className="flex items-center space-x-2 mt-2">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <span className="text-muted-foreground">{employee.companies?.name}</span>
                  {employee.position && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <Badge variant="outline">{employee.position}</Badge>
                    </>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  {t('employeeDocuments.totalDocuments', { count: documents.length })}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="shadow-elegant hover:shadow-glow transition-all">
                    <Upload className="h-4 w-4 ml-2" />
                    {t('employeeDocuments.uploadNew')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{t('employeeDocuments.uploadTitle', { name: employee.name })}</DialogTitle>
                    <DialogDescription>
                      {t('employeeDocuments.uploadDesc')}
                    </DialogDescription>
                  </DialogHeader>
                  <UploadDropzone
                    onFilesAccepted={handleFilesAccepted}
                    maxFiles={1}
                    maxFileSize={50 * 1024 * 1024} // 50MB
                  />
                </DialogContent>
              </Dialog>
            </div>
          </motion.div>

          {/* Filters */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="shadow-soft">
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="flex-1">
                    <Label htmlFor="search">{t('employeeDocuments.search')}</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="search"
                        placeholder={t('employeeDocuments.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="w-full lg:w-48">
                    <Label>{t('employeeDocuments.status')}</Label>
                    <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('employeeDocuments.allStatuses')}</SelectItem>
                        <SelectItem value="valid">{t('employeeDocuments.valid')}</SelectItem>
                        <SelectItem value="expiring_soon">{t('employeeDocuments.expiringSoon')}</SelectItem>
                        <SelectItem value="expired">{t('employeeDocuments.expired')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="w-full lg:w-48">
                    <Label>{t('employeeDocuments.documentType')}</Label>
                    <Select value={selectedType} onValueChange={setSelectedType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('employeeDocuments.allTypes')}</SelectItem>
                        {documentTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name_ar}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end space-x-2">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                    >
                      <Grid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Documents */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {filteredDocuments.length === 0 ? (
              <Card className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                  {t('employeeDocuments.noDocuments')}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm || selectedStatus !== 'all' || selectedType !== 'all'
                    ? t('employeeDocuments.noDocumentsDesc')
                    : t('employeeDocuments.noDocumentsEmpty')
                  }
                </p>
                <Button onClick={() => setIsUploadDialogOpen(true)}>
                  <Upload className="h-4 w-4 ml-2" />
                  {t('employeeDocuments.uploadFirst')}
                </Button>
              </Card>
            ) : (
              <div className={viewMode === 'grid' ?
                "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" :
                "space-y-2"
              }>
                {filteredDocuments.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </motion.div>

          {/* Document Form Dialog */}
          <Dialog open={showDocumentForm} onOpenChange={(open) => !open && handleDocumentFormClose()}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingDocument ? t('documents.card.editDocument') : t('documents.addDocument')}</DialogTitle>
                <DialogDescription>
                  {editingDocument ? t('documents.form.editDescription') || 'Edit document details' : t('documents.employeeDocumentForm.description')}
                </DialogDescription>
              </DialogHeader>
              {(uploadedFile || editingDocument) && (
                <DocumentForm
                  uploadedFile={uploadedFile}
                  fileName={uploadedFileName}
                  onClose={handleDocumentFormClose}
                  onSuccess={handleDocumentSaved}
                  documentTypes={documentTypes}
                  companies={companies}
                  employees={employee ? [employee] : []}
                  ministries={ministries}
                  editingDocument={editingDocument}
                  preselectedEmployeeId={employeeId}
                />
              )}
            </DialogContent>
          </Dialog>

          {/* View Document Dialog */}
          <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>تفاصيل الوثيقة</DialogTitle>
                <DialogDescription>
                  عرض جميع بيانات الوثيقة
                </DialogDescription>
              </DialogHeader>
              {selectedDocument && (
                <div className="space-y-6">
                  {/* File Preview Section */}
                  {selectedDocument.file_path && (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <Label className="text-sm font-medium text-muted-foreground mb-2 block">معاينة الملف</Label>
                      {(() => {
                        const fileName = selectedDocument.file_name || '';
                        const isImage = /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName);
                        const isPdf = /\.pdf$/i.test(fileName);

                        if (isImage && selectedDocument.file_path) {
                          // Check if it's a base64 data URL or a regular file path
                          if (selectedDocument.file_path.startsWith('data:image')) {
                            return (
                              <div className="flex justify-center">
                                <img
                                  src={selectedDocument.file_path}
                                  alt={selectedDocument.title}
                                  className="max-w-full max-h-96 object-contain rounded border"
                                />
                              </div>
                            );
                          } else {
                            // File path reference - show placeholder since file doesn't exist
                            return (
                              <div className="text-center py-8 text-muted-foreground">
                                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                <p>⚠️ الملف غير متوفر على الخادم</p>
                                <p className="text-xs">مسار الملف: {selectedDocument.file_path}</p>
                                <p className="text-xs text-red-500">يرجى رفع الملف مرة أخرى</p>
                              </div>
                            );
                          }
                        } else if (isPdf && selectedDocument.file_path) {
                          if (selectedDocument.file_path.startsWith('data:application/pdf')) {
                            return (
                              <div className="text-center">
                                <iframe
                                  src={selectedDocument.file_path}
                                  className="w-full h-96 border rounded"
                                  title={selectedDocument.title}
                                />
                                <p className="text-sm text-muted-foreground mt-2">
                                  ملف PDF - اضغط على تحميل لعرضه بطريقة أفضل
                                </p>
                              </div>
                            );
                          } else {
                            return (
                              <div className="text-center py-8 text-muted-foreground">
                                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                <p>⚠️ ملف PDF غير متوفر على الخادم</p>
                                <p className="text-xs">مسار الملف: {selectedDocument.file_path}</p>
                                <p className="text-xs text-red-500">يرجى رفع الملف مرة أخرى</p>
                              </div>
                            );
                          }
                        } else {
                          return (
                            <div className="text-center py-8 text-muted-foreground">
                              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                              <p>معاينة الملف غير متوفرة لهذا النوع</p>
                              <p className="text-xs">{fileName}</p>
                            </div>
                          );
                        }
                      })()}
                    </div>
                  )}

                  {/* Document Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">العنوان</Label>
                      <p className="text-sm font-medium">{selectedDocument.title}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">نوع الوثيقة</Label>
                      <p className="text-sm">{selectedDocument.document_types?.name_ar}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">الحالة</Label>
                      <StatusBadge status={calculateDocumentStatus(selectedDocument.expiry_date)} />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">اسم الملف</Label>
                      <p className="text-sm">{selectedDocument.file_name || 'غير متوفر'}</p>
                    </div>
                    {selectedDocument.issue_date && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">تاريخ الإصدار</Label>
                        <p className="text-sm">{new Date(selectedDocument.issue_date).toLocaleDateString('en-GB').replace(/\//g, '-')}</p>
                      </div>
                    )}
                    {selectedDocument.expiry_date && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">تاريخ انتهاء الصلاحية</Label>
                        <p className="text-sm">{new Date(selectedDocument.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB').replace(/\//g, '-')}</p>
                      </div>
                    )}
                    {selectedDocument.ministries && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">الوزارة</Label>
                        <p className="text-sm">{selectedDocument.ministries.name_ar}</p>
                      </div>
                    )}
                    {selectedDocument.notes && (
                      <div className="md:col-span-2">
                        <Label className="text-sm font-medium text-muted-foreground">ملاحظات</Label>
                        <p className="text-sm">{selectedDocument.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button
                      onClick={() => handleDownloadDocument(selectedDocument)}
                      className="flex-1"
                    >
                      <Download className="h-4 w-4 ml-2" />
                      تحميل الوثيقة
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsViewDialogOpen(false)}
                    >
                      إغلاق
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Photo Upload Dialog */}
          <Dialog open={isPhotoUploadOpen} onOpenChange={setIsPhotoUploadOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>رفع صورة الموظف</DialogTitle>
                <DialogDescription>
                  اختر صورة للموظف {employee.name}
                </DialogDescription>
              </DialogHeader>
              <UploadDropzone
                onFilesAccepted={handlePhotoUpload}
                maxFiles={1}
                maxFileSize={5 * 1024 * 1024} // 5MB
                acceptedFileTypes={['image/*']}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center"
              />
              <div className="text-xs text-muted-foreground text-center">
                حجم الصورة الأقصى: 5 ميجابايت • الصيغ المدعومة: JPG, PNG, GIF
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </Layout>
    );
  }
