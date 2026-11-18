import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client;
export function db(){
  if(!client) client = createClient(config.supabaseUrl(), config.supabaseKey(), { auth: { persistSession: false } });
  return client;
}
function check(res, what){
  if(res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
export { check };

export async function logRun(row){
  const { error } = await db().from('wa_runs').insert(row);
  if(error) console.error('wa_runs insert failed:', error.message);
}
export async function lastDigestTime(){
  const { data } = await db().from('wa_runs').select('started_at').eq('kind','digest').eq('ok', true)
    .order('started_at', { ascending: false }).limit(1);
  return data?.[0]?.started_at || null;
}
export async function loadProfiles(){
  const data = check(await db().from('team_profiles').select('id,name,role,slack_user_id,access_revoked,muted_notification_types'), 'load team_profiles');
  return (data || []).filter(p => !p.access_revoked);
}
