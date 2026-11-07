ALTER TABLE documents
ADD COLUMN document_number TEXT DEFAULT NULL
CHECK (
  document_number IS NULL OR
  (typeof(document_number) = 'text' AND length(document_number) <= 128)
);
