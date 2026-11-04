export function reminderText(audience: 'management' | 'employee', item: string, owner: string, expiry: string, company = false): string {
  const [year, month, day] = expiry.split('-');
  const date = `${day}/${month}/${year}`;
  if (audience === 'employee') {
    return `أهلاً بيك «${owner}»،\nتذكير: وثيقة «${item}» تاريخ انتهائها ${date}. يُرجى متابعة التجديد مع الإدارة.`;
  }
  return `تذكير: وثيقة «${item}» الخاصة ب${company ? 'الشركة' : 'الموظف'} «${owner}»، تاريخ انتهائها ${date}. يُرجى متابعة التجديد.`;
}
