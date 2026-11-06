import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadComponent(path, name, modules, globals = {}) {
  const react = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const source = fs.readFileSync(new URL('../src/components/' + path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, React: react, ...globals,
    require: id => ({ react: { ...react, ...modules.react },
      '@/contexts/LanguageContext': { useLanguage: () => ({ t: key => key }) },
      '@/lib/utils': { cn: () => '' }, ...modules })[id] ?? {} });
  return exports[name];
}

function picker(props) {
  return loadComponent('documents/DocumentAttachmentPicker.tsx', 'DocumentAttachmentPicker', {
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/UploadDropzone': { UploadDropzone: 'dropzone' },
    './DocumentAttachment': { DocumentAttachment: 'preview' },
  })(props);
}

test('editing offers a replacement picker and permits changing the selected replacement', () => {
  const editingDocument = { id: 'synthetic', file_name: 'stored.pdf', file_path: 'stored.pdf' };
  const selected = [], changed = [];
  const props = { editingDocument, disabled: false, onSelect: file => selected.push(file), onChange: () => changed.push(true) };
  const tree = picker({ ...props, file: null });
  const dropzone = tree.children.find(node => node?.type === 'dropzone');
  assert.ok(dropzone);
  const file = { name: 'replacement.pdf' };
  dropzone.props.onFilesAccepted([file]); assert.equal(selected[0], file);
  const replacement = picker({ ...props, file });
  const button = replacement.children.find(node => node?.type === 'button');
  assert.ok(button); button.props.onClick(); assert.equal(changed.length, 1);
  assert.equal(replacement.children.some(node => node?.type === 'dropzone'), false);
});

test('in-form file selection starts no simulation interval or upload-state updates', () => {
  const selected = [], callbacks = {};
  let intervals = 0, updates = 0;
  const tree = picker({ file: null, disabled: false, onSelect: file => selected.push(file), onChange() {} });
  const props = tree.children.find(node => node?.type === 'dropzone').props;
  const Dropzone = loadComponent('ui/UploadDropzone.tsx', 'UploadDropzone', {
    react: { useState: () => [[], () => { updates++; }], useCallback: callback => callback },
    'react-dropzone': { useDropzone: options => {
      callbacks.onDrop = options.onDrop;
      return { getRootProps: () => ({}), getInputProps: () => ({}) };
    } },
    '@/lib/fileAccept': { fileAccept: () => ({}) },
  }, { setInterval: () => { intervals++; return 1; } });
  const file = { name: 'synthetic.pdf' };
  for (let cycle = 0; cycle < 3; cycle++) {
    Dropzone(props); callbacks.onDrop([file], []);
  }
  assert.equal(selected.length, 3);
  assert.equal(intervals, 0); assert.equal(updates, 0);
  Dropzone({ ...props, disabled: true }); callbacks.onDrop([file], []);
  assert.equal(selected.length, 3);
});
