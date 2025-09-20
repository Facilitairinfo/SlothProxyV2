import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function fetchSites() {
  const { data, error } = await supabase
    .from('sites')
    .select('id, siteKey, url, created_at');

  if (error) {
    console.error('❌ Supabase fetch error:', error.message);
    throw error;
  }

  return data;
}
