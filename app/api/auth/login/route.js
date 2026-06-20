import { NextResponse } from 'next/server';
import { verifyLogin } from '../../../../lib/auth';
import { createSession } from '../../../../lib/session';

export async function POST(request) {
  const { email, password } = await request.json();
  const user = await verifyLogin(email, password);
  if (!user) {
    return NextResponse.json({ error: 'Email ou mot de passe incorrect' }, { status: 401 });
  }
  await createSession(user);
  return NextResponse.json({ success: true, user });
}
