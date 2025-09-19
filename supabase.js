// supabase.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;
let supabaseAdmin = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

export async function getActiveSites() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sites')
    .select('siteKey,label,url,active,lastUpdated')
    .eq('active', true);
  if (error) throw error;
  return data || [];
}

export async function getSiteByKey(siteKey) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('sites')
    .select('siteKey,label,url,active,lastUpdated')
    .eq('siteKey', siteKey)
    .single();
  if (error) throw error;
  return data || null;
}

export async function touchLastUpdated(siteKey) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin
    .from('sites')
    .update({ lastUpdated: new Date().toISOString() })
    .eq('siteKey', siteKey);
  if (error) throw error;
}
