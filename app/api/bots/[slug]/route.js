import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-auth';
import { apiError } from '../../../../lib/apiJson';
import { getSupabase } from '../../../../lib/supabase';
import { fetchBotStatus, botUrlFromLocation } from '../../../../lib/bots';

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
