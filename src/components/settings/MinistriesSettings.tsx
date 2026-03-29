import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { Shield, Pencil, Trash2 } from 'lucide-react';
import type { Ministry } from './types';

interface MinistriesSettingsProps {
  ministries: Ministry[];
  newMinistry: { name: string; name_ar: string };
  onNewMinistryChange: (value: { name: string; name_ar: string }) => void;
  onAdd: () => void;
  onEdit: (ministry: Ministry) => void;
  onDelete: (ministry: Ministry) => void;
}

export default function MinistriesSettings({
  ministries, newMinistry, onNewMinistryChange, onAdd, onEdit, onDelete
}: MinistriesSettingsProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Shield className="h-5 w-5" />
          <span>{t('settings.ministries.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.ministries.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="ministry_name_ar">{t('settings.ministries.nameArabic')}</Label>
            <Input
              id="ministry_name_ar"
              value={newMinistry.name_ar}
              onChange={(e) => onNewMinistryChange({ ...newMinistry, name_ar: e.target.value })}
              placeholder={t('settings.ministries.nameArabicPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="ministry_name_en">{t('settings.ministries.nameEnglish')}</Label>
            <Input
              id="ministry_name_en"
              value={newMinistry.name}
              onChange={(e) => onNewMinistryChange({ ...newMinistry, name: e.target.value })}
              placeholder={t('settings.ministries.nameEnglishPlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onAdd} className="w-full">{t('settings.ministries.addNew')}</Button>
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="font-semibold mb-3">{t('settings.ministries.currentMinistriesCount', { count: ministries.length })}</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {ministries.map((ministry) => (
              <div key={ministry.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{ministry.name_ar}</p>
                  <p className="text-sm text-muted-foreground">{ministry.name}</p>
                </div>
                <div className="flex space-x-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(ministry)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDelete(ministry)}>
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
