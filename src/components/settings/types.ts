export interface EmailSettingsData {
  smtp_server: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  email_sender: string;
  email_receiver: string;
  enable_notifications: boolean;
  weekly_schedule: boolean;
  monthly_schedule: boolean;
}

export interface Company {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
}

export interface DocumentType {
  id: string;
  name: string;
  name_ar: string;
}

export interface Ministry {
  id: string;
  name: string;
  name_ar: string;
}

export interface Position {
  id: string;
  name: string;
  name_ar: string;
  value: string;
}
