// test-supabase.js
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const endpoint = `${SUPABASE_URL}/rest/v1/Facilitairinfo`;

async function testSupabase() {
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await res.json();

    if (res.ok) {
      console.log(`✅ Supabase connected. ${data.length} rows fetched.`);
    } else {
      console.error(`❌ Supabase error: ${res.status} ${res.statusText}`);
      console.error(data);
    }
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  }
}

testSupabase();
