import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { DocumentType } from '@/types';

export interface EmployeeDocumentFiltersProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  documentTypes: DocumentType[];
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

/** The document filters and the bulk-action bar of the employee profile page. */
export function EmployeeDocumentFilters({
  searchTerm,
  onSearchTermChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  documentTypes,
  selectedCount,
  totalCount,
  onSelectAll,
  onBulkDelete,
  onClearSelection,
}: EmployeeDocumentFiltersProps) {
  return (
    <>
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Input
                placeholder="البحث في الوثائق..."
                value={searchTerm}
                onChange={e => onSearchTermChange(e.target.value)}
                className="w-full"
              />
            </div>
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="حالة الوثيقة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الحالات</SelectItem>
                <SelectItem value="valid">سارية</SelectItem>
                <SelectItem value="expiring_soon">تنتهي قريباً</SelectItem>
                <SelectItem value="expired">منتهية الصلاحية</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={onTypeFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="نوع الوثيقة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنواع</SelectItem>
                {documentTypes.map(type => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={selectedCount === totalCount && totalCount > 0}
                onCheckedChange={onSelectAll}
              />
              <label htmlFor="select-all" className="text-sm">
                تحديد الكل ({selectedCount})
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-2 p-4 bg-primary/10 rounded-lg"
        >
          <span className="text-sm font-medium">تم تحديد {selectedCount} وثيقة</span>
          <Button onClick={onBulkDelete} variant="destructive" size="sm">
            <Trash2 className="h-4 w-4 ml-2" />
            حذف المحددة
          </Button>
          <Button onClick={onClearSelection} variant="outline" size="sm">
            إلغاء التحديد
          </Button>
        </motion.div>
      )}
    </>
  );
}
