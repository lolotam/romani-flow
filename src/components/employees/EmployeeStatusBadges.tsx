import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ExpiryStatus } from '@/types';

/**
 * Badges for the two expiry states the employee screens show.
 *
 * The state itself is derived in the browser from the expiry date — the server
 * only stores the date.
 */
export function ResidencyStatusBadge({ status }: { status?: ExpiryStatus }) {
  const { t } = useLanguage();

  switch (status) {
    case 'expired':
      return <Badge className="bg-red-500 text-white">{t('employees.status.expired')}</Badge>;
    case 'less_than_week':
      return <Badge className="bg-orange-500 text-white">{t('employees.status.lessThanWeek')}</Badge>;
    case 'less_than_month':
      return <Badge className="bg-yellow-500 text-white">{t('employees.status.lessThanMonth')}</Badge>;
    case 'valid':
      return <Badge className="bg-green-500 text-white">{t('employees.status.valid')}</Badge>;
    default:
      return <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>;
  }
}

export function DrivingLicenseStatusBadge({ status }: { status?: ExpiryStatus }) {
  const { t } = useLanguage();

  switch (status) {
    case 'expired':
      return <Badge className="bg-red-500 text-white">{t('employees.status.expired')}</Badge>;
    case 'less_than_week':
      return <Badge className="bg-orange-500 text-white">{t('employees.status.lessThanWeek')}</Badge>;
    case 'less_than_month':
      return <Badge className="bg-yellow-500 text-white">{t('employees.status.lessThanMonth')}</Badge>;
    case 'valid':
      return <Badge className="bg-green-500 text-white">{t('employees.status.valid')}</Badge>;
    default:
      return <Badge variant="outline">{t('employees.status.notSpecified')}</Badge>;
  }
}
