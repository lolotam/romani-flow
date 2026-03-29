export const ar = {
  // Navigation
  nav: {
    dashboard: 'لوحة التحكم',
    employees: 'الموظفين',
    documents: 'الوثائق',
    settings: 'الإعدادات',
    logout: 'تسجيل الخروج'
  },

  // Header/Layout
  header: {
    title: 'Romani CureMed',
    subtitle: 'نظام إدارة الوثائق'
  },

  // Theme
  theme: {
    light: 'الوضع المضيء',
    dark: 'الوضع الداكن',
    toggle: 'تبديل المظهر'
  },

  // Dashboard
  dashboard: {
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
  },

  // Employees Page
  employees: {
    title: 'إدارة الموظفين',
    registered: 'إجمالي {{count}} موظف مسجل',
    addEmployee: 'إضافة موظف جديد',
    export: 'تصدير البيانات',
    exportAs: 'تصدير كـ {{format}}',
    search: 'البحث',
    searchPlaceholder: 'البحث بالاسم، البريد الإلكتروني، الجوال، أو المنصب...',
    filterByCompany: 'تصفية حسب الشركة',
    allCompanies: 'جميع الشركات',

    // Profile/View Dialog
    profile: {
      title: 'الملف الشخصي للموظف',
      description: 'عرض تفاصيل الموظف',
      personalData: 'البيانات الشخصية',
      fullName: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      mobile: 'رقم الجوال',
      civilId: 'الرقم المدني',
      birthDate: 'تاريخ الميلاد',
      workInfo: 'معلومات العمل',
      company: 'الشركة',
      position: 'المنصب',
      hireDate: 'تاريخ التوظيف',
      employeeNo: 'رقم الموظف',
      residencyInfo: 'معلومات الإقامة',
      residencyExpiry: 'تاريخ انتهاء الإقامة',
      status: 'الحالة',
      daysRemaining: 'الأيام المتبقية',
      viewDocuments: 'عرض الوثائق',
      editData: 'تعديل البيانات',
      close: 'إغلاق'
    },

    tabs: {
      personal: 'المعلومات الشخصية',
      work: 'معلومات العمل',
      residency: 'معلومات الإقامة'
    },

    table: {
      name: 'الاسم',
      position: 'المنصب',
      company: 'الشركة',
      civilId: 'الرقم المدني',
      birthDate: 'تاريخ الميلاد',
      hireDate: 'تاريخ التوظيف',
      residencyExpiry: 'انتهاء الإقامة',
      residencyStatus: 'حالة الإقامة',
      drivingLicense: 'رخصة القيادة',
      documents: 'الوثائق',
      status: 'الحالة',
      actions: 'الإجراءات'
    },

    status: {
      active: 'نشط ✓',
      inactive: 'غير نشط ✗',
      expired: 'منتهية',
      lessThanWeek: 'أقل من أسبوع',
      lessThanMonth: 'أقل من شهر',
      valid: 'سارية',
      notSpecified: 'غير محدد',
      licenseStatus: 'حالة الرخصة',
      noLicense: 'لا توجد رخصة',
      dateUndefined: 'التاريخ غير محدد'
    },

    // Form fields
    form: {
      mobileNo: 'رقم الجوال'
    },

    actions: {
      view: 'عرض',
      edit: 'تعديل',
      delete: 'حذف',
      viewDocuments: 'عرض الوثائق',
      viewProfile: 'عرض الملف'
    },

    dialog: {
      addTitle: 'إضافة موظف جديد',
      addDescription: 'أدخل بيانات الموظف الجديد',
      editTitle: 'تعديل بيانات الموظف',
      editDescription: 'تحديث معلومات الموظف',
      viewTitle: 'تفاصيل الموظف',

      fields: {
        name: 'الاسم *',
        company: 'الشركة *',
        position: 'المنصب',
        email: 'البريد الإلكتروني',
        mobileNo: 'رقم الجوال',
        birthDate: 'تاريخ الميلاد (dd/mm/yyyy)',
        civilId: 'الرقم المدني',
        residencyExpiry: 'تاريخ انتهاء الإقامة (dd/mm/yyyy)',
        hireDate: 'تاريخ التوظيف (dd/mm/yyyy)',
        drivingLicense: 'رخصة القيادة',
        drivingLicenseExpiry: 'تاريخ انتهاء رخصة القيادة (dd/mm/yyyy)',
        documentCount: 'عدد الوثائق',
        documentCountEdit: 'وثيقة',
        employeeStatus: 'حالة الموظف',
        selectCompany: 'اختر الشركة',
        selectPosition: 'اختر المنصب',
        validLicense: 'صالحة ✓',
        invalidLicense: 'غير صالحة ✗',
        willUpdateAfterAdd: '0 وثيقة (سيتم التحديث بعد إضافة الوثائق)',
        fullName: 'الاسم الكامل',
        employeeId: 'معرف الموظف',
        daysLeft: 'الأيام المتبقية'
      },

      buttons: {
        add: 'إضافة الموظف',
        update: 'تحديث البيانات',
        cancel: 'إلغاء',
        close: 'إغلاق'
      }
    },

    messages: {
      addSuccess: 'تم إضافة الموظف بنجاح',
      editSuccess: 'تم تحديث بيانات الموظف بنجاح',
      deleteSuccess: 'تم حذف الموظف بنجاح',
      deleteConfirm: 'هل أنت متأكد من حذف هذا الموظف؟',
      error: 'خطأ',
      loadError: 'فشل في تحميل بيانات الموظفين',
      addError: 'فشل في إضافة الموظف',
      updateError: 'فشل في تحديث بيانات الموظف',
      deleteError: 'فشل في حذف الموظف',
      requiredFields: 'يرجى ملء جميع الحقول المطلوبة',
      exportSuccess: 'تم تصدير بيانات الموظفين إلى ملف {{format}}',
      exportError: 'فشل في تصدير البيانات'
    },

    stats: {
      total: 'إجمالي الموظفين',
      active: 'نشط',
      inactive: 'غير نشط'
    },

    // Export
    exportData: 'تصدير البيانات',
    exportCSV: 'تصدير كـ CSV',
    exportJSON: 'تصدير كـ JSON'
  },

  // Settings Page
  settings: {
    title: 'الإعدادات',
    subtitle: 'إدارة إعدادات النظام والتكوينات',

    // Tabs
    tabs: {
      email: 'البريد',
      appearance: 'المظهر',
      companies: 'الشركات',
      positions: 'المناصب',
      documents: 'أنواع الوثائق',
      ministries: 'الوزارات',
      backup: 'النسخ الاحتياطي'
    },

    // Email Settings
    email: {
      title: 'إعدادات البريد الإلكتروني',
      description: 'تكوين خدمة البريد الإلكتروني لإرسال الإشعارات',
      serviceId: 'معرف الخدمة',
      templateId: 'معرف القالب',
      userId: 'معرف المستخدم',
      testEmail: 'اختبر البريد الإلكتروني',
      testSuccess: 'تم إرسال البريد الإلكتروني بنجاح',
      testError: 'فشل في إرسال البريد الإلكتروني',
      save: 'حفظ الإعدادات',
      smtpServer: 'خادم SMTP',
      smtpPort: 'منفذ SMTP',
      smtpUsername: 'اسم المستخدم',
      smtpPassword: 'كلمة المرور',
      emailSender: 'المرسل',
      emailReceiver: 'المستقبل',
      enableNotifications: 'تفعيل الإشعارات',
      weeklySchedule: 'تذكير أسبوعي',
      monthlySchedule: 'تذكير شهري',
      saveEmailSettings: 'حفظ إعدادات البريد الإلكتروني',
      testEmailButton: 'اختبار الإيميل',
      monitoringTitle: 'مراقبة انتهاء الصلاحية والتنبيهات التلقائية',
      monitoringDescription: 'مراقبة تلقائية لانتهاء صلاحية الإقامات والوثائق مع إرسال تنبيهات عبر البريد الإلكتروني',
      totalEmployees: 'إجمالي الموظفين',
      registeredEmployee: 'موظف مسجل',
      expiringResidencies: 'إقامات تنتهي قريباً',
      expiringDocuments: 'وثائق تنتهي قريباً',
      withinMonth: 'خلال شهر',
      noFileChosen: 'لم يتم اختيار ملف',
      checkExpiry: 'فحص انتهاء الصلاحية',
      checkingExpiry: 'جاري الفحص...',
      sendImmediateReport: 'إرسال تقرير فوري',
      sendingReport: 'جاري الإرسال...',
      enableAutoAlerts: 'تشغيل التنبيهات التلقائية',
      lastEmailSent: 'آخر إيميل تم إرساله:',
      expiryDetails: 'تفاصيل انتهاء الصلاحية',
      expiringResidenciesList: 'الإقامات التي تنتهي صلاحيتها',
      expiringDocumentsList: 'الوثائق التي تنتهي صلاحيتها',
      employeeName: 'اسم الموظف',
      documentName: 'اسم الوثيقة',
      employee: 'الموظف',
      residencyExpiryDate: 'تاريخ انتهاء الإقامة',
      expiryDate: 'تاريخ الانتهاء',
      timeRemaining: 'المدة المتبقية',
      status: 'الحالة',
      dayExpired: 'يوم (منتهية)',
      day: 'يوم',
      expired: 'منتهية',
      danger: 'خطر',
      warning: 'تحذير',
      actions: 'الإجراءات',
      moreItemsInReport: 'وعرض {count} إقامة أخرى في التقرير الكامل',
      moreDocumentsInReport: 'وعرض {count} وثيقة أخرى في التقرير الكامل',
      emailConfigNote: 'ملاحظة مهمة حول إعدادات البريد الإلكتروني',
      emailConfigNotes: {
        verifySmtp: '• تأكد من صحة إعدادات SMTP قبل تفعيل الإشعارات التلقائية',
        autoAlertsWhen: '• يتم إرسال التنبيهات التلقائية عند:',
        monthBeforeExpiry: '- بقاء شهر على انتهاء الصلاحية',
        weekBeforeExpiry: '- بقاء أسبوع على انتهاء الصلاحية',
        actualExpiry: '- انتهاء الصلاحية فعلياً',
        immediateReport: '• يمكن إرسال تقرير فوري في أي وقت باستخدام زر "إرسال تقرير فوري"'
      }
    },

    // Appearance Settings
    appearance: {
      title: 'إعدادات المظهر',
      description: 'تخصيص مظهر النظام والثيم المفضل',
      darkMode: 'الوضع المظلم',
      darkModeDescription: 'تفعيل أو إلغاء تفعيل الوضع المظلم'
    },

    // Backup Settings (first instance removed - using the one at line ~460)

    // Companies Management
    companies: {
      title: 'إدارة الشركات',
      description: 'إضافة وإدارة الشركات في النظام',
      addNew: 'إضافة شركة جديدة',
      name: 'اسم الشركة',
      nameArabic: 'الاسم بالعربية',
      nameEnglish: 'الاسم بالإنجليزية',
      description: 'الوصف',
      currentCompanies: 'الشركات الحالية',
      employeeCount: '{{count}} موظف',
      nameArabicPlaceholder: 'أدخل اسم الشركة بالعربية',
      nameEnglishPlaceholder: 'أدخل اسم الشركة بالإنجليزية',
      descriptionPlaceholder: 'أدخل وصف الشركة',
      currentCompaniesCount: 'الشركات الحالية ({{count}})'
    },

    // Positions Management
    positions: {
      title: 'إدارة المناصب',
      description: 'إضافة وإدارة مناصب الموظفين في النظام',
      addNew: 'إضافة منصب جديد',
      name: 'الاسم',
      nameArabic: 'الاسم بالعربية',
      nameEnglish: 'الاسم بالإنجليزية',
      value: 'القيمة',
      valuePlaceholder: 'قيمة المنصب',
      currentPositions: 'المناصب الحالية',
      editTitle: 'تعديل المنصب',
      editDescription: 'تعديل بيانات المنصب',
      nameArabicPlaceholder: 'أدخل اسم المنصب بالعربية',
      nameEnglishPlaceholder: 'أدخل اسم المنصب بالإنجليزية',
      currentPositionsCount: 'المناصب الحالية ({{count}})'
    },

    // Document Types Management
    documentTypes: {
      title: 'إدارة أنواع الوثائق',
      description: 'إضافة وإدارة أنواع الوثائق في النظام',
      addNew: 'إضافة نوع وثيقة جديد',
      name: 'الاسم',
      nameArabic: 'الاسم بالعربية',
      nameEnglish: 'الاسم بالإنجليزية',
      currentTypes: 'الأنواع الحالية',
      editTitle: 'تعديل نوع الوثيقة',
      editDescription: 'تعديل بيانات نوع الوثيقة',
      nameEnglishPlaceholder: 'نوع الوثيقة',
      nameArabicPlaceholder: 'نوع الوثيقة',
      currentTypesCount: 'أنواع الوثائق الحالية ({{count}})'
    },

    // Ministries Management
    ministries: {
      title: 'إدارة الوزارات',
      description: 'إضافة وإدارة الوزارات في النظام',
      addNew: 'إضافة وزارة جديدة',
      name: 'الاسم',
      nameArabic: 'الاسم بالعربية',
      nameEnglish: 'الاسم بالإنجليزية',
      currentMinistries: 'الوزارات الحالية',
      editTitle: 'تعديل الوزارة',
      editDescription: 'تعديل بيانات الوزارة',
      nameEnglishPlaceholder: 'اسم الوزارة',
      nameArabicPlaceholder: 'اسم الوزارة',
      currentMinistriesCount: 'الوزارات الحالية ({{count}})'
    },

    // Backup Settings
    backup: {
      title: 'النسخ الاحتياطي',
      description: 'إدارة النسخ الاحتياطي واستعادة البيانات',
      createBackup: 'إنشاء نسخة احتياطية',
      restoreBackup: 'استعادة نسخة احتياطية',
      downloadBackup: 'تحميل النسخة الاحتياطية',
      backupCreated: 'تم إنشاء النسخة الاحتياطية بنجاح',
      backupRestored: 'تم استعادة البيانات بنجاح',
      confirmRestore: 'هل أنت متأكد من استعادة البيانات؟ سيتم استبدال البيانات الحالية.',
      selectFile: 'اختر ملف النسخة الاحتياطية'
    },

    // Common Actions
    actions: {
      add: 'إضافة',
      edit: 'تعديل',
      delete: 'حذف',
      save: 'حفظ',
      cancel: 'إلغاء',
      saveChanges: 'حفظ التغييرات',
      confirmDelete: 'هل أنت متأكد من الحذف؟'
    },

    // Messages
    messages: {
      addSuccess: 'تم الإضافة بنجاح',
      updateSuccess: 'تم التحديث بنجاح',
      deleteSuccess: 'تم الحذف بنجاح',
      saveSuccess: 'تم حفظ الإعدادات بنجاح',
      addError: 'فشل في الإضافة',
      updateError: 'فشل في التحديث',
      deleteError: 'فشل في الحذف',
      saveError: 'فشل في حفظ الإعدادات',
      requiredFields: 'يرجى إدخال جميع البيانات المطلوبة'
    },

    // Settings Page Toast Messages
    settingsToasts: {
      themeChanged: 'تم التغيير',
      themeChangedDesc: 'تم {status} الوضع المظلم',
      enabled: 'تفعيل',
      disabled: 'إلغاء',
      error: 'خطأ',
      success: 'تم بنجاح',
      requiredFields: 'يرجى إدخال جميع البيانات المطلوبة',
      companyAdded: 'تم إضافة الشركة الجديدة',
      companyAddError: 'فشل في إضافة الشركة',
      companyUpdated: 'تم تحديث الشركة',
      companyUpdateError: 'فشل في تحديث الشركة',
      companyDeleted: 'تم حذف الشركة',
      companyDeleteError: 'فشل في حذف الشركة',
      companyDeleteConfirm: 'هل أنت متأكد من حذف شركة "{name}"؟',
      documentTypeAdded: 'تم إضافة نوع الوثيقة الجديد',
      documentTypeAddError: 'فشل في إضافة نوع الوثيقة',
      documentTypeUpdated: 'تم تحديث نوع الوثيقة',
      documentTypeUpdateError: 'فشل في تحديث نوع الوثيقة',
      documentTypeDeleted: 'تم حذف نوع الوثيقة',
      documentTypeDeleteError: 'فشل في حذف نوع الوثيقة',
      documentTypeDeleteConfirm: 'هل أنت متأكد من حذف نوع الوثيقة "{name}"؟',
      ministryAdded: 'تم إضافة الوزارة الجديدة',
      ministryAddError: 'فشل في إضافة الوزارة',
      ministryUpdated: 'تم تحديث الوزارة',
      ministryUpdateError: 'فشل في تحديث الوزارة',
      ministryDeleted: 'تم حذف الوزارة',
      ministryDeleteError: 'فشل في حذف الوزارة',
      ministryDeleteConfirm: 'هل أنت متأكد من حذف الوزارة "{name}"؟',
      positionAdded: 'تم إضافة المنصب الجديد',
      positionAddError: 'فشل في إضافة المنصب',
      positionUpdated: 'تم تحديث المنصب',
      positionUpdateError: 'فشل في تحديث المنصب',
      positionDeleted: 'تم حذف المنصب',
      positionDeleteError: 'فشل في حذف المنصب',
      positionDeleteConfirm: 'هل أنت متأكد من حذف المنصب "{name}"؟',
      backupExported: 'تم التصدير',
      backupExportedDesc: 'تم تصدير النسخة الاحتياطية بنجاح',
      backupExportError: 'فشل في تصدير النسخة الاحتياطية',
      emailSettingsSaved: 'تم حفظ إعدادات البريد الإلكتروني',
      checkCompleted: 'تم الفحص',
      checkCompletedDesc: 'تم العثور على {employees} إقامة و {documents} وثيقة تنتهي صلاحيتها قريباً',
      checkError: 'فشل في فحص انتهاء الصلاحية',
      emailSent: 'تم الإرسال',
      emailSendError: 'فشل الإرسال',
      emailError: 'خطأ في إرسال الإيميل: {error}'
    }
  },

  // Documents Page
  documents: {
    title: 'إدارة الوثائق',
    subtitle: 'إدارة جميع وثائق الشركة والموظفين',
    viewAndManage: 'عرض وإدارة جميع الوثائق ({{count}} وثيقة)',
    addDocument: 'إضافة وثيقة جديدة',
    uploadDocuments: 'رفع وثائق',
    uploadNew: 'رفع وثائق جديدة',
    chooseFiles: 'اختر الملفات التي تريد رفعها',
    search: 'البحث',
    searchPlaceholder: 'البحث في الوثائق...',
    filterBy: 'تصفية حسب {{filter}}',
    allTypes: 'جميع الأنواع',
    allStatuses: 'جميع الحالات',
    status: 'الحالة',
    documentType: 'نوع الوثيقة',

    // Status options
    statusOptions: {
      all: 'جميع الحالات',
      valid: 'صالح',
      expiringSoon: 'ينتهي قريباً',
      expired: 'منتهي الصلاحية'
    },

    tabs: {
      all: 'جميع الوثائق',
      employee: 'وثائق الموظفين',
      company: 'وثائق الشركات',
      companyDocuments: 'وثائق الشركات',
      employeeDocuments: 'وثائق الموظفين'
    },

    // Document card content
    card: {
      expiresOn: 'ينتهي:',
      viewDocument: 'عرض الوثيقة',
      editDocument: 'تعديل الوثيقة',
      downloadDocument: 'تحميل الوثيقة',
      deleteDocument: 'حذف الوثيقة'
    },

    // Company section
    company: {
      viewAllCompanyDocuments: 'عرض جميع وثائق الشركة',
      noDocumentsInSection: 'لا توجد وثائق في هذا القسم',
      clickToGoToCompanyPage: 'انقر للذهاب إلى صفحة وثائق الشركة',
      viewAllDocuments: 'عرض جميع الوثائق ({{count}})',
      employees: 'موظفو {{company}}'
    },

    // Employee section  
    employee: {
      noEmployeesInSection: 'لا يوجد موظفين في هذا القسم'
    },

    // Bulk operations
    bulk: {
      selected: 'تم تحديد {{count}} وثيقة',
      clearSelection: 'إلغاء التحديد',
      download: 'تحميل',
      delete: 'حذف',
      selectAll: 'تحديد الكل ({{count}})',
      deleteConfirm: 'هل أنت متأكد من حذف {{count}} وثيقة؟',
      deleteSuccess: 'تم حذف {{count}} وثيقة',
      deleteError: 'فشل في حذف الوثائق'
    },

    // Empty states
    empty: {
      noCompanies: 'لا توجد شركات مضافة في النظام',
      noCompaniesSubtext: 'قم بإضافة شركات من صفحة الإعدادات',
      noEmployees: 'لا توجد شركات مضافة في النظام',
      noEmployeesSubtext: 'قم بإضافة شركات من صفحة الإعدادات'
    },

    table: {
      title: 'العنوان',
      type: 'النوع',
      entity: 'الجهة',
      issueDate: 'تاريخ الإصدار',
      expiryDate: 'تاريخ الانتهاء',
      status: 'الحالة',
      file: 'الملف',
      actions: 'الإجراءات'
    },

    status: {
      valid: 'سارية',
      expiring: 'تنتهي قريباً',
      expired: 'منتهية',
      daysLeft: 'باقي {{days}} يوم'
    },

    actions: {
      view: 'عرض',
      edit: 'تعديل',
      delete: 'حذف',
      download: 'تنزيل',
      preview: 'معاينة'
    },

    // Document form
    form: {
      title: 'عنوان الوثيقة',
      beneficiaryType: 'نوع المستفيد',
      company: 'الشركة',
      employee: 'الموظف',
      documentType: 'نوع الوثيقة',
      ministry: 'الوزارة/الجهة',
      entityName: 'اسم الجهة',
      issueDate: 'تاريخ الإصدار',
      expiryDate: 'تاريخ الانتهاء',
      notes: 'ملاحظات',
      file: 'الملف',

      // Form labels and placeholders
      titlePlaceholder: 'أدخل عنوان الوثيقة',
      selectCompany: 'اختر الشركة',
      selectEmployee: 'اختر الموظف',
      selectDocumentType: 'اختر نوع الوثيقة',
      selectMinistry: 'اختر الوزارة',
      entityNamePlaceholder: 'أدخل اسم الجهة',
      notesPlaceholder: 'ملاحظات إضافية (اختياري)',
      selectDate: 'اختر التاريخ',

      // Form options
      beneficiaryTypes: {
        company: 'الشركة',
        employee: 'الموظف'
      },

      // Additional form labels
      entityNameLabel: 'اسم الجهة *',
      entityNamePlaceholder: 'أدخل اسم الجهة',
      employeeDataLabel: 'بيانات الموظف',
      filterByCompanyLabel: 'تصفية حسب الشركة (اختياري)',
      allCompaniesOption: 'جميع الشركات',
      employeeLabel: 'الموظف *',
      selectEmployeeLabel: 'اختر الموظف',
      documentTypeLabel: 'نوع الوثيقة *',
      selectDocumentTypeLabel: 'اختر نوع الوثيقة',
      otherMinistryOption: 'أخرى',

      // Validation messages
      validation: {
        titleMinLength: 'عنوان الوثيقة يجب أن يكون 3 أحرف على الأقل',
        titleMaxLength: 'عنوان الوثيقة يجب ألا يزيد عن 120 حرف',
        beneficiaryTypeRequired: 'نوع المستفيد مطلوب',
        expiryDateRequired: 'تاريخ الانتهاء مطلوب',
        allFieldsRequired: 'جميع الحقول المطلوبة يجب أن تكون مملوءة',
        invalidDateRange: 'تاريخ الانتهاء يجب أن يكون بعد أو مساوي لتاريخ الإصدار',
        entityNameRequired: 'اسم الجهة مطلوب عند اختيار "أخرى"'
      },

      // Buttons
      buttons: {
        save: 'حفظ الوثيقة',
        update: 'تحديث الوثيقة',
        cancel: 'إلغاء',
        close: 'إغلاق'
      }
    },

    // Upload dialog
    upload: {
      title: 'رفع وثيقة جديدة',
      titleFor: 'رفع وثيقة جديدة لـ {{name}}',
      chooseFile: 'اختر الملف الذي تريد رفعه',
      dragAndDrop: 'اسحب وأفلت الملفات هنا',
      dragAndDropActive: 'أسقط الملفات هنا...',
      clickToSelect: 'أو انقر للاختيار من جهازك',
      maxFiles: 'الحد الأقصى: {{count}} ملفات، {{size}} لكل ملف',
      supportedTypes: 'الأنواع المدعومة: {{types}}',
      uploadedFiles: 'الملفات المرفوعة ({{count}})',
      clearAll: 'مسح الكل',
      uploading: 'جاري الرفع...',
      uploadComplete: 'تم الرفع',
      uploadFailed: 'فشل في الرفع',
      removeFile: 'إزالة الملف'
    },

    messages: {
      addSuccess: 'تم إضافة الوثيقة بنجاح',
      editSuccess: 'تم تحديث الوثيقة بنجاح',
      deleteSuccess: 'تم حذف الوثيقة بنجاح',
      deleteConfirm: 'هل أنت متأكد من حذف هذه الوثيقة؟',
      uploadSuccess: 'تم رفع الملف بنجاح',
      downloadError: 'فشل في تحميل الوثيقة',
      error: 'خطأ',
      success: 'تم بنجاح',
      loadError: 'فشل في تحميل الوثائق',
      noDocuments: 'لا توجد وثائق',
      fileSizeError: 'حجم الملف يجب أن يكون أقل من 20 ميجابايت',
      fileTypeError: 'نوع الملف غير مدعوم. يُسمح فقط بملفات PDF و JPG و PNG',
      noFileError: 'لا يوجد ملف للحفظ',
      ministryCreateError: 'فشل في إنشاء الوزارة الجديدة',
      updateError: 'فشل في تحديث بيانات الوثيقة',
      saveError: 'فشل في حفظ بيانات الوثيقة',
      consoleError: 'خطأ في حفظ الوثيقة'
    },

    // Employee Document Form
    employeeDocumentForm: {
      title: 'إضافة وثيقة جديدة',
      description: 'أدخل بيانات الوثيقة الجديدة للموظف',
      requiredFieldsError: 'يرجى ملء جميع الحقول المطلوبة',
      saveError: 'فشل في حفظ بيانات الوثيقة',
      saveSuccess: 'تم حفظ الوثيقة بنجاح',
      attachedFile: 'الملف المرفق:',
      saving: 'جاري الحفظ...',
      save: 'حفظ الوثيقة',
      cancel: 'إلغاء'
    }
  },

  // Employee Documents Page
  employeeDocuments: {
    title: 'وثائق {{name}}',
    totalDocuments: 'إجمالي {{count}} وثيقة',
    uploadNew: 'رفع وثيقة جديدة',
    uploadTitle: 'رفع وثيقة جديدة لـ {{name}}',
    uploadDesc: 'اختر الملف الذي تريد رفعه',
    search: 'البحث',
    searchPlaceholder: 'البحث في الوثائق...',
    status: 'الحالة',
    allStatuses: 'جميع الحالات',
    valid: 'صالح',
    expiringSoon: 'ينتهي قريباً',
    expired: 'منتهي الصلاحية',
    documentType: 'نوع الوثيقة',
    allTypes: 'جميع الأنواع',
    noDocuments: 'لا توجد وثائق',
    noDocumentsDesc: 'لا توجد وثائق تطابق معايير البحث',
    noDocumentsEmpty: 'لم يتم رفع أي وثائق لهذا الموظف بعد',
    uploadFirst: 'رفع أول وثيقة',
    back: 'العودة',
    active: 'نشط',
    inactive: 'غير نشط',
    unauthorized: 'غير مصرح',
    inactiveEmployee: 'هذا الموظف غير نشط ولا يمكن عرض وثائقه',
    employeeNotFound: 'الموظف غير موجود',
    backToList: 'العودة إلى قائمة الموظفين',
    view: 'عرض الوثيقة',
    edit: 'تعديل الوثيقة',
    download: 'تحميل الوثيقة',
    delete: 'حذف الوثيقة',
    deleteConfirm: 'هل أنت متأكد من حذف هذه الوثيقة؟',
    photoUploadSuccess: 'تم رفع صورة الموظف بنجاح',
    photoDeleteSuccess: 'تم حذف صورة الموظف بنجاح',
    photoDeleteConfirm: 'هل أنت متأكد من حذف صورة الموظف؟'
  },

  // Additional Settings - Merged into main settings section above

  // Login Page
  login: {
    title: 'مرحباً',
    subtitle: 'سجل الدخول إلى حسابك',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    rememberMe: 'تذكرني',
    forgotPassword: 'نسيت كلمة المرور؟',
    loginButton: 'تسجيل الدخول',
    noAccount: 'ليس لديك حساب؟',
    signUp: 'التسجيل',
    error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    success: 'تم تسجيل الدخول بنجاح'
  },

  // Index/Landing Page
  index: {
    title: 'Romani CureMed',
    subtitle: 'نظام إدارة الوثائق الطبية',
    description: 'نظام متقدم لإدارة الوثائق الطبية لشركتي Green Future و CureMed',
    getStarted: 'ابدأ الآن',
    learnMore: 'اعرف المزيد',
    features: {
      title: 'المميزات',
      document: 'إدارة الوثائق',
      employee: 'إدارة الموظفين',
      alerts: 'تنبيهات ذكية',
      reports: 'التقارير والتحليلات'
    }
  },

  // Not Found Page
  notFound: {
    title: '404 - الصفحة غير موجودة',
    message: 'الصفحة التي تبحث عنها غير موجودة',
    goHome: 'الذهاب إلى لوحة التحكم',
    goBack: 'العودة'
  },

  // Common/Shared
  common: {
    loading: 'جاري التحميل...',
    error: 'خطأ',
    success: 'تم بنجاح',
    cancel: 'إلغاء',
    save: 'حفظ',
    delete: 'حذف',
    edit: 'تعديل',
    view: 'عرض',
    close: 'إغلاق',
    back: 'العودة',
    next: 'التالي',
    previous: 'السابق',
    search: 'البحث',
    filter: 'تصفية',
    all: 'الكل',
    active: 'نشط',
    inactive: 'غير نشط',
    yes: 'نعم',
    no: 'لا',
    add: 'إضافة',
    update: 'تحديث',
    confirm: 'تأكيد',
    required: 'مطلوب',
    optional: 'اختياري',
    select: 'اختر',
    upload: 'رفع',
    download: 'تنزيل',
    export: 'تصدير',
    import: 'استيراد',
    print: 'طباعة',
    refresh: 'تحديث',
    actions: 'الإجراءات',
    status: 'الحالة',
    date: 'التاريخ',
    name: 'الاسم',
    description: 'الوصف',
    type: 'النوع',
    noData: 'لا توجد بيانات',
    noResults: 'لا توجد نتائج',
    showMore: 'عرض المزيد',
    showLess: 'عرض أقل',
    total: 'الإجمالي',
    of: 'من',
    to: 'إلى',
    from: 'من',
    today: 'اليوم',
    yesterday: 'أمس',
    thisWeek: 'هذا الأسبوع',
    thisMonth: 'هذا الشهر',
    thisYear: 'هذا العام',
    notSpecified: 'غير محدد',
    unknown: 'غير معروف'
  }
};