export interface UserModel {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'member';
  permissions: string[];
  preferences: {
    theme: 'dark';
    locale: string;
  };
  avatar: string;
  activityLog: string[];
}
