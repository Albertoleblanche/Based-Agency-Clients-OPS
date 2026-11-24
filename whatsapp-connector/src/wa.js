import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import { config, isClientGroup } from './config.js';
import { db, logRun } from './db.js';
import { setQr } from './settings.js';

const groupNames = new Map(); // jid -> subject (client groups only)
// Messages (group chats only) that arrive before the list of groups to read is known, as happens
// with the history WhatsApp sends right after linking. Kept in memory only, then stored for the
// groups that are read and dropped for the rest.
let pending = [];
const PENDING_MAX = 20000;
let groupsLoaded = false;     // the group list has reached Radar at least once since connecting
let emptyTries = 0;
let sock = null;
let status = 'closed';
let onLoggedOut = async () => {};

export const getStatus = () => status;
export const groupsReady = () => groupsLoaded || emptyTries >= 10;

function textOf(m){
  const msg = m.message;
  if(!msg) return null;
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return inner.conversation
    || inner.extendedTextMessage?.text
    || inner.imageMessage?.caption
    || inner.videoMessage?.caption
    || inner.documentMessage?.caption
    || (inner.imageMessage ? '[photo]' : null)
    || (inner.videoMessage ? '[video]' : null)
    || (inner.audioMessage ? '[voice message]' : null)
    || (inner.documentMessage ? `[file: ${inner.documentMessage.fileName || 'document'}]` : null)
    || null;
}

function looksLikeTeam(m){
  if(m.key.fromMe) return true;
  const n = String(m.pushName || '').toLowerCase();
  return !!n && config.teamHints.some(h => n === h || n.startsWith(h + ' '));
}

// Asks WhatsApp for the group list (infrequent), stores every group's NAME, and marks which are read.
// A group is read when its name matches the client rule, unless an admin switched it by hand in Radar.
export async function refreshGroups(){
  if(!sock) return;
  const all = await sock.groupFetchAllParticipating();
  if(!Object.keys(all || {}).length){
    // Right after linking WhatsApp can still be syncing and answer with no groups: try again shortly.
    emptyTries++;
    console.log('WhatsApp sent no groups yet (still syncing). Trying again in 30 seconds.');
    return;
  }
  const { data: existing } = await db().from('wa_groups').select('jid,active,manual');
  const ex = new Map((existing || []).map(g => [g.jid, g]));
  const now = new Date().toISOString();
  const rows = Object.entries(all).map(([jid, g]) => {
    const auto = isClientGroup(g.subject);
    const cur = ex.get(jid);
    const manual = cur?.manual || false;
    return { jid, name: g.subject, auto_match: auto, manual, active: manual ? cur.active : auto, updated_at: now };
  });
  if(rows.length){
    const { error } = await db().from('wa_groups').upsert(rows, { onConflict: 'jid' });
    if(error){ console.error('Saving the group list to Radar failed:', error.message); return; }
  }
  groupsLoaded = true;
  await syncActiveGroups();
  console.log(`Reading ${groupNames.size} client groups (of ${rows.length} groups on this number). Personal chats are never read.`);
}

// Cheap, database-only: picks up on/off switches changed in Radar.
export async function syncActiveGroups(){
  const { data, error } = await db().from('wa_groups').select('jid,name').eq('active', true);
  if(error) return;
  groupNames.clear();
  for(const g of data || []) groupNames.set(g.jid, g.name);
  if(pending.length && groupNames.size){
    const held = pending; pending = [];
    await ingest(held);
    console.log(`Stored the messages WhatsApp sent before the group list arrived (${held.length} looked at; only groups that are read are kept).`);
  }
}
// Until the groups to read are known, hold group messages instead of dropping them.
function intake(messages){
  if(groupNames.size) return ingest(messages);
  const groupMsgs = (messages || []).filter(m => (m.key?.remoteJid || '').endsWith('@g.us'));
  pending.push(...groupMsgs);
  if(pending.length > PENDING_MAX) pending = pending.slice(-PENDING_MAX);
  return Promise.resolve();
}

