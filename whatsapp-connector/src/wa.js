import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config, isClientGroup } from './config.js';
import { db, logRun } from './db.js';

const groupNames = new Map(); // jid -> subject (client groups only)
let sock = null;
let status = 'closed';
let onLoggedOut = async () => {};

export const getStatus = () => status;

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

async function saveGroup(jid, name){
  const { error } = await db().from('wa_groups').upsert({ jid, name, updated_at: new Date().toISOString() }, { onConflict: 'jid', ignoreDuplicates: false });
  if(error) console.error('wa_groups upsert failed:', error.message);
}

async function refreshGroups(){
  const all = await sock.groupFetchAllParticipating();
  let kept = 0;
  for(const [jid, g] of Object.entries(all)){
    if(isClientGroup(g.subject)){
      groupNames.set(jid, g.subject);
      await saveGroup(jid, g.subject);
      kept++;
    } else groupNames.delete(jid);
  }
  console.log(`Client groups being read: ${kept} (of ${Object.keys(all).length} groups on this number). Personal chats and other groups are ignored.`);
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
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: false,      // don't show the office PC as "online"
    generateHighQualityLinkPreview: false,
  });

  // READ-ONLY GUARD: this service must never send anything to WhatsApp.
  const blocked = () => { throw new Error('Read-only connector: sending to WhatsApp is disabled.'); };
  sock.sendMessage = blocked;
  sock.relayMessage = blocked;
  sock.sendPresenceUpdate = async () => {};
  sock.readMessages = async () => {};   // never send read receipts

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages }) => { ingest(messages).catch(e => console.error('ingest error', e.message)); });
  sock.ev.on('messaging-history.set', ({ messages }) => { ingest(messages || []).catch(e => console.error('history ingest error', e.message)); });
  sock.ev.on('groups.upsert', () => refreshGroups().catch(() => {}));
  sock.ev.on('groups.update', () => refreshGroups().catch(() => {}));

  sock.ev.on('connection.update', async (u) => {
    if(u.qr){
      console.log('\nScan this QR with WhatsApp → Settings → Linked devices → Link a device:\n');
      qrcode.generate(u.qr, { small: true });
    }
    if(u.connection === 'open'){
      status = 'open';
      console.log('WhatsApp connected (read-only).');
      await logRun({ kind: 'status', connection: 'open', note: 'connected' });
      try { await refreshGroups(); } catch(e){ console.error('group refresh failed', e.message); }
      onReady && onReady();
    }
    if(u.connection === 'close'){
      const code = u.lastDisconnect?.error?.output?.statusCode;
      status = 'closed';
      if(code === DisconnectReason.loggedOut){
        status = 'logged_out';
        console.error('WhatsApp session was logged out. Delete the auth folder and run again to re-link.');
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

export function stop(){ try { sock?.end?.(undefined); } catch {} }
