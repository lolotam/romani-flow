import { useNavigate } from 'react-router-dom';
import { Building2, Eye, FileText, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmployeeCard } from '@/components/EmployeeCard';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Company, DocumentWithRelations, EmployeeWithRelations } from '@/lib/api';
import { DocumentCard, type DocumentCardActions } from './DocumentCard';

interface DocumentSectionsProps {
  companies: Company[];
  documentsByCompany: Map<string, DocumentWithRelations[]>;
  employeesByCompany: Map<string, (EmployeeWithRelations & { document_count: number })[]>;
  activeTab: string;
  viewMode: 'grid' | 'list';
  selectedIds: string[];
  actions: DocumentCardActions;
}

export function DocumentSections({ companies, documentsByCompany, employeesByCompany,
  activeTab, viewMode, selectedIds, actions }: DocumentSectionsProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (companies.length === 0) {
    return (
      <div className="text-center py-12">
        {activeTab === 'company'
          ? <Building2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          : <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />}
        <p className="text-muted-foreground">{t(activeTab === 'company' ? 'documents.empty.noCompanies' : 'documents.empty.noEmployees')}</p>
        <p className="text-sm text-muted-foreground mt-2">{t(activeTab === 'company' ? 'documents.empty.noCompaniesSubtext' : 'documents.empty.noEmployeesSubtext')}</p>
      </div>
    );
  }

  return <div className="space-y-8">
    {companies.map((company) => {
      const docs = documentsByCompany.get(company.id) ?? [];
      const employees = employeesByCompany.get(company.id) ?? [];
      const openCompany = () => navigate(`/documents/company/${company.id}`);
      return (
        <section key={company.id} className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {activeTab === 'company' ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}
              <span>{activeTab === 'company' ? company.name_ar || company.name
                : t('documents.company.employees', { company: company.name_ar || company.name })}</span>
              <Badge variant="secondary">{activeTab === 'company' ? docs.length : employees.length}</Badge>
            </h3>
            {activeTab === 'company' && (
              <Button variant="outline" size="sm" onClick={openCompany}>
                <Eye className="h-4 w-4 ml-2" />
                {t('documents.company.viewAllCompanyDocuments')}
              </Button>
            )}
          </div>

          {activeTab === 'company' ? (
            docs.length === 0 ? (
              <Card className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">{t('documents.company.noDocumentsInSection')}</p>
                <Button variant="link" onClick={openCompany}>
                  {t('documents.company.clickToGoToCompanyPage')}
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className={viewMode === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2'}>
                  {docs.slice(0, 4).map((doc) => (
                    <DocumentCard key={doc.id} doc={doc} selected={selectedIds.includes(doc.id)} {...actions} />
                  ))}
                </div>
                {docs.length > 4 && (
                  <div className="text-center">
                    <Button variant="outline" onClick={openCompany}>
                      {t('documents.company.viewAllDocuments', { count: docs.length })}
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : employees.length === 0 ? (
            <Card className="p-8 text-center">
              <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">{t('documents.employee.noEmployeesInSection')}</p>
            </Card>
          ) : (
            <div className={viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2'}>
              {employees.map((employee) => (
                <EmployeeCard key={employee.id} employee={employee}
                  onViewDocuments={(id) => navigate(`/documents/employee/${id}`)}
                  onViewProfile={(profile) => navigate(`/employees/${profile.id}`)} />
              ))}
            </div>
          )}
        </section>
      );
    })}
  </div>;
}
