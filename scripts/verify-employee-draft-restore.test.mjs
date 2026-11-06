import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { employeeDocumentDraft, newDocumentDefaults, nextDocumentFileTitle } from '../src/lib/documentFormDrafts.ts';
import { restoreFormDate } from '../src/lib/formDefaults.ts';
import { draftValues } from '../src/lib/documentDraftSession.ts';

// Exercise the real component callbacks at the hook boundary, without a browser.
// Defaults are already pending when a newly created cross-device draft arrives.
function formCallbacks(kind = 'employee', status = 'saved', overrides = {}) {
  const state = { form: null, draftRestore: null, defaults: null, picker: null, changes: [] };
  const react = {
    createElement: (type, props) => {
      if (type === 'picker') state.picker = props;
      return { type, props };
    },
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
    '@/lib/documentFormDrafts': { employeeDocumentDraft, nextDocumentFileTitle },
    '@/lib/formDefaults': { restoreFormDate },
    '@/lib/documentDraftSession': { draftValues },
    './documents/documentFormSchema': { createDocumentSchema: () => ({}) },
    './documents/DocumentAttachmentPicker': { DocumentAttachmentPicker: 'picker' },
    '@hookform/resolvers/zod': { zodResolver: () => ({}) },
    'react-hook-form': { useForm: ({ defaultValues }) => {
      state.form = defaultValues;
      return { getValues: key => key ? state.form[key] : state.form, reset: value => { state.form = value; },
        setValue: (key, value) => { state.form = { ...state.form, [key]: value }; state.changes.push(state.form); },
        watch: key => state.form[key], formState: { isDirty: false }, handleSubmit: () => () => {} };
    } },
    './documents/useStagedDocumentUpload': { useStagedDocumentUpload: () => ({ hasPendingUpload: () => false }) },
    '@/hooks/useDocumentDraft': { useDocumentDraft: (_scope, restore) => {
      state.draftRestore = restore;
      return { status, hasDraft: false, session: { current: { change: value => state.changes.push(value) } } };
    } },
    '@/hooks/useLastSubmission': { useLastSubmissionRestore: (_form, enabled, restore, pristine) => {
      state.defaults = { enabled, restore, pristine };
    } },
  };
  modules['@/lib/documentFormDrafts'].newDocumentDefaults = newDocumentDefaults;
  const component = kind === 'employee' ? 'EmployeeDocumentForm' : 'DocumentForm';
  const source = fs.readFileSync(new URL('../src/components/' + component + '.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => modules[name] ?? {} });
  const props = { isOpen: true, employeeId: 'synthetic-employee', onClose() {}, onSave() {},
    employees: [], documentTypes: [], companies: [], ministries: [], ...overrides };
  const root = exports[component](props);
  root.type({ ...props, ...root.props });
  return state;
}

for (const selected of [{ name: 'second.pdf' }, null]) {
  test(`discard uses ${selected ? 'the current file title' : 'an empty title without a file'}, never the initial file title`, () => {
    const state = formCallbacks('general', 'saved', { fileName: 'first.pdf', uploadedFile: selected });
    state.draftRestore({ title: 'Saved draft title', notes: 'Discard me' });
    state.draftRestore(null);
    assert.equal(state.form.title, selected ? 'second' : '');
    assert.equal(state.form.notes, '');
  });
}

test('discard while editing preserves the stored document title rather than the replacement filename', () => {
  const state = formCallbacks('general', 'saved', { fileName: 'first.pdf', uploadedFile: { name: 'second.pdf' },
    editingDocument: { id: 'synthetic', title: 'Stored title', expiry_date: '2030-01-01', notes: 'Stored notes' } });
  state.draftRestore({ title: 'Unsaved edit', notes: 'Discard me' });
  state.draftRestore(null);
  assert.equal(state.form.title, 'Stored title');
  assert.equal(state.form.notes, 'Stored notes');
});

for (const kind of ['employee', 'general']) for (const phase of ['before load', 'after restore']) {
  test(`${kind} file selection ${phase} preserves cross-device metadata without queuing an empty draft`, () => {
    const state = formCallbacks(kind, phase === 'before load' ? 'loading' : 'saved');
    const saved = { title: 'Custom draft title', notes: 'Important unsaved notes', expiry_date: '2030-01-01' };
    if (phase === 'after restore') state.draftRestore(saved);
    const before = JSON.stringify(state.form);
    state.picker.onSelect({ name: 'different-name.pdf' });
    assert.equal(JSON.stringify(state.form), before);
    assert.equal(state.changes.length, 0);
    if (phase === 'before load') state.draftRestore(saved);
    assert.equal(state.form.title, saved.title);
    assert.equal(state.form.notes, saved.notes);
    assert.equal(state.form.expiry_date.getFullYear(), 2030);
  });
}

for (const kind of ['employee', 'general']) for (const restored of [null, { title: 'Cross-device draft', notes: 'Unsubmitted work' }]) {
  test(`${kind}: a pending defaults response ${restored ? 'cannot replace a restored draft' : 'can fill an empty form'}`, () => {
    const state = formCallbacks(kind);
    assert.equal(state.defaults.enabled, true); // The old request was eligible when started.
    state.draftRestore(restored);
    if (state.defaults.pristine()) state.defaults.restore({ title: 'Previous submission', notes: 'Old notes' });
    assert.equal(state.form.title, restored ? restored.title : 'Previous submission');
    assert.equal(state.form.notes, restored ? restored.notes : 'Old notes');
  });
}
