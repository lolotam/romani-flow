// Employees Page
export const employees = {
  whatsapp: { optIn: 'Send WhatsApp reminders to this employee', help: 'Only their own documents and residency use the current mobile with country code, when WhatsApp reminders are enabled globally.' },
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

  // Search
};
