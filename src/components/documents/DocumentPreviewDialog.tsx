import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Download, FileText, Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { calculateDocumentStatus } from '@/lib/statusUtils';
import { endpoints, type DocumentWithRelations } from '@/lib/api';

interface DocumentPreviewDialogProps {
  document: DocumentWithRelations | null;
  onClose: () => void;
  handleDownloadDocument: (doc: DocumentWithRelations) => void;
  handleEmailDocument: (doc: DocumentWithRelations) => void;
  emailLabel: string;
}

export function DocumentPreviewDialog({ document, onClose, handleDownloadDocument,
  handleEmailDocument, emailLabel }: DocumentPreviewDialogProps) {
  const { t, language } = useLanguage();
  return <>
    {/* View Document Dialog */}
    <Dialog open={!!document} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تفاصيل الوثيقة</DialogTitle>
          <DialogDescription>
            عرض جميع بيانات الوثيقة
          </DialogDescription>
        </DialogHeader>
        {document && (
          <div className="space-y-6">
            {/* File Preview Section */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <Label className="text-sm font-medium text-muted-foreground mb-2 block">معاينة الملف</Label>
              {(() => {
                const filePath = document.file_path;
                if (!filePath) {
                  return (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>لا يوجد ملف مرفق</p>
                    </div>
                  );
                }
                if (document.mime_type?.startsWith('image/')) {
                  return (
                    <div className="flex justify-center">
                      <img src={endpoints.files.previewUrl(document.id)} alt={document.title} className="max-w-full max-h-96 object-contain rounded border" />
                    </div>
                  );
                }
                if (document.mime_type === 'application/pdf') {
                  return (
                    <div className="text-center">
                      <iframe src={endpoints.files.previewUrl(document.id)} className="w-full h-96 border rounded" title={document.title} />
                      <p className="text-sm text-muted-foreground mt-2">ملف PDF - اضغط على تحميل لعرضه بطريقة أفضل</p>
                    </div>
                  );
                }
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>معاينة الملف غير متوفرة</p>
                    <p className="text-xs">{document.file_name || ''}</p>
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium text-muted-foreground">العنوان</Label>
                <p className="text-sm font-medium">{document.title}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-muted-foreground">نوع الوثيقة</Label>
                <p className="text-sm">{document.document_types?.name_ar}</p>
              </div>
              <div>
                <Label className="text-sm font-medium text-muted-foreground">الحالة</Label>
                <StatusBadge status={calculateDocumentStatus(document.expiry_date)} />
              </div>
              <div>
                <Label className="text-sm font-medium text-muted-foreground">اسم الملف</Label>
                <p className="text-sm">{document.file_name || 'غير متوفر'}</p>
              </div>
              {document.issue_date && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">تاريخ الإصدار</Label>
                  <p className="text-sm">{new Date(document.issue_date).toLocaleDateString('en-GB')}</p>
                </div>
              )}
              {document.expiry_date && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">تاريخ انتهاء الصلاحية</Label>
                  <p className="text-sm">{new Date(document.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}</p>
                </div>
              )}
              {document.companies && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">الشركة</Label>
                  <p className="text-sm">{document.companies.name}</p>
                </div>
              )}
              {document.employees && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">الموظف</Label>
                  <p className="text-sm">{document.employees.name}</p>
                </div>
              )}
              {document.ministries && (
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">الوزارة</Label>
                  <p className="text-sm">{document.ministries.name_ar}</p>
                </div>
              )}
              {document.notes && (
                <div className="md:col-span-2">
                  <Label className="text-sm font-medium text-muted-foreground">ملاحظات</Label>
                  <p className="text-sm">{document.notes}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-4">
              <Button variant="outline" disabled={!document.file_path} onClick={() => handleEmailDocument(document)}>
                <Mail className="h-4 w-4 ml-2" />
                {emailLabel}
              </Button>
              <Button
                onClick={() => handleDownloadDocument(document)}
                className="flex-1"
              >
                <Download className="h-4 w-4 ml-2" />
                تحميل الوثيقة
              </Button>
              <Button
                variant="outline"
                onClick={() => onClose()}
              >
                إغلاق
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  </>;
}
