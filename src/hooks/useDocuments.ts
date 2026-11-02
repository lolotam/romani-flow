import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Company, DocumentType, DocumentWithRelations, EmployeeWithRelations, Ministry } from '@/lib/api';
import { calculateDocumentStatus } from '@/lib/statusUtils';

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentWithRelations[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setError(null);
    try {
      const results = await Promise.all([
        api.from<DocumentWithRelations>('documents')
          .select('*, employees (name, companies (name, name_ar)), companies (name, name_ar), document_types (name, name_ar), ministries (name, name_ar)')
          .order('created_at', 'desc').execute(),
        api.from<Company>('companies').select('*').order('name', 'asc').execute(),
        api.from<EmployeeWithRelations>('employees').select('*, companies (name, name_ar)').order('name', 'asc').execute(),
        api.from<DocumentType>('document_types').select('*').order('name_ar', 'asc').execute(),
        api.from<Ministry>('ministries').select('*').order('name_ar', 'asc').execute(),
      ]);
      if (currentRequest !== requestId.current) return;
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      setDocuments(results[0].data ?? []);
      setCompanies(results[1].data ?? []);
      setEmployees(results[2].data ?? []);
      setDocumentTypes(results[3].data ?? []);
      setMinistries(results[4].data ?? []);
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { requestId.current += 1; };
  }, [reload]);

  const removeDocuments = (ids: string[]) => {
    // Invalidate an older refresh before removing successfully deleted rows.
    requestId.current += 1;
    setDocuments((current) => current.filter((document) => !ids.includes(document.id)));
  };

  // Calculate document count for each employee from the same document snapshot.
  const employeesWithCounts = useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach((document) => {
      if (document.employee_id) counts.set(document.employee_id, (counts.get(document.employee_id) ?? 0) + 1);
    });
    return employees.map((employee) => ({ ...employee, document_count: counts.get(employee.id) ?? 0 }));
  }, [documents, employees]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [activeTab, setActiveTab] = useState('company');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredDocuments = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesSearch = [document.title, document.document_types?.name, document.document_types?.name_ar,
        document.companies?.name, document.companies?.name_ar, document.employees?.name]
        .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = selectedStatus === 'all' || calculateDocumentStatus(document.expiry_date) === selectedStatus;
      const matchesType = selectedType === 'all' || document.document_type_id === selectedType;
      const matchesTab = activeTab === 'company' ? !!document.company_id : !!document.employee_id;
      return matchesSearch && matchesStatus && matchesType && matchesTab;
    });
  }, [documents, searchTerm, selectedStatus, selectedType, activeTab]);

  // Dynamic company documents - group documents by company id, not display name.
  const documentsByCompany = useMemo(() => {
    const groups = new Map<string, DocumentWithRelations[]>();
    filteredDocuments.forEach((document) => {
      const companyId = document.company_id ?? document.employees?.company_id;
      if (companyId) groups.set(companyId, [...(groups.get(companyId) ?? []), document]);
    });
    return groups;
  }, [filteredDocuments]);

  // Dynamic employee groups by company.
  const employeesByCompany = useMemo(() => {
    const groups = new Map<string, typeof employeesWithCounts>();
    employeesWithCounts.forEach((employee) => {
      if (employee.company_id && employee.is_active !== false) {
        groups.set(employee.company_id, [...(groups.get(employee.company_id) ?? []), employee]);
      }
    });
    return groups;
  }, [employeesWithCounts]);

  // Scope selection to the current filters so bulk actions cannot affect hidden rows.
  const selectedDocuments = filteredDocuments.filter((document) => selectedIds.includes(document.id));
  const toggleDocumentSelection = (id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id]);
  };
  const selectAllDocuments = () => {
    setSelectedIds(filteredDocuments.map((document) => document.id));
  };

  return {
    documents, companies, employees: employeesWithCounts, documentTypes, ministries, isLoading, error, reload, removeDocuments,
    searchTerm, setSearchTerm: (value: string) => { setSearchTerm(value); setSelectedIds([]); },
    selectedStatus, setSelectedStatus: (value: string) => { setSelectedStatus(value); setSelectedIds([]); },
    selectedType, setSelectedType: (value: string) => { setSelectedType(value); setSelectedIds([]); },
    activeTab, setActiveTab: (value: string) => { setActiveTab(value); setSelectedIds([]); },
    viewMode, setViewMode, filteredDocuments, documentsByCompany, employeesByCompany,
    selectedDocuments, toggleDocumentSelection, selectAllDocuments, clearSelection: () => setSelectedIds([]),
  };
}
