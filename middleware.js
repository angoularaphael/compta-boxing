import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE } from './lib/session';

const BOT_UA =
  /bot|crawl|spider|slurp|curl|wget|python-requests|scrapy|headless|ahrefs|semrush|dotbot|petalbot|bytespider|gptbot|chatgpt-user|claude-web|anthropic-ai|perplexitybot|mj12bot|blexbot|serpstat|dataforseo/i;

function isBlockedBot(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua.trim()) return true;
  return BOT_UA.test(ua);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/admin')) return NextResponse.next();

  if (isBlockedBot(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const secret = new TextEncoder().encode(
      process.env.SESSION_SECRET || process.env.SITE_API_SECRET || 'change-me'
    );
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = { matcher: ['/admin/:path*'] };
