import { UserModel } from '@/core/user/model';

export const hasPermission = (user: UserModel, permission: string) => user.permissions.includes(permission);
