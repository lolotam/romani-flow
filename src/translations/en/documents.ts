// Documents Page
export const documents = {
  title: 'Document Management',
  subtitle: 'Manage all company and employee documents',
  viewAndManage: 'View and manage all documents ({{count}} documents)',
  addDocument: 'Add New Document',
  uploadDocuments: 'Upload Documents',
  uploadNew: 'Upload New Documents',
  chooseFiles: 'Choose files to upload',
  search: 'Search',
  searchPlaceholder: 'Search documents...',
  filterBy: 'Filter by {{filter}}',
  allTypes: 'All Types',
  allStatuses: 'All Statuses',
  status: 'Status',
  documentType: 'Document Type',

  // Status options
  statusOptions: {
    all: 'All Statuses',
    valid: 'Valid',
    expiringSoon: 'Expiring Soon',
    expired: 'Expired'
  },

  tabs: {
    all: 'All Documents',
    employee: 'Employee Documents',
    company: 'Company Documents',
    companyDocuments: 'Company Documents',
    employeeDocuments: 'Employee Documents'
  },

  // Document card content
  card: {
    expiresOn: 'Expires:',
    viewDocument: 'View Document',
    editDocument: 'Edit Document',
    downloadDocument: 'Download Document',
    deleteDocument: 'Delete Document',
    noPreview: 'No Preview'
  },

  // Company section
  company: {
    viewAllCompanyDocuments: 'View All Company Documents',
    noDocumentsInSection: 'No documents in this section',
    clickToGoToCompanyPage: 'Click to go to company documents page',
    viewAllDocuments: 'View All Documents ({{count}})',
    employees: '{{company}} Employees'
  },

  // Employee section  
  employee: {
    noEmployeesInSection: 'No employees in this section'
  },

  // Bulk operations
  bulk: {
    selected: '{{count}} documents selected',
    clearSelection: 'Clear Selection',
    download: 'Download',
    delete: 'Delete',
    selectAll: 'Select All ({{count}})',
    deleteConfirm: 'Are you sure you want to delete {{count}} documents?',
    deleteSuccess: '{{count}} documents deleted successfully',
    deleteError: 'Failed to delete documents'
  },

  // Empty states
  empty: {
    noCompanies: 'No companies added to the system',
    noCompaniesSubtext: 'Add companies from the settings page',
    noEmployees: 'No companies added to the system',
    noEmployeesSubtext: 'Add companies from the settings page'
  },

  table: {
    title: 'Title',
    type: 'Type',
    entity: 'Entity',
    issueDate: 'Issue Date',
    expiryDate: 'Expiry Date',
    status: 'Status',
    file: 'File',
    actions: 'Actions'
  },


  actions: {
    view: 'View',
    edit: 'Edit',
    delete: 'Delete',
    download: 'Download',
    preview: 'Preview'
  },

  // Document form
  form: {
    previewNoFile: 'No file selected',
    closeUnsavedConfirm: 'The latest changes were not saved. Close without them? The last saved draft will be kept.',
    previewHint: 'Select a PDF or image to preview while filling the fields.',
    previewOpen: 'Open file in a new tab if preview is unavailable',
    fileCleanupPending: 'The previous attachment was abandoned, but file cleanup is pending retry.',
    title: 'Document Title',
    beneficiaryType: 'Beneficiary Type',
    company: 'Company',
    employee: 'Employee',
    documentType: 'Document Type',
    ministry: 'Ministry/Entity',
    entityName: 'Entity Name',
    issueDate: 'Issue Date',
    expiryDate: 'Expiry Date',
    notes: 'Notes',
    file: 'File',

    // Form labels and placeholders
    titlePlaceholder: 'Enter document title',
    selectCompany: 'Select Company',
    selectEmployee: 'Select Employee',
    selectDocumentType: 'Select Document Type',
    selectMinistry: 'Select Ministry',
    entityNamePlaceholder: 'Enter entity name',
    notesPlaceholder: 'Additional notes (optional)',
    selectDate: 'Select Date',

    // Form options
    beneficiaryTypes: {
      company: 'Company',
      employee: 'Employee'
    },

    // Additional form labels
    entityNameLabel: 'Entity Name *',
    employeeDataLabel: 'Employee Data',
    filterByCompanyLabel: 'Filter by Company (optional)',
    allCompaniesOption: 'All Companies',
    employeeLabel: 'Employee *',
    selectEmployeeLabel: 'Select Employee',
    documentTypeLabel: 'Document Type *',
    selectDocumentTypeLabel: 'Select Document Type',
    otherMinistryOption: 'Other',

    // Validation messages
    validation: {
      entityNameTooLong: 'Entity name must not exceed 100 characters',
      notesTooLong: 'Notes exceed 5000 characters. Shorten them before saving the draft or document.',
      reviewFields: 'Review the errors shown in the form fields before saving.',
      noDocumentTypes: 'Add a document type in Settings first, then return to save the document.',
      noEmployees: 'No employees are available. Add an employee first or select a company beneficiary.',
      titleMinLength: 'Document title must be at least 3 characters',
      titleMaxLength: 'Document title must not exceed 120 characters',
      beneficiaryTypeRequired: 'Beneficiary type is required',
      expiryDateRequired: 'Expiry date is required',
      allFieldsRequired: 'All required fields must be filled',
      invalidDateRange: 'Expiry date must be after or equal to issue date',
      entityNameRequired: 'Entity name is required when selecting "Other"'
    },

    // Buttons
    buttons: {
      save: 'Save Document',
      update: 'Update Document',
      cancel: 'Cancel',
      close: 'Close'
    }
  },

  // Upload dialog
  upload: {
    title: 'Upload New Document',
    titleFor: 'Upload New Document for {{name}}',
    chooseFile: 'Choose the file you want to upload',
    dragAndDrop: 'Drag and drop files here',
    dragAndDropActive: 'Drop files here...',
    clickToSelect: 'or click to select from your device',
    maxFiles: 'Maximum: {{count}} files, {{size}} per file',
    supportedTypes: 'Supported types: {{types}}',
    uploadedFiles: 'Uploaded Files ({{count}})',
    clearAll: 'Clear All',
    uploading: 'Uploading...',
    uploadComplete: 'Upload Complete',
    uploadFailed: 'Upload Failed',
    removeFile: 'Remove file'
  },

  messages: {
    addSuccess: 'Document added successfully',
    editSuccess: 'Document updated successfully',
    deleteSuccess: 'Document deleted successfully',
    deleteConfirm: 'Are you sure you want to delete this document?',
    uploadSuccess: 'File uploaded successfully',
    downloadError: 'Failed to download document',
    error: 'Error',
    success: 'Success',
    loadError: 'Failed to load documents',
    noDocuments: 'No documents found',
    fileSizeError: 'File size must be less than 20MB',
    fileTypeError: 'Unsupported file type. Only PDF, JPG and PNG files are allowed',
    noFileError: 'No file to save',
    ministryCreateError: 'Failed to create new ministry',
    updateError: 'Failed to update document data',
    saveError: 'Failed to save document data',
    consoleError: 'Error saving document'
  },

  // Employee Document Form
  employeeDocumentForm: {
    title: 'Add New Document',
    description: 'Enter new document data for the employee',
    requiredFieldsError: 'Please fill in all required fields',
    saveError: 'Failed to save document data',
    saveSuccess: 'Document saved successfully',
    attachedFile: 'Attached File:',
    saving: 'Saving...',
    save: 'Save Document',
    cancel: 'Cancel'
  }
};
