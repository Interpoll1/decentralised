export interface Database {
  public: {
    Tables: {
      receipts: {
        Row: {
          id: string;
          data: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          data: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          data?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}