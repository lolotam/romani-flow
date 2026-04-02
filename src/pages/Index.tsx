import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full opacity-15 blur-3xl bg-primary"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full opacity-15 blur-3xl bg-[hsl(var(--medical))]"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl bg-[hsl(var(--corporate))]"></div>
      </div>

      <div className="text-center space-y-8 p-8 relative z-10 max-w-4xl">
        <div className="space-y-4">
          <h1 className="text-6xl md:text-7xl font-display font-bold text-gradient animate-fade-up">
            Romani CureMed
          </h1>
          <h2 className="text-2xl md:text-3xl font-semibold text-foreground animate-fade-up">
            نظام إدارة الوثائق الطبية المتقدم
          </h2>
          <p className="text-lg text-muted-foreground mb-8 animate-fade-up max-w-2xl mx-auto">
            منصة شاملة لإدارة وثائق شركتي Green Future و CureMed بكفاءة عالية وأمان متقدم
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-up">
          <Button 
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-elegant hover:shadow-glow transition-all duration-300 transform hover:scale-105 px-8 py-4 text-lg"
            onClick={() => window.location.href = '/login'}
          >
            تسجيل الدخول للنظام
          </Button>
          <Button 
            variant="outline"
            size="lg"
            className="border-primary/30 hover:bg-accent transition-all duration-300 px-8 py-4 text-lg"
          >
            معرفة المزيد
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 animate-fade-up">
          <div className="text-center p-6 rounded-xl glass">
            <div className="w-12 h-12 bg-primary rounded-lg mx-auto mb-4 flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">📄</span>
            </div>
            <h3 className="font-semibold text-foreground mb-2">إدارة الوثائق</h3>
            <p className="text-muted-foreground text-sm">
              نظام متقدم لإدارة وتنظيم جميع الوثائق والملفات الطبية
            </p>
          </div>

          <div className="text-center p-6 rounded-xl glass">
            <div className="w-12 h-12 bg-[hsl(var(--success))] rounded-lg mx-auto mb-4 flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">👥</span>
            </div>
            <h3 className="font-semibold text-foreground mb-2">إدارة الموظفين</h3>
            <p className="text-muted-foreground text-sm">
              متابعة شاملة لبيانات الموظفين ووثائقهم الشخصية
            </p>
          </div>

          <div className="text-center p-6 rounded-xl glass">
            <div className="w-12 h-12 bg-[hsl(var(--corporate))] rounded-lg mx-auto mb-4 flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">📊</span>
            </div>
            <h3 className="font-semibold text-foreground mb-2">التقارير والإحصائيات</h3>
            <p className="text-muted-foreground text-sm">
              تقارير مفصلة وإحصائيات دقيقة لمتابعة الأداء
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
