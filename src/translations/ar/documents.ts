// Documents Page
export const documents = {
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
    deleteDocument: 'حذف الوثيقة',
    noPreview: 'لا توجد معاينة'
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


  actions: {
    view: 'عرض',
    edit: 'تعديل',
    delete: 'حذف',
    download: 'تنزيل',
    preview: 'معاينة'
  },

  // Document form
  form: {
    previewNoFile: 'لم يتم اختيار ملف',
    closeUnsavedConfirm: 'لم تُحفظ آخر التعديلات. هل تريد إغلاق الفورم بدونها؟ ستظل آخر مسودة محفوظة كما هي.',
    previewHint: 'اختر ملف PDF أو صورة لمعاينته أثناء تعبئة الحقول.',
    previewOpen: 'افتح الملف في تبويب جديد إذا لم تتوفر المعاينة',
    fileCleanupPending: 'تم إلغاء المرفق السابق، لكن حذف ملفه ما زال معلّقًا لإعادة المحاولة.',
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
      entityNameTooLong: 'اسم الجهة يجب ألا يتجاوز 100 حرف',
      notesTooLong: 'الملاحظات تتجاوز 5000 حرف. اختصرها قبل حفظ المسودة أو الوثيقة.',
      reviewFields: 'راجع الأخطاء الموضحة في حقول النموذج قبل الحفظ.',
      noDocumentTypes: 'أضف نوع وثيقة من الإعدادات أولًا، ثم ارجع لإكمال الحفظ.',
      noEmployees: 'لا يوجد موظفون. أضف موظفًا أولًا أو اختر شركة كمستفيد.',
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
};
