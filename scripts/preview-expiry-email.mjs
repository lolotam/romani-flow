#!/usr/bin/env node
/**
 * Renders the expiry reminder email to `preview/expiry-report.html` so the
 * layout can be inspected in a browser without sending anything.
 *
 *   node scripts/preview-expiry-email.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { expiryReportHtml, expiryReportText } = await import(
  pathToFileURL(resolve(root, 'server/services/templates/index.ts')).href
);

const today = new Date();
const iso = (offset) => {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const report = {
  language: 'ar',
  windowDays: 90,
  generatedAt: today,
  employees: [
    {
      id: 'e1',
      name: 'محمد عبد الله',
      companyName: 'شركة إعمار للتطوير العقاري',
      expiryDate: iso(2),
      daysRemaining: 2,
      isExpired: false,
      intervalDays: 7,
    },
    {
      id: 'e2',
      name: 'Sarah Ahmed',
      companyName: 'Emaar Contracting',
      expiryDate: iso(-12),
      daysRemaining: -12,
      isExpired: true,
      intervalDays: 90,
    },
  ],
  documents: [
    {
      id: 'd1',
      title: ' residence visa',
      fileName: 'residence-visa-2026.pdf',
      employeeName: 'محمد عبد الله',
      companyName: 'شركة إعمار للتطوير العقاري',
      documentTypeName: 'تأشيرة إقامة',
      ministryName: 'وزارة الداخلية',
      issueDate: iso(-365),
      expiryDate: iso(1),
      daysRemaining: 1,
      isExpired: false,
      intervalDays: 7,
    },
    {
      id: 'd2',
      title: 'Trade licence',
      fileName: 'trade-licence.pdf',
      employeeName: null,
      companyName: 'Emaar Contracting',
      documentTypeName: 'رخصة تجارية',
      ministryName: 'وزارة التجارة',
      issueDate: iso(-200),
      expiryDate: iso(45),
      daysRemaining: 45,
      isExpired: false,
      intervalDays: 90,
    },
  ],
};

const html = expiryReportHtml(report);
const text = expiryReportText(report);

const outDir = resolve(root, 'preview');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'expiry-report.html'), html, 'utf8');
writeFileSync(resolve(outDir, 'expiry-report.txt'), text, 'utf8');

console.log('Wrote preview/expiry-report.html');
console.log('Wrote preview/expiry-report.txt');
