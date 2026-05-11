export interface AuthUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export interface SessionRecord {
  userId: string;
  expiresAt: number;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: AuthUser;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface AuthFailure {
  success: false;
  code: string;
  error: string;
}

export interface AuthSuccess {
  success: true;
  user: AuthUser;
}

export type AuthResult = AuthSuccess | AuthFailure;

export interface UserStoreOptions {
  filePath?: string;
  now?: () => number;
}
