import type { EmailLanguage } from './shared.js';

/**
 * The shapes the expiry report is rendered from.
 *
 * They live in their own module so the plain-text renderer and the HTML
 * renderer can share them without importing each other.
 */

export interface ExpiringEmployee {
  id: string;
  name: string;
  companyName: string;
  expiryDate: string;
  daysRemaining: number;
  isExpired: boolean;
  intervalDays: number;
}

export interface ExpiringDocument {
  id: string;
  title: string;
  fileName: string | null;
  employeeName: string | null;
  companyName: string | null;
  documentTypeName: string | null;
  ministryName: string | null;
  issueDate: string | null;
  expiryDate: string;
  daysRemaining: number;
  isExpired: boolean;
  intervalDays: number;
}

export interface ExpiryReport {
  employees: ExpiringEmployee[];
  documents: ExpiringDocument[];
  windowDays: number;
  generatedAt: Date;
  language: EmailLanguage;
}
