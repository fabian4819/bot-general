import 'dotenv/config'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { handleMessage } from './bot/handler'
import { startScheduler } from './scheduler/reports'

const logger = pino({ level: 'silent' })
const SESSION_PATH = process.env.SESSION_PATH || './auth_info_baileys'
const OWNER_PHONE = process.env.OWNER_PHONE
const BOT_START_TS = Math.floor(Date.now() / 1000)

if (!OWNER_PHONE) {
  console.error('❌ OWNER_PHONE not set in .env')
  process.exit(1)
}

const ownerJid = `${OWNER_PHONE}@s.whatsapp.net`
const ownerPhone = OWNER_PHONE

const ALLOWED_PHONES = new Set(
  (process.env.ALLOWED_PHONES || OWNER_PHONE || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
)

function getMessageText(msg: proto.IWebMessageInfo): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''
  ).trim()
}

function getMessageTimestampSeconds(msg: proto.IWebMessageInfo): number | null {
  const timestamp = msg.messageTimestamp
  if (!timestamp) return null
  const value = typeof timestamp === 'number' ? timestamp : Number(timestamp.toString())
  return Number.isFinite(value) ? value : null
}

function getPhoneJidFromMessage(msg: proto.IWebMessageInfo): string | null {
  const key = msg.key as typeof msg.key & {
    senderPn?: string
    participantPn?: string
  }
  return key.senderPn || key.participantPn || null
}

function getPhoneNumberFromJid(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null
  return jid.split('@')[0]
}

async function connectToWhatsApp(): Promise<ReturnType<typeof makeWASocket>> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()
  let pairingCodeRequested = false

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid.endsWith('@broadcast'),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Scan QR code ini dengan WhatsApp kamu:\n')
      qrcode.generate(qr, { small: true })

      if (!state.creds.registered && !pairingCodeRequested) {
        pairingCodeRequested = true
        const phoneNumber = ownerPhone.replace(/\D/g, '')
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(phoneNumber)
            console.log(`\n🔗 Pairing code WhatsApp: ${code}`)
            console.log('Buka WhatsApp > Linked devices > Link with phone number, lalu masukkan kode ini.\n')
          } catch (err) {
            pairingCodeRequested = false
            console.error('[Pairing] Gagal request pairing code:', err)
          }
        }, 1500)
      }
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp terhubung sebagai ${OWNER_PHONE}`)
      console.log(`📊 Default spreadsheet: https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`)
      console.log(`👥 Allowed phones: ${Array.from(ALLOWED_PHONES).join(', ')}`)

      // Start scheduled reports, send to owner's self-chat
      startScheduler(async (text) => {
        await sock.sendMessage(ownerJid, { text })
      })
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`⚠️ Koneksi terputus (${statusCode}). ${shouldReconnect ? 'Menghubungkan ulang...' : 'Sesi expired, hapus auth_info_baileys/ dan jalankan ulang.'}`)

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 3000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue

      const remoteJid = msg.key.remoteJid ?? ''
      const messageTs = getMessageTimestampSeconds(msg)

      if (messageTs && messageTs < BOT_START_TS - 5) {
        continue
      }

      // Skip group chats
      if (remoteJid.endsWith('@g.us')) continue

      const identityJid = getPhoneJidFromMessage(msg) || remoteJid
      const phoneNumber = getPhoneNumberFromJid(identityJid)

      // Only respond to allowed numbers
      // @lid is WhatsApp's privacy format. If Baileys exposes senderPn/participantPn,
      // use that real phone JID for filtering and per-user spreadsheet selection.
      if (phoneNumber) {
        if (!ALLOWED_PHONES.has(phoneNumber)) {
          console.log(`[Filter] blocked jid=${remoteJid} identity=${identityJid}`)
          continue
        }
      }

      const text = getMessageText(msg)
      if (!text) continue

      console.log(`[Bot] type=${type} from=${remoteJid} identity=${identityJid} text="${text}"`)

      try {
        const result = await handleMessage(text, identityJid)
        if (!result.text && !result.document) continue
        if (result.document) {
          await sock.sendMessage(remoteJid, {
            document: result.document,
            mimetype: result.documentMimetype ?? 'application/pdf',
            fileName: result.documentFileName,
            caption: result.text,
          })
        } else if (result.text) {
          await sock.sendMessage(remoteJid, { text: result.text })
        }
      } catch (err) {
        console.error('[Handler] Error:', err)
        await sock.sendMessage(remoteJid, { text: '❌ Error saat memproses pesan. Coba lagi.' })
      }
    }
  })

  return sock
}

console.log('🚀 Bot Cashflow starting...')
connectToWhatsApp().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
