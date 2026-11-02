// Dashboard
export const dashboard = {
  title: 'لوحة التحكم',
  subtitle: 'لوحة التحكم الرئيسية',
  welcome: {
    title: 'مرحباً بك، المدير',
    date: 'إليك نظرة عامة على النظام اليوم، {{date}}'
  },

  // Stats Cards
  stats: {
    totalDocuments: 'إجمالي الوثائق',
    totalEmployees: 'إجمالي الموظفين',
    totalCompanies: 'الشركات',
    expiredDocuments: 'وثائق منتهية الصلاحية',
    description: {
      totalDocuments: 'العدد الإجمالي للوثائق المرفوعة',
      totalEmployees: 'العدد الإجمالي للموظفين النشطين',
      totalCompanies: 'عدد الشركات المسجلة',
      expiredDocuments: 'وثائق تحتاج لتجديد فوري'
    }
  },

  // Debug Panel
  debug: {
    title: '🔧 أدوات التطوير',
    description: 'إذا كانت البيانات لا تظهر بشكل صحيح، اضغط فرض التحديث',
    forceRefresh: '🔄 فرض التحديث',
    currentCounts: '📊 العدد الحالي للوثائق: {{documents}} | الموظفين: {{employees}} | الشركات: {{companies}}'
  },

  // Alerts
  alerts: {
    title: 'تنبيهات مهمة',
    criticalExpiry: 'وثائق تحتاج انتباه فوري',
    expiredMessage: '• {{count}} وثيقة منتهية الصلاحية تحتاج لتجديد فوري',
    expiringMessage: '• {{count}} وثيقة ستنتهي صلاحيتها خلال 30 يوماً'
  },

  // Recent Activities
  recentActivities: {
    title: 'النشاطات الأخيرة',
    description: 'آخر العمليات المنجزة في النظام',
    employeeAdded: 'تم إضافة موظف جديد: {{name}}',
    documentAdded: 'تم إضافة وثيقة جديدة: {{title}}',
    documentUpdated: 'تم تحديث وثيقة: {{title}}',
    noActivities: 'لا توجد نشاطات حديثة',
    by: 'بواسطة',
    admin: 'المدير'
  },

  // Reminders
  reminders: {
    title: 'التذكيرات',
    description: 'الوثائق والمستندات التي تنتهي صلاحيتها قريباً',
    table: {
      type: 'النوع',
      name: 'الاسم',
      expiryDate: 'تاريخ الانتهاء',
      status: 'الحالة',
      actions: 'الإجراءات'
    },
    types: {
      residency: 'إقامة',
      drivingLicense: 'رخصة قيادة'
    },
    status: {
      expired: 'منتهية',
      expiringToday: 'تنتهي اليوم',
      daysLeft: '{{days}} يوم'
    },
    actions: {
      pin: 'تثبيت التذكير',
      unpin: 'إلغاء التثبيت',
      delete: 'حذف التذكير',
      confirmDelete: 'هل أنت متأكد من حذف هذا التذكير؟'
    },
    moreItems: '+{{count}} عنصر إضافي ينتهي قريباً',
    noReminders: 'لا توجد تذكيرات',
    allDocumentsValid: 'جميع الوثائق سارية المفعول',
    deleteSuccess: 'تم حذف التذكير'
  },

  // Quick Actions
  quickActions: {
    title: 'الإجراءات السريعة',
    addDocument: 'إضافة وثيقة جديدة',
    addEmployee: 'إضافة موظف',
    exportData: 'تصدير البيانات',
    settings: 'الإعدادات'
  }
};
