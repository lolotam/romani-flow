/**
 * Dedicated Browser Forms Fixture for Task 10 (Forms Contract for Tasks 13 & 14).
 *
 * Statically imports actual production DocumentEditorDialog, DocumentForm, and EmployeeDocumentForm.
 * Renders under actual AuthProvider and LanguageProvider.
 * Free of external font imports (no remote Google fonts / index.css).
 * Maintains single-owner account control, fresh mount epochs, committed auth readiness,
 * and realistic close/unmount lifecycles with epoch-isolated callbacks.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/hooks/useAuth';
import { LanguageProvider } from '../../src/contexts/LanguageContext';
import { Toaster } from '../../src/components/ui/sonner';
import { DocumentEditorDialog } from '../../src/components/documents/DocumentDialogs';
import { DocumentForm } from '../../src/components/DocumentForm';
import { EmployeeDocumentForm } from '../../src/components/EmployeeDocumentForm';
import type { DocumentFormProps } from '../../src/components/documents/documentFormSchema';

const DEFAULT_DOCUMENT_TYPES = [
  { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' },
  { id: 'type-passport', name: 'Passport', name_ar: 'جواز السفر' },
  { id: 'type-contract', name: 'Work Contract', name_ar: 'عقد العمل' },
];

const DEFAULT_MINISTRIES = [
  { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' },
  { id: 'min-molf', name: 'Ministry of Labor', name_ar: 'وزارة العمل' },
];

const DEFAULT_COMPANIES = [
  { id: 'comp-1', name: 'Romani Trading Co', name_ar: 'شركة روماني للتجارة' },
  { id: 'comp-2', name: 'Gulf Services Ltd', name_ar: 'شركة الخليج للخدمات' },
];

const DEFAULT_EMPLOYEES = [
  { id: 'emp-1', name: 'Ahmed Al-Sabah', company_id: 'comp-1' },
  { id: 'emp-2', name: 'Fatima Al-Mansoor', company_id: 'comp-1' },
];

export interface GeneralMountOptions {
  uploadedFile?: File | null;
  fileName?: string;
  documentTypes?: typeof DEFAULT_DOCUMENT_TYPES;
  companies?: typeof DEFAULT_COMPANIES;
  employees?: typeof DEFAULT_EMPLOYEES;
  ministries?: typeof DEFAULT_MINISTRIES;
  preselectedCompanyId?: string;
  preselectedEmployeeId?: string;
  editingDocument?: DocumentFormProps['editingDocument'];
  asDialog?: boolean;
}

export interface EmployeeMountOptions {
  isOpen?: boolean;
  employeeId?: string;
  uploadedFile?: File | null;
}

export interface EventLogEntry {
  type: string;
  payload?: unknown;
  timestamp: number;
}

export interface FormsControls {
  mountGeneral: (opts?: GeneralMountOptions) => number;
  mountEmployee: (opts?: EmployeeMountOptions) => number;
  unmount: () => number;
  setFile: (file: File | null) => void;
  setAccount: (accountId: string) => number;
  getEventLog: () => EventLogEntry[];
  clearEventLog: () => void;
  getState: () => {
    mode: 'general' | 'employee' | 'none';
    mountEpoch: number;
    currentAccount: string;
    isAuthReady: boolean;
    selectedFileName: string | null;
    hasExtractionPanel: boolean;
    hasDocumentNumberInput: boolean;
    documentNumberValue: string | null;
    titleValue: string | null;
  };
}

declare global {
  interface Window {
    __formsControls?: FormsControls;
  }
}

interface FormsContainerProps {
  currentAccount: string;
  mountEpoch: number;
  mode: 'general' | 'employee' | 'none';
  generalProps: GeneralMountOptions;
  employeeProps: EmployeeMountOptions;
  onGeneralClose: (epoch: number) => void;
  onGeneralSuccess: (epoch: number) => void;
  onEmployeeClose: (epoch: number) => void;
  onEmployeeSave: (epoch: number) => void;
}

function FormsContainer({
  currentAccount,
  mountEpoch,
  mode,
  generalProps,
  employeeProps,
  onGeneralClose,
  onGeneralSuccess,
  onEmployeeClose,
  onEmployeeSave,
}: FormsContainerProps) {
  const { user, isLoading } = useAuth();
  const isAuthReady = !isLoading && user?.id === currentAccount;

  return (
    <div
      data-testid="forms-mount-container"
      data-mode={mode}
      data-mount-epoch={mountEpoch}
      data-auth-ready={isAuthReady ? 'true' : 'false'}
      data-auth-account={user?.id ?? ''}
      style={{
        padding: '1rem',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: '#f8fafc',
      }}
    >
      <div
        data-testid="forms-fixture-header"
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#ffffff',
          borderRadius: '6px',
          border: '1px solid #e2e8f0',
          fontSize: '12px',
          fontFamily: 'monospace',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Mode: <strong data-testid="fixture-current-mode">{mode}</strong></span>
        <span>Account: <strong data-testid="fixture-current-account">{currentAccount}</strong></span>
        <span>Epoch: <strong data-testid="fixture-mount-epoch">{mountEpoch}</strong></span>
        <span>Auth: <strong data-testid="fixture-auth-ready">{isAuthReady ? 'READY' : 'WAITING'}</strong></span>
      </div>

      {mode === 'general' && (
        generalProps.asDialog ? (
          <div data-testid="general-dialog-wrapper" data-form-epoch={mountEpoch}>
            <DocumentEditorDialog
              key={`general-dialog-${currentAccount}-${mountEpoch}`}
              uploadedFile={generalProps.uploadedFile ?? null}
              fileName={generalProps.fileName ?? ''}
              documentTypes={generalProps.documentTypes ?? DEFAULT_DOCUMENT_TYPES}
              companies={generalProps.companies ?? DEFAULT_COMPANIES}
              employees={generalProps.employees ?? DEFAULT_EMPLOYEES}
              ministries={generalProps.ministries ?? DEFAULT_MINISTRIES}
              preselectedCompanyId={generalProps.preselectedCompanyId}
              preselectedEmployeeId={generalProps.preselectedEmployeeId}
              editingDocument={generalProps.editingDocument ?? null}
              onClose={() => onGeneralClose(mountEpoch)}
              onSuccess={() => onGeneralSuccess(mountEpoch)}
            />
          </div>
        ) : (
          <div data-testid="general-form-wrapper" data-form-epoch={mountEpoch} style={{ backgroundColor: '#ffffff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <DocumentForm
              key={`general-form-${currentAccount}-${mountEpoch}`}
              uploadedFile={generalProps.uploadedFile ?? null}
              fileName={generalProps.fileName ?? ''}
              documentTypes={generalProps.documentTypes ?? DEFAULT_DOCUMENT_TYPES}
              companies={generalProps.companies ?? DEFAULT_COMPANIES}
              employees={generalProps.employees ?? DEFAULT_EMPLOYEES}
              ministries={generalProps.ministries ?? DEFAULT_MINISTRIES}
              preselectedCompanyId={generalProps.preselectedCompanyId}
              preselectedEmployeeId={generalProps.preselectedEmployeeId}
              editingDocument={generalProps.editingDocument ?? null}
              onClose={() => onGeneralClose(mountEpoch)}
              onSuccess={() => onGeneralSuccess(mountEpoch)}
            />
          </div>
        )
      )}

      {mode === 'employee' && employeeProps.isOpen && (
        <div data-testid="employee-form-wrapper" data-form-epoch={mountEpoch}>
          <EmployeeDocumentForm
            key={`employee-form-${currentAccount}:${employeeProps.employeeId}-${mountEpoch}`}
            isOpen={employeeProps.isOpen ?? true}
            employeeId={employeeProps.employeeId ?? 'emp-1'}
            uploadedFile={employeeProps.uploadedFile ?? null}
            onClose={() => onEmployeeClose(mountEpoch)}
            onSave={() => onEmployeeSave(mountEpoch)}
          />
        </div>
      )}

      <Toaster />
    </div>
  );
}

export function ExtractionFormsFixture() {
  const [currentAccount, setCurrentAccount] = useState<string>('account-admin-1');
  const [mountEpoch, setMountEpoch] = useState<number>(1);
  const activeEpochRef = useRef<number>(1);
  const [mode, setMode] = useState<'general' | 'employee' | 'none'>('general');
  const eventLogRef = useRef<EventLogEntry[]>([]);

  const logEvent = useCallback((type: string, payload?: unknown) => {
    eventLogRef.current.push({ type, payload, timestamp: Date.now() });
  }, []);

  const [generalProps, setGeneralProps] = useState<GeneralMountOptions>({
    uploadedFile: null,
    fileName: '',
    documentTypes: DEFAULT_DOCUMENT_TYPES,
    companies: DEFAULT_COMPANIES,
    employees: DEFAULT_EMPLOYEES,
    ministries: DEFAULT_MINISTRIES,
    asDialog: true,
  });

  const [employeeProps, setEmployeeProps] = useState<EmployeeMountOptions>({
    isOpen: true,
    employeeId: 'emp-1',
    uploadedFile: null,
  });

  // Closed callbacks actually close/hide the component, guarded against stale epochs
  const handleGeneralClose = useCallback((epoch: number) => {
    if (epoch !== activeEpochRef.current) return;
    logEvent('general:onClose');
    setMode('none');
  }, [logEvent]);

  const handleGeneralSuccess = useCallback((epoch: number) => {
    if (epoch !== activeEpochRef.current) return;
    logEvent('general:onSuccess');
  }, [logEvent]);

  const handleEmployeeClose = useCallback((epoch: number) => {
    if (epoch !== activeEpochRef.current) return;
    logEvent('employee:onClose');
    setEmployeeProps((prev) => ({ ...prev, isOpen: false }));
    setMode('none');
  }, [logEvent]);

  const handleEmployeeSave = useCallback((epoch: number) => {
    if (epoch !== activeEpochRef.current) return;
    logEvent('employee:onSave');
  }, [logEvent]);

  // Single-owner account and mount control
  useEffect(() => {
    window.__formsControls = {
      mountGeneral: (opts = {}) => {
        const next = activeEpochRef.current + 1;
        activeEpochRef.current = next;
        setMountEpoch(next);
        setGeneralProps({
          uploadedFile: opts.uploadedFile ?? null,
          fileName: opts.fileName ?? (opts.uploadedFile ? opts.uploadedFile.name : ''),
          documentTypes: opts.documentTypes ?? DEFAULT_DOCUMENT_TYPES,
          companies: opts.companies ?? DEFAULT_COMPANIES,
          employees: opts.employees ?? DEFAULT_EMPLOYEES,
          ministries: opts.ministries ?? DEFAULT_MINISTRIES,
          preselectedCompanyId: opts.preselectedCompanyId,
          preselectedEmployeeId: opts.preselectedEmployeeId,
          editingDocument: opts.editingDocument ?? null,
          asDialog: opts.asDialog ?? true,
        });
        setMode('general');
        return next;
      },
      mountEmployee: (opts = {}) => {
        const next = activeEpochRef.current + 1;
        activeEpochRef.current = next;
        setMountEpoch(next);
        setEmployeeProps({
          isOpen: opts.isOpen ?? true,
          employeeId: opts.employeeId ?? 'emp-1',
          uploadedFile: opts.uploadedFile ?? null,
        });
        setMode('employee');
        return next;
      },
      unmount: () => {
        const next = activeEpochRef.current + 1;
        activeEpochRef.current = next;
        setMountEpoch(next);
        setMode('none');
        return next;
      },
      setAccount: (acct: string) => {
        setCurrentAccount(acct);
        const next = activeEpochRef.current + 1;
        activeEpochRef.current = next;
        setMountEpoch(next);
        return next;
      },
      setFile: (file: File | null) => {
        if (mode === 'general') {
          setGeneralProps((prev) => ({
            ...prev,
            uploadedFile: file,
            fileName: file ? file.name : '',
          }));
        } else if (mode === 'employee') {
          setEmployeeProps((prev) => ({
            ...prev,
            uploadedFile: file,
          }));
        }
      },
      getEventLog: () => [...eventLogRef.current],
      clearEventLog: () => {
        eventLogRef.current = [];
      },
      getState: () => {
        // Query actual DocumentExtractionPanel semantics [role="status"][aria-live="polite"]
        const panelEl = document.querySelector('[role="status"][aria-live="polite"]');
        const numberInput = document.querySelector<HTMLInputElement>(
          'input[name="document_number"], #document_number'
        );
        const titleInput = document.querySelector<HTMLInputElement>(
          'input[name="title"], #title'
        );
        const container = document.querySelector('[data-testid="forms-mount-container"]');
        const isAuthReady = container?.getAttribute('data-auth-ready') === 'true';

        return {
          mode,
          mountEpoch: activeEpochRef.current,
          currentAccount,
          isAuthReady,
          selectedFileName:
            mode === 'general'
              ? generalProps.uploadedFile?.name ?? null
              : employeeProps.uploadedFile?.name ?? null,
          hasExtractionPanel: Boolean(panelEl),
          hasDocumentNumberInput: Boolean(numberInput),
          documentNumberValue: numberInput?.value ?? null,
          titleValue: titleInput?.value ?? null,
        };
      },
    };
  }, [mode, currentAccount, generalProps, employeeProps]);

  return (
    <AuthProvider key={`auth-${currentAccount}`}>
      <LanguageProvider>
        <FormsContainer
          currentAccount={currentAccount}
          mountEpoch={mountEpoch}
          mode={mode}
          generalProps={generalProps}
          employeeProps={employeeProps}
          onGeneralClose={handleGeneralClose}
          onGeneralSuccess={handleGeneralSuccess}
          onEmployeeClose={handleEmployeeClose}
          onEmployeeSave={handleEmployeeSave}
        />
      </LanguageProvider>
    </AuthProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<ExtractionFormsFixture />);
}
