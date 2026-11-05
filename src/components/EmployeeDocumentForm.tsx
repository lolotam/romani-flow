import React, { useState, useEffect, useRef } from 'react';
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
import { draftValues } from '@/lib/documentDraftSession';
import { restoreFormDate } from '@/lib/formDefaults';
import { useAuth } from '@/hooks/useAuth';
import { DocumentDraftStatus } from './documents/DocumentDraftStatus';
import { DocumentAttachment } from './documents/DocumentAttachment';
import { useLastSubmissionRestore } from '@/hooks/useLastSubmission';

const emptyForm = {
  title: '', document_type_id: '', ministry_id: '',
  issue_date: null as Date | null, expiry_date: null as Date | null, notes: '',
};

interface EmployeeDocumentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  employeeId: string;
  uploadedFile?: File | null;
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
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const { t, isRTL } = useLanguage();
  const { stageFile, clearUpload } = useStagedDocumentUpload();
  const submitting = useRef(false);
  
  const [formData, setFormData] = useState(emptyForm);
  const dirty = useRef(false);
  const draft = useDocumentDraft('employee:' + employeeId, saved => {
    setFormData({ ...emptyForm, ...(saved ?? {}),
      issue_date: restoreFormDate(saved?.issue_date) ?? null, expiry_date: restoreFormDate(saved?.expiry_date) ?? null });
  }, isOpen);
  useEffect(() => { if (isOpen) dirty.current = false; }, [isOpen, employeeId]);
  useLastSubmissionRestore('documents', isOpen && draft.status === 'saved' && !draft.hasDraft, (saved) => {
    setFormData(current => ({ ...current, title: uploadedFile ? uploadedFile.name.replace(/\.[^/.]+$/, '') : String(saved.title ?? ''),
      document_type_id: String(saved.document_type_id ?? ''), ministry_id: String(saved.ministry_id ?? ''),
      notes: String(saved.notes ?? '') }));
  }, () => !dirty.current);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setFormData(emptyForm);
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

  useEffect(() => {
    if (isOpen && uploadedFile) {
      setFormData(prev => ({
        ...prev,
        title: uploadedFile.name.replace(/\.[^/.]+$/, ''), // Remove file extension
      }));
    }
  }, [isOpen, uploadedFile]);

  const editForm = (patch: Partial<typeof emptyForm>) => {
    dirty.current = true;
    const next = { ...formData, ...patch };
    setFormData(next);
    draft.session.current?.change(draftValues(next));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    
    if (!formData.title || !formData.document_type_id) {
      toast.error(t('documents.employeeDocumentForm.requiredFieldsError'));
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    
    try {
      const draftRef = await draft.prepare(draftValues(formData));
      const uploadId = uploadedFile
        ? await stageFile(uploadedFile, t('documents.employeeDocumentForm.saveError'))
        : undefined;

      // Save metadata and claim the staged upload in one server transaction.
      const payload = {
        draft: draftRef,
        title: formData.title,
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
        throw new Error(`${t('documents.employeeDocumentForm.saveError')}: ${dbError.message}`);
      }

      draft.session.current?.committed();
      clearUpload();
      toast.success(t('documents.employeeDocumentForm.saveSuccess'));
      onSave();
      onClose();
    } catch (error) {
      draft.session.current?.resume();
      console.error('Error saving document:', error);
      toast.error(error instanceof Error ? error.message : t('documents.employeeDocumentForm.saveError'));
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (submitting.current) return;
    try { await draft.session.current?.flush(); onClose(); }
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
        <DocumentAttachment uploadedFile={uploadedFile ?? null} />
        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset disabled={isSubmitting} className="space-y-6">
          <DocumentDraftStatus status={draft.status} restored={draft.hasDraft} needsFile={!uploadedFile} onDiscard={() => void draft.session.current?.discard().catch(() => toast.error(t('documents.employeeDocumentForm.saveError')))} />
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
              <Label htmlFor="document_type_id">{t('documents.form.documentType')} *</Label>
              <Select
                value={formData.document_type_id}
                onValueChange={(value) => editForm({ document_type_id: value })}
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
                onValueChange={(value) => editForm({ ministry_id: value })}
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

            {uploadedFile && (
              <div className="md:col-span-2 p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{t('documents.employeeDocumentForm.attachedFile')}</span>
                  <span className="text-sm text-muted-foreground">{uploadedFile.name}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={isSubmitting || ['loading', 'failed', 'conflict'].includes(draft.status)} className="flex-1">
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
          </fieldset>
        </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
