// Dashboard
export const dashboard = {
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
};
