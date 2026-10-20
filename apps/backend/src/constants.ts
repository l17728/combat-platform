import { AUTH_CONSTRAINTS } from "@combat/shared";

export const { PASSWORD_MIN_LENGTH, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH } = AUTH_CONSTRAINTS;

export const BCRYPT_ROUNDS = 10;
export const JWT_EXPIRY_NORMAL = "7d";
export const JWT_EXPIRY_GUEST = "1d";
export const JWT_EXPIRY_ADMIN_DEFAULT = "365d";
export const DEFAULT_ADMIN_PASSWORD = "admin123";
export const INVITE_DEFAULT_EXPIRY_DAYS = 7;
