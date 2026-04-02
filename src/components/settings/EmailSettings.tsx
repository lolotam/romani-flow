import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { Mail, Clock, RefreshCw, Trash2 } from 'lucide-react';
import type { EmailSettingsData } from './types';
import { Employee } from '@/lib/jsonDatabase';
import { ExpiryData } from '@/lib/emailService';

interface EmailSettingsProps {
  emailSettings: EmailSettingsData;
  onEmailSettingsChange: (settings: EmailSettingsData) => void;
  onSave: () => void;
  onTestEmail: () => void;
  onCheckExpiry: () => void;
  onSendReport: () => void;
  onAutoNotifications: () => void;
  onDeleteReminder: (id: string, type: 'employee' | 'document') => void;
  isCheckingExpiry: boolean;
  isSendingEmail: boolean;
  lastEmailSent: string | null;
  employees: Employee[];
  expiryData: ExpiryData;
}

export default function EmailSettingsComponent({
  emailSettings, onEmailSettingsChange, onSave, onTestEmail,
  onCheckExpiry, onSendReport, onAutoNotifications, onDeleteReminder,
  isCheckingExpiry, isSendingEmail, lastEmailSent, employees, expiryData
}: EmailSettingsProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      {/* Resend Email Config */}
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>{t('settings.email.title')}</span>
          </CardTitle>
          <CardDescription>{t('settings.email.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="resend_from_email">{t('settings.email.emailSender')}</Label>
              <Input id="resend_from_email" type="email" value={emailSettings.resend_from_email}
                placeholder="ROMANI Reports <onboarding@resend.dev>"
                onChange={(e) => onEmailSettingsChange({ ...emailSettings, resend_from_email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="email_receiver">{t('settings.email.emailReceiver')}</Label>
              <Input id="email_receiver" type="email" value={emailSettings.email_receiver}
                placeholder="admin@company.com"
                onChange={(e) => onEmailSettingsChange({ ...emailSettings, email_receiver: e.target.value })} />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <Label htmlFor="enable_notifications">{t('settings.email.enableNotifications')}</Label>
              <Switch id="enable_notifications" checked={emailSettings.enable_notifications}
                onCheckedChange={(checked) => onEmailSettingsChange({ ...emailSettings, enable_notifications: checked })} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="daily_schedule">{t('settings.email.dailySchedule') || 'تقرير يومي تلقائي (8 صباحاً)'}</Label>
              <Switch id="daily_schedule" checked={emailSettings.daily_schedule}
                onCheckedChange={(checked) => onEmailSettingsChange({ ...emailSettings, daily_schedule: checked })} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={onSave} className="flex-1">{t('settings.email.saveEmailSettings')}</Button>
            <Button onClick={onTestEmail} variant="outline" className="flex-1">{t('settings.email.testEmailButton')}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Expiry Monitoring */}
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>{t('settings.email.monitoringTitle')}</span>
          </CardTitle>
          <CardDescription>{t('settings.email.monitoringDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="font-medium">{t('settings.email.totalEmployees')}</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-blue-600">{employees.length}</span>
                <p className="text-sm text-muted-foreground">{t('settings.email.registeredEmployee')}</p>
              </div>
            </div>
            <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span className="font-medium">{t('settings.email.expiringResidencies')}</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-orange-600">{expiryData.employees.length}</span>
                <p className="text-sm text-muted-foreground">{t('settings.email.withinMonth')}</p>
              </div>
            </div>
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span className="font-medium">{t('settings.email.expiringDocuments')}</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold text-red-600">{expiryData.documents.length}</span>
                <p className="text-sm text-muted-foreground">{t('settings.email.withinMonth')}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onCheckExpiry} disabled={isCheckingExpiry} variant="outline" className="flex items-center space-x-2">
              <RefreshCw className={`h-4 w-4 ${isCheckingExpiry ? 'animate-spin' : ''}`} />
              <span>{isCheckingExpiry ? t('settings.email.checkingExpiry') : t('settings.email.checkExpiry')}</span>
            </Button>
            <Button onClick={onSendReport} disabled={isSendingEmail || !emailSettings.enable_notifications} variant="default" className="flex items-center space-x-2">
              <Mail className="h-4 w-4" />
              <span>{isSendingEmail ? t('settings.email.sendingReport') : t('settings.email.sendImmediateReport')}</span>
            </Button>
            <Button onClick={onAutoNotifications} disabled={!emailSettings.enable_notifications} variant="secondary" className="flex items-center space-x-2">
              <Clock className="h-4 w-4" />
              <span>{t('settings.email.enableAutoAlerts')}</span>
            </Button>
          </div>

          {lastEmailSent && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  {t('settings.email.lastEmailSent')} {lastEmailSent}
                </span>
              </div>
            </div>
          )}

          {/* Expiry Details Tables */}
          {(expiryData.employees.length > 0 || expiryData.documents.length > 0) && (
            <div className="space-y-6 pt-4 border-t">
              <h3 className="text-lg font-semibold">{t('settings.email.expiryDetails')}</h3>

              {expiryData.employees.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium text-orange-600">{t('settings.email.expiringResidenciesList')} ({expiryData.employees.length})</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('settings.email.employeeName')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.residencyExpiryDate')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.timeRemaining')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.status')}</th>
                          <th className="text-end p-2 font-medium">{t('settings.email.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expiryData.employees.slice(0, 5).map((emp, index) => (
                          <tr key={emp.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
                            <td className="p-2 font-medium">{emp.name}</td>
                            <td className="p-2">{emp.residency_expiry_date ? new Date(emp.residency_expiry_date).toLocaleDateString('ar-EG') : '-'}</td>
                            <td className="p-2">{Math.abs(emp.daysUntilExpiry)} {emp.daysUntilExpiry < 0 ? t('settings.email.dayExpired') : t('settings.email.day')}</td>
                            <td className="p-2">
                              <span className={`px-2 py-1 rounded-full text-xs ${emp.daysUntilExpiry < 0
                                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                : emp.daysUntilExpiry <= 7
                                  ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                }`}>
                                {emp.daysUntilExpiry < 0 ? t('settings.email.expired') : emp.daysUntilExpiry <= 7 ? t('settings.email.danger') : t('settings.email.warning')}
                              </span>
                            </td>
                            <td className="p-2 text-end">
                              <Button variant="ghost" size="sm" onClick={() => onDeleteReminder(emp.id, 'employee')} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {expiryData.employees.length > 5 && (
                      <p className="text-xs text-muted-foreground mt-2">{t('settings.email.moreItemsInReport', { count: expiryData.employees.length - 5 })}</p>
                    )}
                  </div>
                </div>
              )}

              {expiryData.documents.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium text-red-600">{t('settings.email.expiringDocumentsList')} ({expiryData.documents.length})</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-start p-2 font-medium">{t('settings.email.documentName')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.employee')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.expiryDate')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.timeRemaining')}</th>
                          <th className="text-start p-2 font-medium">{t('settings.email.status')}</th>
                          <th className="text-end p-2 font-medium">{t('settings.email.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expiryData.documents.slice(0, 5).map((doc, index) => (
                          <tr key={doc.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/25'}>
                            <td className="p-2 font-medium">{doc.title}</td>
                            <td className="p-2">{doc.employee?.name || '-'}</td>
                            <td className="p-2">{doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('ar-EG') : '-'}</td>
                            <td className="p-2">{Math.abs(doc.daysUntilExpiry)} {doc.daysUntilExpiry < 0 ? t('settings.email.dayExpired') : t('settings.email.day')}</td>
                            <td className="p-2">
                              <span className={`px-2 py-1 rounded-full text-xs ${doc.daysUntilExpiry < 0
                                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                : doc.daysUntilExpiry <= 7
                                  ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                }`}>
                                {doc.daysUntilExpiry < 0 ? t('settings.email.expired') : doc.daysUntilExpiry <= 7 ? t('settings.email.danger') : t('settings.email.warning')}
                              </span>
                            </td>
                            <td className="p-2 text-end">
                              <Button variant="ghost" size="sm" onClick={() => onDeleteReminder(doc.id, 'document')} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {expiryData.documents.length > 5 && (
                      <p className="text-xs text-muted-foreground mt-2">{t('settings.email.moreDocumentsInReport', { count: expiryData.documents.length - 5 })}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Info Note */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">{t('settings.email.emailConfigNote')}</h4>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• يتم إرسال التقارير عبر خدمة Resend</li>
              <li>• التقرير اليومي التلقائي يُرسل الساعة 8 صباحاً</li>
              <li>• يشمل التقرير الوثائق والإقامات المنتهية أو القريبة من الانتهاء (خلال 30 يوم)</li>
              <li>• يمكنك إرسال تقرير فوري في أي وقت بالضغط على "إرسال تقرير فوري"</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
