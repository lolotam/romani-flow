import { useId, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Building2, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentFormData, DocumentFormProps } from './documentFormSchema';

type Props = Pick<DocumentFormProps, 'companies' | 'employees' | 'documentTypes' | 'ministries' | 'preselectedEmployeeId'>;

export function DocumentBeneficiaryFields({ companies, employees, documentTypes, ministries, preselectedEmployeeId }: Props) {
  const form = useFormContext<DocumentFormData>();
  const { t, language } = useLanguage();
  const [selectedCompany, setSelectedCompany] = useState('');
  const scopeId = useId();
  const beneficiaryType = form.watch('beneficiary_type');
  const lockedEmployee = employees.find(employee => employee.id === preselectedEmployeeId);
  const employeeCompany = companies.find(company => company.id === lockedEmployee?.company_id);
  const watchedMinistry = form.watch('ministry_id');
  const selectedCompanyEmployees = selectedCompany
    ? employees.filter(emp => emp.company_id === selectedCompany)
    : employees;
  // Dynamic ministries from database with "Other" option
  const dynamicMinistries = [
    ...ministries,
    { id: 'other', name: t('documents.form.otherMinistryOption'), name_ar: t('documents.form.otherMinistryOption') },
  ];

  return (
    <>
      {/* Conditional Fields - Company */}
      {beneficiaryType === 'company' && (
        <div className="space-y-4 p-4 border rounded-lg bg-blue-50/30">
          <h3 className="font-medium text-sm flex items-center space-x-2">
            <Building2 className="h-4 w-4 ml-2" />
            <span>{t('documents.form.company')} Data</span>
          </h3>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="company_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('documents.form.company')} *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('documents.form.selectCompany')} />
                      </SelectTrigger>
                    </FormControl>
                     <SelectContent>
                      {companies.length > 0 ? companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {language === 'ar' ? company.name_ar : company.name}
                        </SelectItem>
                      )) : (
                        <SelectItem value="no_companies" disabled>
                          {t('common.noData')}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="document_type_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('documents.form.documentType')} *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('documents.form.selectDocumentType')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {language === 'ar' ? type.name_ar : type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="ministry_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('documents.form.ministry')} *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.form.selectMinistry')} />
                    </SelectTrigger>
                  </FormControl>
                   <SelectContent>
                     {dynamicMinistries.map((ministry) => (
                       <SelectItem key={ministry.id} value={ministry.id}>
                         {language === 'ar' ? ministry.name_ar : ministry.name}
                       </SelectItem>
                     ))}
                   </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
           />

          {/* Entity Name Field - Shows when "Other" is selected */}
          {watchedMinistry === 'other' && (
            <FormField
              control={form.control}
              name="entity_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('documents.form.entityNameLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('documents.form.entityNamePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      )}

      {/* Conditional Fields - Employee */}
      {beneficiaryType === 'employee' && (
        <div className="space-y-4 p-4 border rounded-lg bg-green-50/30">
          <h3 className="font-medium text-sm flex items-center space-x-2">
            <User className="h-4 w-4 ml-2" />
            <span>{t('documents.form.employeeDataLabel')}</span>
          </h3>

          {preselectedEmployeeId ? <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor={`${scopeId}-employee`}>{t('documents.form.employeeLabel')}</Label>
              <Input id={`${scopeId}-employee`} value={lockedEmployee?.name ?? ''} readOnly aria-readonly="true" /></div>
            <div className="space-y-2"><Label htmlFor={`${scopeId}-company`}>{t('documents.form.company')}</Label>
              <Input id={`${scopeId}-company`} value={language === 'ar' ? employeeCompany?.name_ar || employeeCompany?.name || '' : employeeCompany?.name || ''} readOnly aria-readonly="true" /></div>
          </div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="company_id"
              render={() => (
                <FormItem>
                  <FormLabel>{t('documents.form.filterByCompanyLabel')}</FormLabel>
                  <Select 
                    onValueChange={(value) => {
                      setSelectedCompany(value === 'all_companies' ? '' : value);
                      form.setValue('employee_id', ''); // Reset employee when company filter changes
                    }} 
                    value={selectedCompany}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('documents.form.allCompaniesOption')} />
                      </SelectTrigger>
                    </FormControl>
                     <SelectContent>
                      <SelectItem value="all_companies">{t('documents.form.allCompaniesOption')}</SelectItem>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('documents.form.employeeLabel')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('documents.form.selectEmployeeLabel')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectedCompanyEmployees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>}

          <FormField
            control={form.control}
            name="document_type_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('documents.form.documentTypeLabel')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.form.selectDocumentTypeLabel')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {documentTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </>
  );
}
