import { useLastSubmissionState } from '@/hooks/useLastSubmission';
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import type { Company, EmployeeWithRelations, Position, SortDirection, SortField } from '@/types';
import { Layout } from '@/components/Layout';
import { Download, FileSpreadsheet, FileJson } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmployeesTable } from '@/components/employees/EmployeesTable';
import { EmployeeFilters } from '@/components/employees/EmployeeFilters';
import { EmployeeFormDialog } from '@/components/employees/EmployeeFormDialog';
import { EmployeeViewDialogContent } from '@/components/employees/EmployeeViewDialogContent';
import { EMPTY_EMPLOYEE_FORM } from '@/components/employees/employeeTypes';
import type { EmployeeFormState } from '@/components/employees/employeeTypes';
import { formatDateForInput, toEmployeeFlags } from '@/components/employees/employeeHelpers';

export default function Employees() {
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeWithRelations | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewEmployee, setViewEmployee] = useState<EmployeeWithRelations | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { toast } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  /**
   * Builds the payload sent to the API.
   *
   * Empty fields are sent as `null` on purpose: the server keeps a stored value
   * when a key is absent, but clears it when the key is explicitly `null`.
   */
  const buildEmployeePayload = (formData: EmployeeFormState) => ({
    name: formData.name,
    email: formData.email || null,
    mobile_no: formData.mobile_no || null,
    position: formData.position || null,
    hire_date: formData.hire_date || null,
    birth_date: formData.birth_date || null,
    civil_id_no: formData.civil_id_no || null,
    residency_expiry_date: formData.residency_expiry_date || null,
    driving_license: formData.driving_license,
    driving_license_expiry_date: formData.driving_license
      ? formData.driving_license_expiry_date || null
      : null,
    company_id: formData.company_id,
    is_active: formData.is_active,
  });

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
      const { data, error } = await api.insert<EmployeeWithRelations>(
        'employees',
        buildEmployeePayload(formData),
      );

      if (error) throw error;

      // Add to local state with company info
      const company = companies.find(c => c.id === formData.company_id);
      const newEmployee: EmployeeWithRelations = {
        ...toEmployeeFlags(data![0] as EmployeeWithRelations),
        companies: company ?? null,
        document_count: 0,
      };
      setEmployees(prev => [...prev, newEmployee]);

      toast({
        title: t('employees.messages.addSuccess') || 'Success',
        description: formData.name,
      });

      setIsAddDialogOpen(false);
      setFormData(EMPTY_EMPLOYEE_FORM);
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
      const { data, error } = await api.update<EmployeeWithRelations>(
        'employees',
        selectedEmployee.id,
        buildEmployeePayload(formData),
      );

      if (error) throw error;

      // Update local state
      const company = companies.find(c => c.id === formData.company_id);
      const updated = data ?? selectedEmployee;
      setEmployees(prev =>
        prev.map(emp =>
          emp.id === selectedEmployee.id
            ? {
                ...emp,
                ...updated,
                companies: company ?? emp.companies,
              }
            : emp,
        ),
      );

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

  const handleViewEmployee = (employee: EmployeeWithRelations) => {
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
      `${t('employees.messages.deleteConfirm')}\n\n${employee.name}`,
    );

    if (!confirmDelete) return;

    try {
      const { error } = await api.delete('employees', employeeId);

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

  const openEditDialog = (employee: EmployeeWithRelations) => {
    setSelectedEmployee(employee);
    setFormData({
      name: employee.name,
      email: employee.email || '',
      mobile_no: employee.mobile_no || '',
      position: employee.position || '',
      hire_date: formatDateForInput(employee.hire_date),
      birth_date: formatDateForInput(employee.birth_date),
      civil_id_no: employee.civil_id_no || '',
      residency_expiry_date: formatDateForInput(employee.residency_expiry_date),
      driving_license: employee.driving_license || false,
      driving_license_expiry_date: formatDateForInput(employee.driving_license_expiry_date),
      company_id: employee.company_id || '',
      is_active: employee.is_active !== undefined ? employee.is_active : true,
    });
    setIsEditDialogOpen(true);
  };

  // Filtered and sorted employees
  const filteredAndSortedEmployees = useMemo(() => {
    const filtered = employees.filter(employee => {
      const matchesSearch =
        employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
        const { data: employeesData, error: employeesError } = await api
          .from<EmployeeWithRelations>('employees')
          .select('*, companies (name, name_ar)')
          .execute();

        // Fetch companies
        const { data: companiesData, error: companiesError } = await api
          .from<Company>('companies')
          .select('*')
          .execute();

        // Fetch positions
        const { data: positionsData, error: positionsError } = await api
          .from<Position>('positions')
          .select('*')
          .execute();

        if (employeesError) {
          console.error('Error fetching employees:', employeesError);
          toast({
            title: 'خطأ',
            description: 'فشل في تحميل بيانات الموظفين',
            variant: 'destructive',
          });
        } else {
          // Transform employees data to match interface
          const transformedEmployees = (employeesData || []).map(emp => ({
            ...emp,
            email: emp.email || '',
            mobile_no: emp.mobile_no || emp.phone || '',
            is_active: emp.is_active !== undefined ? emp.is_active : true,
            document_count: 0, // Will be calculated separately
            // Ensure company object is populated
            companies: emp.companies || (companiesData || []).find(c => c.id === emp.company_id) || null,
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
          title: 'خطأ',
          description: 'فشل في تحميل البيانات',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast]);

  const [formData, setFormData] = useLastSubmissionState<EmployeeFormState>('employees', EMPTY_EMPLOYEE_FORM, isAddDialogOpen);

  const updateFormData = (patch: Partial<EmployeeFormState>) => {
    setFormData(prev => ({ ...prev, ...patch }));
  };

  const viewEmployeeNumber = viewEmployee
    ? employees.findIndex(e => e.id === viewEmployee.id) + 1
    : 0;

  return (
    <Layout>
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
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
                  <DropdownMenuItem onClick={() => {}}>
                    <FileSpreadsheet className="h-4 w-4 ml-2" />
                    {t('employees.exportCSV')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {}}>
                    <FileJson className="h-4 w-4 ml-2" />
                    {t('employees.exportJSON')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <EmployeeFormDialog
                mode="add"
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                formData={formData}
                onFormChange={updateFormData}
                companies={companies}
                positions={positions}
                onSubmit={handleAddEmployee}
              />
            </div>
          </div>
        </motion.div>

        {/* Filters and Search */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <EmployeeFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            companies={companies}
            selectedCompany={selectedCompany}
            onSelectedCompanyChange={setSelectedCompany}
          />
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
                <EmployeesTable
                  employees={filteredAndSortedEmployees}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onView={handleViewEmployee}
                  onViewDocuments={handleViewDocuments}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Edit Dialog */}
        <EmployeeFormDialog
          mode="edit"
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          formData={formData}
          onFormChange={updateFormData}
          companies={companies}
          positions={positions}
          onSubmit={handleEditEmployee}
          documentCount={selectedEmployee?.document_count || 0}
        />

        {/* View Employee Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">{t('employees.profile.title')}</DialogTitle>
              <DialogDescription>{t('employees.profile.description')}</DialogDescription>
            </DialogHeader>
            {viewEmployee && (
              <EmployeeViewDialogContent
                employee={viewEmployee}
                employeeNumber={viewEmployeeNumber}
                onViewDocuments={id => {
                  setIsViewDialogOpen(false);
                  handleViewDocuments(id);
                }}
                onEdit={employee => {
                  setIsViewDialogOpen(false);
                  openEditDialog(employee);
                }}
                onClose={() => setIsViewDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
