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
}

export function DocumentFilters({ searchTerm, setSearchTerm, selectedStatus, setSelectedStatus,
  selectedType, setSelectedType, viewMode, setViewMode, documentTypes }: DocumentFiltersProps) {
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
                  <Label htmlFor="search">{t('documents.search')}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input id="search" placeholder={t('documents.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
                  </div>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t('documents.status')}</Label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.status')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('documents.statusOptions.all')}</SelectItem>
                      <SelectItem value="valid">{t('documents.statusOptions.valid')}</SelectItem>
                      <SelectItem value="expiring_soon">{t('documents.statusOptions.expiringSoon')}</SelectItem>
                      <SelectItem value="expired">{t('documents.statusOptions.expired')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="w-full lg:w-48">
                  <Label>{t('documents.documentType')}</Label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('documents.documentType')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('documents.allTypes')}</SelectItem>
                      {documentTypes.map(type => <SelectItem key={type.id} value={type.id}>
                          {language === 'ar' ? type.name_ar : type.name}
                        </SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-end space-x-2">
                  <Button variant={viewMode === 'grid' ? 'default' : 'outline'} size="sm" aria-label={language === 'ar' ? '??? ????' : 'Grid view'} onClick={() => setViewMode('grid')}>
                    <Grid className="h-4 w-4" />
                  </Button>
                  <Button variant={viewMode === 'list' ? 'default' : 'outline'} size="sm" aria-label={language === 'ar' ? '??? ?????' : 'List view'} onClick={() => setViewMode('list')}>
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
  </>;
}
