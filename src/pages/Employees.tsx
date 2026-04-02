import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { jsonDatabase } from '@/lib/jsonDatabase';
import { Layout } from '@/components/Layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateInput } from '@/components/ui/date-input';
import {
  Users,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Calendar,
  Building2,
  UserCheck,
  FileText,
  ChevronUp,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileJson,
  User
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';


interface Employee {
  id: string;
  name: string;
  email?: string;
  mobile_no?: string;
  position?: string;
  hire_date?: string;
  birth_date?: string;
  civil_id_no?: string;
  residency_expiry_date?: string;
  residency_status?: 'expired' | 'less_than_week' | 'less_than_month' | 'valid';
  driving_license?: boolean;
  driving_license_expiry_date?: string;
  driving_license_status?: 'expired' | 'less_than_week' | 'less_than_month' | 'valid';
  document_count?: number;
  company_id: string;
  created_at: string;
  is_active?: boolean;
  companies?: {
    name: string;
    name_ar: string;
  };
}

interface Company {
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

type SortField = 'name' | 'position' | 'hire_date' | 'birth_date' | 'civil_id_no' | 'mobile_no' | 'residency_expiry_date';
type SortDirection = 'asc' | 'desc';

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { toast } = useToast();
  const { t, language, isRTL } = useLanguage();
  const navigate = useNavigate();

  // Essential functions
  const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB'); // dd/mm/yyyy format
  };

  const formatDateForInput = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />;
  };

  const handleAddEmployee = async () => {
    if (!formData.name.trim() || !formData.company_id) {
      toast({
        title: t('employees.messages.error'),
        description: t('employees.messages.requiredFields') || 'Name and company are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { data, error } = await jsonDatabase.insert('employees', {
        name: formData.name,
        email: formData.email || undefined,
        mobile_no: formData.mobile_no || undefined,
        position: formData.position || undefined,
        hire_date: formData.hire_date || undefined,
        birth_date: formData.birth_date || undefined,
        civil_id_no: formData.civil_id_no || undefined,
        residency_expiry_date: formData.residency_expiry_date || undefined,
        driving_license: formData.driving_license,
        driving_license_expiry_date: formData.driving_license ? formData.driving_license_expiry_date || undefined : undefined,
        company_id: formData.company_id,
        is_active: formData.is_active,
      });

      if (error) throw error;

      // Add to local state with company info
      const company = companies.find(c => c.id === formData.company_id);
      const newEmployee = {
        ...data![0],
        companies: company ? { name: company.name, name_ar: company.name_ar } : undefined,
        document_count: 0,
      };
      setEmployees(prev => [...prev, newEmployee]);

      toast({
        title: t('employees.messages.addSuccess') || 'Success',
        description: formData.name,
      });

      setIsAddDialogOpen(false);
      setFormData({
        name: '', email: '', mobile_no: '', position: '', hire_date: '',
        birth_date: '', civil_id_no: '', residency_expiry_date: '',
        driving_license: false, driving_license_expiry_date: '',
        company_id: '', is_active: true,
      });
    } catch (error) {
      console.error('Error adding employee:', error);
      toast({
        title: t('employees.messages.error'),
        description: t('employees.messages.addError') || 'Failed to add employee',
        variant: 'destructive',
      });
    }
  };

  const handleEditEmployee = async () => {
    if (!selectedEmployee || !formData.name.trim() || !formData.company_id) {
      toast({
        title: t('employees.messages.error'),
        description: t('employees.messages.requiredFields') || 'Name and company are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { data, error } = await jsonDatabase.update('employees', selectedEmployee.id, {
        name: formData.name,
        email: formData.email || undefined,
        mobile_no: formData.mobile_no || undefined,
        position: formData.position || undefined,
        hire_date: formData.hire_date || undefined,
        birth_date: formData.birth_date || undefined,
        civil_id_no: formData.civil_id_no || undefined,
        residency_expiry_date: formData.residency_expiry_date || undefined,
        driving_license: formData.driving_license,
        driving_license_expiry_date: formData.driving_license ? formData.driving_license_expiry_date || undefined : undefined,
        company_id: formData.company_id,
        is_active: formData.is_active,
      });

      if (error) throw error;

      // Update local state
      const company = companies.find(c => c.id === formData.company_id);
      setEmployees(prev => prev.map(emp =>
        emp.id === selectedEmployee.id
          ? {
              ...emp,
              ...data,
              companies: company ? { name: company.name, name_ar: company.name_ar } : emp.companies,
            }
          : emp
      ));

      toast({
        title: t('employees.messages.editSuccess') || 'Success',
        description: formData.name,
      });

      setIsEditDialogOpen(false);
      setSelectedEmployee(null);
    } catch (error) {
      console.error('Error updating employee:', error);
      toast({
        title: t('employees.messages.error'),
        description: t('employees.messages.editError') || 'Failed to update employee',
        variant: 'destructive',
      });
    }
  };

  const handleViewEmployee = (employee: Employee) => {
    setViewEmployee(employee);
    setIsViewDialogOpen(true);
  };

  const handleViewDocuments = (employeeId: string) => {
    navigate(`/documents/employee/${employeeId}`);
  };

  const handleDelete = async (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    const confirmDelete = window.confirm(
      `${t('employees.messages.deleteConfirm')}\n\n${employee.name}`
    );

    if (!confirmDelete) return;

    try {
      const { error } = await jsonDatabase.delete('employees', employeeId);

      if (error) {
        toast({
          title: t('employees.messages.error'),
          description: t('employees.messages.deleteError'),
          variant: 'destructive',
        });
        return;
      }

      // Update local state
      setEmployees(prev => prev.filter(e => e.id !== employeeId));

      toast({
        title: t('employees.messages.deleteSuccess'),
        description: `${employee.name}`,
      });
    } catch (error) {
      console.error('Error deleting employee:', error);
      toast({
        title: t('employees.messages.error'),
        description: t('employees.messages.deleteError'),
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormData({
      name: employee.name,
      email: employee.email || '',
      mobile_no: employee.mobile_no || '',
      position: employee.position || '',
      hire_date: formatDateForInput(employee.hire_date || ''),
      birth_date: formatDateForInput(employee.birth_date || ''),
      civil_id_no: employee.civil_id_no || '',
      residency_expiry_date: formatDateForInput(employee.residency_expiry_date || ''),
      driving_license: employee.driving_license || false,
      driving_license_expiry_date: formatDateForInput(employee.driving_license_expiry_date || ''),
      company_id: employee.company_id,
      is_active: employee.is_active !== undefined ? employee.is_active : true
    });
    setIsEditDialogOpen(true);
  };

  const calculateResidencyStatus = (expiryDate: string | undefined): 'expired' | 'less_than_week' | 'less_than_month' | 'valid' | undefined => {
    if (!expiryDate) return undefined;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays <= 7) return 'less_than_week';
    if (diffDays <= 30) return 'less_than_month';
    return 'valid';
  };

  const calculateDrivingLicenseStatus = (expiryDate: string | undefined): 'expired' | 'less_than_week' | 'less_than_month' | 'valid' | undefined => {
    if (!expiryDate) return undefined;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays <= 7) return 'less_than_week';
    if (diffDays <= 30) return 'less_than_month';
    return 'valid';
  };

  const getResidencyStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'expired':
        return <Badge className="bg-red-500 text-white">{t('employees.status.expired')}</Badge>;
      case 'less_than_week':
        return <Badge className="bg-orange-500 text-white">{t('employees.status.lessThanWeek')}</Badge>;
      case 'less_than_month':
        return <Badge className="bg-yellow-500 text-white">{t('employees.status.lessThanMonth')}</Badge>;
      case 'valid':
        return <Badge className="bg-green-500 text-white">{t('employees.status.valid')}</Badge>;
      default:
        return <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>;
    }
  };

  const getDrivingLicenseStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'expired':
        return <Badge className="bg-red-500 text-white">{t('employees.status.expired')}</Badge>;
      case 'less_than_week':
        return <Badge className="bg-orange-500 text-white">{t('employees.status.lessThanWeek')}</Badge>;
      case 'less_than_month':
        return <Badge className="bg-yellow-500 text-white">{t('employees.status.lessThanMonth')}</Badge>;
      case 'valid':
        return <Badge className="bg-green-500 text-white">{t('employees.status.valid')}</Badge>;
      default:
        return <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>;
    }
  };

  // Filtered and sorted employees
  const filteredAndSortedEmployees = useMemo(() => {
    let filtered = employees.filter(employee => {
      const matchesSearch = employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        employee.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        employee.mobile_no?.includes(searchTerm) ||
        employee.position?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCompany = selectedCompany === 'all' || employee.company_id === selectedCompany;

      return matchesSearch && matchesCompany;
    });

    return filtered.sort((a, b) => {
      let aValue = a[sortField] || '';
      let bValue = b[sortField] || '';

      if (sortDirection === 'desc') {
        [aValue, bValue] = [bValue, aValue];
      }

      return String(aValue).localeCompare(String(bValue));
    });
  }, [employees, searchTerm, selectedCompany, sortField, sortDirection]);

  // Load data on component mount
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch employees with company information
        const { data: employeesData, error: employeesError } = await jsonDatabase
          .from('employees')
          .select('*')
          .execute();

        // Fetch companies
        const { data: companiesData, error: companiesError } = await jsonDatabase
          .from('companies')
          .execute();

        // Fetch positions
        const { data: positionsData, error: positionsError } = await jsonDatabase
          .from('positions')
          .execute();

        if (employeesError) {
          console.error('Error fetching employees:', employeesError);
          toast({
            title: "خطأ",
            description: "فشل في تحميل بيانات الموظفين",
            variant: "destructive",
          });
        } else {
          // Transform employees data to match interface
          const transformedEmployees = (employeesData || []).map((emp: any) => ({
            ...emp,
            email: emp.email || '',
            mobile_no: emp.mobile_no || emp.phone || '',
            is_active: emp.is_active !== undefined ? emp.is_active : true,
            document_count: 0, // Will be calculated separately
            // Ensure company object is populated
            companies: emp.companies || (companiesData || []).find(c => c.id === emp.company_id),
          }));
          setEmployees(transformedEmployees);
        }

        if (companiesError) {
          console.error('Error fetching companies:', companiesError);
        } else {
          setCompanies(companiesData || []);
        }

        if (positionsError) {
          console.error('Error fetching positions:', positionsError);
        } else {
          setPositions(positionsData || []);
        }

      } catch (error) {
        console.error('Error loading data:', error);
        toast({
          title: "خطأ",
          description: "فشل في تحميل البيانات",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast]);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile_no: '',
    position: '',
    hire_date: '',
    birth_date: '',
    civil_id_no: '',
    residency_expiry_date: '',
    driving_license: false,
    driving_license_expiry_date: '',
    company_id: '',
    is_active: true
  });

  return (
    <Layout>
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gradient">{t('employees.title')}</h1>
              <p className="text-muted-foreground">
                {t('employees.stats.total')}: {employees.length}
              </p>
            </div>

            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="shadow-soft hover:shadow-elegant transition-all">
                    <Download className="h-4 w-4 ml-2" />
                    {t('employees.exportData')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { }}>
                    <FileSpreadsheet className="h-4 w-4 ml-2" />
                    {t('employees.exportCSV')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { }}>
                    <FileJson className="h-4 w-4 ml-2" />
                    {t('employees.exportJSON')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="shadow-elegant hover:shadow-glow transition-all">
                    <Plus className="h-4 w-4 ml-2" />
                    {t('employees.addEmployee')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{t('employees.dialog.addTitle')}</DialogTitle>
                    <DialogDescription>
                      {t('employees.dialog.addDescription')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">{t('employees.dialog.fields.name')}</Label>
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="company_id">{t('employees.dialog.fields.company')}</Label>
                        <Select
                          value={formData.company_id}
                          onValueChange={(value) => setFormData({ ...formData, company_id: value })}
                          required
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('employees.dialog.fields.selectCompany')} />
                          </SelectTrigger>
                          <SelectContent>
                            {companies.map((company) => (
                              <SelectItem key={company.id} value={company.id}>
                                {company.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="position">{t('employees.dialog.fields.position')}</Label>
                        <Select
                          value={formData.position}
                          onValueChange={(value) => setFormData({ ...formData, position: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('employees.dialog.fields.selectPosition')} />
                          </SelectTrigger>
                          <SelectContent>
                            {positions.map((position) => (
                              <SelectItem key={position.id} value={position.value}>
                                {language === 'ar' ? position.name_ar : position.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="email">{t('employees.dialog.fields.email')}</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="mobile_no">{t('employees.dialog.fields.mobileNo')}</Label>
                        <Input
                          id="mobile_no"
                          value={formData.mobile_no}
                          onChange={(e) => setFormData({ ...formData, mobile_no: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="birth_date">{t('employees.dialog.fields.birthDate')}</Label>
                        <DateInput
                          value={formData.birth_date}
                          onChange={(value) => setFormData({ ...formData, birth_date: value })}
                          name="birth_date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="civil_id_no">{t('employees.dialog.fields.civilId')}</Label>
                        <Input
                          id="civil_id_no"
                          value={formData.civil_id_no}
                          onChange={(e) => setFormData({ ...formData, civil_id_no: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="residency_expiry_date">{t('employees.dialog.fields.residencyExpiry')}</Label>
                        <DateInput
                          value={formData.residency_expiry_date}
                          onChange={(value) => setFormData({ ...formData, residency_expiry_date: value })}
                          name="residency_expiry_date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="hire_date">{t('employees.dialog.fields.hireDate')}</Label>
                        <DateInput
                          value={formData.hire_date}
                          onChange={(value) => setFormData({ ...formData, hire_date: value })}
                          name="hire_date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="add-driving_license">{t('employees.dialog.fields.drivingLicense')}</Label>
                        <div className="flex items-center space-x-3 mt-2 p-3 border rounded-md">
                          <Switch
                            id="add-driving_license"
                            checked={formData.driving_license}
                            onCheckedChange={(checked) => setFormData({ ...formData, driving_license: checked })}
                          />
                          <span className={`text-sm font-medium ${formData.driving_license ? 'text-green-600' : 'text-gray-500'}`}>
                            {formData.driving_license ? t('employees.dialog.fields.validLicense') : t('employees.dialog.fields.invalidLicense')}
                          </span>
                        </div>
                      </div>
                      {formData.driving_license && (
                        <div>
                          <Label htmlFor="driving_license_expiry_date">{t('employees.dialog.fields.drivingLicenseExpiry')}</Label>
                          <DateInput
                            value={formData.driving_license_expiry_date}
                            onChange={(value) => setFormData({ ...formData, driving_license_expiry_date: value })}
                            name="driving_license_expiry_date"
                          />
                        </div>
                      )}
                      <div>
                        <Label htmlFor="document_count">{t('employees.dialog.fields.documentCount')}</Label>
                        <div className="flex items-center space-x-2 p-3 bg-muted/30 border rounded-md">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{t('employees.dialog.fields.willUpdateAfterAdd')}</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="add-is_active">{t('employees.dialog.fields.employeeStatus')}</Label>
                        <div className="flex items-center space-x-3 mt-2 p-3 border rounded-md">
                          <Switch
                            id="add-is_active"
                            checked={formData.is_active}
                            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                          />
                          <span className={`text-sm font-medium ${formData.is_active ? 'text-green-600' : 'text-red-600'}`}>
                            {formData.is_active ? t('employees.status.active') : t('employees.status.inactive')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-4">
                      <Button onClick={handleAddEmployee} className="flex-1">
                        {t('employees.dialog.buttons.add')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                        {t('employees.dialog.buttons.cancel')}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </motion.div>

        {/* Filters and Search */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="shadow-soft">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="search">{t('employees.search')}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder={t('employees.searchPlaceholder')}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="w-full sm:w-48">
                  <Label htmlFor="company-filter">{t('employees.filterByCompany')}</Label>
                  <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('employees.allCompanies')}</SelectItem>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Employees Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="shadow-elegant">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="w-[70px] text-start">#</TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.name')}</span>
                          {getSortIcon('name')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('position')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.position')}</span>
                          {getSortIcon('position')}
                        </div>
                      </TableHead>
                      <TableHead>{t('employees.table.company')}</TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('mobile_no')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.form.mobileNo')}</span>
                          {getSortIcon('mobile_no')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('civil_id_no')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.civilId')}</span>
                          {getSortIcon('civil_id_no')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('birth_date')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.birthDate')}</span>
                          {getSortIcon('birth_date')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('hire_date')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.hireDate')}</span>
                          {getSortIcon('hire_date')}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => handleSort('residency_expiry_date')}
                      >
                        <div className="flex items-center space-x-2">
                          <span>{t('employees.table.residencyExpiry')}</span>
                          {getSortIcon('residency_expiry_date')}
                        </div>
                      </TableHead>
                      <TableHead>{t('employees.table.residencyStatus')}</TableHead>
                      <TableHead>{t('employees.table.drivingLicense')}</TableHead>
                      <TableHead>{t('employees.status.licenseStatus')}</TableHead>
                      <TableHead>{t('employees.table.documents')}</TableHead>
                      <TableHead>{t('employees.table.status')}</TableHead>
                      <TableHead>{t('employees.table.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedEmployees.map((employee, index) => (
                      <TableRow key={employee.id} className="hover:bg-accent/30 transition-colors">
                        <TableCell className="text-start font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{employee.name}</div>
                            <div className="text-sm text-muted-foreground">{employee.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {employee.position && (
                            <Badge variant="outline">{employee.position}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span>{employee.companies?.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {employee.mobile_no ? (
                            <div className="flex items-center space-x-2">
                              <span>{employee.mobile_no}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {employee.civil_id_no ? (
                            <div className="flex items-center space-x-2">
                              <UserCheck className="h-4 w-4 text-muted-foreground" />
                              <span>{employee.civil_id_no}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {employee.birth_date ? (
                            <div className="flex items-center space-x-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span>{formatDateForDisplay(employee.birth_date)}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {employee.hire_date ? (
                            <div className="flex items-center space-x-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span>{formatDateForDisplay(employee.hire_date)}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {employee.residency_expiry_date ? (
                            <div className="flex items-center space-x-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className={`${new Date(employee.residency_expiry_date) < new Date() ? 'text-red-500' : new Date(employee.residency_expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? 'text-orange-500' : 'text-green-600'}`}>
                                {formatDateForDisplay(employee.residency_expiry_date)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getResidencyStatusBadge(calculateResidencyStatus(employee.residency_expiry_date))}
                        </TableCell>
                        <TableCell>
                          {employee.driving_license ? (
                            employee.driving_license_expiry_date ? (
                              <div className="flex items-center space-x-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className={`${new Date(employee.driving_license_expiry_date) < new Date() ? 'text-red-500' : new Date(employee.driving_license_expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? 'text-orange-500' : 'text-green-600'}`}>
                                  {formatDateForDisplay(employee.driving_license_expiry_date)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{t('employees.status.dateUndefined')}</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">{t('employees.status.noLicense')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {employee.driving_license && employee.driving_license_expiry_date
                            ? getDrivingLicenseStatusBadge(calculateDrivingLicenseStatus(employee.driving_license_expiry_date))
                            : <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>
                          }
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              {employee.document_count || 0}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={employee.is_active !== false ? "default" : "destructive"}
                            className={employee.is_active !== false ? "bg-blue-500 hover:bg-blue-600" : "bg-red-500 hover:bg-red-600"}
                          >
                            {employee.is_active !== false ? t('employees.status.active').replace(' ✓', '') : t('employees.status.inactive').replace(' ✗', '')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewEmployee(employee)}
                              title={t('employees.profile.title')}
                              className="hover:bg-primary hover:text-primary-foreground"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewDocuments(employee.id)}
                              title={t('employees.profile.viewDocuments')}
                              className="hover:bg-blue-600 hover:text-white"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(employee)}
                              title={t('employees.actions.edit')}
                              className="hover:bg-accent"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(employee.id)}
                              className="hover:bg-destructive hover:text-destructive-foreground"
                              title={t('employees.actions.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('employees.dialog.editTitle')}</DialogTitle>
              <DialogDescription>
                {t('employees.dialog.editDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div>
                <Label htmlFor="edit-name">{t('employees.dialog.fields.name')}</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-company_id">{t('employees.dialog.fields.company')}</Label>
                <Select
                  value={formData.company_id}
                  onValueChange={(value) => setFormData({ ...formData, company_id: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('employees.dialog.fields.selectCompany')} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-position">{t('employees.dialog.fields.position')}</Label>
                <Select
                  value={formData.position}
                  onValueChange={(value) => setFormData({ ...formData, position: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('employees.dialog.fields.selectPosition')} />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.map((position) => (
                      <SelectItem key={position.id} value={position.value}>
                        {language === 'ar' ? position.name_ar : position.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-email">{t('employees.dialog.fields.email')}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-mobile_no">{t('employees.dialog.fields.mobileNo')}</Label>
                <Input
                  id="edit-mobile_no"
                  value={formData.mobile_no}
                  onChange={(e) => setFormData({ ...formData, mobile_no: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-birth_date">{t('employees.dialog.fields.birthDate')}</Label>
                <DateInput
                  value={formData.birth_date}
                  onChange={(value) => setFormData({ ...formData, birth_date: value })}
                  name="edit-birth_date"
                />
              </div>
              <div>
                <Label htmlFor="edit-civil_id_no">{t('employees.dialog.fields.civilId')}</Label>
                <Input
                  id="edit-civil_id_no"
                  value={formData.civil_id_no}
                  onChange={(e) => setFormData({ ...formData, civil_id_no: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-residency_expiry_date">{t('employees.dialog.fields.residencyExpiry')}</Label>
                <DateInput
                  value={formData.residency_expiry_date}
                  onChange={(value) => setFormData({ ...formData, residency_expiry_date: value })}
                  name="edit-residency_expiry_date"
                />
              </div>
              <div>
                <Label htmlFor="edit-hire_date">{t('employees.dialog.fields.hireDate')}</Label>
                <DateInput
                  value={formData.hire_date}
                  onChange={(value) => setFormData({ ...formData, hire_date: value })}
                  name="edit-hire_date"
                />
              </div>
              <div>
                <Label htmlFor="edit-driving_license">{t('employees.dialog.fields.drivingLicense')}</Label>
                <div className="flex items-center space-x-3 mt-2 p-3 border rounded-md">
                  <Switch
                    id="edit-driving_license"
                    checked={formData.driving_license}
                    onCheckedChange={(checked) => setFormData({ ...formData, driving_license: checked })}
                  />
                  <span className={`text-sm font-medium ${formData.driving_license ? 'text-green-600' : 'text-gray-500'}`}>
                    {formData.driving_license ? t('employees.dialog.fields.validLicense') : t('employees.dialog.fields.invalidLicense')}
                  </span>
                </div>
              </div>
              {formData.driving_license && (
                <div>
                  <Label htmlFor="edit-driving_license_expiry_date">{t('employees.dialog.fields.drivingLicenseExpiry')}</Label>
                  <DateInput
                    value={formData.driving_license_expiry_date}
                    onChange={(value) => setFormData({ ...formData, driving_license_expiry_date: value })}
                    name="edit-driving_license_expiry_date"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="edit-document_count">{t('employees.dialog.fields.documentCount')}</Label>
                <div className="flex items-center space-x-2 p-3 bg-muted/30 border rounded-md">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {selectedEmployee?.document_count || 0} {t('employees.dialog.fields.documentCountEdit')}
                  </span>
                </div>
              </div>
              <div className="col-span-2">
                <Label htmlFor="edit-is_active">{t('employees.dialog.fields.employeeStatus')}</Label>
                <div className="flex items-center space-x-3 mt-2 p-3 border rounded-md">
                  <Switch
                    id="edit-is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <span className={`text-sm font-medium ${formData.is_active ? 'text-green-600' : 'text-red-600'}`}>
                    {formData.is_active ? t('employees.status.active') : t('employees.status.inactive')}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleEditEmployee}>
                حفظ التغييرات
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* View Employee Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">{t('employees.profile.title')}</DialogTitle>
              <DialogDescription>
                {t('employees.profile.description')}
              </DialogDescription>
            </DialogHeader>
            {viewEmployee && (
              <div className="space-y-6">
                {/* Employee Header */}
                <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg">
                  <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="h-8 w-8 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold">{viewEmployee.name}</h3>
                    <p className="text-muted-foreground">
                      {viewEmployee.position} - {viewEmployee.companies?.name}
                    </p>
                  </div>
                </div>

                {/* Employee Information Tabs */}
                <Tabs defaultValue="personal" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="personal">{t('employees.tabs.personal')}</TabsTrigger>
                    <TabsTrigger value="work">{t('employees.tabs.work')}</TabsTrigger>
                    <TabsTrigger value="residency">{t('employees.tabs.residency')}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="personal" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">{t('employees.profile.personalData')}</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">{t('employees.profile.fullName')}</Label>
                          <p className="font-medium">{viewEmployee.name}</p>
                        </div>
                        {viewEmployee.email && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.email')}</Label>
                            <p className="font-medium">{viewEmployee.email}</p>
                          </div>
                        )}
                        {viewEmployee.mobile_no && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.mobile')}</Label>
                            <p className="font-medium">{viewEmployee.mobile_no}</p>
                          </div>
                        )}
                        {viewEmployee.civil_id_no && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.civilId')}</Label>
                            <p className="font-medium">{viewEmployee.civil_id_no}</p>
                          </div>
                        )}
                        {viewEmployee.birth_date && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.birthDate')}</Label>
                            <p className="font-medium">
                              {formatDateForDisplay(viewEmployee.birth_date)}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="work" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">{t('employees.profile.workInfo')}</CardTitle>
                      </CardHeader>
                      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">{t('employees.profile.company')}</Label>
                          <p className="font-medium">{viewEmployee.companies?.name}</p>
                        </div>
                        {viewEmployee.position && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.position')}</Label>
                            <Badge variant="outline" className="w-fit">{viewEmployee.position}</Badge>
                          </div>
                        )}
                        {viewEmployee.hire_date && (
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">{t('employees.profile.hireDate')}</Label>
                            <p className="font-medium">
                              {formatDateForDisplay(viewEmployee.hire_date)}
                            </p>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label className="text-muted-foreground">{t('employees.profile.employeeNo')}</Label>
                          <p className="font-medium font-mono">
                            {String(employees.findIndex(e => e.id === viewEmployee.id) + 1).padStart(2, '0')}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="residency" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">{t('employees.profile.residencyInfo')}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {viewEmployee.residency_expiry_date && (
                          <>
                            <div className="space-y-2">
                              <Label className="text-muted-foreground">{t('employees.profile.residencyExpiry')}</Label>
                              <p className="font-medium">
                                {formatDateForDisplay(viewEmployee.residency_expiry_date)}
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-muted-foreground">{t('employees.profile.status')}</Label>
                              <div className="flex items-center gap-2">
                                {getResidencyStatusBadge(calculateResidencyStatus(viewEmployee.residency_expiry_date))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-muted-foreground">{t('employees.profile.daysRemaining')}</Label>
                              <p className="font-medium">
                                {(() => {
                                  const today = new Date();
                                  const expiry = new Date(viewEmployee.residency_expiry_date);
                                  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                  if (diffDays < 0) return language === 'ar' ? `منتهية منذ ${Math.abs(diffDays)} يوم` : `Expired ${Math.abs(diffDays)} days ago`;
                                  if (diffDays === 0) return language === 'ar' ? 'تنتهي اليوم' : 'Expires today';
                                  return `${diffDays} ${language === 'ar' ? 'يوم' : 'days'}`;
                                })()}
                              </p>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsViewDialogOpen(false);
                      handleViewDocuments(viewEmployee.id);
                    }}
                  >
                    <FileText className="h-4 w-4 ml-2" />
                    {t('employees.profile.viewDocuments')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsViewDialogOpen(false);
                      openEditDialog(viewEmployee);
                    }}
                  >
                    <Edit className="h-4 w-4 ml-2" />
                    {t('employees.profile.editData')}
                  </Button>
                  <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
                    {t('employees.profile.close')}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog >
      </div >
    </Layout >
  );
}
