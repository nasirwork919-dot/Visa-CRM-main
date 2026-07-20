/**
 * One-time script: uploads local WhatsApp credentials to Supabase
 * so the Railway-deployed bot can connect without scanning a QR code.
 *
 * Run: node upload-auth.js
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const credsPath = path.join(__dirname, 'auth_info', 'creds.json');
  if (!fs.existsSync(credsPath)) {
    console.error('❌ No auth_info/creds.json found. Run bot.js first and scan the QR code.');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const { error } = await supabase.from('wa_auth_sessions').upsert({
    id: 'default',
    creds,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('❌ Upload failed:', error.message);
    process.exit(1);
  }

  console.log('✅ Credentials uploaded to Supabase successfully!');
  console.log('   The Railway bot will now connect without scanning a QR code.');
}

main();
