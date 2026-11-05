export function reminderText(audience: 'management' | 'employee', item: string, owner: string, expiry: string, company = false, language: 'ar' | 'en' = 'ar'): string {
  const [year, month, day] = expiry.split('-');
  const date = `${day}/${month}/${year}`;
  if (language === 'en') {
    return audience === 'employee'
      ? `Hello «${owner}»,\nReminder: document «${item}» expires on ${date}. Please follow up with management on renewal.`
      : `Reminder: document «${item}» for ${company ? 'company' : 'employee'} «${owner}» expires on ${date}. Please follow up on renewal.`;
  }
  if (audience === 'employee') {
    return `أهلاً بيك «${owner}»،\nتذكير: وثيقة «${item}» تاريخ انتهائها ${date}. يُرجى متابعة التجديد مع الإدارة.`;
  }
  return `تذكير: وثيقة «${item}» الخاصة ب${company ? 'الشركة' : 'الموظف'} «${owner}»، تاريخ انتهائها ${date}. يُرجى متابعة التجديد.`;
}
