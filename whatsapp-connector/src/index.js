import cron from 'node-cron';
import { config } from './config.js';
import { connect, getStatus, stop } from './wa.js';
import { runDigest, alertAdmins } from './digest.js';

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
let running = false;

async function safeDigest(opts){
  if(running) return;
  running = true;
  try { await runDigest(opts); } catch(e){ console.error('Digest failed:', e.message); }
  finally { running = false; }
}

async function main(){
  console.log('Radar WhatsApp connector — READ ONLY. It never sends WhatsApp messages.');

  if(args.has('--digest-now') && !args.has('--live')){
    // Analyze what is already stored, no WhatsApp connection needed.
    await safeDigest({ dry });
    process.exit(0);
  }

  await connect({
    onReady: () => {
      if(args.has('--link-only')){ console.log('Linked. You can close this (Ctrl+C) and start it normally with: npm start'); }
    },
    onLogout: async () => {
      await alertAdmins('⚠️ *Radar WhatsApp connector was logged out.* New client messages are NOT being read. Open the connector on the office PC, delete the `auth` folder and scan the QR code again.');
    },
  });
  if(args.has('--link-only')) return;

  for(const t of config.digestTimes){
    const [h, m] = t.split(':').map(Number);
    if(Number.isNaN(h) || Number.isNaN(m)) { console.error(`Bad DIGEST_TIMES entry: ${t}`); continue; }
    cron.schedule(`${m} ${h} * * *`, () => { if(getStatus() === 'open') safeDigest({ dry }); else console.log('Skipped digest: WhatsApp not connected.'); }, { timezone: config.tz });
    console.log(`Digest scheduled daily at ${t} (${config.tz}).`);
  }
  if(args.has('--digest-now')) setTimeout(() => safeDigest({ dry }), 20000);
}

process.on('SIGINT', () => { stop(); process.exit(0); });
main().catch(e => { console.error(e.message); process.exit(1); });
