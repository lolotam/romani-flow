import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { Database, Download, Upload, Trash2 } from 'lucide-react';

interface BackupSettingsProps {
  onExportBackup: () => void;
  onEraseAllData: (confirmText: string) => void;
}

export default function BackupSettings({ onExportBackup, onEraseAllData }: BackupSettingsProps) {
  const { t } = useLanguage();
  const [isEraseDialogOpen, setIsEraseDialogOpen] = useState(false);
  const [eraseConfirmText, setEraseConfirmText] = useState('');

  const handleErase = () => {
    onEraseAllData(eraseConfirmText);
    setIsEraseDialogOpen(false);
    setEraseConfirmText('');
  };

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Database className="h-5 w-5" />
          <span>{t('settings.backup.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.backup.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.backup.backupSection')}</h3>
            <p className="text-sm text-muted-foreground">{t('settings.backup.backupDescription')}</p>
            <Button onClick={onExportBackup} className="w-full">
              <Download className="h-4 w-4 ml-2" />
              {t('settings.backup.exportBackup')}
            </Button>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('settings.backup.restoreSection')}</h3>
            <p className="text-sm text-muted-foreground">{t('settings.backup.restoreDescription')}</p>
            <div className="space-y-2">
              <Input type="file" accept=".json" />
              <Button className="w-full" variant="outline">
                <Upload className="h-4 w-4 ml-2" />
                {t('settings.backup.importBackup')}
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="text-lg font-semibold mb-3">{t('settings.backup.automaticBackups')}</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">{t('settings.backup.dailyBackups')}</p>
                <p className="text-sm text-muted-foreground">{t('settings.backup.dailyBackupsDesc')}</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">{t('settings.backup.backupNotifications')}</p>
                <p className="text-sm text-muted-foreground">{t('settings.backup.backupNotificationsDesc')}</p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="pt-4 border-t border-red-200 dark:border-red-900/50 mt-6">
          <h3 className="text-lg font-semibold mb-3 text-red-600">{t('settings.backup.eraseData')}</h3>
          <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <p className="font-medium text-red-800 dark:text-red-400">{t('settings.backup.eraseDataDescription')}</p>
            </div>

            <Dialog open={isEraseDialogOpen} onOpenChange={setIsEraseDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="shrink-0">
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('settings.backup.eraseButton')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-red-600">{t('settings.backup.eraseConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('settings.backup.eraseConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Input
                    value={eraseConfirmText}
                    onChange={(e) => setEraseConfirmText(e.target.value)}
                    placeholder={t('settings.backup.eraseConfirmPlaceholder')}
                    className="border-red-200 focus-visible:ring-red-500"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setIsEraseDialogOpen(false); setEraseConfirmText(''); }}>
                      {t('settings.backup.eraseCancel')}
                    </Button>
                    <Button variant="destructive" onClick={handleErase} disabled={eraseConfirmText !== 'DELETE ALL'}>
                      {t('settings.backup.eraseConfirmButton')}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
