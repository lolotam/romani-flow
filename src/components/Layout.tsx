import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Menu } from "lucide-react";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/contexts/LanguageContext";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { t, language } = useLanguage();

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border bg-card px-4">
            <h1 className="text-lg font-semibold text-foreground text-center flex-1 lg:text-start lg:flex-none">{t('header.title')}</h1>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle />
              <SidebarTrigger className="ml-2">
                <Menu className="h-5 w-5" />
              </SidebarTrigger>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
