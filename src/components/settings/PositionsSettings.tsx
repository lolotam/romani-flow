import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { UserCog, Pencil, Trash2 } from 'lucide-react';
import type { Position } from './types';

interface PositionsSettingsProps {
  positions: Position[];
  newPosition: { name: string; name_ar: string; value: string };
  onNewPositionChange: (value: { name: string; name_ar: string; value: string }) => void;
  onAdd: () => void;
  onEdit: (position: Position) => void;
  onDelete: (position: Position) => void;
}

export default function PositionsSettings({
  positions, newPosition, onNewPositionChange, onAdd, onEdit, onDelete
}: PositionsSettingsProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <UserCog className="h-5 w-5" />
          <span>{t('settings.positions.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.positions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="position_name_ar">{t('settings.positions.nameArabic')}</Label>
            <Input
              id="position_name_ar"
              value={newPosition.name_ar}
              onChange={(e) => onNewPositionChange({ ...newPosition, name_ar: e.target.value })}
              placeholder={t('settings.positions.nameArabicPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="position_name_en">{t('settings.positions.nameEnglish')}</Label>
            <Input
              id="position_name_en"
              value={newPosition.name}
              onChange={(e) => onNewPositionChange({ ...newPosition, name: e.target.value })}
              placeholder={t('settings.positions.nameEnglishPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="position_value">{t('settings.positions.value')}</Label>
            <Input
              id="position_value"
              value={newPosition.value}
              onChange={(e) => onNewPositionChange({ ...newPosition, value: e.target.value })}
              placeholder={t('settings.positions.valuePlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onAdd} className="w-full">{t('settings.positions.addNew')}</Button>
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="font-semibold mb-3">{t('settings.positions.currentPositionsCount', { count: positions.length })}</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {positions.map((position) => (
              <div key={position.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{position.name_ar}</p>
                  <p className="text-sm text-muted-foreground">{position.name} - {position.value}</p>
                </div>
                <div className="flex space-x-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(position)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDelete(position)}>
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
