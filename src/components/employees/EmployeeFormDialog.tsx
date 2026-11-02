import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Company, Position } from '@/types';
import { EmployeeFormFields } from '@/components/employees/EmployeeFormFields';
import type { EmployeeFormState } from '@/components/employees/employeeTypes';

export interface EmployeeFormDialogProps {
  mode: 'add' | 'edit';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: EmployeeFormState;
  onFormChange: (patch: Partial<EmployeeFormState>) => void;
  companies: Company[];
  positions: Position[];
  onSubmit: () => void;
  /** The document count of the employee being edited. */
  documentCount?: number;
}

/**
 * The add and edit dialogs.
 *
 * Both share the same fields, so only the shell differs between the two modes.
 */
export function EmployeeFormDialog({
  mode,
  open,
  onOpenChange,
  formData,
  onFormChange,
  companies,
  positions,
  onSubmit,
  documentCount = 0,
}: EmployeeFormDialogProps) {
  const { t } = useLanguage();

  const isAdd = mode === 'add';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {isAdd && (
        <DialogTrigger asChild>
          <Button className="shadow-elegant hover:shadow-glow transition-all">
            <Plus className="h-4 w-4 ml-2" />
            {t('employees.addEmployee')}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className={isAdd ? 'sm:max-w-2xl max-h-[90vh] overflow-y-auto' : 'sm:max-w-2xl'}
      >
        <DialogHeader>
          <DialogTitle>
            {isAdd ? t('employees.dialog.addTitle') : t('employees.dialog.editTitle')}
          </DialogTitle>
          <DialogDescription>
            {isAdd ? t('employees.dialog.addDescription') : t('employees.dialog.editDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className={isAdd ? 'space-y-4' : 'py-4'}>
          <EmployeeFormFields
            formData={formData}
            onChange={onFormChange}
            companies={companies}
            positions={positions}
            mode={mode}
            idPrefix={isAdd ? '' : 'edit-'}
            documentCount={documentCount}
          />
          {isAdd ? (
            <div className="flex gap-2 pt-4">
              <Button onClick={onSubmit} className="flex-1">
                {t('employees.dialog.buttons.add')}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('employees.dialog.buttons.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                إلغاء
              </Button>
              <Button onClick={onSubmit}>حفظ التغييرات</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
