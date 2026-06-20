import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-auth';
import { apiError } from '../../../../lib/apiJson';
import { getSupabase } from '../../../../lib/supabase';
import { fetchBotAction, fetchBotStatus, botUrlFromLocation } from '../../../../lib/bots';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    await requireSession();
    const slug = params.slug;
    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', slug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const botUrl = botUrlFromLocation(location);
    const status = await fetchBotStatus(botUrl);

    return NextResponse.json({
      slug,
      label: location.name,
      botUrl: botUrl || null,
      ...status,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request, { params }) {
  try {
    await requireSession();
    const slug = params.slug;
    const action = new URL(request.url).searchParams.get('action');
    if (!['start', 'stop', 'logout'].includes(action)) {
      return NextResponse.json({ error: `Action inconnue: ${action}` }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', slug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const botUrl = botUrlFromLocation(location);
    const result = await fetchBotAction(botUrl, action);
    return NextResponse.json({ slug, ...result });
  } catch (err) {
    return apiError(err);
  }
}
