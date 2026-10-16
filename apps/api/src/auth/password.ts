import { hash, compare } from 'bcryptjs';

const BCRYPT_COST = 12;

/** bcrypt password hashing. Pure functions — no NestJS dependency. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('password must be at least 8 characters');
  return hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}
