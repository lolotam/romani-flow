import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DateInput } from '@/components/ui/date-input';
import { FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmployeeFormState } from '@/components/employees/employeeTypes';

export interface EmployeeFormFieldsProps {
  formData: EmployeeFormState;
  onChange: (patch: Partial<EmployeeFormState>) => void;
  companies: { id: string; name: string }[];
  positions: { id: string; name: string; name_ar: string; value: string }[];
  /** Prefix for the input ids, so both dialogs can coexist in the DOM. */
  idPrefix?: string;
  /** The add dialog marks the required fields and shows a placeholder count. */
  mode?: 'add' | 'edit';
  /** The document count of the employee being edited. */
  documentCount?: number;
}

/**
 * The shared employee form fields.
 *
 * Both the add and the edit dialog use the same fields, so they live here once.
 */
export function EmployeeFormFields({
  formData,
  onChange,
  companies,
  positions,
  idPrefix = '',
  mode = 'add',
  documentCount = 0,
}: EmployeeFormFieldsProps) {
  const { t, language } = useLanguage();

  const id = (name: string) => `${idPrefix}${name}`;
  const isRequired = mode === 'add';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label htmlFor={id('name')}>{t('employees.dialog.fields.name')}</Label>
        <Input
          id={id('name')}
          value={formData.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required={isRequired}
        />
      </div>
      <div>
        <Label htmlFor={id('company_id')}>{t('employees.dialog.fields.company')}</Label>
        <Select
          value={formData.company_id}
          onValueChange={(value) => onChange({ company_id: value })}
          required={isRequired}
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
        <Label htmlFor={id('position')}>{t('employees.dialog.fields.position')}</Label>
        <Select
          value={formData.position}
          onValueChange={(value) => onChange({ position: value })}
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
        <Label htmlFor={id('email')}>{t('employees.dialog.fields.email')}</Label>
        <Input
          id={id('email')}
          type="email"
          value={formData.email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id('mobile_no')}>{t('employees.dialog.fields.mobileNo')}</Label>
        <Input
          id={id('mobile_no')}
          value={formData.mobile_no}
          onChange={(e) => onChange({ mobile_no: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id('birth_date')}>{t('employees.dialog.fields.birthDate')}</Label>
        <DateInput
          value={formData.birth_date}
          onChange={(value) => onChange({ birth_date: value })}
          name={id('birth_date')}
        />
      </div>
      <div>
        <Label htmlFor={id('civil_id_no')}>{t('employees.dialog.fields.civilId')}</Label>
        <Input
          id={id('civil_id_no')}
          value={formData.civil_id_no}
          onChange={(e) => onChange({ civil_id_no: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id('residency_expiry_date')}>
          {t('employees.dialog.fields.residencyExpiry')}
        </Label>
        <DateInput
          value={formData.residency_expiry_date}
          onChange={(value) => onChange({ residency_expiry_date: value })}
          name={id('residency_expiry_date')}
        />
      </div>
      <div>
        <Label htmlFor={id('hire_date')}>{t('employees.dialog.fields.hireDate')}</Label>
        <DateInput
          value={formData.hire_date}
          onChange={(value) => onChange({ hire_date: value })}
          name={id('hire_date')}
        />
      </div>
      <div>
        <Label htmlFor={id('driving_license')}>{t('employees.dialog.fields.drivingLicense')}</Label>
        <div className="flex items-center gap-3 mt-2 p-3 border rounded-md">
          <Switch
            id={id('driving_license')}
            checked={formData.driving_license}
            onCheckedChange={(checked) => onChange({ driving_license: checked })}
          />
          <span
            className={`text-sm font-medium ${
              formData.driving_license ? 'text-green-600' : 'text-gray-500'
            }`}
          >
            {formData.driving_license
              ? t('employees.dialog.fields.validLicense')
              : t('employees.dialog.fields.invalidLicense')}
          </span>
        </div>
      </div>
      {formData.driving_license && (
        <div>
          <Label htmlFor={id('driving_license_expiry_date')}>
            {t('employees.dialog.fields.drivingLicenseExpiry')}
          </Label>
          <DateInput
            value={formData.driving_license_expiry_date}
            onChange={(value) => onChange({ driving_license_expiry_date: value })}
            name={id('driving_license_expiry_date')}
          />
        </div>
      )}
      <div>
        <Label htmlFor={id('document_count')}>{t('employees.dialog.fields.documentCount')}</Label>
        <div className="flex items-center gap-2 p-3 bg-muted/30 border rounded-md">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {mode === 'edit' ? (
            <span className="text-sm font-medium">
              {documentCount} {t('employees.dialog.fields.documentCountEdit')}
            </span>
          ) : (
            <span className="text-sm font-medium">
              {t('employees.dialog.fields.willUpdateAfterAdd')}
            </span>
          )}
        </div>
      </div>
      <div className="col-span-2">
        <Label htmlFor={id('is_active')}>{t('employees.dialog.fields.employeeStatus')}</Label>
        <div className="flex items-center gap-3 mt-2 p-3 border rounded-md">
          <Switch
            id={id('is_active')}
            checked={formData.is_active}
            onCheckedChange={(checked) => onChange({ is_active: checked })}
          />
          <span
            className={`text-sm font-medium ${
              formData.is_active ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {formData.is_active ? t('employees.status.active') : t('employees.status.inactive')}
          </span>
        </div>
      </div>
    </div>
  );
}
