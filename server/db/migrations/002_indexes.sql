-- Query paths that the SPA and the expiry report rely on.

CREATE INDEX IF NOT EXISTS idx_employees_company   ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_residency ON employees(residency_expiry_date);
CREATE INDEX IF NOT EXISTS idx_employees_name      ON employees(name);

CREATE INDEX IF NOT EXISTS idx_documents_employee   ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_company    ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_type       ON documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_documents_ministry   ON documents(ministry_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry     ON documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_documents_created    ON documents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
