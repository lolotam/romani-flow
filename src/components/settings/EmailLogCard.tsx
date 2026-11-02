import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailLogEntry } from '@/lib/api';

interface EmailLogCardProps {
  entries: EmailLogEntry[];
}

const VISIBLE_ROWS = 10;

export function EmailLogCard({ entries }: EmailLogCardProps) {
  const { language } = useLanguage();
  const L = (ar: string, en: string) => (language === 'ar' ? ar : en);

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle>{L('سجل الإرسال', 'Send log')}</CardTitle>
        <CardDescription>{L('آخر محاولات الإرسال', 'The latest send attempts')}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{L('لا توجد محاولات بعد', 'No attempts yet')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-start font-medium">{L('الوقت', 'Time')}</th>
                  <th className="p-2 text-start font-medium">{L('النوع', 'Kind')}</th>
                  <th className="p-2 text-start font-medium">{L('المستلمون', 'Recipients')}</th>
                  <th className="p-2 text-start font-medium">{L('الحالة', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, VISIBLE_ROWS).map((entry, index) => (
                  <tr key={entry.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
                    <td className="p-2">{entry.created_at}</td>
                    <td className="p-2">{entry.kind}</td>
                    <td className="p-2" dir="ltr">{entry.recipients}</td>
                    <td className="p-2" title={entry.error ?? undefined}>{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
