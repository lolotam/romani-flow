import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  Edit,
  Eye,
  FileText,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type { EmployeeWithRelations, SortDirection, SortField } from '@/types';
import {
  DrivingLicenseStatusBadge,
  ResidencyStatusBadge,
} from '@/components/employees/EmployeeStatusBadges';
import {
  calculateExpiryStatus,
  expiryDateClassName,
  formatDateForDisplay,
} from '@/components/employees/employeeHelpers';

export interface EmployeesTableProps {
  employees: EmployeeWithRelations[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onView: (employee: EmployeeWithRelations) => void;
  onViewDocuments: (employeeId: string) => void;
  onEdit: (employee: EmployeeWithRelations) => void;
  onDelete: (employeeId: string) => void;
}

/**
 * The employees table.
 *
 * Sorting stays in the browser — it is a display concern over the rows the
 * page already holds.
 */
export function EmployeesTable({
  employees,
  sortField,
  sortDirection,
  onSort,
  onView,
  onViewDocuments,
  onEdit,
  onDelete,
}: EmployeesTableProps) {
  const { t } = useLanguage();

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/50">
          <TableHead className="w-[70px] text-start">#</TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('name')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.table.name')}</span>
              {getSortIcon('name')}
            </div>
          </TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('position')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.table.position')}</span>
              {getSortIcon('position')}
            </div>
          </TableHead>
          <TableHead>{t('employees.table.company')}</TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('mobile_no')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.form.mobileNo')}</span>
              {getSortIcon('mobile_no')}
            </div>
          </TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('civil_id_no')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.table.civilId')}</span>
              {getSortIcon('civil_id_no')}
            </div>
          </TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('birth_date')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.table.birthDate')}</span>
              {getSortIcon('birth_date')}
            </div>
          </TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('hire_date')}
          >
            <div className="flex items-center space-x-2">
              <span>{t('employees.table.hireDate')}</span>
              {getSortIcon('hire_date')}
            </div>
          </TableHead>
          <TableHead
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSort('residency_expiry_date')}
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
        {employees.map((employee, index) => (
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
              {(employee.mobile_no || employee.phone) ? (
                <div className="flex items-center space-x-2">
                  <span>{(employee.mobile_no || employee.phone)}</span>
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
                  <span className={expiryDateClassName(employee.residency_expiry_date)}>
                    {formatDateForDisplay(employee.residency_expiry_date)}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">{t('employees.status.notSpecified')}</span>
              )}
            </TableCell>
            <TableCell>
              <ResidencyStatusBadge
                status={calculateExpiryStatus(employee.residency_expiry_date)}
              />
            </TableCell>
            <TableCell>
              {employee.driving_license ? (
                employee.driving_license_expiry_date ? (
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className={expiryDateClassName(employee.driving_license_expiry_date)}>
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
              {employee.driving_license && employee.driving_license_expiry_date ? (
                <DrivingLicenseStatusBadge
                  status={calculateExpiryStatus(employee.driving_license_expiry_date)}
                />
              ) : (
                <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>
              )}
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
                variant={employee.is_active !== false ? 'default' : 'destructive'}
                className={
                  employee.is_active !== false
                    ? 'bg-blue-500 hover:bg-blue-600'
                    : 'bg-red-500 hover:bg-red-600'
                }
              >
                {employee.is_active !== false
                  ? t('employees.status.active').replace(' ✓', '')
                  : t('employees.status.inactive').replace(' ✗', '')}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onView(employee)}
                  title={t('employees.profile.title')}
                  className="hover:bg-primary hover:text-primary-foreground"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewDocuments(employee.id)}
                  title={t('employees.profile.viewDocuments')}
                  className="hover:bg-blue-600 hover:text-white"
                >
                  <FileText className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(employee)}
                  title={t('employees.actions.edit')}
                  className="hover:bg-accent"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(employee.id)}
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
  );
}