async function ingest(messages){
  const rows = [];
  for(const m of messages){
    const jid = m.key?.remoteJid;
    // Hard filter: only client groups. Everything else is dropped before it touches memory or the database.
    if(!jid || !jid.endsWith('@g.us') || !groupNames.has(jid)) continue;
    const text = textOf(m);
    if(!text || !m.key.id) continue;
    const secs = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
    rows.push({
      wa_msg_id: m.key.id,
      group_jid: jid,
      sender: m.pushName || (m.key.participant || '').split('@')[0] || null,
      from_team: looksLikeTeam(m),
      text: text.slice(0, 4000),
      ts: new Date((secs || Math.floor(Date.now()/1000)) * 1000).toISOString(),
    });
  }
  if(!rows.length) return;
  const { error } = await db().from('wa_messages').upsert(rows, { onConflict: 'group_jid,wa_msg_id', ignoreDuplicates: true });
  if(error) console.error('wa_messages upsert failed:', error.message);
}

export async function connect({ onReady, onLogout } = {}){
  if(onLogout) onLoggedOut = onLogout;
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();
  const mine = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: false,      // don't show the office PC as "online"
    generateHighQualityLinkPreview: false,
  });
  sock = mine;

  // READ-ONLY GUARD: this service must never send anything to WhatsApp.
  const blocked = () => { throw new Error('Read-only connector: sending to WhatsApp is disabled.'); };
  sock.sendMessage = blocked;
  sock.relayMessage = blocked;
  sock.sendPresenceUpdate = async () => {};
  sock.readMessages = async () => {};   // never send read receipts

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages }) => { intake(messages).catch(e => console.error('ingest error', e.message)); });
  sock.ev.on('messaging-history.set', ({ messages }) => { intake(messages || []).catch(e => console.error('history ingest error', e.message)); });
  sock.ev.on('groups.upsert', () => refreshGroups().catch(() => {}));
  sock.ev.on('groups.update', () => refreshGroups().catch(() => {}));

  sock.ev.on('connection.update', async (u) => {
    if(mine !== sock) return;   // events from a replaced socket (after re-link) are ignored
    if(u.qr){
      console.log('\nScan this QR with WhatsApp → Settings → Linked devices → Link a device:\n');
      qrcode.generate(u.qr, { small: true });
      try { await setQr(await QRCode.toDataURL(u.qr, { width: 280, margin: 1 })); } catch(e){ console.error('QR to Radar failed:', e.message); }
    }
    if(u.connection === 'open'){
      status = 'open'; groupsLoaded = false; emptyTries = 0;
      console.log('WhatsApp connected (read-only).');
      try { await setQr(null); } catch {}
      await logRun({ kind: 'status', connection: 'open', note: 'connected' });
      try { await refreshGroups(); } catch(e){ console.error(`Couldn't get the group list yet (${e.message}). Trying again in 30 seconds.`); }
      onReady && onReady();
    }
    if(u.connection === 'close'){
      const code = u.lastDisconnect?.error?.output?.statusCode;
      status = 'closed';
      if(code === DisconnectReason.loggedOut){
        status = 'logged_out';
        console.error('WhatsApp session was logged out. Press Re-link… in Radar → Settings → WhatsApp and scan the new code.');
        await logRun({ kind: 'error', ok: false, connection: 'logged_out', note: 'WhatsApp session logged out — re-scan the QR code' });
        await onLoggedOut();
      } else {
        console.log(`Connection closed (code ${code}). Reconnecting in 5s…`);
        await logRun({ kind: 'status', connection: 'closed', note: `closed code ${code}` });
        setTimeout(() => connect({ onReady }).catch(e => console.error('reconnect failed', e.message)), 5000);
      }
    }
  });
  return sock;
}

// Empties the login folder but keeps the folder itself: on a server it is often a mounted
// volume, which can't be deleted.
function clearAuth(){
  fs.mkdirSync(config.authDir, { recursive: true });
  for(const f of fs.readdirSync(config.authDir)) fs.rmSync(`${config.authDir}/${f}`, { recursive: true, force: true });
}

// Unlinks this number and starts a fresh QR (triggered from Radar's Setup panel).
export async function relink(){
  console.log('Re-link requested from Radar: clearing the saved login and showing a new QR code.');
  const old = sock;
  sock = null; status = 'closed';
  try { await old?.logout(); } catch {}
  try { old?.end?.(undefined); } catch {}
  clearAuth();
  await logRun({ kind: 'status', connection: 'closed', note: 're-link requested from Radar' });
  await connect({});
}

export function stop(){ try { sock?.end?.(undefined); } catch {} }
