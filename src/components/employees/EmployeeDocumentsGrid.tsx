import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Download, FileText, Trash2 } from 'lucide-react';
import type { DocumentWithRelations } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { canEdit } from '@/lib/permissions';

export interface EmployeeDocumentsGridProps {
  documents: DocumentWithRelations[];
  selectedDocumentIds: string[];
  onToggleDocument: (documentId: string) => void;
  onDownload: (document: DocumentWithRelations) => void;
  onDelete: (documentId: string) => void;
}

/** The grid of document cards shown on the employee profile page. */
export function EmployeeDocumentsGrid({
  documents,
  selectedDocumentIds,
  onToggleDocument,
  onDownload,
  onDelete,
}: EmployeeDocumentsGridProps) {
  const editable = canEdit(useAuth().user?.role);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {documents.map((document, index) => (
        <motion.div
          key={document.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <Card className="hover:shadow-lg transition-all duration-300 group">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedDocumentIds.includes(document.id)}
                    onCheckedChange={() => onToggleDocument(document.id)}
                  />
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <StatusBadge status={document.status} />
              </div>
              <CardTitle className="text-lg line-clamp-2 group-hover:text-primary transition-colors">
                {document.title}
              </CardTitle>
              <CardDescription>{document.document_types?.name_ar}</CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {document.issue_date && (
                  <div>
                    <span className="text-muted-foreground">تاريخ الإصدار:</span>
                    <div>{new Date(document.issue_date).toLocaleDateString('en-GB')}</div>
                  </div>
                )}
                {document.expiry_date && (
                  <div>
                    <span className="text-muted-foreground">تاريخ الانتهاء:</span>
                    <div>{new Date(document.expiry_date).toLocaleDateString('en-GB')}</div>
                  </div>
                )}
              </div>

              {document.ministries && (
                <div className="text-sm">
                  <span className="text-muted-foreground">الوزارة:</span>
                  <Badge variant="outline" className="mr-2">
                    {document.ministries.name_ar}
                  </Badge>
                </div>
              )}

              {document.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">ملاحظات:</span>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{document.notes}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {document.file_path && (
                  <Button
                    onClick={() => onDownload(document)}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    <Download className="h-4 w-4 ml-2" />
                    تنزيل
                  </Button>
                )}
                {editable && <Button
                  onClick={() => onDelete(document.id)}
                  variant="destructive"
                  size="sm"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
