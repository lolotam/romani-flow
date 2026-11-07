import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/hooks/useAuth';
import { LanguageProvider } from '../../src/contexts/LanguageContext';
import { DocumentEditorDialog } from '../../src/components/documents/DocumentDialogs';
import { EmployeeDocumentForm } from '../../src/components/EmployeeDocumentForm';
import type { ExtractionRequest, ExtractionResult } from '../../server/contracts/documentExtraction';
import { readImageHeader } from '../../src/lib/extraction/imageHeader';
import { prepareDocument } from '../../src/lib/extraction/prepare';
import { extractDocument } from '../../src/lib/api/documentExtraction';

// Synthetic options conforming strictly to application schemas (unexported per parent fix)
const SYNTHETIC_COMPANIES = [
  { id: 'comp-1', name: 'Al-Amal Trading', name_ar: 'شركة الأمل للتجارة' },
  { id: 'comp-2', name: 'Al-Noor Logistics', name_ar: 'شركة النور للخدمات اللوجستية' },
];

const SYNTHETIC_EMPLOYEES = [
  { id: 'emp-1', name: 'Ahmad Al-Mansour', company_id: 'comp-1' },
  { id: 'emp-2', name: 'Fatima Al-Sabah', company_id: 'comp-2' },
];

const SYNTHETIC_DOCUMENT_TYPES = [
  { id: 'type-civil-id', name: 'Civil ID', name_ar: 'البطاقة المدنية' },
  { id: 'type-passport', name: 'Passport', name_ar: 'جواز السفر' },
  { id: 'type-work-permit', name: 'Work Permit', name_ar: 'إذن العمل' },
];

const SYNTHETIC_MINISTRIES = [
  { id: 'min-moi', name: 'Ministry of Interior', name_ar: 'وزارة الداخلية' },
  { id: 'min-pam', name: 'Public Authority for Manpower', name_ar: 'الهيئة العامة للقوى العاملة' },
  { id: 'min-moh', name: 'Ministry of Health', name_ar: 'وزارة الصحة' },
];

export interface ImageHeaderResult {
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export interface PreparedDocumentResult {
  pageCount: number;
  images: ExtractionRequest['images'];
}

export interface FixtureSpies {
  createImageBitmapCalls: number;
  workerTerminateCalls: number;
  canvasReleaseCalls: number;
}

declare global {
  interface Window {
    __fixtureCounts: {
      onSave: number;
      onSuccess: number;
    };
    __fixtureSpies: FixtureSpies;
    __fixtureControls: {
      setMode: (mode: 'general' | 'employee') => void;
      setAccount: (account: string) => void;
      getMode: () => 'general' | 'employee';
      getAccount: () => string;
      resetCounts: () => void;
      getSpies: () => FixtureSpies;
      resetSpies: () => void;
      testImageHeader: (bytes: Uint8Array) => Promise<{ success: boolean; result?: ImageHeaderResult; error?: string }>;
      testPrepareDocument: (file: File, signal?: AbortSignal, maxSourceBytes?: number) => Promise<{ success: boolean; result?: PreparedDocumentResult; error?: string }>;
      testPdfRender: (bytes: Uint8Array, signal?: AbortSignal) => Promise<{ success: boolean; result?: PreparedDocumentResult; error?: string }>;
      testExtractDocument: (payload: ExtractionRequest, account?: string) => Promise<{ success: boolean; result?: ExtractionResult; error?: string }>;
      testAssetUrl: (url: string) => Promise<{ status: number; contentType: string | null; ok: boolean; error?: string }>;
      setRenderGate: (held: boolean) => void;
      awaitEnteredToBlob: () => Promise<void>;
      releaseRenderGate: () => void;
    };
  }
}

// Browser instrumentation boundary for spies
if (typeof window !== 'undefined') {
  if (!window.__fixtureSpies) {
    window.__fixtureSpies = {
      createImageBitmapCalls: 0,
      workerTerminateCalls: 0,
      canvasReleaseCalls: 0,
    };

    if (typeof window.createImageBitmap === 'function') {
      const originalCreateImageBitmap = window.createImageBitmap;
      window.createImageBitmap = function (...args: Parameters<typeof originalCreateImageBitmap>) {
        window.__fixtureSpies.createImageBitmapCalls += 1;
        return originalCreateImageBitmap.apply(this, args);
      } as typeof originalCreateImageBitmap;
    }

    if (typeof Worker !== 'undefined' && Worker.prototype) {
      window.Worker = new Proxy(window.Worker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args) as Worker;
          window.dispatchEvent(new Event('fixture-worker-started'));
          return worker;
        },
      });
      const originalTerminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function () {
        window.__fixtureSpies.workerTerminateCalls += 1;
        return originalTerminate.apply(this);
      };
    }

    if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
      const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      if (widthDescriptor?.set) {
        const originalSetWidth = widthDescriptor.set;
        Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
          set(val: number) {
            if (val === 0) window.__fixtureSpies.canvasReleaseCalls += 1;
            originalSetWidth.call(this, val);
          },
          configurable: true,
        });
      }
      const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
      if (heightDescriptor?.set) {
        const originalSetHeight = heightDescriptor.set;
        Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
          set(val: number) {
            if (val === 0) window.__fixtureSpies.canvasReleaseCalls += 1;
            originalSetHeight.call(this, val);
          },
          configurable: true,
        });
      }
    }
  }
}

