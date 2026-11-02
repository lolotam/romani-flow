import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, User, UserCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UploadDropzone } from '@/components/ui/UploadDropzone';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { endpoints, type EmployeeWithRelations } from '@/lib/api';

interface EmployeeDocumentsHeaderProps {
  employee: EmployeeWithRelations;
  documentCount: number;
  onPhotoChange: () => Promise<void>;
}

export function EmployeeDocumentsHeader({ employee, documentCount, onPhotoChange }: EmployeeDocumentsHeaderProps) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const label = (ar: string, en: string) => language === 'ar' ? ar : en;

  const changePhoto = async (file?: File) => {
    if (saving.current) return;
    if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
      toast({ title: t('common.error'), variant: 'destructive',
        description: t(file.type.startsWith('image/') ? 'documents.messages.fileSizeError' : 'documents.messages.fileTypeError') });
      return;
    }
    if (!file && !window.confirm(t('employeeDocuments.photoDeleteConfirm'))) return;
    saving.current = true;
    setIsSaving(true);
    try {
      const result = file ? await endpoints.files.uploadPhoto(employee.id, file)
        : await endpoints.files.removePhoto(employee.id);
      if (result.error) throw result.error;
      setPhotoOpen(false);
      await onPhotoChange();
      toast({ title: t('common.success'),
        description: t(file ? 'employeeDocuments.photoUploadSuccess' : 'employeeDocuments.photoDeleteSuccess') });
    } catch (cause) {
      toast({ title: t('common.error'), description: cause instanceof Error ? cause.message : t('documents.messages.saveError'),
        variant: 'destructive' });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return <div className="flex flex-col sm:flex-row items-start gap-6 flex-1">
    <div className="relative shrink-0">
      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-primary/20 overflow-hidden bg-muted shadow-elegant">
        {employee.photo_path ? <img
          src={`${endpoints.files.photoUrl(employee.id)}?v=${encodeURIComponent(employee.photo_path)}`}
          alt={employee.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><User className="h-10 w-10 text-primary/60" /></div>}
      </div>
      <Button size="icon" className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
        disabled={isSaving} onClick={() => setPhotoOpen(true)} aria-label={label('رفع صورة الموظف', 'Upload employee photo')}>
        <Camera className="h-4 w-4" />
      </Button>
      {employee.photo_path && <Button size="icon" variant="destructive"
        className="absolute -top-1 -left-1 h-6 w-6 rounded-full" disabled={isSaving}
        onClick={() => { void changePhoto(); }} aria-label={label('حذف صورة الموظف', 'Remove employee photo')}>
        <X className="h-3 w-3" />
      </Button>}
    </div>
    <div className="flex-1">
      <Button variant="ghost" size="sm" onClick={() => navigate('/employees')} className="mb-2">
        <ArrowLeft className="h-4 w-4 ml-1" />{t('employeeDocuments.back')}
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold text-gradient">{t('employeeDocuments.title', { name: employee.name })}</h1>
        <Badge>{documentCount}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <UserCheck className="h-5 w-5 text-primary" />
        <span className="text-muted-foreground">{language === 'ar' ? employee.companies?.name_ar : employee.companies?.name}</span>
        {employee.position && <Badge variant="outline">{employee.position}</Badge>}
      </div>
      <p className="text-muted-foreground mt-1">{t('employeeDocuments.totalDocuments', { count: documentCount })}</p>
    </div>
    <Dialog open={photoOpen} onOpenChange={(open) => { if (!saving.current) setPhotoOpen(open); }}>
      <DialogContent className="sm:max-w-md" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{label('رفع صورة الموظف', 'Upload employee photo')}</DialogTitle>
          <DialogDescription>{label(`اختر صورة للموظف ${employee.name}`, `Choose a photo for ${employee.name}`)}</DialogDescription>
        </DialogHeader>
        <UploadDropzone onFilesAccepted={(files) => { if (files[0]) void changePhoto(files[0]); }}
          maxFiles={1} maxFileSize={5 * 1024 * 1024} acceptedFileTypes={['image/*']} disabled={isSaving} />
        <p className="text-xs text-muted-foreground text-center">
          {label('حجم الصورة الأقصى: 5 ميجابايت • الصيغ المدعومة: JPG, PNG, GIF', 'Maximum photo size: 5 MB • Supported formats: JPG, PNG, GIF')}
        </p>
      </DialogContent>
    </Dialog>
  </div>;
}
