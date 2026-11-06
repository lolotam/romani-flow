import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/hooks/useAuth';
import { LanguageProvider } from '../../src/contexts/LanguageContext';
import { DocumentEditorDialog, DocumentUploadDialog } from '../../src/components/documents/DocumentDialogs';
import '../../src/index.css';

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  return <AuthProvider><LanguageProvider>
    <DocumentUploadDialog open={open} onOpenChange={setOpen} onFilesAccepted={files => {
      setFile(files[0]); setOpen(false);
    }} />
    {file && <DocumentEditorDialog uploadedFile={file} fileName={file.name}
      companies={[]} employees={[]} documentTypes={[]} ministries={[]}
      onClose={() => setFile(null)} onSuccess={() => undefined} />}
  </LanguageProvider></AuthProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
