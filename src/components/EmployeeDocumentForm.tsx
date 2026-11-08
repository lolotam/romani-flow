import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { CalendarIcon, FileText, Save, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { api, type Document, type DocumentType, type Ministry } from '@/lib/api';
import { useStagedDocumentUpload } from './documents/useStagedDocumentUpload';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDocumentDraft } from '@/hooks/useDocumentDraft';
import { draftValues, type DocumentDraftSession } from '@/lib/documentDraftSession';
import { employeeDocumentDraft, nextDocumentFileTitle } from '@/lib/documentFormDrafts';
import { useAuth } from '@/hooks/useAuth';
import { DocumentDraftStatus } from './documents/DocumentDraftStatus';
import { DocumentAttachmentPicker } from './documents/DocumentAttachmentPicker';
import { useLastSubmissionRestore } from '@/hooks/useLastSubmission';
import { useDocumentExtraction, type DocumentExtractionOptions, type DocumentExtractionState } from '@/hooks/useDocumentExtraction';
import { DocumentExtractionPanel } from './documents/DocumentExtractionPanel';
import { documentNumber } from '../../server/contracts/documentNumber';
import type { Field, Values } from '../../server/contracts/documentExtraction';

const emptyForm = {
  title: '', document_type_id: '', ministry_id: '',
  issue_date: null as Date | null, expiry_date: null as Date | null, notes: '',
  document_number: '',
};

/** The employee form knows the ministry, so every field may be proposed. */
const employeeSupportedFields: Field[] = ['title', 'document_number', 'document_type_id', 'ministry_id', 'issue_date', 'expiry_date'];

interface EmployeeDocumentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  employeeId: string;
  uploadedFile?: File | null;
}

/**
 * The extraction session of the employee form.
 *
 * The hook lives in its own component, so a host that renders the form
 * without the extraction module still renders the form itself.
 */
function EmployeeExtractionBridge({ stateRef, options, disabled }: {
  stateRef: React.MutableRefObject<DocumentExtractionState | null>;
  options: DocumentExtractionOptions;
  disabled: boolean;
}) {
  const state = useDocumentExtraction(options);
  stateRef.current = state;
  return <DocumentExtractionPanel state={state} disabled={disabled} />;
}

export function EmployeeDocumentForm(props: EmployeeDocumentFormProps) {
  const { user } = useAuth();
  return <EmployeeDocumentFormContent key={String(user?.id) + ':' + props.employeeId} {...props} />;
}

