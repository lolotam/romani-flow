import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Save, X, Building2, User, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { createDocumentSchema, type DocumentFormData, type DocumentFormProps } from './documents/documentFormSchema';
import { DocumentAttachment } from './documents/DocumentAttachment';
import { DocumentBeneficiaryFields } from './documents/DocumentBeneficiaryFields';
import { DocumentDateFields } from './documents/DocumentDateFields';
import { saveDocument } from './documents/saveDocument';
import { useStagedDocumentUpload } from './documents/useStagedDocumentUpload';
import { useLastSubmissionRestore } from '@/hooks/useLastSubmission';
import { restoreFormDate } from '@/lib/formDefaults';

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
  const { t, isRTL } = useLanguage();
  const documentSchema = createDocumentSchema(t);

  const submitting = React.useRef(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
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

  const { stageFile, clearUpload } = useStagedDocumentUpload();
  const formIsDirty = form.formState.isDirty;
  useLastSubmissionRestore('documents', !editingDocument, (saved) => {
    form.reset({ ...form.getValues(),
      title: fileName ? fileName.replace(/\.[^/.]+$/, '') : String(saved.title ?? ''),
      beneficiary_type: preselectedCompanyId ? 'company' : preselectedEmployeeId ? 'employee' : saved.employee_id ? 'employee' : 'company',
      company_id: preselectedCompanyId ?? String(saved.company_id ?? ''),
      employee_id: preselectedEmployeeId ?? String(saved.employee_id ?? ''),
      document_type_id: String(saved.document_type_id ?? ''), ministry_id: String(saved.ministry_id ?? ''),
      issue_date: restoreFormDate(saved.issue_date), expiry_date: restoreFormDate(saved.expiry_date), notes: String(saved.notes ?? ''),
    });
  }, () => !formIsDirty);

  const handleSubmit = async (data: DocumentFormData): Promise<boolean> => {
    if (submitting.current) return false;
    submitting.current = true;
    setIsSubmitting(true);
    try {
      if (!uploadedFile && !editingDocument) {
        throw new Error(t('documents.messages.noFileError'));
      }
      // Handle file validation for new uploads
      if (uploadedFile) {
        const maxSize = 20 * 1024 * 1024; // 20MB
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (uploadedFile.size > maxSize) throw new Error(t('documents.messages.fileSizeError'));
        if (!allowedTypes.includes(uploadedFile.type)) throw new Error(t('documents.messages.fileTypeError'));
      }
      const uploadId = uploadedFile
        ? await stageFile(uploadedFile, t('documents.messages.saveError'))
        : undefined;
      await saveDocument(data, editingDocument?.id, uploadId, t);
      clearUpload();
      toast.success(editingDocument ? t('documents.messages.editSuccess') : t('documents.messages.addSuccess'));
      onSuccess();
      onClose();
      return true;
    } catch (error) {
      console.error(t('documents.messages.consoleError') + ':', error);
      toast.error(error instanceof Error ? error.message : t('documents.messages.error'));
      return false;
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit, () => toast.error(t('documents.form.validation.reviewFields')))} className="space-y-6">
            <DocumentAttachment uploadedFile={uploadedFile} editingDocument={editingDocument} />
            {documentTypes.length === 0 && <p role="alert" className="text-destructive">{t('documents.form.validation.noDocumentTypes')}</p>}
            {form.watch('beneficiary_type') === 'employee' && employees.length === 0 &&
              <p role="alert" className="text-destructive">{t('documents.form.validation.noEmployees')}</p>}

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
                        // Reset dependent fields
                        form.setValue('company_id', '');
                        form.setValue('employee_id', '');
                        form.setValue('document_type_id', '');
                        form.setValue('ministry_id', '');
                        form.setValue('entity_name', '');
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

            <DocumentBeneficiaryFields
              key={form.watch('beneficiary_type')}
              companies={companies}
              employees={employees}
              documentTypes={documentTypes}
              ministries={ministries}
            />
            <DocumentDateFields />

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
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
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
                      let saved = false;
                      await form.handleSubmit(async (data) => { saved = await handleSubmit(data); },
                        () => toast.error(t('documents.form.validation.reviewFields')))();
                      if (!saved) return;
                      // Reset form for new document
                      form.reset({
                        title: '',
                        beneficiary_type: 'employee',
                        notes: '',
                      });
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
