import React from 'react';
import { useForm, type DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
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
import { draftValues, type DocumentDraftSession } from '@/lib/documentDraftSession';
import { restoreFormDate } from '@/lib/formDefaults';
import { useAuth } from '@/hooks/useAuth';
import { DocumentDraftStatus } from './documents/DocumentDraftStatus';
import { useLastSubmissionRestore } from '@/hooks/useLastSubmission';
import { newDocumentDefaults, nextDocumentFileTitle } from '@/lib/documentFormDrafts';
import { useDocumentExtraction, type DocumentExtractionOptions, type DocumentExtractionState } from '@/hooks/useDocumentExtraction';
import { DocumentExtractionPanel } from './documents/DocumentExtractionPanel';
import type { Field, Values } from '../../server/contracts/documentExtraction';

/** The fields an extraction may propose, in the order of the shared contract. */
const extractionFieldNames: Field[] = ['title', 'document_number', 'document_type_id', 'ministry_id', 'issue_date', 'expiry_date'];

/**
 * The extraction session of a document form.
 *
 * The hook lives in its own component, so a host that renders the form
 * without the extraction module still renders the form itself. The session is
 * handed to the form through a ref, because the form calls it long before the
 * panel of the attempt is on the screen.
 */
export function DocumentExtractionBridge({ stateRef, options, disabled }: {
  stateRef: React.MutableRefObject<DocumentExtractionState | null>;
  options: DocumentExtractionOptions;
  disabled: boolean;
}) {
  const state = useDocumentExtraction(options);
  stateRef.current = state;
  return <DocumentExtractionPanel state={state} disabled={disabled} />;
}

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
  const { user } = useAuth();
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
      document_number: editingDocument.document_number ?? '',
    } : newDocumentDefaults(defaultContext, fileName),
  });

  const baseline = React.useRef<DefaultValues<DocumentFormData>>(form.getValues());
  const generatedTitle = React.useRef<string | null>(!editingDocument && fileName ? baseline.current.title ?? null : null);
  const extractionRef = React.useRef<DocumentExtractionState | null>(null);
  const draftSessionRef = React.useRef<{ current: DocumentDraftSession | null } | null>(null);
  const [draftReady, setDraftReady] = React.useState(false);
  const beneficiaryType = form.watch('beneficiary_type');
  const watchedCompanyId = form.watch('company_id');
  const watchedEmployeeId = form.watch('employee_id');
  // The general form has no ministry in employee mode, so the ministry is not a
  // field the machine may ever propose there.
  const supportedFields: Field[] = beneficiaryType === 'employee'
    ? ['title', 'document_number', 'document_type_id', 'issue_date', 'expiry_date']
    : ['title', 'document_number', 'document_type_id', 'ministry_id', 'issue_date', 'expiry_date'];
  const readExtractionValues = React.useCallback((): Values => {
    const value = form.getValues();
    return {
      title: value.title ?? '',
      document_number: value.document_number ?? '',
      document_type_id: value.document_type_id ?? '',
      ministry_id: value.ministry_id ?? '',
      issue_date: value.issue_date ? format(value.issue_date, 'yyyy-MM-dd') : '',
      expiry_date: value.expiry_date ? format(value.expiry_date, 'yyyy-MM-dd') : '',
    };
  }, [form]);
  const applyExtractionPatch = React.useCallback((patch: Partial<Values>) => {
    if (patch.title !== undefined) form.setValue('title', patch.title, { shouldDirty: true });
    if (patch.document_number !== undefined) form.setValue('document_number', patch.document_number, { shouldDirty: true });
    if (patch.document_type_id !== undefined) form.setValue('document_type_id', patch.document_type_id, { shouldDirty: true });
    if (patch.ministry_id !== undefined) form.setValue('ministry_id', patch.ministry_id, { shouldDirty: true });
    if (patch.issue_date !== undefined) form.setValue('issue_date', patch.issue_date ? new Date(patch.issue_date + 'T00:00:00') : undefined, { shouldDirty: true });
    if (patch.expiry_date !== undefined) form.setValue('expiry_date', patch.expiry_date ? new Date(patch.expiry_date + 'T00:00:00') : undefined, { shouldDirty: true });
    // The machine values enter the draft through the ordinary change of the
    // session, so the order of the writes and the revision of the scope stay
    // the ones of the session itself.
    draftSessionRef.current?.current?.change(draftValues(form.getValues()));
  }, [form]);
  const extractionOptions: DocumentExtractionOptions = {
    account: user?.id ?? null,
    scope,
    context: [scope, beneficiaryType, watchedCompanyId, watchedEmployeeId, documentTypes.length, ministries.length].join('|'),
    file: selectedFile,
    ready: draftReady && documentTypes.length > 0,
    open: true,
    values: readExtractionValues,
    apply: applyExtractionPatch,
    supported: supportedFields,
    onStart: () => { allowLastSubmission.current = false; },
  };
  const draft = useDocumentDraft(scope, saved => {
    if (saved !== null) {
      allowLastSubmission.current = false;
      generatedTitle.current = null;
      // Every key of the restored draft belongs to the administrator, including
      // the ones that are empty or explicitly null.
      extractionRef.current?.protect(extractionFieldNames.filter(field => Object.prototype.hasOwnProperty.call(saved, field)));
    }
    let empty = baseline.current;
    if (saved === null && !editingDocument) {
      const title = selectedFile?.name.replace(/\.[^/.]+$/, '').slice(0, 120) ?? '';
      generatedTitle.current = selectedFile ? title : null;
      empty = { ...baseline.current, title };
    }
    const values = saved ? { ...baseline.current, ...saved,
      issue_date: restoreFormDate(saved.issue_date), expiry_date: restoreFormDate(saved.expiry_date),
      ...(preselectedEmployeeId ? { beneficiary_type: 'employee' as const, employee_id: preselectedEmployeeId, company_id: '' } : {}),
      ...(preselectedCompanyId && !preselectedEmployeeId ? { beneficiary_type: 'company' as const, company_id: preselectedCompanyId, employee_id: '' } : {}) } : empty;
    form.reset(values as DocumentFormData);
    // The draft of the form is usable now, so an extraction may start.
    setDraftReady(true);
  });
  draftSessionRef.current = draft.session;
  // A stored document owns every one of its fields, and the filename title of a
  // new document is never a machine value.
  React.useEffect(() => {
    extractionRef.current?.protect(editingDocument ? [...extractionFieldNames] : ['title']);
  }, [editingDocument]);
  React.useEffect(() => {
    if (!selectedFile || editingDocument || !['saved', 'saving'].includes(draft.status)) return;
    const next = nextDocumentFileTitle(form.getValues('title'), generatedTitle.current, selectedFile.name, draft.hasDraft);
    if (next === null) return;
    generatedTitle.current = next;
    form.setValue('title', next, { shouldDirty: true });
  }, [selectedFile, editingDocument, draft.status, draft.hasDraft, form]);
  React.useEffect(() => {
    const subscription = form.watch((_values, info) => {
      if (info.name === 'title' && form.getValues('title') !== generatedTitle.current) generatedTitle.current = null;
      if (info.name) draft.session.current?.change(draftValues(form.getValues()));
    });
    return () => subscription.unsubscribe();
  }, [form, draft.session]);
  const closeForm = React.useCallback(async () => {
    if (submitting.current) return;
    // The extraction stops before the draft is closed, so a late answer can
    // never write into a form that is on its way out.
    extractionRef.current?.cancel();
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
      // The replacement happens before the upload is abandoned, so the machine
      // provenance of the old file is dropped in the same tick.
      extractionRef.current?.replace();
      const cleanupPending = await abandonUpload(draft.reference);
      setSelectedFile(null);
      if (cleanupPending) toast.warning(t('documents.form.fileCleanupPending'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('documents.messages.saveError')); }
    finally { submitting.current = false; setIsSubmitting(false); }
  };
  const formIsDirty = form.formState.isDirty;
  useLastSubmissionRestore('documents', allowLastSubmission.current && !editingDocument && draft.status === 'saved' && !draft.hasDraft, (saved) => {
    generatedTitle.current = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : null;
    // The restored fields belong to the administrator, and a new record never
    // carries the number of the previous one.
    extractionRef.current?.protect(['title', 'document_type_id', 'ministry_id']);
    form.reset({ ...form.getValues(),
      title: selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : String(saved.title ?? ''),
      beneficiary_type: preselectedEmployeeId ? 'employee' : preselectedCompanyId ? 'company' : saved.employee_id ? 'employee' : 'company',
      company_id: preselectedEmployeeId ? '' : preselectedCompanyId ?? String(saved.company_id ?? ''),
      employee_id: preselectedEmployeeId ?? String(saved.employee_id ?? ''),
      document_type_id: String(saved.document_type_id ?? ''), ministry_id: String(saved.ministry_id ?? ''),
      notes: String(saved.notes ?? ''),
      document_number: '',
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
      // The extraction stops before the save transaction starts, so a late
      // answer can never write into a document that is being saved.
      extractionRef.current?.cancel();
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
        generatedTitle.current = null;
        baseline.current = newDocumentDefaults(defaultContext);
        setSelectedFile(null);
        await draft.session.current?.restart();
        // A new record starts a new extraction session.
        extractionRef.current?.reset();
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
    <Card className="min-w-0 w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <CardContent className="grid min-w-0 grid-cols-1 items-start gap-6 p-4 lg:grid-cols-2 lg:p-6">
        <DocumentAttachmentPicker file={selectedFile} editingDocument={editingDocument}
            disabled={isSubmitting || draft.status === 'discarding' || hasPendingUpload() && ['loading', 'failed', 'conflict'].includes(draft.status)}
            onChange={() => void changeFile()} onSelect={setSelectedFile} />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => handleSubmit(data), () => toast.error(t('documents.form.validation.reviewFields')))} className="min-w-0 space-y-6">
            <fieldset disabled={isSubmitting || draft.status === 'discarding'} className="min-w-0 space-y-6">
            <DocumentDraftStatus status={draft.status} restored={draft.hasDraft} needsFile={!selectedFile && !editingDocument} onDiscard={() => {
              allowLastSubmission.current = false;
              // The machine provenance is dropped before the draft is discarded,
              // and the protection returns only when the discard succeeded.
              extractionRef.current?.invalidate();
              const session = draft.session.current;
              if (!session) return;
              void session.discard().then(() => { extractionRef.current?.reset(); }).catch(() => toast.error(t('documents.messages.saveError')));
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
                      <Input maxLength={120} placeholder={t('documents.form.titlePlaceholder')} {...field}
                        onChange={event => { extractionRef.current?.manual('title'); field.onChange(event); }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="document_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('extraction.documentNumber')}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} type="text" maxLength={128}
                        onChange={event => { extractionRef.current?.manual('document_number'); field.onChange(event); }} />
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
                        // The beneficiary change ends the attempt of the old
                        // context and drops the machine provenance of the
                        // values it filled and that nobody changed afterwards.
                        // A value the administrator owns stays.
                        extractionRef.current?.replace();
                        extractionRef.current?.manual('document_type_id');
                        extractionRef.current?.manual('ministry_id');
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
              onManualChange={field => extractionRef.current?.manual(field)}
              onContextChange={() => extractionRef.current?.replace()}
            />
            <DocumentDateFields onManualChange={field => extractionRef.current?.manual(field)} />

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
            <div className="flex flex-col gap-2 pt-4 border-t sm:flex-row sm:flex-wrap sm:justify-between">
              <Button type="button" variant="outline" onClick={() => void closeForm()} disabled={isSubmitting}>
                <X className="h-4 w-4 ml-2" />
                {t('documents.form.buttons.cancel')}
              </Button>
              
              <div className="flex flex-col gap-2 sm:flex-row">
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
            {/* The extraction panel follows the actions, so the panel of a running
                attempt never takes the place of the cancel of the form itself. */}
            <DocumentExtractionBridge stateRef={extractionRef} options={extractionOptions}
              disabled={isSubmitting || draft.status === 'discarding'} />
            </fieldset>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
