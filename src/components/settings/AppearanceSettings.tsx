import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { Moon, Sun } from 'lucide-react';

interface AppearanceSettingsProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export default function AppearanceSettings({ darkMode, onToggleDarkMode }: AppearanceSettingsProps) {
  const { t } = useLanguage();

  return (
    <Card className="shadow-elegant">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          {darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          <span>{t('settings.appearance.title')}</span>
        </CardTitle>
        <CardDescription>{t('settings.appearance.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="dark-mode">{t('settings.appearance.darkMode')}</Label>
            <p className="text-sm text-muted-foreground">{t('settings.appearance.darkModeDescription')}</p>
          </div>
          <Switch id="dark-mode" checked={darkMode} onCheckedChange={onToggleDarkMode} />
        </div>
      </CardContent>
    </Card>
  );
}
