import cron from 'node-cron';
import { config } from './config.js';
import { connect, getStatus, stop, relink, syncActiveGroups, refreshGroups, groupsReady } from './wa.js';
import { loadSettings, applySettings, heartbeat, clearRelinkFlag, clearCheckFlag } from './settings.js';
import { runDigest, alertAdmins, sendHeldAlerts } from './digest.js';

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
    applySettings(await loadSettings());
    await safeDigest({ dry });
    process.exit(0);
  }

  await connect({
    onReady: () => {
      if(args.has('--link-only')){ console.log('Linked. You can close this (Ctrl+C) and start it normally with: npm start'); }
    },
    onLogout: async () => {
      await alertAdmins('*The Radar WhatsApp connector was logged out.* New client messages are not being read. Open the connector on the office PC, delete the `auth` folder and scan the QR code again.');
    },
  });
  if(args.has('--link-only')) return;

  let tasks = [];
  const schedule = () => {
    tasks.forEach(t => t.stop()); tasks = [];
    for(const t of config.digestTimes){
      const [h, m] = t.split(':').map(Number);
      if(Number.isNaN(h) || Number.isNaN(m)) { console.error(`Bad digest time: ${t}`); continue; }
      // Weekdays only: the team doesn't work weekends. Monday's first check reads everything since
      // Friday's last one, so nothing is missed.
      tasks.push(cron.schedule(`${m} ${h} * * 1-5`, async () => {
        await sendHeldAlerts().catch(e => console.error('Held alert not sent:', e.message));
        if(getStatus() === 'open') safeDigest({ dry }); else console.log('Skipped digest: WhatsApp not connected.');
      }, { timezone: config.tz }));
    }
    console.log(`Digest scheduled on weekdays at ${config.digestTimes.join(', ')} (${config.tz}).`);
  };
  applySettings(await loadSettings());
  schedule();

  // Every 30s: tell Radar we're alive, pick up setup changes (times, roles, group switches, re-link).
  setInterval(async () => {
    try {
      await heartbeat();
      const s = await loadSettings();
      if(applySettings(s)) schedule();
      await syncActiveGroups();
      // until the group list has reached Radar (WhatsApp can be slow right after linking), keep asking
      if(getStatus() === 'open' && !groupsReady()) await refreshGroups().catch(e => console.error(`Couldn't get the group list yet (${e.message}). Trying again in 30 seconds.`));
      if(s?.relink_requested){ await clearRelinkFlag(); await relink(); }
      // Check Now, from Radar: read the groups right away. No Slack messages; those go at the set times.
      if(s?.check_requested_at && getStatus() === 'open' && !running){
        await clearCheckFlag();
        console.log('Check Now from Radar: reading the groups now.');
        safeDigest({ dry, notify: false });
      }
    } catch(e){ console.error('Settings sync failed:', e.message); }
  }, 30000);
  // Ask WhatsApp for the group list every 30 minutes (switches in Radar are applied from the database every 30s).
  setInterval(() => { if(getStatus() === 'open') refreshGroups().catch(() => {}); }, 30 * 60000);
  if(args.has('--digest-now')) setTimeout(() => safeDigest({ dry }), 20000);
}

process.on('SIGINT', () => { stop(); process.exit(0); });
main().catch(e => { console.error(e.message); process.exit(1); });
