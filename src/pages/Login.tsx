import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Shield, Stethoscope } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useLanguage } from '@/contexts/LanguageContext';
import { request } from '@/lib/api/http';

interface LoginProps {
  initialMode?: 'login' | 'register';
}

export default function Login({ initialMode = 'login' }: LoginProps) {
  const [isRegister, setIsRegister] = useState(initialMode === 'register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const arabic = language === 'ar';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isRegister) {
        const { data, error } = await request<{ success: boolean; message?: string }>('/api/auth/register', {
          method: 'POST',
          body: {
            email: email.trim(),
            password,
            name: name.trim() || undefined,
            workspaceName: workspaceName.trim() || undefined,
          },
        });

        if (error) {
          toast({
            title: arabic ? "خطأ في إنشاء الحساب" : "Registration Error",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: arabic ? "تم إنشاء الحساب بنجاح" : "Account Created",
          description: arabic ? "جاري تسجيل الدخول..." : "Logging in...",
        });

        // Automatically log in after registration
        const loginRes = await login(email.trim(), password);
        if (loginRes.success) {
          navigate('/dashboard');
        } else {
          setIsRegister(false);
        }
      } else {
        const result = await login(email.trim(), password);
        if (result.success) {
          toast({
            title: t('login.success'),
            description: "مرحباً بك في نظام Romani CureMed",
          });
          navigate('/dashboard');
        } else {
          toast({
            title: "خطأ في تسجيل الدخول",
            description: result.error || t('login.error'),
            variant: "destructive",
          });
        }
      }
    } catch {
      toast({
        title: "خطأ",
        description: "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary rounded-full opacity-10 blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[hsl(var(--medical))] rounded-full opacity-15 blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[hsl(var(--corporate))] rounded-full opacity-10 blur-3xl"></div>
      </div>

      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 rtl:left-4 rtl:right-auto">
        <ThemeToggle />
        <LanguageToggle />
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        <Card className="shadow-elegant bg-card border-border">
          <CardHeader className="text-center space-y-4">
            <motion.div
              initial={false}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-glow"
            >
              <div className="flex items-center space-x-1">
                <Shield className="w-6 h-6 text-primary-foreground" />
                <Stethoscope className="w-6 h-6 text-primary-foreground" />
              </div>
            </motion.div>

            <div>
              <CardTitle className="text-2xl font-display text-gradient">
                Romani CureMed
              </CardTitle>
              <CardDescription className="text-muted-foreground mt-2">
                {isRegister
                  ? (arabic ? 'إنشاء حساب جديد ومساحة عمل مستقلة' : 'Create new account & private workspace')
                  : (arabic ? 'نظام إدارة الوثائق الطبية المتقدم' : 'Advanced Medical Document Management')}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-start block">
                      {arabic ? 'الاسم' : 'Full Name'}
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="text-start neomorphism-inset"
                      placeholder={arabic ? 'د. وليد' : 'Dr. Waleed'}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="workspaceName" className="text-start block">
                      {arabic ? 'اسم مساحة العمل / الشركة' : 'Company / Workspace Name'}
                    </Label>
                    <Input
                      id="workspaceName"
                      type="text"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      className="text-start neomorphism-inset"
                      placeholder={arabic ? 'مساحة عمل كيور ميد' : 'CureMed Workspace'}
                      required
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-start block">
                  {t('login.email')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-start neomorphism-inset"
                  placeholder="admin@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-start block">
                  {t('login.password')}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="text-start neomorphism-inset pl-10"
                    placeholder="••••••••"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute left-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-primary hover:opacity-90 text-primary-foreground shadow-elegant hover:shadow-glow transition-all duration-300 mt-2"
                disabled={isLoading}
              >
                {isLoading
                  ? (arabic ? 'جارٍ المعالجة...' : 'Processing...')
                  : isRegister
                  ? (arabic ? 'إنشاء الحساب ومساحة العمل' : 'Create Account & Workspace')
                  : t('login.loginButton')}
              </Button>

              <div className="text-center pt-2">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setIsRegister(!isRegister)}
                  className="text-sm text-primary"
                >
                  {isRegister
                    ? (arabic ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'Already have an account? Sign In')
                    : (arabic ? 'ليس لديك حساب؟ إنشاء حساب ومساحة عمل جديدة' : "Don't have an account? Sign Up")}
                </Button>
              </div>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>للدعم الفني: support@romani-curemed.com</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
