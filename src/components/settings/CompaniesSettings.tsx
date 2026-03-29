import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { Building2, Pencil, Trash2 } from 'lucide-react';
import type { Company } from './types';

interface CompaniesSettingsProps {
  companies: Company[];
  newCompany: { name: string; name_ar: string; description: string };
  onNewCompanyChange: (value: { name: string; name_ar: string; description: string }) => void;
  onAdd: () => void;
  onEdit: (company: Company) => void;
  onDelete: (company: Company) => void;
}

export default function CompaniesSettings({
  companies, newCompany, onNewCompanyChange, onAdd, onEdit, onDelete
}: CompaniesSettingsProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Building2 className="h-5 w-5" />
          <span>{t('settings.companies.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.companies.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="company_name_ar">{t('settings.companies.nameArabic')}</Label>
            <Input
              id="company_name_ar"
              value={newCompany.name_ar}
              onChange={(e) => onNewCompanyChange({ ...newCompany, name_ar: e.target.value })}
              placeholder={t('settings.companies.nameArabicPlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="company_name_en">{t('settings.companies.nameEnglish')}</Label>
            <Input
              id="company_name_en"
              value={newCompany.name}
              onChange={(e) => onNewCompanyChange({ ...newCompany, name: e.target.value })}
              placeholder={t('settings.companies.nameEnglishPlaceholder')}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onAdd} className="w-full">{t('settings.companies.addNew')}</Button>
          </div>
        </div>
        <div>
          <Label htmlFor="company_description">{t('settings.companies.description')}</Label>
          <Textarea
            id="company_description"
            value={newCompany.description}
            onChange={(e) => onNewCompanyChange({ ...newCompany, description: e.target.value })}
            placeholder={t('settings.companies.descriptionPlaceholder')}
          />
        </div>

        <div className="pt-4 border-t">
          <h3 className="font-semibold mb-3">{t('settings.companies.currentCompaniesCount', { count: companies.length })}</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {companies.map((company) => (
              <div key={company.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{company.name_ar}</p>
                  <p className="text-sm text-muted-foreground">{company.name}</p>
                </div>
                <div className="flex space-x-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(company)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDelete(company)}>
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
