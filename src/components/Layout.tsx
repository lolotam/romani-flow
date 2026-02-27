import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Menu } from "lucide-react";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { t, language } = useLanguage();

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-gradient-subtle" dir={t('dir') || (language === 'ar' ? 'rtl' : 'ltr')} >
        <div className="flex-1 flex flex-col">
          {/* Header with trigger for all screen sizes */}
          <header className="h-14 flex items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-sm px-4">
            <h1 className="text-lg font-semibold text-foreground text-center flex-1 lg:text-right lg:flex-none">{t('header.title')}</h1>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <SidebarTrigger className="ml-2">
                <Menu className="h-5 w-5" />
              </SidebarTrigger>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>

        <AppSidebar />
      </div>
    </SidebarProvider>
  );
}