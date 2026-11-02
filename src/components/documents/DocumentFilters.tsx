import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Grid, List, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentType } from '@/lib/api';

interface DocumentFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  selectedStatus: string;
  setSelectedStatus: (value: string) => void;
  selectedType: string;
  setSelectedType: (value: string) => void;
  viewMode: 'grid' | 'list';
  setViewMode: (value: 'grid' | 'list') => void;
  documentTypes: DocumentType[];
  scope?: 'documents' | 'employeeDocuments';
}

export function DocumentFilters({ searchTerm, setSearchTerm, selectedStatus, setSelectedStatus,
  selectedType, setSelectedType, viewMode, setViewMode, documentTypes, scope = 'documents' }: DocumentFiltersProps) {
  const { t, language } = useLanguage();
  return <>
{/* Filters */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.1
      }}>
          <Card className="shadow-soft">
            <CardContent className="p-6">
              <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="search">{t(`${scope}.search`)}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input id="search" placeholder={t(`${scope}.searchPlaceholder`)} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
                  </div>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t(`${scope}.status`)}</Label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder={t(`${scope}.status`)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t(scope === 'documents' ? 'documents.statusOptions.all' : 'employeeDocuments.allStatuses')}</SelectItem>
                      <SelectItem value="valid">{t(scope === 'documents' ? 'documents.statusOptions.valid' : 'employeeDocuments.valid')}</SelectItem>
                      <SelectItem value="expiring_soon">{t(scope === 'documents' ? 'documents.statusOptions.expiringSoon' : 'employeeDocuments.expiringSoon')}</SelectItem>
                      <SelectItem value="expired">{t(scope === 'documents' ? 'documents.statusOptions.expired' : 'employeeDocuments.expired')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t(`${scope}.documentType`)}</Label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger>
                      <SelectValue placeholder={t(`${scope}.documentType`)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t(`${scope}.allTypes`)}</SelectItem>
                      {documentTypes.map(type => <SelectItem key={type.id} value={type.id}>
                          {language === 'ar' ? type.name_ar : type.name}
                        </SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-end space-x-2">
                  <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" aria-label={language === 'ar' ? 'عرض شبكي' : 'Grid view'} onClick={() => setViewMode('grid')}>
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" aria-label={language === 'ar' ? 'عرض القائمة' : 'List view'} onClick={() => setViewMode('list')}>
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
  </>;
}
