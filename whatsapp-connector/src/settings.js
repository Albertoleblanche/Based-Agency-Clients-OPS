import { config } from './config.js';
import { db } from './db.js';
import { applyRoleNotes } from './roles.js';

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

export async function loadSettings(){
  const { data, error } = await db().from('wa_settings').select('*').eq('id', 1).maybeSingle();
  if(error || !data) return null;      // table not created yet -> keep .env defaults
  return data;
}

// Applies Radar's settings to the running process. Returns true if the schedule changed.
export function applySettings(s){
  if(!s) return false;
  applyRoleNotes(s.role_notes || {});
  config.pilotIds = Array.isArray(s.pilot_user_ids) ? s.pilot_user_ids.map(String) : [];
  const times = (s.digest_times || []).map(t => t.trim()).filter(t => TIME.test(t));
  const tz = validTz(s.timezone) ? s.timezone : config.tz;
  const changed = JSON.stringify(times) !== JSON.stringify(config.digestTimes) || tz !== config.tz;
  if(times.length){ config.digestTimes = times; }
  config.tz = tz;
  return changed;
}

export async function heartbeat(){
  await db().from('wa_settings').update({ heartbeat_at: new Date().toISOString() }).eq('id', 1);
}
export async function setQr(dataUrl){
  await db().from('wa_settings').update({ qr: dataUrl, qr_at: dataUrl ? new Date().toISOString() : null }).eq('id', 1);
}
export async function clearRelinkFlag(){
  await db().from('wa_settings').update({ relink_requested: false }).eq('id', 1);
}
