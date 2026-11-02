import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, CreditCard, Mail, Phone, User } from 'lucide-react';
import type { EmployeeWithRelations } from '@/types';

export interface EmployeeProfileHeaderProps {
  employee: EmployeeWithRelations;
}

/** The employee summary card at the top of the employee profile page. */
export function EmployeeProfileHeader({ employee }: EmployeeProfileHeaderProps) {
  return (
    <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
      <CardHeader>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="h-8 w-8 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-2xl text-gradient">{employee.name}</CardTitle>
            <CardDescription className="text-lg">
              {employee.position} - {employee.companies?.name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {employee.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{employee.email}</span>
            </div>
          )}
          {employee.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{employee.phone}</span>
            </div>
          )}
          {employee.civil_id_no && (
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{employee.civil_id_no}</span>
            </div>
          )}
          {employee.hire_date && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">تاريخ التوظيف: {employee.hire_date}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
