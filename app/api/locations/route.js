import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { listLocations } from '../../../lib/locations';

export async function GET() {
  try {
    await requireSession();
    const sb = getSupabase();
    const locations = await listLocations(sb);
    return NextResponse.json({ locations });
  } catch (err) {
    return apiError(err);
  }
}
