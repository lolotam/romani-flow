import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FileText, Calendar, Eye, Edit, Download, Trash2, Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { calculateDocumentStatus } from '@/lib/statusUtils';
import { endpoints, type DocumentWithRelations } from '@/lib/api';

export interface DocumentCardActions {
  handleViewDocument: (doc: DocumentWithRelations) => void;
  handleEditDocument: (doc: DocumentWithRelations) => void;
  handleDownloadDocument: (doc: DocumentWithRelations) => void;
  handleDeleteDocument: (id: string) => void;
  handleEmailDocument: (doc: DocumentWithRelations) => void;
  toggleDocumentSelection: (id: string) => void;
  emailLabel: string;
  isDeleting: boolean;
}

interface DocumentCardProps extends DocumentCardActions {
  doc: DocumentWithRelations;
  selected: boolean;
}

export function DocumentCard({ doc, selected, handleViewDocument, handleEditDocument,
  handleDownloadDocument, handleDeleteDocument, handleEmailDocument, toggleDocumentSelection,
  emailLabel, isDeleting }: DocumentCardProps) {
  const { t, language } = useLanguage();
  const isImage = !!doc.file_path && !!doc.mime_type?.startsWith('image/');
  const isPdf = doc.mime_type === 'application/pdf';
  
  return <Card className="group hover:shadow-elegant transition-all duration-300 relative overflow-hidden">
    <div className="absolute top-3 left-3 z-10">
      <Checkbox aria-label={`${t('documents.bulk.selected', { count: 1 })}: ${doc.title}`} checked={selected} onCheckedChange={() => toggleDocumentSelection(doc.id)} className="bg-background border-2" />
    </div>
    
    {/* Thumbnail Preview */}
    <div className="relative w-full h-32 bg-muted flex items-center justify-center overflow-hidden">
      {isImage ? (
        <img src={endpoints.files.previewUrl(doc.id)} alt={doc.title} className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center text-muted-foreground">
          <FileText className="h-10 w-10 mb-1 opacity-50" />
          <span className="text-xs">{isPdf ? 'PDF' : t('documents.card.noPreview') || 'No Preview'}</span>
        </div>
      )}
    </div>

    <CardHeader className="pb-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <CardTitle className="text-lg font-semibold line-clamp-2 pr-8">
            {doc.title}
          </CardTitle>
          <CardDescription className="mt-1">
            {doc.document_types?.name_ar}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
    
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={calculateDocumentStatus(doc.expiry_date)} />
        <Badge variant="outline" className="text-xs">
          {doc.employee_id ? doc.employees?.name : doc.companies?.name}
        </Badge>
      </div>
      
      {doc.expiry_date && <div className="flex items-center text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 ml-2" />
          <span>{t('documents.card.expiresOn')} {new Date(doc.expiry_date + 'T00:00:00').toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}</span>
        </div>}
      
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="flex space-x-1">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={() => handleViewDocument(doc)}
            aria-label={t('documents.card.viewDocument')}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={() => handleEditDocument(doc)}
            aria-label={t('documents.card.editDocument')}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={() => handleDownloadDocument(doc)}
            aria-label={t('documents.card.downloadDocument')}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleEmailDocument(doc)} aria-label={emailLabel}>
            <Mail className="h-4 w-4" />
          </Button>
          <Button 
            disabled={isDeleting}
            variant="ghost" 
            size="sm" 
            className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => handleDeleteDocument(doc.id)}
            aria-label={t('documents.card.deleteDocument')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>;
}
