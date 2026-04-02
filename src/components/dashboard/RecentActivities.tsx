import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, FileText, User } from 'lucide-react';
import type { RecentActivity } from '@/types';

interface RecentActivitiesProps {
  activities: RecentActivity[];
  language: string;
  t: (key: string) => string;
}

export function RecentActivities({ activities, language, t }: RecentActivitiesProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
    >
      <Card className="shadow-elegant">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calendar className="h-5 w-5" />
            <span>{t('dashboard.recentActivities.title')}</span>
          </CardTitle>
          <CardDescription>
            {t('dashboard.recentActivities.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length > 0 ? (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start space-x-3 p-3 bg-muted/30 rounded-lg">
                  <div className="p-2 bg-primary/10 rounded-full">
                    {activity.type === 'employee_added' ? (
                      <User className="h-4 w-4 text-primary" />
                    ) : (
                      <FileText className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activity.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(activity.date).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-CA')} - {activity.user}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('dashboard.recentActivities.noActivities')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
