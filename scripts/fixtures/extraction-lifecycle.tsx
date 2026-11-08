/**
 * Dedicated Browser Lifecycle Fixture for Task 10 / Task 12.
 *
 * Statically imports actual production useDocumentExtraction and DocumentExtractionPanel.
 * Free of external font imports (no remote Google fonts / index.css).
 * Exposes hook inputs strictly through React state and relays hook actions directly.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/hooks/useAuth';
import { LanguageProvider } from '../../src/contexts/LanguageContext';
import type { Field, Values } from '../../server/contracts/documentExtraction';
import {
  useDocumentExtraction,
  type ExtractionPhase,
  type ExtractionFields,
} from '../../src/hooks/useDocumentExtraction';
import { DocumentExtractionPanel } from '../../src/components/documents/DocumentExtractionPanel';

// Tracks actual extraction HTTP/body settlement without changing hook or form behavior.
const nativeFetch = window.fetch.bind(window);
const extractionReads = new Map<string, { settled: boolean; outcome: string }>();
const bitmapWork = new Set<Promise<ImageBitmap>>();
const nativeBitmap = window.createImageBitmap.bind(window);
window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
  const work = nativeBitmap(...args);
  bitmapWork.add(work);
  void work.finally(() => bitmapWork.delete(work)).catch(() => {});
  return work;
}) as typeof createImageBitmap;
const taskTurn = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
  channel.port2.postMessage(null);
});
window.__extractionProbe = {
  reads: extractionReads,
  drain: async () => {
    // React passive effects and continuations use browser tasks; native image decode is awaited too.
    for (let i = 0; i < 3; i++) { await taskTurn(); await Promise.allSettled([...bitmapWork]); }
  },
};
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname !== '/api/document-extraction' || init?.method !== 'POST') return nativeFetch(input, init);
  let id = `malformed-${extractionReads.size}`;
  try { id = JSON.parse(String(init.body)).requestId ?? id; } catch { /* Observe malformed POSTs too; never prevent transport. */ }
  const record = { settled: false, outcome: 'pending' };
  extractionReads.set(id, record);
  try {
    const response = await nativeFetch(input, init);
    const text = response.text.bind(response);
    response.text = async () => {
      try { return await text(); }
      finally { record.settled = true; record.outcome = 'response'; }
    };
    return response;
  } catch (error) {
    record.settled = true;
    record.outcome = init.signal?.aborted ? 'abort' : 'error';
    throw error;
  }
};

export interface LifecycleMountProps {
  secondForm?: boolean;
  initialAccount?: string | null;
  initialScope?: string;
  initialContext?: string;
  initialFile?: File | null;
  initialReady?: boolean;
  initialOpen?: boolean;
  initialSupported?: Field[];
  initialValues?: Values;
  initialPanelDisabled?: boolean;
}

export interface LifecycleControls {
  remount: (props?: LifecycleMountProps) => void;
  setAccount: (account: string | null) => void;
  setScope: (scope: string) => void;
  setContext: (context: string) => void;
  setFile: (file: File | null) => void;
  setReady: (ready: boolean) => void;
  setOpen: (open: boolean) => void;
  setSupported: (fields: Field[]) => void;
  setFormValues: (values: Values) => void;
  updateFieldValue: (field: Field, val: string) => void;
  setPanelDisabled: (disabled: boolean) => void;
  manual: (field: Field) => void;
  protect: (fields: Field[]) => void;
  replace: () => void;
  invalidate: () => void;
  reset: () => void;
  retry: () => void;
  cancel: () => void;
  accept: (field: Field, val: string) => boolean;
  getState: () => {
    phase: ExtractionPhase;
    fields: ExtractionFields | null;
    errorCode: string | null;
    retryAfterSeconds: number;
    formValues: Values;
    applyCallCount: number;
    lastAppliedPatch: Partial<Values> | null;
    onStartCount: number;
    mountEpoch: number;
    selectedFileName: string | null;
    ready: boolean;
  };
}

declare global {
  interface Window {
    __extractionProbe: {
      reads: Map<string, { settled: boolean; outcome: string }>;
      drain: () => Promise<void>;
    };
    __lifecycleControls?: LifecycleControls;
    __secondLifecycleControls?: LifecycleControls;
  }
}

interface InnerMountProps extends LifecycleMountProps {
  controlSlot?: 'primary' | 'second';
  mountEpoch: number;
  remount: (props?: LifecycleMountProps) => void;
}

