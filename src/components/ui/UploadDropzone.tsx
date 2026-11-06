import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from './button';
import { Progress } from './progress';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { fileAccept } from '@/lib/fileAccept';

interface UploadedFile {
  file: File;
  id: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

interface UploadDropzoneProps {
  onFilesAccepted: (files: File[]) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  acceptedFileTypes?: string[];
  className?: string;
  disabled?: boolean;
  selectionOnly?: boolean;
}

export function UploadDropzone({
  onFilesAccepted,
  maxFiles = 10,
  maxFileSize = 10 * 1024 * 1024, // 10MB
  acceptedFileTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'],
  className,
  disabled = false,
  selectionOnly = false
}: UploadDropzoneProps) {
  const { t } = useLanguage();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: unknown[]) => {
    if (disabled) return;

    // Handle rejected files
    if (rejectedFiles.length > 0) {
      console.warn('Some files were rejected:', rejectedFiles);
    }

    // In-form selection is local; its parent owns preview and actual upload state.
    if (selectionOnly) { onFilesAccepted(acceptedFiles); return; }

    // Add accepted files to the list
    const newFiles: UploadedFile[] = acceptedFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      progress: 0,
      status: 'uploading'
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);
    onFilesAccepted(acceptedFiles);

    // Simulate upload progress
    newFiles.forEach(uploadedFile => {
      simulateUpload(uploadedFile.id);
    });
  }, [onFilesAccepted, disabled, selectionOnly]);

  const simulateUpload = (fileId: string) => {
    const interval = setInterval(() => {
      setUploadedFiles(prev => prev.map(file => {
        if (file.id === fileId) {
          const newProgress = Math.min(file.progress + Math.random() * 30, 100);
          const isComplete = newProgress >= 100;
          
          if (isComplete) {
            clearInterval(interval);
            return {
              ...file,
              progress: 100,
              status: Math.random() > 0.1 ? 'success' : 'error', // 90% success rate
              error: Math.random() > 0.1 ? undefined : t('documents.upload.uploadFailed')
            };
          }
          
          return { ...file, progress: newProgress };
        }
        return file;
      }));
    }, 200);
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
  };

  const clearAll = () => {
    setUploadedFiles([]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles,
    maxSize: maxFileSize,
    accept: fileAccept(acceptedFileTypes),
    disabled
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer transition-all duration-200",
          isDragActive && "border-primary bg-primary/5",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "hover:border-primary hover:bg-accent/50"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center space-y-4 pointer-events-none">
          <div className={cn(
            "p-4 rounded-full pointer-events-none",
            isDragActive ? "bg-primary/10" : "bg-accent"
          )}>
            <Upload className={cn(
              "h-8 w-8 pointer-events-none",
              isDragActive ? "text-primary" : "text-muted-foreground"
            )} />
          </div>
          <div className="pointer-events-none">
            <p className="text-lg font-medium">
              {isDragActive ? t('documents.upload.dragAndDropActive') : t('documents.upload.dragAndDrop')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('documents.upload.clickToSelect')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('documents.upload.maxFiles', { count: maxFiles, size: formatFileSize(maxFileSize) })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('documents.upload.supportedTypes', { types: acceptedFileTypes.join(', ') })}
            </p>
          </div>
        </div>
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{t('documents.upload.uploadedFiles', { count: uploadedFiles.length })}</h4>
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              className="h-8"
            >
              {t('documents.upload.clearAll')}
            </Button>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {uploadedFiles.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className="flex items-center space-x-3 p-3 border border-border rounded-lg bg-card"
              >
                <div className="flex-shrink-0">
                  <File className="h-5 w-5 text-muted-foreground" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium truncate">
                      {uploadedFile.file.name}
                    </p>
                    <div className="flex items-center space-x-2">
                      {uploadedFile.status === 'success' && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {uploadedFile.status === 'error' && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(uploadedFile.id)}
                        className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatFileSize(uploadedFile.file.size)}</span>
                    <span>
                      {uploadedFile.status === 'uploading' && `${Math.round(uploadedFile.progress)}%`}
                      {uploadedFile.status === 'success' && t('documents.upload.uploadComplete')}
                      {uploadedFile.status === 'error' && uploadedFile.error}
                    </span>
                  </div>
                  
                  {uploadedFile.status === 'uploading' && (
                    <Progress value={uploadedFile.progress} className="h-1 mt-2" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
