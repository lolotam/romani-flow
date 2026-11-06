import React from 'react';
import { useForm, type DefaultValues } from 'react-hook-form';
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
import { DocumentAttachmentPicker } from './documents/DocumentAttachmentPicker';
import { DocumentBeneficiaryFields } from './documents/DocumentBeneficiaryFields';
import { DocumentDateFields } from './documents/DocumentDateFields';
import { saveDocument } from './documents/saveDocument';
import { useStagedDocumentUpload } from './documents/useStagedDocumentUpload';
import { useDocumentDraft } from '@/hooks/useDocumentDraft';
import { draftValues } from '@/lib/documentDraftSession';
import { restoreFormDate } from '@/lib/formDefaults';
import { useAuth } from '@/hooks/useAuth';
import { DocumentDraftStatus } from './documents/DocumentDraftStatus';
import { useLastSubmissionRestore } from '@/hooks/useLastSubmission';
import { newDocumentDefaults } from '@/lib/documentFormDrafts';

export function DocumentForm(props: DocumentFormProps) {
  const { user } = useAuth();
  const scope = props.editingDocument ? 'edit:' + props.editingDocument.id : props.preselectedEmployeeId ? 'employee:' + props.preselectedEmployeeId : props.preselectedCompanyId ? 'company:' + props.preselectedCompanyId : 'new';
  return <DocumentFormContent key={String(user?.id) + ':' + scope} {...props} scope={scope} />;
}

