import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Company } from '@/types';

export interface EmployeeFiltersProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  companies: Company[];
  selectedCompany: string;
  onSelectedCompanyChange: (value: string) => void;
}

/** The search box and the company filter above the employees table. */
export function EmployeeFilters({
  searchTerm,
  onSearchTermChange,
  companies,
  selectedCompany,
  onSelectedCompanyChange,
}: EmployeeFiltersProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-soft">
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="search">{t('employees.search')}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder={t('employees.searchPlaceholder')}
                value={searchTerm}
                onChange={e => onSearchTermChange(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="w-full sm:w-48">
            <Label htmlFor="company-filter">{t('employees.filterByCompany')}</Label>
            <Select value={selectedCompany} onValueChange={onSelectedCompanyChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('employees.allCompanies')}</SelectItem>
                {companies.map(company => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
