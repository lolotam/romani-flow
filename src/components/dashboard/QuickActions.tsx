import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

interface QuickAction {
  titleKey: string;
  icon: LucideIcon;
  href: string;
  action: () => void;
}

interface QuickActionsProps {
  actions: QuickAction[];
  t: (key: string) => string;
}

export function QuickActions({ actions, t }: QuickActionsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="mb-8"
    >
      <h3 className="text-xl font-semibold text-foreground mb-4">
        {t('dashboard.quickActions.title')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {actions.map((action, index) => (
          <Card
            key={index}
            className="cursor-pointer shadow-soft hover:shadow-elegant transition-all duration-300 transform hover:scale-105 hover:bg-accent/50"
            onClick={action.action}
          >
            <CardContent className="flex items-center space-x-4 p-6">
              <div className="p-2 bg-primary/10 rounded-lg">
                <action.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">{t(action.titleKey)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}
