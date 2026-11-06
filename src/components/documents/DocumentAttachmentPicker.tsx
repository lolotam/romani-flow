import { Button } from '@/components/ui/button';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { useLanguage } from '@/contexts/LanguageContext';
import { DocumentAttachment } from './DocumentAttachment';
import type { DocumentFormProps } from './documentFormSchema';

/** Shared in-dialog attachment selection; existing stored files remain preview-only. */
export function DocumentAttachmentPicker({ file, editingDocument, disabled, onSelect, onChange }: {
  file: File | null; editingDocument?: DocumentFormProps['editingDocument']; disabled: boolean;
  onSelect: (file: File) => void; onChange: () => void;
}) {
  const { t } = useLanguage();
  return <div className="space-y-3">
    <DocumentAttachment uploadedFile={file} editingDocument={editingDocument} />
    {file && !editingDocument && <Button type="button" variant="outline" disabled={disabled} onClick={onChange}>{t('documents.chooseFiles')}</Button>}
    {!file && !editingDocument && <UploadDropzone maxFiles={1} maxFileSize={20 * 1024 * 1024}
      acceptedFileTypes={['.pdf', '.jpg', '.jpeg', '.png']} disabled={disabled}
      onFilesAccepted={files => { if (files[0]) onSelect(files[0]); }} />}
  </div>;
}
