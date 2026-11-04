import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Edit, FileText, User } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmployeeWithRelations } from '@/types';
import { ResidencyStatusBadge } from '@/components/employees/EmployeeStatusBadges';
import {
  calculateExpiryStatus,
  formatDateForDisplay,
} from '@/components/employees/employeeHelpers';

export interface EmployeeViewDialogProps {
  employee: EmployeeWithRelations;
  /** The 1-based index of the employee in the full list, shown as their number. */
  employeeNumber: number;
  onViewDocuments: (employeeId: string) => void;
  onEdit: (employee: EmployeeWithRelations) => void;
  onClose: () => void;
}

/**
 * The read-only employee profile, shown in tabs.
 *
 * Lives outside the dialog shell so the page keeps only the state.
 */
export function EmployeeViewDialogContent({
  employee,
  employeeNumber,
  onViewDocuments,
  onEdit,
  onClose,
}: EmployeeViewDialogProps) {
  const { t, language } = useLanguage();

  return (
    <div className="space-y-6">
      {/* Employee Header */}
      <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg">
        <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
          <User className="h-8 w-8 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold">{employee.name}</h3>
          <p className="text-muted-foreground">
            {employee.position} - {employee.companies?.name}
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
                <p className="font-medium">{employee.name}</p>
              </div>
              {employee.email && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.email')}</Label>
                  <p className="font-medium">{employee.email}</p>
                </div>
              )}
              {(employee.mobile_no || employee.phone) && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.mobile')}</Label>
                  <p className="font-medium">{(employee.mobile_no || employee.phone)}</p>
                </div>
              )}
              {employee.civil_id_no && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.civilId')}</Label>
                  <p className="font-medium">{employee.civil_id_no}</p>
                </div>
              )}
              {employee.birth_date && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.birthDate')}</Label>
                  <p className="font-medium">{formatDateForDisplay(employee.birth_date)}</p>
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
                <p className="font-medium">{employee.companies?.name}</p>
              </div>
              {employee.position && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.position')}</Label>
                  <Badge variant="outline" className="w-fit">
                    {employee.position}
                  </Badge>
                </div>
              )}
              {employee.hire_date && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('employees.profile.hireDate')}</Label>
                  <p className="font-medium">{formatDateForDisplay(employee.hire_date)}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('employees.profile.employeeNo')}</Label>
                <p className="font-medium font-mono">{String(employeeNumber).padStart(2, '0')}</p>
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
              {employee.residency_expiry_date && (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('employees.profile.residencyExpiry')}
                    </Label>
                    <p className="font-medium">
                      {formatDateForDisplay(employee.residency_expiry_date)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">{t('employees.profile.status')}</Label>
                    <div className="flex items-center gap-2">
                      <ResidencyStatusBadge
                        status={calculateExpiryStatus(employee.residency_expiry_date)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('employees.profile.daysRemaining')}
                    </Label>
                    <p className="font-medium">
                      {(() => {
                        const today = new Date();
                        const expiry = new Date(employee.residency_expiry_date!);
                        const diffDays = Math.ceil(
                          (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
                        );
                        if (diffDays < 0)
                          return language === 'ar'
                            ? `منتهية منذ ${Math.abs(diffDays)} يوم`
                            : `Expired ${Math.abs(diffDays)} days ago`;
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
          onClick={() => onViewDocuments(employee.id)}
        >
          <FileText className="h-4 w-4 ml-2" />
          {t('employees.profile.viewDocuments')}
        </Button>
        <Button variant="outline" onClick={() => onEdit(employee)}>
          <Edit className="h-4 w-4 ml-2" />
          {t('employees.profile.editData')}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t('employees.profile.close')}
        </Button>
      </div>
    </div>
  );
}
