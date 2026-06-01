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

async function connectToWhatsApp(): Promise<ReturnType<typeof makeWASocket>> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH)
  const { version } = await fetchLatestBaileysVersion()

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
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp terhubung sebagai ${OWNER_PHONE}`)
      console.log(`📊 Spreadsheet: https://docs.google.com/spreadsheets/d/${process.env.SPREADSHEET_ID}`)

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
    if (type !== 'notify') return

    for (const msg of messages) {
      if (!msg.message) continue

      const remoteJid = msg.key.remoteJid ?? ''
      const messageTs = getMessageTimestampSeconds(msg)

      if (messageTs && messageTs < BOT_START_TS - 5) {
        continue
      }

      // Skip group chats
      if (remoteJid.endsWith('@g.us')) continue

      // Only respond to allowed numbers
      // @lid = WhatsApp privacy format, phone number can't be extracted directly — allow through
      // @s.whatsapp.net = standard format, filter by phone number
      if (remoteJid.endsWith('@s.whatsapp.net')) {
        const phoneNumber = remoteJid.split('@')[0]
        if (!ALLOWED_PHONES.has(phoneNumber)) {
          console.log(`[Filter] blocked jid=${remoteJid}`)
          continue
        }
      }

      const text = getMessageText(msg)
      if (!text) continue

      console.log(`[Bot] from=${remoteJid} text="${text}"`)

      try {
        const result = await handleMessage(text, remoteJid)
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
