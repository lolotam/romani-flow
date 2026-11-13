import { useEffect, useState } from 'react';
import { api, endpoints } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { isOwner } from '@/lib/permissions';
import type {
  Company,
  DocumentWithRelations,
  EmployeeWithRelations,
} from '@/lib/api/types';
import type { DashboardStats, ExpiringItem, RecentActivity } from '@/types';

/**
 * The data behind the dashboard.
 *
 * It lives in its own hook so the page stays a view: the page renders, the hook
 * fetches and derives. Everything comes from the API — there is no local copy
 * of the database in the browser any more.
 */

const EMPTY_STATS: DashboardStats = {
  totalDocuments: 0,
  totalEmployees: 0,
  totalCompanies: 0,
  expiringDocuments: 0,
  expiredDocuments: 0,
};

/** The default warning window, used until the settings answer. */
const DEFAULT_WARNING_DAYS = 30;

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Days until a date; negative once the date has passed. */
function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function statusFor(daysLeft: number): ExpiringItem['status'] {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return 'critical';
  return 'warning';
}

/**
 * Builds the reminder list.
 *
 * The warning window follows the server's `expiry_warning_days` setting, so the
 * dashboard and the reminder emails agree on what "expiring soon" means.
 */
function collectExpiringItems(
  employees: EmployeeWithRelations[],
  documents: DocumentWithRelations[],
  windowDays: number,
  t: Translate,
): ExpiringItem[] {
  const items: ExpiringItem[] = [];

  for (const employee of employees) {
    const residency = daysUntil(employee.residency_expiry_date);
    if (residency !== null && residency <= windowDays) {
      items.push({
        id: employee.id,
        title: t('dashboard.reminders.types.residency'),
        type: 'employee',
        entityName: employee.name,
        expiryDate: employee.residency_expiry_date as string,
        daysLeft: residency,
        status: statusFor(residency),
      });
    }

    if (employee.driving_license && employee.driving_license_expiry_date) {
      const licence = daysUntil(employee.driving_license_expiry_date);
      if (licence !== null && licence <= windowDays) {
        items.push({
          id: `${employee.id}_license`,
          title: t('dashboard.reminders.types.drivingLicense'),
          type: 'employee',
          entityName: employee.name,
          expiryDate: employee.driving_license_expiry_date as string,
          daysLeft: licence,
          status: statusFor(licence),
        });
      }
    }
  }

  for (const document of documents) {
    const remaining = daysUntil(document.expiry_date);
    if (remaining === null || remaining > windowDays) continue;

    const owner = document.employees?.name ?? document.companies?.name ?? t('common.unknown');

    items.push({
      id: document.id,
      title: document.title,
      type: document.employee_id ? 'employee' : 'company',
      entityName: owner,
      expiryDate: document.expiry_date as string,
      daysLeft: remaining,
      status: statusFor(remaining),
    });
  }

  return items.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** The most recent additions, newest first. */
function collectActivities(
  employees: EmployeeWithRelations[],
  documents: DocumentWithRelations[],
  t: Translate,
): RecentActivity[] {
  const activities: RecentActivity[] = [];

  for (const employee of employees.slice(0, 2)) {
    activities.push({
      id: `emp_${employee.id}`,
      type: 'employee_added',
      description: t('dashboard.recentActivities.employeeAdded', { name: employee.name }),
      date: employee.created_at,
      user: t('dashboard.recentActivities.admin'),
    });
  }

  for (const document of documents.slice(0, 3)) {
    activities.push({
      id: `doc_${document.id}`,
      type: 'document_added',
      description: t('dashboard.recentActivities.documentAdded', { title: document.title }),
      date: document.created_at,
      user: t('dashboard.recentActivities.admin'),
    });
  }

  return activities
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
}

export interface DashboardData {
  stats: DashboardStats;
  activities: RecentActivity[];
  expiringItems: ExpiringItem[];
  isLoading: boolean;
  error: string | null;
}

export function useDashboardData(t: Translate): DashboardData {
  const owner = isOwner(useAuth().user?.role);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [expiringItems, setExpiringItems] = useState<ExpiringItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [documentsResult, employeesResult, companiesResult, settingsResult] =
          await Promise.all([
            api.from<DocumentWithRelations>('documents').select('*').execute(),
            api.from<EmployeeWithRelations>('employees').select('*').execute(),
            api.from<Company>('companies').select('*').execute(),
            owner ? endpoints.settings.read() : Promise.resolve({ data: null, error: null }),
          ]);

        if (cancelled) return;

        const documents = documentsResult.data ?? [];
        const employees = employeesResult.data ?? [];
        const companies = companiesResult.data ?? [];

        const configured = Number(settingsResult.data?.settings?.expiry_warning_days);
        const warningDays =
          Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WARNING_DAYS;

        let expiringCount = 0;
        let expiredCount = 0;
        for (const document of documents) {
          const remaining = daysUntil(document.expiry_date);
          if (remaining === null) continue;
          if (remaining < 0) expiredCount += 1;
          else if (remaining <= warningDays) expiringCount += 1;
        }

        setStats({
          totalDocuments: documents.length,
          totalEmployees: employees.length,
          totalCompanies: companies.length,
          expiringDocuments: expiringCount,
          expiredDocuments: expiredCount,
        });

        setActivities(collectActivities(employees, documents, t));
        setExpiringItems(collectExpiringItems(employees, documents, warningDays, t));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [t, owner]);

  return { stats, activities, expiringItems, isLoading, error };
}
