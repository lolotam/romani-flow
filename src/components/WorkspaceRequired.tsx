import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Plus, LogOut } from 'lucide-react';
import { request } from '@/lib/api/http';

interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

export default function WorkspaceRequired() {
  const { language } = useLanguage();
  const { logout, user } = useAuth();
  const arabic = language === 'ar';

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void request<{ workspaces: WorkspaceOption[] }>('/api/auth/workspaces').then(({ data }) => {
      if (!active) return;
      if (data?.workspaces) {
        setWorkspaces(data.workspaces);
      }
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSelectWorkspace = async (workspaceId: string) => {
    const { error } = await request('/api/auth/select-workspace', {
      method: 'POST',
      body: { workspaceId },
    });
    if (!error) {
      window.location.href = '/dashboard';
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setIsCreating(true);
    const { error } = await request('/api/auth/create-workspace', {
      method: 'POST',
      body: { name: newWorkspaceName.trim() },
    });
    setIsCreating(false);
    if (!error) {
      window.location.href = '/dashboard';
    }
  };

  return (
    <main className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout} className="text-red-500 hover:text-red-600">
            <LogOut className="h-4 w-4 me-1" />
            {arabic ? 'تسجيل الخروج' : 'Logout'}
          </Button>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>{arabic ? 'اختر مساحة العمل' : 'Choose Workspace'}</CardTitle>
            <CardDescription>
              {arabic
                ? 'اختر مساحة عمل مسجلة للمتابعة أو أنشئ مساحة عمل جديدة لشركتك.'
                : 'Select an existing workspace or create a new one for your company.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="py-6 text-center text-muted-foreground">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
              </div>
            ) : workspaces.length > 0 ? (
              <div className="space-y-2">
                {workspaces.map((ws) => (
                  <Button
                    key={ws.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-3 px-4"
                    onClick={() => handleSelectWorkspace(ws.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary" />
                      <span className="font-medium">{ws.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{ws.role}</span>
                  </Button>
                ))}
              </div>
            ) : null}

            <form onSubmit={handleCreateWorkspace} className="pt-2 border-t space-y-3">
              <label className="text-xs font-semibold text-muted-foreground uppercase">
                {arabic ? 'إنشاء مساحة عمل جديدة' : 'Create new workspace'}
              </label>
              <div className="flex gap-2">
                <Input
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={arabic ? 'اسم الشركة أو مساحة العمل' : 'Company or workspace name'}
                  disabled={isCreating}
                />
                <Button type="submit" disabled={isCreating || !newWorkspaceName.trim()}>
                  <Plus className="h-4 w-4 me-1" />
                  {arabic ? 'إنشاء' : 'Create'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
