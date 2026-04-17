import { createClient } from '@supabase/supabase-js';

// TEMP: Hardcoded values for a one-off connectivity test.
// DO NOT COMMIT real keys; remove after testing.
const supabaseUrl = 'https://wiekabbfmpmxjhiwyfzt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpZWthYmJmbXBteGpoaXd5Znp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2ODA5MzAsImV4cCI6MjA3ODI1NjkzMH0.b1WLRQxc1K5_sGwGQzoVOCUs8kHvunHCtzUEge06CyA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  console.log('Testing Supabase connection...');
  const preview = supabaseKey.length >= 12
    ? `${supabaseKey.slice(0, 6)}...${supabaseKey.slice(-6)}`
    : supabaseKey.length ? 'short' : 'empty';
  const looksJwt = supabaseKey.split('.').length === 3;
  console.log('[Supabase][Test ENV] url=', supabaseUrl, 'anon_len=', supabaseKey.length, 'anon_preview=', preview, 'jwt_like=', looksJwt);
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('nickname')
      .limit(1);

    if (error) {
      console.error('❌ Supabase Error:', error.message);
      console.error('Full error:', JSON.stringify(error, null, 2));
      process.exitCode = 1;
    } else {
      console.log('✅ SUCCESS! Connection works!');
      console.log('Data:', data);
    }
  } catch (err) {
    console.error('❌ Exception:', err?.message || err);
    process.exitCode = 1;
  }
}

testConnection();