import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Clock, User, Building2, Trash2, Pin, PinOff } from 'lucide-react';
import type { ExpiringItem } from '@/types';

interface RemindersTableProps {
  items: ExpiringItem[];
  pinnedItems: string[];
  deletedItems: string[];
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  language: string;
  t: (key: string, params?: Record<string, any>) => string;
}

export function RemindersTable({
  items,
  pinnedItems,
  deletedItems,
  onTogglePin,
  onDelete,
  language,
  t,
}: RemindersTableProps) {
  const filteredItems = items
    .filter(item => !deletedItems.includes(item.id))
    .map(item => ({
      ...item,
      isPinned: pinnedItems.includes(item.id),
    }))
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return a.daysLeft - b.daysLeft;
    });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7 }}
    >
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>{t('dashboard.reminders.title')}</span>
          </CardTitle>
          <CardDescription>
            {t('dashboard.reminders.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredItems.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left rtl:text-right w-12"></TableHead>
                    <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.type')}</TableHead>
                    <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.name')}</TableHead>
                    <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.expiryDate')}</TableHead>
                    <TableHead className="text-left rtl:text-right">{t('dashboard.reminders.table.status')}</TableHead>
                    <TableHead className="text-left rtl:text-right w-20">{t('dashboard.reminders.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.slice(0, 5).map((item) => (
                    <TableRow key={item.id} className={item.isPinned ? 'bg-primary/5' : ''}>
                      <TableCell>
                        {item.isPinned && (
                          <Pin className="h-4 w-4 text-primary" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {item.type === 'employee' ? (
                            <User className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span>{item.entityName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {new Date(item.expiryDate).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA')}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            item.status === 'expired'
                              ? 'bg-destructive text-destructive-foreground'
                              : item.status === 'critical'
                                ? 'bg-orange-500 text-white'
                                : 'bg-yellow-500 text-white'
                          }
                        >
                          {item.daysLeft < 0
                            ? t('dashboard.reminders.status.expired')
                            : item.daysLeft === 0
                              ? t('dashboard.reminders.status.expiringToday')
                              : t('dashboard.reminders.status.daysLeft', { days: Math.abs(item.daysLeft) })}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => onTogglePin(item.id)}
                            title={item.isPinned ? t('dashboard.reminders.actions.unpin') : t('dashboard.reminders.actions.pin')}
                          >
                            {item.isPinned ? (
                              <PinOff className="h-3 w-3 text-primary" />
                            ) : (
                              <Pin className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => onDelete(item.id)}
                            title={t('dashboard.reminders.actions.delete')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredItems.length > 5 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  {t('dashboard.reminders.moreItems', { count: filteredItems.length - 5 })}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('dashboard.reminders.noReminders')}</p>
              <p className="text-sm">{t('dashboard.reminders.allDocumentsValid')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
