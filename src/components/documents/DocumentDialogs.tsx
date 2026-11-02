import type { ComponentProps } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { DocumentForm } from '@/components/DocumentForm';
import { useLanguage } from '@/contexts/LanguageContext';

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesAccepted: (files: File[]) => void;
}

export function DocumentUploadDialog({ open, onOpenChange, onFilesAccepted }: DocumentUploadDialogProps) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="shadow-elegant hover:shadow-glow transition-all">
          <Upload className="h-4 w-4 ml-2" />
          {t('documents.uploadDocuments')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('documents.uploadNew')}</DialogTitle>
          <DialogDescription>{t('documents.chooseFiles')}</DialogDescription>
        </DialogHeader>
        <UploadDropzone onFilesAccepted={onFilesAccepted} maxFiles={1} maxFileSize={20 * 1024 * 1024} />
      </DialogContent>
    </Dialog>
  );
}

export function DocumentEditorDialog(props: ComponentProps<typeof DocumentForm>) {
  const { t } = useLanguage();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(props.editingDocument ? 'documents.card.editDocument' : 'documents.uploadNew')}</DialogTitle>
          <DialogDescription>{props.fileName}</DialogDescription>
        </DialogHeader>
        <DocumentForm {...props} />
      </DialogContent>
    </Dialog>
  );
}
