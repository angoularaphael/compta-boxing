import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'compta_session';

function secret() {
  const s = process.env.SESSION_SECRET || process.env.SITE_API_SECRET || 'change-me';
  return new TextEncoder().encode(s);
}

export async function createSession(user) {
  const token = await new SignJWT({ email: user.email, role: user.role, name: user.name || '' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSession() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { email: payload.email, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

export function clearSession() {
  cookies().delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