let renderGateHeld = false;
let renderGateResolvers: Array<() => void> = [];
let toBlobEnteredResolvers: Array<() => void> = [];
let toBlobEntered = false;

if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    if (renderGateHeld) {
      toBlobEntered = true;
      const waiters = toBlobEnteredResolvers;
      toBlobEnteredResolvers = [];
      waiters.forEach((r) => r());
      new Promise<void>((resolve) => {
        renderGateResolvers.push(resolve);
      }).then(() => {
        originalToBlob.call(this, callback, type, quality);
      });
      return;
    }
    return originalToBlob.call(this, callback, type, quality);
  };
}

export function ExtractionBrowserFixture() {
  const preparationOnly = new URLSearchParams(window.location.search).has('preparation');
  useEffect(() => {
    if (!preparationOnly) void import('../../src/index.css');
  }, [preparationOnly]);
  const [mode, setMode] = useState<'general' | 'employee'>('general');
  const [account, setAccount] = useState('account-admin-1');
  const [onSaveCount, setOnSaveCount] = useState(0);
  const [onSuccessCount, setOnSuccessCount] = useState(0);

  // Sync counters to window object for synchronous evaluation in test runner
  useEffect(() => {
    window.__fixtureCounts = {
      onSave: onSaveCount,
      onSuccess: onSuccessCount,
    };
  }, [onSaveCount, onSuccessCount]);

  useEffect(() => {
    window.__fixtureControls = {
      setMode: (m: 'general' | 'employee') => setMode(m),
      setAccount: (a: string) => setAccount(a),
      getMode: () => mode,
      getAccount: () => account,
      resetCounts: () => {
        setOnSaveCount(0);
        setOnSuccessCount(0);
      },
      getSpies: () => ({ ...window.__fixtureSpies }),
      resetSpies: () => {
        window.__fixtureSpies = {
          createImageBitmapCalls: 0,
          workerTerminateCalls: 0,
          canvasReleaseCalls: 0,
        };
      },
      testImageHeader: async (bytes: Uint8Array) => {
        try {
          const result = readImageHeader(bytes);
          return { success: true, result };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: err instanceof Error && err.name === 'AbortError' ? 'AbortError' : message };
        }
      },
      testPrepareDocument: async (file: File, signal?: AbortSignal, maxSourceBytes?: number) => {
        try {
          const controller = signal ? null : new AbortController();
          const activeSignal = signal ?? controller!.signal;
          const result = await prepareDocument(file, activeSignal, maxSourceBytes ?? 20 * 1024 * 1024);
          return { success: true, result };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: err instanceof Error && err.name === 'AbortError' ? 'AbortError' : message };
        }
      },
      testPdfRender: async (bytes: Uint8Array, signal?: AbortSignal) => {
        try {
          const file = new File([bytes], 'document.pdf', { type: 'application/pdf' });
          const controller = signal ? null : new AbortController();
          const activeSignal = signal ?? controller!.signal;
          const result = await prepareDocument(file, activeSignal, 20 * 1024 * 1024);
          return { success: true, result };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: err instanceof Error && err.name === 'AbortError' ? 'AbortError' : message };
        }
      },
      testExtractDocument: async (payload: ExtractionRequest, acct?: string) => {
        try {
          const controller = new AbortController();
          const result = await extractDocument(payload, acct || account, controller.signal);
          return { success: true, result };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: err instanceof Error && err.name === 'AbortError' ? 'AbortError' : message };
        }
      },
      testAssetUrl: async (url: string) => {
        try {
          const res = await fetch(url);
          return { status: res.status, contentType: res.headers.get('content-type'), ok: res.ok };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { status: 0, contentType: null, ok: false, error: message };
        }
      },
      setRenderGate: (held: boolean) => {
        renderGateHeld = held;
        if (!held) {
          const resolvers = renderGateResolvers;
          renderGateResolvers = [];
          resolvers.forEach((r) => r());
          const entryResolvers = toBlobEnteredResolvers;
          toBlobEnteredResolvers = [];
          entryResolvers.forEach((r) => r());
          toBlobEntered = false;
        } else {
          toBlobEntered = false;
        }
      },
      awaitEnteredToBlob: () => {
        if (toBlobEntered) return Promise.resolve();
        return new Promise<void>((resolve) => {
          toBlobEnteredResolvers.push(resolve);
        });
      },
      releaseRenderGate: () => {
        renderGateHeld = false;
        const gateResolvers = renderGateResolvers;
        renderGateResolvers = [];
        gateResolvers.forEach((r) => r());
        const entryResolvers = toBlobEnteredResolvers;
        toBlobEnteredResolvers = [];
        entryResolvers.forEach((r) => r());
        toBlobEntered = false;
      },
    };
  }, [mode, account]);

  if (preparationOnly) return <div data-testid="fixture-controls">Preparation fixture</div>;
  return (
    <AuthProvider key={account}>
      <LanguageProvider>
        <div className="p-4 bg-background min-h-screen">
          {/* Fixture-only controls */}
          <div data-testid="fixture-controls" className="mb-4 p-3 border rounded bg-muted/30 flex flex-wrap gap-3 items-center text-xs">
            <span className="font-semibold text-foreground">Extraction Test Fixture:</span>
            <div className="flex gap-1 items-center">
              <span>Mode:</span>
              <button
                type="button"
                data-testid="mode-general"
                className={`px-2 py-1 border rounded ${mode === 'general' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                onClick={() => setMode('general')}
              >
                General Form
              </button>
              <button
                type="button"
                data-testid="mode-employee"
                className={`px-2 py-1 border rounded ${mode === 'employee' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                onClick={() => setMode('employee')}
              >
                Employee Form
              </button>
            </div>
            <div className="flex gap-1 items-center">
              <span>Account:</span>
              <button
                type="button"
                data-testid="switch-account"
                className="px-2 py-1 border rounded bg-background"
                onClick={() => {
                  const nextAccount = account === 'account-admin-1' ? 'account-admin-2' : 'account-admin-1';
                  setAccount(nextAccount);
                }}
              >
                Toggle ({account})
              </button>
            </div>
            <div className="ml-auto flex gap-4 text-xs">
              <div>onSave count: <span data-testid="on-save-count" className="font-mono font-bold">{onSaveCount}</span></div>
              <div>onSuccess count: <span data-testid="on-success-count" className="font-mono font-bold">{onSuccessCount}</span></div>
            </div>
          </div>

          {/* Form mount container: preserved component lifetime across file replacements */}
          <div data-testid="form-mount-container">
            {mode === 'general' ? (
              <DocumentEditorDialog
                key="fixture-general-doc-form"
                uploadedFile={null}
                fileName="synthetic-document.pdf"
                companies={SYNTHETIC_COMPANIES}
                employees={SYNTHETIC_EMPLOYEES}
                documentTypes={SYNTHETIC_DOCUMENT_TYPES}
                ministries={SYNTHETIC_MINISTRIES}
                onClose={() => undefined}
                onSuccess={() => {
                  setOnSuccessCount(c => c + 1);
                  setOnSaveCount(c => c + 1);
                }}
              />
            ) : (
              <EmployeeDocumentForm
                key="fixture-employee-doc-form"
                isOpen={true}
                employeeId="emp-1"
                uploadedFile={null}
                onClose={() => undefined}
                onSave={() => {
                  setOnSaveCount(c => c + 1);
                  setOnSuccessCount(c => c + 1);
                }}
              />
            )}
          </div>
        </div>
      </LanguageProvider>
    </AuthProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<ExtractionBrowserFixture />);
}
