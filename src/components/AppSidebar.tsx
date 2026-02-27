import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  Building2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Home
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { logout } = useAuth();
  const { t, language } = useLanguage();

  const mainItems = [
    { title: t('nav.dashboard'), url: "/dashboard", icon: LayoutDashboard },
    { title: t('nav.employees'), url: "/employees", icon: Users },
    { title: t('nav.documents'), url: "/documents", icon: FileText },
    { title: t('nav.settings'), url: "/settings", icon: Settings },
  ];

  const currentPath = location.pathname;

  const isActive = (path: string) => currentPath === path;

  const getNavCls = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
      : "hover:bg-accent/50 text-muted-foreground hover:text-foreground";

  return (
    <Sidebar
      side={language === 'ar' ? 'right' : 'left'}
      className={`${collapsed ? "w-16" : "w-64"} transition-all duration-300 border-r border-border/50 bg-card/50 backdrop-blur-sm`}
    >
      <SidebarContent className="p-0">
        {/* Header */}
        <div className={`p-4 border-b border-border/50 ${collapsed ? "px-2" : "px-4"}`}>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
              <div className="p-2 bg-primary/10 rounded-lg">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              {!collapsed && (
                <div>
                  <h2 className="text-lg font-bold text-gradient">{t('header.title')}</h2>
                  <p className="text-xs text-muted-foreground">{t('header.subtitle')}</p>
                </div>
              )}
            </div>
            <SidebarTrigger className="h-8 w-8 rounded-md hover:bg-accent">
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </SidebarTrigger>
          </div>
        </div>

        {/* Navigation Menu */}
        <SidebarGroup className="px-0">
          <SidebarGroupLabel className={`px-4 text-xs uppercase tracking-wide text-muted-foreground ${collapsed ? "sr-only" : ""}`}>
            {t('nav.dashboard')}
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2">
            <SidebarMenu className="space-y-1">
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="h-auto">
                    <NavLink
                      to={item.url}
                      end
                      className={`${getNavCls({ isActive: isActive(item.url) })} flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 ${collapsed ? "justify-center" : ""}`}
                    >
                      <item.icon className="h-5 w-5" />
                      {!collapsed && <span className="font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Footer */}
        <div className="mt-auto p-2 border-t border-border/50 space-y-1">
          <ThemeToggle collapsed={collapsed} />
          <Button
            variant="ghost"
            onClick={logout}
            className={`w-full flex items-center gap-2 ${collapsed ? "px-2 justify-center" : "px-3 justify-start"} py-3 text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors`}
          >
            <LogOut className="h-5 w-5" />
            {!collapsed && <span>{t('nav.logout')}</span>}
          </Button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}