import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { CalendarIcon, FileText, Save, X, Building2, User, AlertCircle, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { jsonDatabase } from '@/lib/jsonDatabase';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { calculateDocumentStatusFromDate } from '@/lib/statusUtils';

// Create schema factory function that accepts translation function
const createDocumentSchema = (t: (key: string) => string) => z.object({
  title: z.string().min(3, t('documents.form.validation.titleMinLength')).max(120, t('documents.form.validation.titleMaxLength')),
  beneficiary_type: z.enum(['company', 'employee'], { required_error: t('documents.form.validation.beneficiaryTypeRequired') }),
  company_id: z.string().optional(),
  employee_id: z.string().optional(),
  document_type_id: z.string().optional(),
  ministry_id: z.string().optional(),
  entity_name: z.string().optional(),
  issue_date: z.date().optional(),
  expiry_date: z.date({ required_error: t('documents.form.validation.expiryDateRequired') }),
  notes: z.string().optional(),
}).refine((data) => {
  // Company validation
  if (data.beneficiary_type === 'company') {
    return data.company_id && data.ministry_id && data.document_type_id;
  }
  // Employee validation  
  if (data.beneficiary_type === 'employee') {
    return data.employee_id && data.document_type_id;
  }
  return false;
}, {
  message: t('documents.form.validation.allFieldsRequired'),
}).refine((data) => {
  // Date validation - expiry date should be >= issue date
  if (data.issue_date && data.expiry_date) {
    return data.expiry_date >= data.issue_date;
  }
  return true;
}, {
  message: t('documents.form.validation.invalidDateRange'),
  path: ['expiry_date']
}).refine((data) => {
  // Entity name required when ministry is "أخرى"
  if (data.ministry_id && data.ministry_id === 'other') {
    return data.entity_name && data.entity_name.trim().length > 0;
  }
  return true;
}, {
  message: t('documents.form.validation.entityNameRequired'),
  path: ['entity_name']
});

type DocumentFormData = z.infer<ReturnType<typeof createDocumentSchema>>;

interface DocumentFormProps {
  uploadedFile: File | null;
  fileName: string;
  onClose: () => void;
  onSuccess: () => void;
  documentTypes: Array<{ id: string; name: string; name_ar: string }>;
  companies: Array<{ id: string; name: string; name_ar: string }>;
  employees: Array<{ id: string; name: string; company_id: string }>;
  ministries: Array<{ id: string; name: string; name_ar: string }>;
  preselectedCompanyId?: string;
  preselectedEmployeeId?: string;
  editingDocument?: {
    id: string;
    title: string;
    document_type_id: string;
    ministry_id?: string;
    employee_id?: string;
    company_id?: string;
    issue_date?: string;
    expiry_date?: string;
    notes?: string;
    file_path?: string;
    file_name?: string;
  } | null;
}

export function DocumentForm({
  uploadedFile,
  fileName,
  onClose,
  onSuccess,
  documentTypes,
  companies,
  employees,
  ministries,
  preselectedCompanyId,
  preselectedEmployeeId,
  editingDocument,
}: DocumentFormProps) {
  const { t, language } = useLanguage();
  const documentSchema = createDocumentSchema(t);
  
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedCompany, setSelectedCompany] = React.useState<string>('');
  const [beneficiaryType, setBeneficiaryType] = React.useState<'company' | 'employee'>(
    editingDocument
      ? (editingDocument.employee_id ? 'employee' : 'company')
      : preselectedCompanyId
        ? 'company'
        : preselectedEmployeeId
          ? 'employee'
          : 'employee'
  );

  const form = useForm<DocumentFormData>({
    resolver: zodResolver(documentSchema),
    defaultValues: editingDocument ? {
      title: editingDocument.title,
      beneficiary_type: editingDocument.employee_id ? 'employee' : 'company',
      company_id: editingDocument.company_id || '',
      employee_id: editingDocument.employee_id || '',
      document_type_id: editingDocument.document_type_id || '',
      ministry_id: editingDocument.ministry_id || '',
      issue_date: editingDocument.issue_date ? new Date(editingDocument.issue_date + 'T00:00:00') : undefined,
      expiry_date: new Date(editingDocument.expiry_date + 'T00:00:00'),
      notes: editingDocument.notes || '',
    } : {
      title: fileName ? fileName.replace(/\.[^/.]+$/, '') : '', // Remove file extension
      beneficiary_type: preselectedCompanyId ? 'company' : preselectedEmployeeId ? 'employee' : 'employee',
      company_id: preselectedCompanyId || '',
      employee_id: preselectedEmployeeId || (employees.length > 0 ? employees[0].id : ''),
      notes: '',
    },
  });

  const selectedCompanyEmployees = selectedCompany 
    ? employees.filter(emp => emp.company_id === selectedCompany)
    : employees;

  // Dynamic ministries from database with "Other" option
  const dynamicMinistries = [
    ...ministries,
    { id: 'other', name: t('documents.form.otherMinistryOption'), name_ar: t('documents.form.otherMinistryOption') },
  ];

  // Use centralized status calculation
  const calculateStatus = calculateDocumentStatusFromDate;

  const watchedExpiryDate = form.watch('expiry_date');
  const watchedMinistry = form.watch('ministry_id');

  const handleSubmit = async (data: DocumentFormData) => {
    setIsSubmitting(true);
    
    try {
      let fileBase64: string | undefined;
      let currentFileName: string;

      // Handle file validation and conversion for new uploads
      if (uploadedFile) {
        // Validate file
        const maxSize = 20 * 1024 * 1024; // 20MB
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];

        if (uploadedFile.size > maxSize) {
          throw new Error(t('documents.messages.fileSizeError'));
        }

        if (!allowedTypes.includes(uploadedFile.type)) {
          throw new Error(t('documents.messages.fileTypeError'));
        }
      }

      // Convert file to base64 for new uploads, use existing data for edits
      if (uploadedFile) {
        const convertFileToBase64 = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
          });
        };

        fileBase64 = await convertFileToBase64(uploadedFile);
        currentFileName = uploadedFile.name;
      } else if (editingDocument) {
        fileBase64 = editingDocument.file_path;
        currentFileName = editingDocument.file_name || 'document';
      } else {
        throw new Error(t('documents.messages.noFileError'));
      }

      // Prepare data based on beneficiary type
      let documentData: any = {
        title: data.title,
        issue_date: data.issue_date?.toISOString().split('T')[0] || null,
        expiry_date: data.expiry_date.toISOString().split('T')[0],
        notes: data.notes || null,
        file_name: currentFileName,
        file_path: fileBase64,
        status: calculateStatus(data.expiry_date)
      };

      if (data.beneficiary_type === 'company') {
        // For company documents
        documentData.company_id = data.company_id;
        documentData.employee_id = null;
        
        // Handle ministry or create custom entity
        if (data.ministry_id === 'other' && data.entity_name) {
          // Create or find custom ministry for "Other"
          const { data: existingMinistries } = await jsonDatabase
            .from('ministries')
            .select('*')
            .eq('name_ar', data.entity_name)
            .execute();

          if (existingMinistries && existingMinistries.length > 0) {
            documentData.ministry_id = existingMinistries[0].id;
          } else {
            const newMinistryId = crypto.randomUUID();
            const { error: ministryError } = await jsonDatabase
              .insert('ministries', {
                id: newMinistryId,
                name: data.entity_name,
                name_ar: data.entity_name,
                created_at: new Date().toISOString()
              });

            if (ministryError) throw new Error(t('documents.messages.ministryCreateError'));
            documentData.ministry_id = newMinistryId;
          }
        } else {
          // Use selected ministry ID directly
          documentData.ministry_id = data.ministry_id;
        }
        
        // Set document type for company documents
        documentData.document_type_id = data.document_type_id;
        
      } else {
        // For employee documents  
        documentData.employee_id = data.employee_id;
        documentData.company_id = null;
        documentData.document_type_id = data.document_type_id;
        documentData.ministry_id = null;
      }

      if (editingDocument) {
        // Update existing document
        const { error: dbError } = await jsonDatabase
          .update('documents', editingDocument.id, {
            ...documentData,
            updated_at: new Date().toISOString()
          });

        if (dbError) {
          throw new Error(`${t('documents.messages.updateError')}: ${dbError}`);
        }
      } else {
        // Create new document
        const documentId = crypto.randomUUID();
        const now = new Date().toISOString();

        const fullDocumentData = {
          id: documentId,
          ...documentData,
          created_at: now,
          updated_at: now
        };

        const { error: dbError } = await jsonDatabase
          .insert('documents', fullDocumentData);

        if (dbError) {
          throw new Error(`${t('documents.messages.saveError')}: ${dbError}`);
        }
      }

      toast.success(editingDocument ? t('documents.messages.editSuccess') : t('documents.messages.addSuccess'));
      onSuccess();
      onClose();
    } catch (error) {
      console.error(t('documents.messages.consoleError') + ':', error);
      toast.error(error instanceof Error ? error.message : t('documents.messages.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* File Upload Info */}
            {(uploadedFile || editingDocument) && (
              <div className="p-4 bg-primary/5 rounded-lg border">
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-primary ml-2" />
                  <div className="flex-1">
                    <h3 className="font-medium text-sm">
                      {editingDocument ? t('documents.form.file') : t('documents.form.file')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {uploadedFile ? uploadedFile.name : editingDocument?.file_name}
                    </p>
                    {uploadedFile && (
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    )}
                  </div>
                  {uploadedFile && uploadedFile.type.startsWith('image/') && (
                    <img
                      src={URL.createObjectURL(uploadedFile)}
                      alt={t('documents.actions.preview')}
                      className="h-12 w-12 object-cover rounded border"
                    />
                  )}
                  {!uploadedFile && editingDocument?.file_path && editingDocument.file_path.startsWith('data:image') && (
                    <img
                      src={editingDocument.file_path}
                      alt={t('documents.actions.preview')}
                      className="h-12 w-12 object-cover rounded border"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Always Visible Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('documents.form.title')} *</FormLabel>
                    <FormControl>
                      <Input placeholder={t('documents.form.titlePlaceholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="beneficiary_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('documents.form.beneficiaryType')} *</FormLabel>
                    <Select 
                      onValueChange={(value: 'company' | 'employee') => {
                        field.onChange(value);
                        setBeneficiaryType(value);
                        // Reset dependent fields
                        form.setValue('company_id', '');
                        form.setValue('employee_id', '');
                        form.setValue('document_type_id', '');
                        form.setValue('ministry_id', '');
                        form.setValue('entity_name', '');
                        setSelectedCompany('');
                      }} 
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('documents.form.beneficiaryType')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="company">
                          <div className="flex items-center space-x-2">
                            <Building2 className="h-4 w-4 ml-2" />
                            <span>{t('documents.form.beneficiaryTypes.company')}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="employee">
                          <div className="flex items-center space-x-2">
                            <User className="h-4 w-4 ml-2" />
                            <span>{t('documents.form.beneficiaryTypes.employee')}</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="company_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('documents.form.filterByCompanyLabel')}</FormLabel>
                        <Select 
                          onValueChange={(value) => {
                            setSelectedCompany(value);
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
                </div>

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

            {/* Date Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="issue_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('documents.form.issueDate')}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>{t('documents.form.selectDate')}</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiry_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="flex items-center space-x-2">
                      <span>{t('documents.form.expiryDate')} *</span>
                      {watchedExpiryDate && (
                        <Badge 
                          variant={calculateStatus(watchedExpiryDate) === 'expired' ? 'destructive' : 
                                  calculateStatus(watchedExpiryDate) === 'expiring_soon' ? 'destructive' : 'default'}
                          className="text-xs"
                        >
                          {calculateStatus(watchedExpiryDate) === 'expired' ? t('documents.statusOptions.expired') :
                           calculateStatus(watchedExpiryDate) === 'expiring_soon' ? t('documents.statusOptions.expiringSoon') : t('documents.statusOptions.valid')}
                        </Badge>
                      )}
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>{t('documents.form.selectDate')}</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date < new Date()}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('documents.form.notes')}</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder={t('documents.form.notesPlaceholder')}
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t">
              <Button type="button" variant="outline" onClick={onClose}>
                <X className="h-4 w-4 ml-2" />
                {t('documents.form.buttons.cancel')}
              </Button>
              
              <div className="flex space-x-2">
                <Button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="shadow-elegant hover:shadow-glow transition-all"
                >
                  <Save className="h-4 w-4 ml-2" />
                  {isSubmitting ?
                    (editingDocument ? t('common.loading') + '...' : t('common.loading') + '...') :
                    (editingDocument ? t('documents.form.buttons.update') : t('documents.form.buttons.save'))
                  }
                </Button>
                
                {!editingDocument && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={async () => {
                      await form.handleSubmit(handleSubmit)();
                      // Reset form for new document
                      form.reset({
                        title: '',
                        beneficiary_type: 'employee',
                        notes: '',
                      });
                      setBeneficiaryType('employee');
                      setSelectedCompany('');
                    }}
                  >
                    <Plus className="h-4 w-4 ml-2" />
                    {t('documents.form.buttons.save')} & {t('common.add')} {t('common.next')}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}