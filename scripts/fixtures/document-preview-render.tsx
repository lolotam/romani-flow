import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useForm, FormProvider } from 'react-hook-form';
import { LanguageProvider } from '../../src/contexts/LanguageContext';
import { DocumentAttachment } from '../../src/components/documents/DocumentAttachment';
import { DocumentBeneficiaryFields } from '../../src/components/documents/DocumentBeneficiaryFields';

/** Actual components/providers: SSR checks markup only, not browser-native PDF rendering. */
export function previewMarkup(mime: string, name: string): string {
  return renderToStaticMarkup(<LanguageProvider><DocumentAttachment uploadedFile={null} editingDocument={{
    id: 'synthetic-document', title: 'Synthetic', document_type_id: 'synthetic-type', file_path: 'synthetic/file', file_name: name, mime_type: mime,
  }} /></LanguageProvider>);
}

function CompanyFixture() {
  const form = useForm({ defaultValues: { beneficiary_type: 'company', company_id: 'synthetic-company' } });
  return <FormProvider {...form}><LanguageProvider><DocumentBeneficiaryFields
    preselectedCompanyId="synthetic-company"
    companies={[{ id: 'synthetic-company', name: 'Synthetic company', name_ar: 'شركة مثال' }]}
    employees={[]} documentTypes={[]} ministries={[]}
  /></LanguageProvider></FormProvider>;
}
export function companyMarkup(): string { return renderToStaticMarkup(<CompanyFixture />); }
