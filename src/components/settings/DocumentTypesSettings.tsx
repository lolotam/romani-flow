import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import type { DocumentType } from './types';

interface DocumentTypesSettingsProps {
  documentTypes: DocumentType[];
  newDocType: { name: string; name_ar: string };
  onNewDocTypeChange: (value: { name: string; name_ar: string }) => void;
  onAdd: () => void;
  onEdit: (docType: DocumentType) => void;
  onDelete: (docType: DocumentType) => void;
}

export default function DocumentTypesSettings({
  documentTypes, newDocType, onNewDocTypeChange, onAdd, onEdit, onDelete
}: DocumentTypesSettingsProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>{t('settings.documentTypes.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.documentTypes.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="doctype_name_ar">{t('settings.documentTypes.nameArabic')}</Label>
            <Input
              id="doctype_name_ar"
              value={newDocType.name_ar}
              onChange={(e) => onNewDocTypeChange({ ...newDocType, name_ar: e.target.value })}
              placeholder={t('settings.documentTypes.nameArabicPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="doctype_name_en">{t('settings.documentTypes.nameEnglish')}</Label>
            <Input
              id="doctype_name_en"
              value={newDocType.name}
              onChange={(e) => onNewDocTypeChange({ ...newDocType, name: e.target.value })}
              placeholder={t('settings.documentTypes.nameEnglishPlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onAdd} className="w-full">{t('settings.documentTypes.addNew')}</Button>
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="font-semibold mb-3">{t('settings.documentTypes.currentTypesCount', { count: documentTypes.length })}</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {documentTypes.map((docType) => (
              <div key={docType.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{docType.name_ar}</p>
                  <p className="text-sm text-muted-foreground">{docType.name}</p>
                </div>
                <div className="flex space-x-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(docType)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDelete(docType)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
