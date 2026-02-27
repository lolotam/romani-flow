import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated on app load
    const checkAuth = () => {
      const token = localStorage.getItem('romani_admin_token');
      if (token) {
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // For demo purposes, we'll use hardcoded credentials
      // In production, this should hash the password and store it properly
      if (username === 'admin' && password === '@Xx123456789xX@') {
        // Set authentication token
        localStorage.setItem('romani_admin_token', 'authenticated');
        setIsAuthenticated(true);
        return { success: true };
      } else {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
      }
    } catch (error) {
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' };
    }
  };

  const logout = () => {
    localStorage.removeItem('romani_admin_token');
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};