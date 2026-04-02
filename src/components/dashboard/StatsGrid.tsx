import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardStats } from '@/types';
import type { LucideIcon } from 'lucide-react';

interface StatCard {
  title: string;
  value: number;
  icon: LucideIcon;
  gradient: string;
  description: string;
}

interface StatsGridProps {
  statCards: StatCard[];
  language: string;
}

export function StatsGrid({ statCards, language }: StatsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <Card className="relative overflow-hidden shadow-elegant hover:shadow-glow transition-all duration-300 transform hover:scale-105">
            <div className={`absolute top-0 right-0 w-32 h-32 ${stat.gradient} opacity-10 rounded-full -translate-y-16 translate-x-16`}></div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {stat.value.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
