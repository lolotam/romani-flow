export const en = {
  // Navigation
  nav: {
    dashboard: 'Dashboard',
    employees: 'Employees',
    documents: 'Documents',
    settings: 'Settings',
    logout: 'Logout'
  },

  // Header/Layout
  header: {
    title: 'Romani CureMed',
    subtitle: 'Document Management System'
  },

  // Theme
  theme: {
    light: 'Light Mode',
    dark: 'Dark Mode',
    toggle: 'Toggle Theme'
  },

  // Dashboard
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Main Control Panel',
    welcome: {
      title: 'Welcome, Admin',
      date: 'Here\'s an overview of the system today, {{date}}'
    },

    // Stats Cards
    stats: {
      totalDocuments: 'Total Documents',
      totalEmployees: 'Total Employees',
      totalCompanies: 'Companies',
      expiredDocuments: 'Expired Documents',
      description: {
        totalDocuments: 'Total number of uploaded documents',
        totalEmployees: 'Total number of active employees',
        totalCompanies: 'Number of registered companies',
        expiredDocuments: 'Documents requiring immediate renewal'
      }
    },

    // Debug Panel
    debug: {
      title: '🔧 Development Tools',
      description: 'If data is not displaying correctly, click force refresh',
      forceRefresh: '🔄 Force Refresh',
      currentCounts: '📊 Current document count: {{documents}} | Employees: {{employees}} | Companies: {{companies}}'
    },

    // Alerts
    alerts: {
      title: 'Important Alerts',
      criticalExpiry: 'Documents requiring immediate attention',
      expiredMessage: '• {{count}} expired documents requiring immediate renewal',
      expiringMessage: '• {{count}} documents expiring within 30 days'
    },

    // Recent Activities
    recentActivities: {
      title: 'Recent Activities',
      description: 'Latest operations completed in the system',
      employeeAdded: 'New employee added: {{name}}',
      documentAdded: 'New document added: {{title}}',
      documentUpdated: 'Document updated: {{title}}',
      noActivities: 'No recent activities',
      by: 'by',
      admin: 'Admin'
    },

    // Reminders
    reminders: {
      title: 'Reminders',
      description: 'Documents and certificates expiring soon',
      table: {
        type: 'Type',
        name: 'Name',
        expiryDate: 'Expiry Date',
        status: 'Status',
        actions: 'Actions'
      },
      types: {
        residency: 'Residency',
        drivingLicense: 'Driving License'
      },
      status: {
        expired: 'Expired',
        expiringToday: 'Expires Today',
        daysLeft: '{{days}} days'
      },
      actions: {
        pin: 'Pin Reminder',
        unpin: 'Unpin',
        delete: 'Delete Reminder',
        confirmDelete: 'Are you sure you want to delete this reminder?'
      },
      moreItems: '+{{count}} more items expiring soon',
      noReminders: 'No Reminders',
      allDocumentsValid: 'All documents are valid',
      deleteSuccess: 'Reminder deleted successfully'
    },

    // Quick Actions
    quickActions: {
      title: 'Quick Actions',
      addDocument: 'Add New Document',
      addEmployee: 'Add Employee',
      exportData: 'Export Data',
      settings: 'Settings'
    }
  },

  // Employees Page
  employees: {
    title: 'Employee Management',
    registered: 'Total {{count}} registered employees',
    addEmployee: 'Add New Employee',
    export: 'Export Data',
    exportAs: 'Export as {{format}}',
    search: 'Search',
    searchPlaceholder: 'Search by name, email, mobile, or position...',
    filterByCompany: 'Filter by Company',
    allCompanies: 'All Companies',

    // Profile/View Dialog
    profile: {
      title: 'Employee Profile',
      description: 'View employee details',
      personalData: 'Personal Data',
      fullName: 'Full Name',
      email: 'Email',
      mobile: 'Mobile Number',
      civilId: 'Civil ID',
      birthDate: 'Birth Date',
      workInfo: 'Work Information',
      company: 'Company',
      position: 'Position',
      hireDate: 'Hire Date',
      employeeNo: 'Employee No.',
      residencyInfo: 'Residency Information',
      residencyExpiry: 'Residency Expiry',
      status: 'Status',
      daysRemaining: 'Days Remaining',
      viewDocuments: 'View Documents',
      editData: 'Edit Data',
      close: 'Close'
    },

    tabs: {
      personal: 'Personal Information',
      work: 'Work Information',
      residency: 'Residency Information'
    },

    table: {
      name: 'Name',
      position: 'Position',
      company: 'Company',
      civilId: 'Civil ID',
      birthDate: 'Birth Date',
      hireDate: 'Hire Date',
      residencyExpiry: 'Residency Expiry',
      residencyStatus: 'Residency Status',
      drivingLicense: 'Driving License',
      documents: 'Documents',
      status: 'Status',
      actions: 'Actions'
    },

    status: {
      active: 'Active ✓',
      inactive: 'Inactive ✗',
      expired: 'Expired',
      lessThanWeek: 'Less than a week',
      lessThanMonth: 'Less than a month',
      valid: 'Valid',
      notSpecified: 'Not specified',
      licenseStatus: 'License Status',
      noLicense: 'No License',
      dateUndefined: 'Date Undefined'
    },

    // Form fields
    form: {
      mobileNo: 'Mobile Number'
    },

    actions: {
      view: 'View',
      edit: 'Edit',
      delete: 'Delete',
      viewDocuments: 'View Documents',
      viewProfile: 'View Profile'
    },

    dialog: {
      addTitle: 'Add New Employee',
      addDescription: 'Enter new employee information',
      editTitle: 'Edit Employee',
      editDescription: 'Update employee information',
      editTitle: 'Edit Employee',
      editDescription: 'Update employee information',
      viewTitle: 'Employee Details',
      viewDescription: 'View employee details',

      fields: {
        name: 'Name *',
        company: 'Company *',
        position: 'Position',
        email: 'Email',
        mobileNo: 'Mobile Number',
        birthDate: 'Birth Date (dd/mm/yyyy)',
        civilId: 'Civil ID Number',
        residencyExpiry: 'Residency Expiry Date (dd/mm/yyyy)',
        hireDate: 'Hire Date (dd/mm/yyyy)',
        drivingLicense: 'Driving License',
        drivingLicenseExpiry: 'Driving License Expiry (dd/mm/yyyy)',
        documentCount: 'Document Count',
        employeeStatus: 'Employee Status',
        selectCompany: 'Select Company',
        selectPosition: 'Select Position',
        validLicense: 'Valid ✓',
        invalidLicense: 'Invalid ✗',
        willUpdateAfterAdd: '0 documents (will update after adding documents)',
        fullName: 'Full Name',
        employeeId: 'Employee ID',
        daysLeft: 'Days Left'
      },

      buttons: {
        add: 'Add Employee',
        update: 'Update Employee',
        cancel: 'Cancel',
        close: 'Close'
      }
    },

    messages: {
      addSuccess: 'Employee added successfully',
      editSuccess: 'Employee information updated successfully',
      deleteSuccess: 'Employee deleted successfully',
      deleteConfirm: 'Are you sure you want to delete this employee?',
      error: 'Error',
      loadError: 'Failed to load employee data',
      addError: 'Failed to add employee',
      updateError: 'Failed to update employee information',
      deleteError: 'Failed to delete employee',
      requiredFields: 'Please fill in all required fields',
      exportSuccess: 'Employee data exported to {{format}} file',
      exportError: 'Failed to export data'
    },

    stats: {
      total: 'Total Employees',
      active: 'Active',
      inactive: 'Inactive'
    },

    // Export
    exportData: 'Export Data',
    exportCSV: 'Export as CSV',
    exportJSON: 'Export as JSON',

    // Dialog
    dialog: {
      addTitle: 'Add New Employee',
      addDescription: 'Enter new employee information',
      editTitle: 'Edit Employee',
      editDescription: 'Edit selected employee information',
      buttons: {
        add: 'Add Employee',
        update: 'Update Information',
        cancel: 'Cancel'
      },
      fields: {
        name: 'Name *',
        email: 'Email Address',
        mobileNo: 'Mobile Number',
        position: 'Position',
        selectPosition: 'Select Position',
        company: 'Company *',
        selectCompany: 'Select Company',
        birthDate: 'Birth Date (dd/mm/yyyy)',
        civilId: 'Civil ID Number',
        hireDate: 'Hire Date (dd/mm/yyyy)',
        residencyExpiry: 'Residency Expiry (dd/mm/yyyy)',
        drivingLicense: 'Driving License',
        validLicense: 'Valid ✓',
        invalidLicense: 'Invalid ✗',
        drivingLicenseExpiry: 'Driving License Expiry (dd/mm/yyyy)',
        employeeStatus: 'Employee Status',
        documentCount: 'Document Count',
        willUpdateAfterAdd: '0 documents (will be updated after adding documents)',
        documentCountEdit: 'documents'
      }
    },

    // Search
    search: 'Search',
    searchPlaceholder: 'Search by name, email, mobile, or position...',
    filterByCompany: 'Filter by Company',
    allCompanies: 'All Companies'
  },

  // Settings Page
  settings: {
    title: 'Settings',
    subtitle: 'Manage system settings and configurations',

    // Tabs
    tabs: {
      email: 'Email',
      appearance: 'Appearance',
      companies: 'Companies',
      positions: 'Positions',
      documents: 'Document Types',
      ministries: 'Ministries',
      backup: 'Backup'
    },

    // Email Settings
    email: {
      title: 'Email Settings',
      description: 'Configure email service for sending notifications',
      serviceId: 'Service ID',
      templateId: 'Template ID',
      userId: 'User ID',
      testEmail: 'Test Email',
      testSuccess: 'Email sent successfully',
      testError: 'Failed to send email',
      save: 'Save Settings',
      smtpServer: 'SMTP Server',
      smtpPort: 'SMTP Port',
      smtpUsername: 'Username',
      smtpPassword: 'Password',
      emailSender: 'Sender',
      emailReceiver: 'Receiver',
      enableNotifications: 'Enable Notifications',
      weeklySchedule: 'Weekly Reminder',
      monthlySchedule: 'Monthly Reminder',
      saveEmailSettings: 'Save Email Settings',
      testEmailButton: 'Test Email',
      monitoringTitle: 'Expiry Monitoring and Automatic Alerts',
      monitoringDescription: 'Automatic monitoring of residency permits and document expiry with email alerts',
      totalEmployees: 'Total Employees',
      registeredEmployee: 'registered employee'
    },

    // Companies Management
    companies: {
      title: 'Companies Management',
      description: 'Add and manage companies in the system',
      addNew: 'Add New Company',
      name: 'Company Name',
      nameArabic: 'Name in Arabic',
      nameEnglish: 'Name in English',
      description: 'Description',
      currentCompanies: 'Current Companies',
      employeeCount: '{{count}} employees',
      nameArabicPlaceholder: 'Enter company name in Arabic',
      nameEnglishPlaceholder: 'Enter company name in English',
      descriptionPlaceholder: 'Enter company description',
      currentCompaniesCount: 'Current Companies ({{count}})'
    },

    // Positions Management
    positions: {
      title: 'Positions Management',
      description: 'Add and manage employee positions in the system',
      addNew: 'Add New Position',
      name: 'Name',
      nameArabic: 'Name in Arabic',
      nameEnglish: 'Name in English',
      value: 'Value',
      valuePlaceholder: 'Position value',
      currentPositions: 'Current Positions',
      editTitle: 'Edit Position',
      editDescription: 'Edit position information',
      nameArabicPlaceholder: 'Enter position name in Arabic',
      nameEnglishPlaceholder: 'Enter position name in English',
      currentPositionsCount: 'Current Positions ({{count}})'
    },

    // Document Types Management
    documentTypes: {
      title: 'Document Types Management',
      description: 'Add and manage document types in the system',
      addNew: 'Add New Document Type',
      name: 'Name',
      nameArabic: 'Name in Arabic',
      nameEnglish: 'Name in English',
      currentTypes: 'Current Types',
      editTitle: 'Edit Document Type',
      editDescription: 'Edit document type information',
      nameEnglishPlaceholder: 'Document Type',
      nameArabicPlaceholder: 'نوع الوثيقة',
      currentTypesCount: 'Current Document Types ({{count}})'
    },

    // Ministries Management
    ministries: {
      title: 'Ministries Management',
      description: 'Add and manage ministries in the system',
      addNew: 'Add New Ministry',
      name: 'Name',
      nameArabic: 'Name in Arabic',
      nameEnglish: 'Name in English',
      currentMinistries: 'Current Ministries',
      editTitle: 'Edit Ministry',
      editDescription: 'Edit ministry information',
      nameEnglishPlaceholder: 'Ministry Name',
      nameArabicPlaceholder: 'اسم الوزارة',
      currentMinistriesCount: 'Current Ministries ({{count}})'
    },

    // Backup Settings
    backup: {
      title: 'Backup & Restore',
      description: 'Manage data backup and restoration',
      createBackup: 'Create Backup',
      restoreBackup: 'Restore Backup',
      downloadBackup: 'Download Backup',
      backupCreated: 'Backup created successfully',
      backupRestored: 'Data restored successfully',
      confirmRestore: 'Are you sure you want to restore data? Current data will be replaced.',
      selectFile: 'Select backup file',
      backupSection: 'Backup',
      backupDescription: 'Export all system data to JSON file',
      exportBackup: 'Export Backup',
      restoreSection: 'Data Restore',
      restoreDescription: 'Import data from backup file',
      chooseFile: 'Choose File',
      importBackup: 'Import Backup',
      automaticBackups: 'Automatic Backups',
      dailyBackups: 'Daily Backups',
      dailyBackupsDesc: 'Keep only the last two backups',
      backupNotifications: 'Backup Notifications',
      backupNotificationsDesc: 'Send confirmation via email'
    },

    // Common Actions
    actions: {
      add: 'Add',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      saveChanges: 'Save Changes',
      confirmDelete: 'Are you sure you want to delete?'
    },

    // Messages
    messages: {
      addSuccess: 'Added successfully',
      updateSuccess: 'Updated successfully',
      deleteSuccess: 'Deleted successfully',
      saveSuccess: 'Settings saved successfully',
      addError: 'Failed to add',
      updateError: 'Failed to update',
      deleteError: 'Failed to delete',
      saveError: 'Failed to save settings',
      requiredFields: 'Please fill in all required fields'
    },

    // Settings Page Toast Messages
    settingsToasts: {
      themeChanged: 'Theme Changed',
      themeChangedDesc: 'Dark mode {status}',
      enabled: 'enabled',
      disabled: 'disabled',
      error: 'Error',
      success: 'Success',
      requiredFields: 'Please fill in all required fields',
      companyAdded: 'New company added',
      companyAddError: 'Failed to add company',
      companyUpdated: 'Company updated',
      companyUpdateError: 'Failed to update company',
      companyDeleted: 'Company deleted',
      companyDeleteError: 'Failed to delete company',
      companyDeleteConfirm: 'Are you sure you want to delete company "{name}"?',
      documentTypeAdded: 'New document type added',
      documentTypeAddError: 'Failed to add document type',
      documentTypeUpdated: 'Document type updated',
      documentTypeUpdateError: 'Failed to update document type',
      documentTypeDeleted: 'Document type deleted',
      documentTypeDeleteError: 'Failed to delete document type',
      documentTypeDeleteConfirm: 'Are you sure you want to delete document type "{name}"?',
      ministryAdded: 'New ministry added',
      ministryAddError: 'Failed to add ministry',
      ministryUpdated: 'Ministry updated',
      ministryUpdateError: 'Failed to update ministry',
      ministryDeleted: 'Ministry deleted',
      ministryDeleteError: 'Failed to delete ministry',
      ministryDeleteConfirm: 'Are you sure you want to delete ministry "{name}"?',
      positionAdded: 'New position added',
      positionAddError: 'Failed to add position',
      positionUpdated: 'Position updated',
      positionUpdateError: 'Failed to update position',
      positionDeleted: 'Position deleted',
      positionDeleteError: 'Failed to delete position',
      positionDeleteConfirm: 'Are you sure you want to delete position "{name}"?',
      backupExported: 'Backup Exported',
      backupExportedDesc: 'Backup exported successfully',
      backupExportError: 'Failed to export backup',
      emailSettingsSaved: 'Email settings saved',
      checkCompleted: 'Check Completed',
      checkCompletedDesc: 'Found {employees} residency permits and {documents} documents expiring soon',
      checkError: 'Failed to check expiry',
      emailSent: 'Email Sent',
      emailSendError: 'Email Send Failed',
      emailError: 'Email sending error: {error}',
      noFileChosen: 'No file chosen'
    }
  },

  // Documents Page
  documents: {
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
      deleteDocument: 'Delete Document'
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

    status: {
      valid: 'Valid',
      expiring: 'Expiring Soon',
      expired: 'Expired',
      daysLeft: '{{days}} days left'
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
      entityNamePlaceholder: 'Enter entity name',
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
  },

  // Employee Documents Page
  employeeDocuments: {
    title: 'Documents of {{name}}',
    totalDocuments: 'Total {{count}} documents',
    uploadNew: 'Upload New Document',
    uploadTitle: 'Upload New Document for {{name}}',
    uploadDesc: 'Choose the file you want to upload',
    search: 'Search',
    searchPlaceholder: 'Search documents...',
    status: 'Status',
    allStatuses: 'All Statuses',
    valid: 'Valid',
    expiringSoon: 'Expiring Soon',
    expired: 'Expired',
    documentType: 'Document Type',
    allTypes: 'All Types',
    noDocuments: 'No documents found',
    noDocumentsDesc: 'No documents match your search criteria',
    noDocumentsEmpty: 'No documents uploaded for this employee yet',
    uploadFirst: 'Upload First Document',
    back: 'Back',
    active: 'Active',
    inactive: 'Inactive',
    unauthorized: 'Unauthorized',
    inactiveEmployee: 'This employee is inactive and their documents cannot be viewed',
    employeeNotFound: 'Employee not found',
    backToList: 'Back to Employees List',
    view: 'View Document',
    edit: 'Edit Document',
    download: 'Download Document',
    delete: 'Delete Document',
    deleteConfirm: 'Are you sure you want to delete this document?',
    photoUploadSuccess: 'Photo uploaded successfully',
    photoDeleteSuccess: 'Photo removed successfully',
    photoDeleteConfirm: 'Are you sure you want to delete the employee photo?'
  },


  // Login Page
  login: {
    title: 'Welcome',
    subtitle: 'Log in to your account',
    email: 'Email',
    password: 'Password',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    loginButton: 'Log In',
    noAccount: 'Don\'t have an account?',
    signUp: 'Sign up',
    error: 'Invalid email or password',
    success: 'Login successful'
  },

  // Index/Landing Page
  index: {
    title: 'Romani CureMed',
    subtitle: 'Medical Document Management System',
    description: 'Advanced system for managing medical documents for Green Future and CureMed companies',
    getStarted: 'Get Started',
    learnMore: 'Learn More',
    features: {
      title: 'Features',
      document: 'Document Management',
      employee: 'Employee Management',
      alerts: 'Smart Alerts',
      reports: 'Reports & Analytics'
    }
  },

  // Not Found Page
  notFound: {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist',
    goHome: 'Go to Dashboard',
    goBack: 'Go Back'
  },

  // Common/Shared
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    search: 'Search',
    filter: 'Filter',
    all: 'All',
    active: 'Active',
    inactive: 'Inactive',
    yes: 'Yes',
    no: 'No',
    add: 'Add',
    update: 'Update',
    confirm: 'Confirm',
    required: 'Required',
    optional: 'Optional',
    select: 'Select',
    upload: 'Upload',
    download: 'Download',
    export: 'Export',
    import: 'Import',
    print: 'Print',
    refresh: 'Refresh',
    actions: 'Actions',
    status: 'Status',
    date: 'Date',
    name: 'Name',
    description: 'Description',
    type: 'Type',
    noData: 'No data available',
    noResults: 'No results found',
    showMore: 'Show More',
    showLess: 'Show Less',
    total: 'Total',
    of: 'of',
    to: 'to',
    from: 'from',
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    thisYear: 'This Year',
    notSpecified: 'Not Specified',
    unknown: 'Unknown'
  }
};