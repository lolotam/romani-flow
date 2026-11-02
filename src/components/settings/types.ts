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
