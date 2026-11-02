import { Clock, Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ExpiryPreview, ExpiryPreviewItem } from '@/lib/api';

interface ExpiryPreviewCardProps {
  preview: ExpiryPreview | null;
  canSend: boolean;
  isSending: boolean;
  onRefresh: () => void;
  onSend: () => void;
}

const VISIBLE_ROWS = 8;

function statusClass(item: ExpiryPreviewItem): string {
  if (item.isExpired) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  if (item.daysRemaining <= 7) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
}

export function ExpiryPreviewCard({ preview, canSend, isSending, onRefresh, onSend }: ExpiryPreviewCardProps) {
  const { language } = useLanguage();
  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);

  const rows = (items: ExpiryPreviewItem[], nameOf: (item: ExpiryPreviewItem) => string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-2 text-start font-medium">{L('الاسم', 'Name')}</th>
            <th className="p-2 text-start font-medium">{L('تاريخ الانتهاء', 'Expiry date')}</th>
            <th className="p-2 text-start font-medium">{L('المتبقي', 'Remaining')}</th>
            <th className="p-2 text-start font-medium">{L('الحالة', 'Status')}</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, VISIBLE_ROWS).map((item, index) => (
            <tr key={item.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
              <td className="p-2 font-medium">{nameOf(item)}</td>
              <td className="p-2">{item.expiryDate}</td>
              <td className="p-2">
                {Math.abs(item.daysRemaining)} {item.isExpired ? L('يوم منذ الانتهاء', 'days ago') : L('يوم', 'days')}
              </td>
              <td className="p-2">
                <span className={`rounded-full px-2 py-1 text-xs ${statusClass(item)}`}>
                  {item.isExpired ? L('منتهي', 'Expired') : L('قارب الانتهاء', 'Expiring')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > VISIBLE_ROWS && (
        <p className="mt-2 text-xs text-muted-foreground">
          {L(`و ${items.length - VISIBLE_ROWS} عناصر أخرى في التقرير`, `and ${items.length - VISIBLE_ROWS} more in the report`)}
        </p>
      )}
    </div>
  );

  const employees = preview?.employees ?? [];
  const documents = preview?.documents ?? [];

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          <span>{L('معاينة التقرير القادم', 'Next report preview')}</span>
        </CardTitle>
        <CardDescription>
          {preview
            ? L(
                `ما سيدخل التقرير الآن (مواعيد: ${preview.intervals.join(' / ') || '-'} يوم)`,
                `What the report would contain now (thresholds: ${preview.intervals.join(' / ') || '-'} days)`,
              )
            : L('تعذر تحميل المعاينة', 'The preview could not be loaded')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
            <span className="font-medium">{L('إقامات تنتهي', 'Residencies expiring')}</span>
            <div className="mt-2 text-2xl font-bold text-orange-600">{employees.length}</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <span className="font-medium">{L('مستندات تنتهي', 'Documents expiring')}</span>
            <div className="mt-2 text-2xl font-bold text-red-600">{documents.length}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onRefresh} variant="outline" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            <span>{L('تحديث المعاينة', 'Refresh preview')}</span>
          </Button>
          <Button onClick={onSend} disabled={!canSend || isSending} className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <span>{isSending ? L('جارٍ الإرسال...', 'Sending...') : L('إرسال التقرير الآن', 'Send the report now')}</span>
          </Button>
        </div>

        {employees.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-medium text-orange-600">{L('الإقامات', 'Residencies')}</h4>
            {rows(employees, (item) => item.name ?? '-')}
          </div>
        )}
        {documents.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h4 className="font-medium text-red-600">{L('المستندات', 'Documents')}</h4>
            {rows(documents, (item) => item.title ?? '-')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
