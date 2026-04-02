import { Employee, Document } from './jsonDatabase';
import { supabase } from '@/integrations/supabase/client';

export interface ExpiryData {
  employees: Array<Employee & { expiryType: 'residency'; daysUntilExpiry: number }>;
  documents: Array<Document & { employee?: Employee; expiryType: 'document'; daysUntilExpiry: number }>;
}

export interface EmailNotificationSettings {
  enabled: boolean;
  dailyReminder: boolean;
  expiredNotification: boolean;
  emailRecipient: string;
  senderEmail: string;
}

// Calculate days between dates
function calculateDaysUntilExpiry(expiryDate: string): number {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Get expiring employees (residency)
export function getExpiringEmployees(employees: Employee[]): Array<Employee & { expiryType: 'residency'; daysUntilExpiry: number }> {
  return employees
    .filter(emp => emp.residency_expiry_date)
    .map(emp => ({
      ...emp,
      expiryType: 'residency' as const,
      daysUntilExpiry: calculateDaysUntilExpiry(emp.residency_expiry_date!)
    }))
    .filter(emp => emp.daysUntilExpiry <= 30);
}

// Get expiring documents
export function getExpiringDocuments(documents: Document[], employees: Employee[]): Array<Document & { employee?: Employee; expiryType: 'document'; daysUntilExpiry: number }> {
  const employeeMap = new Map(employees.map(emp => [emp.id, emp]));
  return documents
    .filter(doc => doc.expiry_date)
    .map(doc => ({
      ...doc,
      employee: doc.employee_id ? employeeMap.get(doc.employee_id) : undefined,
      expiryType: 'document' as const,
      daysUntilExpiry: calculateDaysUntilExpiry(doc.expiry_date!)
    }))
    .filter(doc => doc.daysUntilExpiry <= 30);
}

// Send expiry report via Edge Function
export async function sendExpiryNotification(
  _expiryData: ExpiryData,
  settings: EmailNotificationSettings
): Promise<{ success: boolean; message: string }> {
  try {
    if (!settings.enabled) {
      return { success: false, message: 'الإشعارات معطلة' };
    }
    if (!settings.emailRecipient) {
      return { success: false, message: 'يرجى تحديد البريد الإلكتروني للمستلم' };
    }

    const { data, error } = await supabase.functions.invoke('send-expiry-report', {
      body: {
        recipientEmail: settings.emailRecipient,
        senderEmail: settings.senderEmail || undefined,
      },
    });

    if (error) {
      console.error('Edge function error:', error);
      return { success: false, message: `خطأ في إرسال التقرير: ${error.message}` };
    }

    if (data?.success) {
      return {
        success: true,
        message: `تم إرسال التقرير بنجاح إلى ${settings.emailRecipient} (${data.totalExpiring} عنصر)`
      };
    }

    return { success: false, message: data?.error || 'خطأ غير معروف' };
  } catch (error) {
    console.error('Send notification error:', error);
    return { success: false, message: `خطأ: ${error instanceof Error ? error.message : 'غير معروف'}` };
  }
}

// Check and send notifications
export async function checkAndSendNotifications(
  employees: Employee[],
  documents: Document[],
  settings: EmailNotificationSettings
): Promise<void> {
  if (!settings.enabled) return;

  const expiringEmployees = getExpiringEmployees(employees);
  const expiringDocuments = getExpiringDocuments(documents, employees);

  if (expiringEmployees.length === 0 && expiringDocuments.length === 0) return;

  const expiryData: ExpiryData = { employees: expiringEmployees, documents: expiringDocuments };
  await sendExpiryNotification(expiryData, settings);
}
