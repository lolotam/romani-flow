import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { employeeDocumentDraft } from '../src/lib/documentFormDrafts.ts';

// Exercise the real component callbacks at the hook boundary, without a browser.
// Defaults are already pending when a newly created cross-device draft arrives.
function formCallbacks() {
  const state = { form: null, draftRestore: null, defaults: null };
  const react = {
    createElement: (type, props) => ({ type, props }),
    useRef: current => ({ current }),
    useCallback: callback => callback,
    useEffect: () => {},
    useState: initial => [initial, value => {
      if (value && typeof value === 'object' && 'title' in value) state.form = value;
    }],
  };
  const modules = {
    react,
    '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    '@/hooks/useAuth': { useAuth: () => ({ user: { id: 'synthetic-admin' } }) },
    '@/contexts/LanguageContext': { useLanguage: () => ({ t: key => key, isRTL: false }) },
    '@/lib/documentFormDrafts': { employeeDocumentDraft },
    './documents/useStagedDocumentUpload': { useStagedDocumentUpload: () => ({ hasPendingUpload: () => false }) },
    '@/hooks/useDocumentDraft': { useDocumentDraft: (_scope, restore) => {
      state.draftRestore = restore;
      return { status: 'saved', hasDraft: false, session: { current: null } };
    } },
    '@/hooks/useLastSubmission': { useLastSubmissionRestore: (_form, enabled, restore, pristine) => {
      state.defaults = { enabled, restore, pristine };
    } },
  };
  const source = fs.readFileSync(new URL('../src/components/EmployeeDocumentForm.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => modules[name] ?? {} });
  const props = { isOpen: true, employeeId: 'synthetic-employee', onClose() {}, onSave() {} };
  exports.EmployeeDocumentForm(props).type(props);
  return state;
}

for (const restored of [null, { title: 'Cross-device draft', notes: 'Unsubmitted work' }]) {
  test(`a pending defaults response ${restored ? 'cannot replace a restored draft' : 'can fill an empty form'}`, () => {
    const state = formCallbacks();
    assert.equal(state.defaults.enabled, true); // The old request was eligible when started.
    state.draftRestore(restored);
    if (state.defaults.pristine()) state.defaults.restore({ title: 'Previous submission', notes: 'Old notes' });
    assert.equal(state.form.title, restored ? restored.title : 'Previous submission');
    assert.equal(state.form.notes, restored ? restored.notes : 'Old notes');
  });
}
