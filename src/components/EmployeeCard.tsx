import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  User, 
  Mail, 
  Phone, 
  Building2, 
  Calendar,
  FileText,
  Eye
} from 'lucide-react';

interface Employee {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  hire_date?: string;
  birth_date?: string;
  civil_id_no?: string;
  residency_expiry_date?: string;
  company_id: string;
  document_count?: number;
  companies?: {
    name: string;
    name_ar: string;
  };
}

interface EmployeeCardProps {
  employee: Employee;
  onViewDocuments: (employeeId: string) => void;
  onViewProfile: (employee: Employee) => void;
}

export function EmployeeCard({ employee, onViewDocuments, onViewProfile }: EmployeeCardProps) {
  const { t } = useLanguage();
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Card className="group hover:shadow-elegant transition-all duration-300 cursor-pointer border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-4">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
              {getInitials(employee.name)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold truncate">
                {employee.name}
              </CardTitle>
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDocuments(employee.id);
                  }}
                  className="h-6 px-2 text-xs bg-accent hover:bg-primary/10 border-border text-foreground"
                  title={`${employee.document_count || 0} ${t('employees.table.documents')}`}
                >
                  <FileText className="h-3 w-3 mr-1" />
                  {employee.document_count || 0}
                </Button>
              </div>
            </div>
            <CardDescription className="flex items-center space-x-2 mt-1">
              <Building2 className="h-3 w-3" />
              <span className="truncate">{employee.companies?.name}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {employee.position && (
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <Badge variant="outline" className="text-xs">
              {employee.position}
            </Badge>
          </div>
        )}
        
        {employee.email && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span className="truncate">{employee.email}</span>
          </div>
        )}
        
        {employee.phone && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Phone className="h-4 w-4" />
            <span>{employee.phone}</span>
          </div>
        )}
        
        {employee.hire_date && (
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{t('employees.table.hireDate')}: {new Date(employee.hire_date).toLocaleDateString('en-GB')}</span>
          </div>
        )}
        
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewProfile(employee);
            }}
            className="hover:bg-accent"
          >
            <Eye className="h-4 w-4 ml-1" />
            {t('employees.actions.viewProfile')}
          </Button>
          
          <Button
            variant="default"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewDocuments(employee.id);
            }}
            className="hover:shadow-md transition-all"
          >
            <FileText className="h-4 w-4 ml-1" />
            {t('employees.actions.viewDocuments')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