function DocumentFormContent({
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
  editingDocument, scope, registerDraftClose,
}: DocumentFormProps & { scope: string }) {
  const { t, isRTL } = useLanguage();
  const documentSchema = createDocumentSchema(t);

  const submitting = React.useRef(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState(uploadedFile);
  const defaultContext = { employeeId: preselectedEmployeeId, companyId: preselectedCompanyId, fallbackEmployeeId: employees[0]?.id };
  const allowLastSubmission = React.useRef(true);
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
    } : newDocumentDefaults(defaultContext, fileName),
  });

  const baseline = React.useRef<DefaultValues<DocumentFormData>>(form.getValues());
  const draft = useDocumentDraft(scope, saved => {
    const values = saved ? { ...baseline.current, ...saved,
      issue_date: restoreFormDate(saved.issue_date), expiry_date: restoreFormDate(saved.expiry_date),
      ...(preselectedEmployeeId ? { beneficiary_type: 'employee' as const, employee_id: preselectedEmployeeId, company_id: '' } : {}),
      ...(preselectedCompanyId && !preselectedEmployeeId ? { beneficiary_type: 'company' as const, company_id: preselectedCompanyId, employee_id: '' } : {}) } : baseline.current;
    form.reset(values as DocumentFormData);
  });
  React.useEffect(() => {
    const subscription = form.watch((_values, info) => {
      if (info.name) draft.session.current?.change(draftValues(form.getValues()));
    });
    return () => subscription.unsubscribe();
  }, [form, draft.session]);
  const closeForm = React.useCallback(async () => {
    if (submitting.current) return;
    try { if (!draft.session.current || await draft.session.current.close(() => window.confirm(t('documents.form.closeUnsavedConfirm')))) onClose(); }
    catch { toast.error(t('documents.messages.saveError')); }
  }, [draft.session, onClose, t]);
  React.useEffect(() => {
    registerDraftClose?.(closeForm);
    return () => registerDraftClose?.(null);
  }, [registerDraftClose, closeForm]);

  const { stageFile, clearUpload, abandonUpload, hasPendingUpload } = useStagedDocumentUpload();
  const changeFile = async () => {
    if (submitting.current) return;
    submitting.current = true; setIsSubmitting(true);
    try {
      const cleanupPending = await abandonUpload(draft.reference);
      setSelectedFile(null);
      if (cleanupPending) toast.warning(t('documents.form.fileCleanupPending'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('documents.messages.saveError')); }
    finally { submitting.current = false; setIsSubmitting(false); }
  };
  const formIsDirty = form.formState.isDirty;
  useLastSubmissionRestore('documents', allowLastSubmission.current && !editingDocument && draft.status === 'saved' && !draft.hasDraft, (saved) => {
    form.reset({ ...form.getValues(),
      title: selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : String(saved.title ?? ''),
      beneficiary_type: preselectedEmployeeId ? 'employee' : preselectedCompanyId ? 'company' : saved.employee_id ? 'employee' : 'company',
      company_id: preselectedEmployeeId ? '' : preselectedCompanyId ?? String(saved.company_id ?? ''),
      employee_id: preselectedEmployeeId ?? String(saved.employee_id ?? ''),
      document_type_id: String(saved.document_type_id ?? ''), ministry_id: String(saved.ministry_id ?? ''),
      notes: String(saved.notes ?? ''),
    });
  }, () => allowLastSubmission.current && !formIsDirty);

  const handleSubmit = async (data: DocumentFormData, keepOpen = false): Promise<boolean> => {
    if (submitting.current || ['loading', 'discarding', 'failed', 'conflict'].includes(draft.status)) return false;
    submitting.current = true;
    setIsSubmitting(true);
    try {
      if (!selectedFile && !editingDocument) {
        throw new Error(t('documents.messages.noFileError'));
      }
      // Handle file validation for new uploads
      if (selectedFile) {
        const maxSize = 20 * 1024 * 1024; // 20MB
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (selectedFile.size > maxSize) throw new Error(t('documents.messages.fileSizeError'));
        if (!allowedTypes.includes(selectedFile.type)) throw new Error(t('documents.messages.fileTypeError'));
      }
      const draftRef = await draft.prepare(draftValues(data));
      const uploadId = selectedFile
        ? await stageFile(selectedFile, t('documents.messages.saveError'), draftRef)
        : undefined;
      await saveDocument(preselectedEmployeeId ? { ...data, beneficiary_type: 'employee', employee_id: preselectedEmployeeId, company_id: '' } : data, editingDocument?.id, uploadId, t, draftRef);
      draft.session.current?.committed();
      clearUpload();
      toast.success(editingDocument ? t('documents.messages.editSuccess') : t('documents.messages.addSuccess'));
      onSuccess();
      if (keepOpen) {
        allowLastSubmission.current = false;
        baseline.current = newDocumentDefaults(defaultContext);
        setSelectedFile(null);
        await draft.session.current?.restart();
      }
      else onClose();
      return true;
    } catch (error) {
      draft.session.current?.resume(error);
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
      <CardContent className="grid items-start gap-6 p-4 lg:grid-cols-2 lg:p-6">
        <DocumentAttachmentPicker file={selectedFile} editingDocument={editingDocument}
            disabled={isSubmitting || draft.status === 'discarding' || hasPendingUpload() && ['loading', 'failed', 'conflict'].includes(draft.status)}
            onChange={() => void changeFile()} onSelect={file => {
              const title = newDocumentDefaults(defaultContext, file.name).title;
              baseline.current = { ...baseline.current, title };
              setSelectedFile(file); form.setValue('title', title, { shouldDirty: true });
            }} />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => handleSubmit(data), () => toast.error(t('documents.form.validation.reviewFields')))} className="space-y-6">
            <fieldset disabled={isSubmitting || draft.status === 'discarding'} className="space-y-6">
            <DocumentDraftStatus status={draft.status} restored={draft.hasDraft} needsFile={!selectedFile && !editingDocument} onDiscard={() => {
              allowLastSubmission.current = false;
              void draft.session.current?.discard().catch(() => toast.error(t('documents.messages.saveError')));
            }} />
            {(form.watch('title')?.length ?? 0) > 120 && <p role="alert" className="text-destructive">{t('documents.form.validation.titleMaxLength')}</p>}
            {(form.watch('notes')?.length ?? 0) > 5000 && <p role="alert" className="text-destructive">{t('documents.form.validation.notesTooLong')}</p>}
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
                      <Input maxLength={120} placeholder={t('documents.form.titlePlaceholder')} {...field} />
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
                      disabled={!!preselectedEmployeeId || !!preselectedCompanyId}
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
              preselectedCompanyId={preselectedCompanyId}
              preselectedEmployeeId={preselectedEmployeeId}
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
                    <Textarea maxLength={5000}
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
              <Button type="button" variant="outline" onClick={() => void closeForm()} disabled={isSubmitting}>
                <X className="h-4 w-4 ml-2" />
                {t('documents.form.buttons.cancel')}
              </Button>
              
              <div className="flex space-x-2">
                <Button 
                  type="submit" 
                  disabled={isSubmitting || !selectedFile && !editingDocument || ['loading', 'discarding', 'failed', 'conflict'].includes(draft.status)}
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
                    disabled={isSubmitting || !selectedFile || ['loading', 'discarding', 'failed', 'conflict'].includes(draft.status)}
                    onClick={async () => {
                      let saved = false;
                      await form.handleSubmit(async (data) => { saved = await handleSubmit(data, true); },
                        () => toast.error(t('documents.form.validation.reviewFields')))();
                      if (!saved) return;
                      form.reset(baseline.current);
                    }}
                  >
                    <Plus className="h-4 w-4 ml-2" />
                    {t('documents.form.buttons.save')} & {t('common.add')} {t('common.next')}
                  </Button>
                )}
              </div>
            </div>
            </fieldset>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
