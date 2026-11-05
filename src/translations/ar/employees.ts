// Employees Page
export const employees = {
  whatsapp: { optIn: 'إرسال تذكيرات واتساب لهذا الموظف', help: 'تصله وثائقه وإقامته فقط على الموبايل الحالي مع كود الدولة، عند تفعيل إرسال واتساب العام.' },
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
    whatsappPhoneInvalid: 'أدخل رقم الجوال بالصيغة الدولية: يبدأ بـ + أو 00 ثم كود الدولة، ويتكوّن من 8 إلى 15 رقماً (مثال: ‎+96555123456) لتفعيل تذكيرات واتساب.',
    whatsappPhoneDuplicate: 'رقم الجوال هذا مستخدم لموظف آخر مفعّل له تذكيرات واتساب.',
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
};
