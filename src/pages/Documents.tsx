import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { jsonDatabase } from '@/lib/jsonDatabase';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { calculateDocumentStatus } from '@/lib/statusUtils';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { DocumentForm } from '@/components/DocumentForm';
import { FileText, Plus, Search, Filter, Download, Trash2, Eye, Edit, Upload, Calendar, Building2, User, Grid, List, MoreVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmployeeCard } from '@/components/EmployeeCard';
import { useLanguage } from '@/contexts/LanguageContext';
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
  employees?: {
    name: string;
    companies?: {
      name: string;
      name_ar: string;
      description?: string;
    };
  };
  companies?: {
    name: string;
    name_ar: string;
    description?: string;
  };
  document_types?: {
    name: string;
    name_ar: string;
  };
  ministries?: {
    name: string;
    name_ar: string;
  };
}
interface Company {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
}
interface Employee {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  hire_date?: string;
  company_id: string;
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
export default function Documents() {
  const { t, language } = useLanguage();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('company');
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showEmployeeDocuments, setShowEmployeeDocuments] = useState(false);
  const {
    toast
  } = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    fetchDocuments();
    fetchCompanies();
    fetchEmployees();
    fetchDocumentTypes();
    fetchMinistries();
  }, []);
  const fetchDocuments = async () => {
    try {
      const {
        data,
        error
      } = await jsonDatabase.from('documents').select(`
          *,
          employees (
            name,
            companies (
              name,
               name_ar
            )
          ),
          companies (
            name,
             name_ar
          ),
          document_types (
            name,
            name_ar
          ),
          ministries (
            name,
            name_ar
          )
        `).order('created_at', 'desc').execute();
      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل الوثائق',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };
  const fetchCompanies = async () => {
    try {
      const {
        data,
        error
      } = await jsonDatabase.from('companies').select('*').order('name', 'asc').execute();
      if (error) throw error;
      setCompanies(data || []);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };
  const fetchEmployees = async () => {
    try {
      const [employeesResult, documentsResult] = await Promise.all([
        jsonDatabase.from('employees').select(`
          *,
          companies (
            name,
            name_ar
          )
        `).order('name', 'asc').execute(),
        jsonDatabase.from('documents').select('*').execute()
      ]);
      
      if (employeesResult.error) throw employeesResult.error;
      if (documentsResult.error) throw documentsResult.error;

      const documents = documentsResult.data || [];
      
      // Calculate document count for each employee
      const employeesWithCounts = employeesResult.data?.map(employee => {
        const documentCount = documents.filter(doc => doc.employee_id === employee.id).length;
        
        return {
          ...employee,
          document_count: documentCount
        };
      }) || [];
      
      setEmployees(employeesWithCounts);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };
  const fetchDocumentTypes = async () => {
    try {
      const {
        data,
        error
      } = await jsonDatabase.from('document_types').select('*').order('name_ar', 'asc').execute();
      if (error) throw error;
      setDocumentTypes(data || []);
    } catch (error) {
      console.error('Error fetching document types:', error);
    }
  };
  const fetchMinistries = async () => {
    try {
      const {
        data,
        error
      } = await jsonDatabase.from('ministries').select('*').order('name_ar', 'asc').execute();
      if (error) throw error;
      setMinistries(data || []);
    } catch (error) {
      console.error('Error fetching ministries:', error);
    }
  };
  const filteredDocuments = useMemo(() => {
    let filtered = documents.filter(doc => {
      const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase()) || doc.document_types?.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) || doc.companies?.name.toLowerCase().includes(searchTerm.toLowerCase()) || doc.employees?.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = selectedStatus === 'all' || doc.status === selectedStatus;
      const matchesType = selectedType === 'all' || doc.document_type_id === selectedType;
      const matchesTab = activeTab === 'company' ? !!doc.company_id : !!doc.employee_id;
      return matchesSearch && matchesStatus && matchesType && matchesTab;
    });
    return filtered;
  }, [documents, searchTerm, selectedStatus, selectedType, activeTab]);
  // Dynamic company documents - group documents by company
  const documentsByCompany = useMemo(() => {
    const companyGroups: { [key: string]: Document[] } = {};

    companies.forEach(company => {
      companyGroups[company.name] = filteredDocuments.filter(doc =>
        doc.companies?.name === company.name || doc.employees?.companies?.name === company.name
      );
    });

    return companyGroups;
  }, [filteredDocuments, companies]);

  // Dynamic employee groups by company
  const employeesByCompany = useMemo(() => {
    const employeeGroups: { [key: string]: Employee[] } = {};

    companies.forEach(company => {
      employeeGroups[company.name] = employees.filter(emp =>
        companies.find(c => c.id === emp.company_id)?.name === company.name && emp.is_active !== false
      );
    });

    return employeeGroups;
  }, [employees, companies]);
  const toggleDocumentSelection = (docId: string) => {
    setSelectedDocuments(prev => prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]);
  };
  const selectAllDocuments = () => {
    setSelectedDocuments(filteredDocuments.map(doc => doc.id));
  };
  const clearSelection = () => {
    setSelectedDocuments([]);
  };
  const bulkDelete = async () => {
    if (!confirm(t('documents.bulk.deleteConfirm', { count: selectedDocuments.length }))) return;
    try {
      // Use the JSON database bulk delete functionality
      const errors = [];
      for (const docId of selectedDocuments) {
        const { error } = await jsonDatabase.delete('documents', docId);
        if (error) errors.push(error);
      }
      if (errors.length > 0) throw errors[0];
      toast({
        title: t('documents.messages.success'),
        description: t('documents.bulk.deleteSuccess', { count: selectedDocuments.length })
      });
      setSelectedDocuments([]);
      await Promise.all([fetchDocuments(), fetchEmployees()]);
    } catch (error) {
      console.error('Error deleting documents:', error);
      toast({
        title: t('documents.messages.error'),
        description: t('documents.bulk.deleteError'),
        variant: 'destructive'
      });
    }
  };
  const handleFilesAccepted = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0]; // Take the first file
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
    // Refresh documents list and employees (to update document counts)
    await Promise.all([fetchDocuments(), fetchEmployees()]);
  };

  const handleViewDocument = (doc: Document) => {
    setSelectedDocument(doc);
    setIsViewDialogOpen(true);
  };

  const handleEditDocument = (doc: Document) => {
    setEditingDocument(doc);
    setUploadedFile(null);
    setUploadedFileName(doc.file_name || '');
    setShowDocumentForm(true);
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه الوثيقة؟')) return;

    try {
      const { error } = await jsonDatabase.delete('documents', docId);

      if (error) throw error;

      toast({
        title: 'تم بنجاح',
        description: 'تم حذف الوثيقة بنجاح'
      });

      await Promise.all([fetchDocuments(), fetchEmployees()]);
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في حذف الوثيقة',
        variant: 'destructive'
      });
    }
  };

  const handleDownloadDocument = async (doc: Document) => {
    if (!doc.file_path) {
      toast({
        title: 'خطأ',
        description: 'لا يوجد ملف للتحميل',
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
        title: 'تم بنجاح',
        description: 'تم تحميل الوثيقة بنجاح'
      });
    } catch (error) {
      console.error('Error downloading document:', error);
      toast({
        title: t('documents.messages.error'),
        description: t('documents.messages.downloadError'),
        variant: 'destructive'
      });
    }
  };
  const DocumentCard = ({
    doc
  }: {
    doc: Document;
  }) => {
    const isImage = doc.file_path?.startsWith('data:image');
    const isPdf = doc.file_path?.startsWith('data:application/pdf');
    
    return <Card className="group hover:shadow-elegant transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-3 left-3 z-10">
        <Checkbox checked={selectedDocuments.includes(doc.id)} onCheckedChange={() => toggleDocumentSelection(doc.id)} className="bg-background border-2" />
      </div>
      
      {/* Thumbnail Preview */}
      <div className="relative w-full h-32 bg-muted flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img src={doc.file_path!} alt={doc.title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center text-muted-foreground">
            <FileText className="h-10 w-10 mb-1 opacity-50" />
            <span className="text-xs">{isPdf ? 'PDF' : t('documents.card.noPreview') || 'No Preview'}</span>
          </div>
        )}
      </div>

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg font-semibold line-clamp-2 pr-8">
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
          <Badge variant="outline" className="text-xs">
            {activeTab === 'company' ? doc.companies?.name : doc.employees?.name}
          </Badge>
        </div>
        
        {doc.expiry_date && <div className="flex items-center text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 ml-2" />
            <span>{t('documents.card.expiresOn')} {new Date(doc.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}</span>
          </div>}
        
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex space-x-1">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => handleViewDocument(doc)}
              title={t('documents.card.viewDocument')}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => handleEditDocument(doc)}
              title={t('documents.card.editDocument')}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => handleDownloadDocument(doc)}
              title={t('documents.card.downloadDocument')}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => handleDeleteDocument(doc.id)}
              title={t('documents.card.deleteDocument')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>;
  const CompanySection = ({
    title,
    docs,
    companyName
  }: {
    title: string;
    docs: Document[];
    companyName: string;
  }) => {
    const company = companies.find(c => c.name === companyName);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center space-x-2">
            <Building2 className="h-5 w-5 ml-2" />
            <span>{title}</span>
            <Badge variant="secondary">{docs.length}</Badge>
          </h3>
          {company && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/documents/company/${company.id}`)}
              className="flex items-center space-x-2"
            >
              <Eye className="h-4 w-4" />
              <span>{t('documents.company.viewAllCompanyDocuments')}</span>
            </Button>
          )}
        </div>

        {docs.length === 0 ? (
          <Card className="p-8 text-center cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => company && navigate(`/documents/company/${company.id}`)}>
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">{t('documents.company.noDocumentsInSection')}</p>
            <p className="text-xs text-muted-foreground mt-2">{t('documents.company.clickToGoToCompanyPage')}</p>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className={viewMode === 'grid' ?
              "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" :
              "space-y-2"}>
              {docs.slice(0, 4).map(doc => <DocumentCard key={doc.id} doc={doc} />)}
            </div>
            {docs.length > 4 && (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={() => company && navigate(`/documents/company/${company.id}`)}
                >
                  {t('documents.company.viewAllDocuments', { count: docs.length })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const EmployeeSection = ({
    title,
    companyName,
    employees: sectionEmployees
  }: {
    title: string;
    companyName: string;
    employees: Employee[];
  }) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center space-x-2">
          <User className="h-5 w-5 ml-2" />
          <span>{title}</span>
          <Badge variant="secondary">{sectionEmployees.length}</Badge>
        </h3>
      </div>
      
      {sectionEmployees.length === 0 ? (
        <Card className="p-8 text-center">
          <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">{t('documents.employee.noEmployeesInSection')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sectionEmployees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onViewDocuments={(employeeId) => {
                navigate(`/documents/employee/${employeeId}`);
              }}
              onViewProfile={(emp) => console.log('View profile:', emp)}
            />
          ))}
        </div>
      )}
    </div>
  );
  if (isLoading) {
    return <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
        </div>
      </Layout>;
  }
  return <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient text-slate-950">{t('documents.title')}</h1>
            <p className="text-muted-foreground">
              {t('documents.viewAndManage', { count: documents.length })}
            </p>
          </div>
          
          <div className="flex gap-2">
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-elegant hover:shadow-glow transition-all">
                  <Upload className="h-4 w-4 ml-2" />
                  {t('documents.uploadDocuments')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t('documents.uploadNew')}</DialogTitle>
                  <DialogDescription>
                    {t('documents.chooseFiles')}
                  </DialogDescription>
                </DialogHeader>
                <UploadDropzone onFilesAccepted={handleFilesAccepted} maxFiles={20} maxFileSize={50 * 1024 * 1024} // 50MB
              />
              </DialogContent>
            </Dialog>
          </div>
        </motion.div>

        {/* Filters */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.1
      }}>
          <Card className="shadow-soft">
            <CardContent className="p-6">
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="search">{t('documents.search')}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input id="search" placeholder={t('documents.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
                  </div>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t('documents.status')}</Label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.status')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('documents.statusOptions.all')}</SelectItem>
                      <SelectItem value="valid">{t('documents.statusOptions.valid')}</SelectItem>
                      <SelectItem value="expiring_soon">{t('documents.statusOptions.expiringSoon')}</SelectItem>
                      <SelectItem value="expired">{t('documents.statusOptions.expired')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t('documents.documentType')}</Label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.documentType')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('documents.allTypes')}</SelectItem>
                      {documentTypes.map(type => <SelectItem key={type.id} value={type.id}>
                          {language === 'ar' ? type.name_ar : type.name}
                        </SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-end space-x-2">
                  <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('grid')}>
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('list')}>
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Bulk Actions */}
        {selectedDocuments.length > 0 && <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.2
      }}>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className="text-sm font-medium">
                      {t('documents.bulk.selected', { count: selectedDocuments.length })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      {t('documents.bulk.clearSelection')}
                    </Button>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4 ml-1" />
                      {t('documents.bulk.download')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={bulkDelete}>
                      <Trash2 className="h-4 w-4 ml-1" />
                      {t('documents.bulk.delete')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>}

        {/* Main Content */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.3
      }}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center justify-between mb-6">
              <TabsList className="grid w-fit grid-cols-2">
                <TabsTrigger value="company" className="flex items-center space-x-2">
                  <Building2 className="h-4 w-4 ml-1" />
                  <span>{t('documents.tabs.companyDocuments')}</span>
                </TabsTrigger>
                <TabsTrigger value="employee" className="flex items-center space-x-2">
                  <User className="h-4 w-4 ml-1" />
                  <span>{t('documents.tabs.employeeDocuments')}</span>
                </TabsTrigger>
              </TabsList>
              
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={selectAllDocuments}>
                  {t('documents.bulk.selectAll', { count: filteredDocuments.length })}
                </Button>
              </div>
            </div>
            
            <TabsContent value="company" className="space-y-8">
              {companies.map((company) => (
                <CompanySection
                  key={company.id}
                  title={company.name_ar || company.name}
                  docs={documentsByCompany[company.name] || []}
                  companyName={company.name}
                />
              ))}
              {companies.length === 0 && (
                <div className="text-center py-12">
                  <Building2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">{t('documents.empty.noCompanies')}</p>
                  <p className="text-sm text-muted-foreground mt-2">{t('documents.empty.noCompaniesSubtext')}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="employee" className="space-y-8">
              {companies.map((company) => (
                <EmployeeSection
                  key={company.id}
                  title={t('documents.company.employees', { company: company.name_ar || company.name })}
                  companyName={company.name}
                  employees={employeesByCompany[company.name] || []}
                />
              ))}
              {companies.length === 0 && (
                <div className="text-center py-12">
                  <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">{t('documents.empty.noEmployees')}</p>
                  <p className="text-sm text-muted-foreground mt-2">{t('documents.empty.noEmployeesSubtext')}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Document Form Dialog */}
        {showDocumentForm && (uploadedFile || editingDocument) &&
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <DocumentForm
                uploadedFile={uploadedFile}
                fileName={uploadedFileName}
                onClose={handleDocumentFormClose}
                onSuccess={handleDocumentSaved}
                documentTypes={documentTypes}
                companies={companies}
                employees={employees}
                ministries={ministries}
                editingDocument={editingDocument}
              />
            </div>
          </div>
        }

        {/* View Document Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>تفاصيل الوثيقة</DialogTitle>
              <DialogDescription>
                عرض جميع بيانات الوثيقة
              </DialogDescription>
            </DialogHeader>
            {selectedDocument && (
              <div className="space-y-4">
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
                      <p className="text-sm">{new Date(selectedDocument.issue_date).toLocaleDateString('en-GB')}</p>
                    </div>
                  )}
                  {selectedDocument.expiry_date && (
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">تاريخ انتهاء الصلاحية</Label>
                      <p className="text-sm">{new Date(selectedDocument.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}</p>
                    </div>
                  )}
                  {selectedDocument.companies && (
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">الشركة</Label>
                      <p className="text-sm">{selectedDocument.companies.name}</p>
                    </div>
                  )}
                  {selectedDocument.employees && (
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">الموظف</Label>
                      <p className="text-sm">{selectedDocument.employees.name}</p>
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

        {/* Employee Documents View */}
        {showEmployeeDocuments && selectedEmployee && (
          <div className="fixed inset-0 bg-background z-50 overflow-auto">
            <div className="p-6 space-y-6">
              {/* Header with back button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowEmployeeDocuments(false)}
                    className="flex items-center space-x-2"
                  >
                    <span>←</span>
                    <span>العودة</span>
                  </Button>
                  <div>
                    <h1 className="text-3xl font-bold text-gradient">وثائق {selectedEmployee.name}</h1>
                    <p className="text-muted-foreground">
                      {selectedEmployee.position} - {selectedEmployee.companies?.name}
                    </p>
                  </div>
                </div>
                <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="shadow-elegant hover:shadow-glow transition-all">
                      <Plus className="h-4 w-4 ml-2" />
                      إضافة وثيقة جديدة
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>إضافة وثيقة جديدة للموظف</DialogTitle>
                      <DialogDescription>
                        اختر الملف الذي تريد رفعه لـ {selectedEmployee.name}
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

              {/* Employee Documents */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">وثائق الموظف</h3>
                {(() => {
                  const employeeDocuments = documents.filter(doc => doc.employee_id === selectedEmployee.id);
                  return employeeDocuments.length === 0 ? (
                    <Card className="p-8 text-center">
                      <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">لا توجد وثائق لهذا الموظف</p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {employeeDocuments.map(doc => (
                        <DocumentCard key={doc.id} doc={doc} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>;
}