function ExtractionLifecycleMount({
  controlSlot = 'primary',
  mountEpoch,
  remount,
  initialAccount = 'account-admin-1',
  initialScope = 'test-scope',
  initialContext = 'kw-docs-context',
  initialFile = null,
  initialReady = true,
  initialOpen = true,
  initialSupported = [
    'title',
    'document_number',
    'document_type_id',
    'ministry_id',
    'issue_date',
    'expiry_date',
  ],
  initialValues = {
    title: 'doc.png',
    document_number: '',
    document_type_id: '',
    ministry_id: '',
    issue_date: '',
    expiry_date: '',
  },
  initialPanelDisabled = false,
}: InnerMountProps) {
  const [account, setAccount] = useState<string | null>(initialAccount);
  const [scope, setScope] = useState<string>(initialScope);
  const [context, setContext] = useState<string>(initialContext);
  const [file, setFile] = useState<File | null>(initialFile);
  const [ready, setReady] = useState<boolean>(initialReady);
  const [open, setOpen] = useState<boolean>(initialOpen);
  const [supported, setSupported] = useState<Field[]>(initialSupported);
  const [formValues, setFormValues] = useState<Values>(initialValues);
  const [panelDisabled, setPanelDisabled] = useState<boolean>(initialPanelDisabled);
  const [onStartCount, setOnStartCount] = useState<number>(0);
  const [applyCallCount, setApplyCallCount] = useState<number>(0);
  const [lastAppliedPatch, setLastAppliedPatch] = useState<Partial<Values> | null>(null);

  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;

  const handleApply = useCallback((patch: Partial<Values>) => {
    setApplyCallCount((c) => c + 1);
    setLastAppliedPatch(patch);
    setFormValues((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleStart = useCallback(() => {
    setOnStartCount((c) => c + 1);
  }, []);

  const extraction = useDocumentExtraction({
    account,
    scope,
    context,
    file,
    ready,
    open,
    values: () => formValuesRef.current,
    apply: handleApply,
    supported,
    onStart: handleStart,
  });

  useEffect(() => {
    const controls: LifecycleControls = {
      remount,
      setAccount: (acct: string | null) => setAccount(acct),
      setScope: (s: string) => setScope(s),
      setContext: (ctx: string) => setContext(ctx),
      setFile: (f: File | null) => setFile(f),
      setReady: (r: boolean) => setReady(r),
      setOpen: (o: boolean) => setOpen(o),
      setSupported: (fields: Field[]) => setSupported(fields),
      setFormValues: (vals: Values) => setFormValues(vals),
      updateFieldValue: (field: Field, val: string) => {
        setFormValues((prev) => ({ ...prev, [field]: val }));
      },
      setPanelDisabled: (d: boolean) => setPanelDisabled(d),
      manual: (field: Field) => extraction.manual(field),
      protect: (fields: Field[]) => extraction.protect(fields),
      replace: () => extraction.replace(),
      invalidate: () => extraction.invalidate(),
      reset: () => extraction.reset(),
      retry: () => extraction.retry(),
      cancel: () => extraction.cancel(),
      accept: (field: Field, val: string) => extraction.accept(field, val),
      getState: () => ({
        phase: extraction.phase,
        fields: extraction.fields,
        errorCode: extraction.errorCode,
        retryAfterSeconds: extraction.retryAfterSeconds,
        formValues: formValuesRef.current,
        applyCallCount,
        lastAppliedPatch,
        onStartCount,
        mountEpoch,
        selectedFileName: file?.name ?? null,
        ready,
      }),
    };
    if (controlSlot === 'second') window.__secondLifecycleControls = controls;
    else window.__lifecycleControls = controls;
    return () => {
      if (controlSlot === 'second') delete window.__secondLifecycleControls;
    };
  }, [
    controlSlot,
    remount,
    account,
    scope,
    context,
    file,
    ready,
    open,
    supported,
    extraction,
    applyCallCount,
    lastAppliedPatch,
    onStartCount,
    mountEpoch,
  ]);

  return (
    <div
      data-testid={controlSlot === 'primary' ? 'lifecycle-mount-container' : 'second-lifecycle-mount-container'}
      data-mount-epoch={mountEpoch}
      style={{ padding: '1rem', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <div
        data-testid="lifecycle-debug"
        style={{
          padding: '0.5rem',
          marginBottom: '1rem',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          backgroundColor: '#f9f9f9',
        }}
      >
        <div>Phase: <span data-testid="lifecycle-phase">{extraction.phase}</span></div>
        <div>Error: <span data-testid="lifecycle-error-code">{extraction.errorCode || ''}</span></div>
        <div>RetryAfter: <span data-testid="lifecycle-retry-after">{extraction.retryAfterSeconds}</span></div>
        <div>ApplyCalls: <span data-testid="lifecycle-apply-count">{applyCallCount}</span></div>
        <div>StartCalls: <span data-testid="lifecycle-on-start-count">{onStartCount}</span></div>
        <div>MountEpoch: <span data-testid="lifecycle-mount-epoch">{mountEpoch}</span></div>
        <div>Values: <span data-testid="lifecycle-values-json">{JSON.stringify(formValues)}</span></div>
      </div>
      <DocumentExtractionPanel state={extraction} disabled={panelDisabled} />
    </div>
  );
}

export function ExtractionLifecycleFixture() {
  const [mountEpoch, setMountEpoch] = useState<number>(1);
  const [mountProps, setMountProps] = useState<LifecycleMountProps>({});

  const handleRemount = useCallback((props: LifecycleMountProps = {}) => {
    setMountProps(props);
    setMountEpoch((prev) => prev + 1);
  }, []);

  return (
    <AuthProvider key={`auth-${mountEpoch}`}>
      <LanguageProvider>
        <div data-testid="lifecycle-root" data-mount-epoch={mountEpoch}>
          <ExtractionLifecycleMount
            key={`mount-${mountEpoch}`}
            mountEpoch={mountEpoch}
            remount={handleRemount}
            {...mountProps}
          />
          {mountProps.secondForm && (
            <ExtractionLifecycleMount
              key={`second-${mountEpoch}`}
              controlSlot="second"
              mountEpoch={mountEpoch}
              remount={handleRemount}
              initialScope="independent-second-form"
            />
          )}
        </div>
      </LanguageProvider>
    </AuthProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<ExtractionLifecycleFixture />);
}