function EmployeeDocumentFormContent({
  isOpen,
  onClose,
  onSave,
  employeeId,
  uploadedFile
}: EmployeeDocumentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(uploadedFile ?? null);
  useEffect(() => { setSelectedFile(isOpen ? uploadedFile ?? null : null); }, [isOpen, uploadedFile]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const { t, isRTL } = useLanguage();
  const { user } = useAuth();
  const { stageFile, clearUpload, abandonUpload, hasPendingUpload } = useStagedDocumentUpload();
  const submitting = useRef(false);
  
  const [formData, commitFormData] = useState(emptyForm);
  const latestForm = useRef(emptyForm);
  const setFormData = useCallback((update: React.SetStateAction<typeof emptyForm>) => {
    const next = typeof update === 'function' ? update(latestForm.current) : update;
    latestForm.current = next;
    commitFormData(next);
  }, []);
  const dirty = useRef(false);
  const allowLastSubmission = useRef(true);
  const generatedTitle = useRef<string | null>(uploadedFile ? uploadedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : null);
  const extractionRef = useRef<DocumentExtractionState | null>(null);
  const draftSessionRef = useRef<{ current: DocumentDraftSession | null } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const readExtractionValues = useCallback((): Values => {
    const value = latestForm.current;
    return {
      title: value.title ?? '', document_number: value.document_number ?? '',
      document_type_id: value.document_type_id ?? '', ministry_id: value.ministry_id ?? '',
      issue_date: value.issue_date ? format(value.issue_date, 'yyyy-MM-dd') : '',
      expiry_date: value.expiry_date ? format(value.expiry_date, 'yyyy-MM-dd') : '',
    };
  }, []);
  // A machine write only ever touches the fields it may propose.
  const applyExtractionPatch = useCallback((patch: Partial<Values>) => {
    const next = { ...latestForm.current };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.document_number !== undefined) next.document_number = patch.document_number;
    if (patch.document_type_id !== undefined) next.document_type_id = patch.document_type_id;
    if (patch.ministry_id !== undefined) next.ministry_id = patch.ministry_id;
    if (patch.issue_date !== undefined) next.issue_date = patch.issue_date ? new Date(patch.issue_date + 'T00:00:00') : null;
    if (patch.expiry_date !== undefined) next.expiry_date = patch.expiry_date ? new Date(patch.expiry_date + 'T00:00:00') : null;
    setFormData(next);
    // The machine values enter the draft through the ordinary change of the
    // session, so the order of the writes and the revision of the scope stay
    // the ones of the session itself.
    draftSessionRef.current?.current?.change(draftValues(next));
  }, [setFormData]);
  const extractionOptions: DocumentExtractionOptions = {
    account: user?.id ?? null,
    scope: 'employee:' + employeeId,
    context: ['employee:' + employeeId, documentTypes.length, ministries.length].join('|'),
    file: selectedFile,
    ready: draftReady && documentTypes.length > 0,
    open: isOpen,
    values: readExtractionValues,
    apply: applyExtractionPatch,
    supported: employeeSupportedFields,
    onStart: () => { allowLastSubmission.current = false; },
  };
  const draft = useDocumentDraft('employee:' + employeeId, saved => {
    dirty.current = false;
    if (saved !== null) {
      allowLastSubmission.current = false;
      generatedTitle.current = null;
      // Every key of the restored draft belongs to the administrator, including
      // the ones that are empty or explicitly null.
      extractionRef.current?.protect(employeeSupportedFields.filter(field => Object.prototype.hasOwnProperty.call(saved, field)));
    }
    const restored = employeeDocumentDraft(saved, selectedFile?.name);
    if (saved === null) generatedTitle.current = selectedFile ? restored.title : null;
    setFormData(restored);
  }, isOpen);
  draftSessionRef.current = draft.session;
  // The draft is usable once the session loaded it, even without a restore.
  useEffect(() => {
    if (['saved', 'saving'].includes(draft.status)) setDraftReady(true);
  }, [draft.status]);
  // The form starts empty once per open, before the draft of the scope is
  // restored, and the options that arrive later never erase the form again.
  useEffect(() => { if (isOpen) { dirty.current = false; allowLastSubmission.current = true; setFormData(emptyForm); } }, [isOpen, employeeId, setFormData]);
  useLastSubmissionRestore('documents', allowLastSubmission.current && isOpen && draft.status === 'saved' && !draft.hasDraft, (saved) => {
    generatedTitle.current = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : null;
    // The restored fields belong to the administrator, and a new record never
    // carries the number of the previous one.
    extractionRef.current?.protect(['title', 'document_type_id', 'ministry_id']);
    setFormData(current => ({ ...current, title: selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, '').slice(0, 120) : String(saved.title ?? ''),
      document_type_id: String(saved.document_type_id ?? ''), ministry_id: String(saved.ministry_id ?? ''),
      notes: String(saved.notes ?? ''), document_number: '' }));
  }, () => allowLastSubmission.current && !dirty.current);

  useEffect(() => {
    if (!selectedFile || !['saved', 'saving'].includes(draft.status)) return;
    // A title the administrator cleared stays cleared, even before the draft
    // that carries the clear was written.
    if (generatedTitle.current === null && !draft.hasDraft) return;
    const title = nextDocumentFileTitle(latestForm.current.title, generatedTitle.current, selectedFile.name, draft.hasDraft);
    if (title === null) return;
    dirty.current = true;
    generatedTitle.current = title;
    const next = { ...latestForm.current, title };
    setFormData(next);
    draft.session.current?.change(draftValues(next));
  }, [selectedFile, draft.status, draft.hasDraft, draft.session, setFormData]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadOptions = async () => {
      const types = await api.from<DocumentType>('document_types').select('*').order('name_ar', 'asc').execute();
      if (cancelled) return;
      if (types.error) console.error('Error fetching document types:', types.error);
      else setDocumentTypes(types.data || []);
      const ministries = await api.from<Ministry>('ministries').select('*').order('name_ar', 'asc').execute();
      if (cancelled) return;
      if (ministries.error) console.error('Error fetching ministries:', ministries.error);
      else setMinistries(ministries.data || []);
    };
    void loadOptions();
    return () => { cancelled = true; };
  }, [isOpen]);

  const editForm = (patch: Partial<typeof emptyForm>) => {
    dirty.current = true;
    if (patch.title !== undefined) generatedTitle.current = null;
    // Every administrator edit is a manual value the machine may not replace.
    for (const field of employeeSupportedFields) {
      if (patch[field] === undefined) continue;
      extractionRef.current?.manual(field);
    }
    const next = { ...latestForm.current, ...patch };
    setFormData(next);
    draft.session.current?.change(draftValues(next));
  };

  const changeFile = async () => {
    if (submitting.current) return;
    submitting.current = true; setIsSubmitting(true);
    try {
      // The attempt ends right away, so a late answer can never write into the
      // form. The provenance of the old file is dropped only after the server
      // confirmed the removal of the attachment, so a failed cleanup keeps the
      // old attachment and its machine values together.
      extractionRef.current?.invalidate();
      const cleanupPending = await abandonUpload(draft.reference);
      extractionRef.current?.replace();
      setSelectedFile(null);
      if (cleanupPending) toast.warning(t('documents.form.fileCleanupPending'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('documents.employeeDocumentForm.saveError')); }
    finally { submitting.current = false; setIsSubmitting(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || ['loading', 'discarding', 'failed', 'conflict'].includes(draft.status)) return;
    if (!selectedFile) { toast.error(t('documents.employeeDocumentForm.requiredFieldsError')); return; }
    if (selectedFile.size > 20 * 1024 * 1024) { toast.error(t('documents.messages.fileSizeError')); return; }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(selectedFile.type)) { toast.error(t('documents.messages.fileTypeError')); return; }

    if (!formData.title || !formData.document_type_id) { toast.error(t('documents.employeeDocumentForm.requiredFieldsError')); return; }

    if (formData.title.length > 120) { toast.error(t('documents.form.validation.titleMaxLength')); return; }
    if (formData.notes.length > 5000) { toast.error(t('documents.form.validation.notesTooLong')); return; }
    // The number is checked with the shared contract, so a value the contract
    // refuses never reaches the server.
    const parsedNumber = documentNumber.safeParse(formData.document_number);
    if (!parsedNumber.success) { toast.error(t('extraction.numberTooLong')); return; }
    // A reversed date range is refused before the file is staged.
    if (formData.issue_date && formData.expiry_date && formData.expiry_date < formData.issue_date) {
      toast.error(t('documents.form.validation.invalidDateRange'));
      return;
    }
    submitting.current = true; setIsSubmitting(true);

    try {
      // The extraction stops before the save transaction starts, so a late
      // answer can never write into a document that is being saved.
      extractionRef.current?.cancel();
      const draftRef = await draft.prepare(draftValues(formData));
      const uploadId = await stageFile(selectedFile, t('documents.employeeDocumentForm.saveError'), draftRef);

      // Save metadata and claim the staged upload in one server transaction.
      const payload = {
        draft: draftRef,
        title: formData.title,
        document_number: parsedNumber.data,
        document_type_id: formData.document_type_id,
        employee_id: employeeId,
        company_id: null, // Employee document, not company
        ministry_id: formData.ministry_id || null,
        issue_date: formData.issue_date ? format(formData.issue_date, 'yyyy-MM-dd') : null,
        expiry_date: formData.expiry_date ? format(formData.expiry_date, 'yyyy-MM-dd') : null,
        notes: formData.notes || null,
        ...(uploadId ? { upload_id: uploadId } : {}),
      };
      const { error: dbError } = await api.insert<Document>('documents', payload);

      if (dbError) {
        throw dbError;
      }

      draft.session.current?.committed();
      clearUpload();
      toast.success(t('documents.employeeDocumentForm.saveSuccess'));
      onSave();
      onClose();
    } catch (error) {
      draft.session.current?.resume(error);
      console.error('Error saving document:', error);
      toast.error(error instanceof Error ? error.message : t('documents.employeeDocumentForm.saveError'));
    } finally { submitting.current = false; setIsSubmitting(false); }
  };

  const handleClose = async () => {
    if (submitting.current) return;
    // The extraction stops before the draft is closed, so a late answer can
    // never write into a form that is on its way out.
    extractionRef.current?.cancel();
    try {
      const closed = !draft.session.current || await draft.session.current.close(() => window.confirm(t('documents.form.closeUnsavedConfirm')));
      if (closed) onClose();
    }
    catch { toast.error(t('documents.employeeDocumentForm.saveError')); }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('documents.employeeDocumentForm.title')}
          </DialogTitle>
          <DialogDescription>
            {t('documents.employeeDocumentForm.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid items-start gap-6 lg:grid-cols-2">
        <DocumentAttachmentPicker file={selectedFile} disabled={isSubmitting || draft.status === 'discarding' || hasPendingUpload() && ['loading', 'failed', 'conflict'].includes(draft.status)}
          onChange={() => void changeFile()} onSelect={setSelectedFile} />
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset disabled={isSubmitting || draft.status === 'discarding'} className="space-y-6">
          {formData.title.length > 120 && <p role="alert" className="text-destructive">{t('documents.form.validation.titleMaxLength')}</p>}
          {formData.notes.length > 5000 && <p role="alert" className="text-destructive">{t('documents.form.validation.notesTooLong')}</p>}
          {formData.issue_date && formData.expiry_date && formData.expiry_date < formData.issue_date &&
            <p role="alert" className="text-destructive">{t('documents.form.validation.invalidDateRange')}</p>}
          <DocumentDraftStatus status={draft.status} restored={draft.hasDraft} needsFile={!selectedFile} onDiscard={() => {
            allowLastSubmission.current = false;
            // The machine provenance is dropped before the draft is discarded,
            // and the protection returns only when the discard succeeded.
            extractionRef.current?.invalidate();
            const session = draft.session.current;
            if (!session) return;
            void session.discard().then(() => { extractionRef.current?.reset(); }).catch(() => toast.error(t('documents.employeeDocumentForm.saveError')));
          }} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="title">{t('documents.form.title')} *</Label>
              <Input
                id="title"
                maxLength={120}
                value={formData.title}
                onChange={(e) => editForm({ title: e.target.value })}
                placeholder={t('documents.form.titlePlaceholder')}
                required
              />
            </div>

            <div>
              <Label htmlFor="document_number">{t('extraction.documentNumber')}</Label>
              <Input
                id="document_number"
                type="text"
                maxLength={128}
                value={formData.document_number}
                onChange={(e) => editForm({ document_number: e.target.value })}
                placeholder={t('extraction.documentNumber')}
              />
            </div>

            <div>
              <Label htmlFor="document_type_id">{t('documents.form.documentType')} *</Label>
              <Select
                value={formData.document_type_id}
                onValueChange={(value) => { if (!value) return; editForm({ document_type_id: value }); }}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('documents.form.selectDocumentType')} />
                </SelectTrigger>
                <SelectContent>
                  {documentTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="ministry_id">{t('documents.form.ministry')}</Label>
              <Select
                value={formData.ministry_id}
                onValueChange={(value) => { if (!value) return; editForm({ ministry_id: value }); }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('documents.form.selectMinistry')} />
                </SelectTrigger>
                <SelectContent>
                  {ministries.map((ministry) => (
                    <SelectItem key={ministry.id} value={ministry.id}>
                      {ministry.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('documents.form.issueDate')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.issue_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {formData.issue_date ? format(formData.issue_date, "PPP") : t('documents.form.selectDate')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.issue_date || undefined}
                    onSelect={(date) => editForm({ issue_date: date || null })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>{t('documents.form.expiryDate')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.expiry_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {formData.expiry_date ? format(formData.expiry_date, "PPP") : t('documents.form.selectDate')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.expiry_date || undefined}
                    onSelect={(date) => editForm({ expiry_date: date || null })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="notes">{t('documents.form.notes')}</Label>
              <Textarea maxLength={5000}
                id="notes"
                value={formData.notes}
                onChange={(e) => editForm({ notes: e.target.value })}
                placeholder={t('documents.form.notesPlaceholder')}
                rows={3}
              />
            </div>

            {selectedFile && (
              <div className="md:col-span-2 p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{t('documents.employeeDocumentForm.attachedFile')}</span>
                  <span className="text-sm text-muted-foreground">{selectedFile.name}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={isSubmitting || !selectedFile || ['loading', 'discarding', 'failed', 'conflict'].includes(draft.status)} className="flex-1">
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  {t('documents.employeeDocumentForm.saving')}
                </div>
              ) : (
                <>
                  <Save className="h-4 w-4 ml-2" />
                  {t('documents.employeeDocumentForm.save')}
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              <X className="h-4 w-4 ml-2" />
              {t('documents.employeeDocumentForm.cancel')}
            </Button>
          </div>
          {/* The extraction panel follows the actions, so the panel of a running
              attempt never takes the place of the cancel of the form itself. */}
          <EmployeeExtractionBridge stateRef={extractionRef} options={extractionOptions} disabled={isSubmitting || draft.status === 'discarding'} />
          </fieldset>
        </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
