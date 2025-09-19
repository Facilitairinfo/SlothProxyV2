// supabase.js
import { createClient } from @supabase/supabase-js;

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client (read)
export const supabase = createClient(supabaseUrl, anonKey);

// Service client (write)
export const supabaseAdmin = createClient(supabaseUrl, serviceKey);

// Fetch all active sites
export async function getActiveSites() {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('active', true);

  if (error) throw error;
  return data || [];
}

// Fetch a single site by siteKey
export async function getSiteByKey(siteKey) {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('siteKey', siteKey)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Update lastUpdated for a site
export async function touchLastUpdated(siteKey) {
  const { error } = await supabaseAdmin
    .from('sites')
    .update({ lastUpdated: new Date().toISOString() })
    .eq('siteKey', siteKey);

  if (error) throw error;
}
