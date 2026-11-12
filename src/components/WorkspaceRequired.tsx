import { OrganizationList, UserButton } from '@clerk/react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function WorkspaceRequired() {
  const { language } = useLanguage();
  const arabic = language === 'ar';

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto flex max-w-3xl justify-end">
        <UserButton />
      </div>
      <section className="mx-auto mt-8 max-w-3xl space-y-6" aria-labelledby="workspace-title">
        <div className="text-center">
          <h1 id="workspace-title" className="text-2xl font-bold text-foreground">
            {arabic ? 'اختر مساحة العمل' : 'Choose a workspace'}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {arabic
              ? 'اختر مساحة عمل موجودة أو أنشئ واحدة جديدة للمتابعة.'
              : 'Select an existing workspace or create a new one to continue.'}
          </p>
        </div>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
        />
      </section>
    </main>
  );
}
