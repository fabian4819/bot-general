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
let activeMessageHandlers = 0
let shuttingDown = false

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

function getPhoneJidFromMessage(msg: proto.IWebMessageInfo): string | null {
  const key = msg.key as typeof msg.key & {
    senderPn?: string
    participantPn?: string
  }
  const remoteJid = key.remoteJid || ''
  const isGroup = remoteJid.endsWith('@g.us')
  return key.participantPn || key.senderPn || (isGroup ? key.participant : remoteJid) || null
}

function getPhoneNumberFromJid(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null
  const phone = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  return phone || null
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
      if (shuttingDown) continue
      if (!msg.message) continue

      const remoteJid = msg.key.remoteJid ?? ''
      const messageTs = getMessageTimestampSeconds(msg)

      if (messageTs && messageTs < BOT_START_TS - 5) {
        continue
      }

      const text = getMessageText(msg)
      if (!text || !text.startsWith('/')) continue

      const identityJid = msg.key.fromMe
        ? ownerJid
        : getPhoneJidFromMessage(msg) || remoteJid
      const phoneNumber = getPhoneNumberFromJid(identityJid)

      // Fail closed: commands only run when the sender's real phone number is known
      // and explicitly allowed. In groups participantPn identifies the sender.
      if (!phoneNumber || !ALLOWED_PHONES.has(phoneNumber)) {
        console.log(`[Filter] blocked jid=${remoteJid} identity=${identityJid}`)
        continue
      }

      console.log(`[Bot] type=${type} from=${remoteJid} identity=${identityJid} text="${text}"`)

      activeMessageHandlers += 1
      try {
        const result = await handleMessage(text, identityJid)
        if (!result.text && !result.document) continue
        const isGroup = remoteJid.endsWith('@g.us')

        if (result.document) {
          await sock.sendMessage(remoteJid, {
            document: result.document,
            mimetype: result.documentMimetype ?? 'application/pdf',
            fileName: result.documentFileName,
            caption: result.text,
          }, isGroup ? { quoted: msg } : undefined)
          console.log(`[Bot] document reply sent to=${remoteJid}`)
        } else if (result.text) {
          await sock.sendMessage(remoteJid, { text: result.text }, isGroup ? { quoted: msg } : undefined)
          console.log(`[Bot] text reply sent to=${remoteJid}`)
        }
      } catch (err) {
        console.error('[Handler] Error:', err)
        await sock.sendMessage(remoteJid, { text: '❌ Error saat memproses pesan. Coba lagi.' })
      } finally {
        activeMessageHandlers -= 1
      }
    }
  })

  return sock
}

async function shutdownGracefully(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[Shutdown] ${signal} received, waiting for ${activeMessageHandlers} active message(s)`)

  const deadline = Date.now() + 75_000
  while (activeMessageHandlers > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  if (activeMessageHandlers > 0) {
    console.warn(`[Shutdown] Timed out with ${activeMessageHandlers} active message(s)`)
  } else {
    console.log('[Shutdown] All active messages completed')
  }
  process.exit(0)
}

process.once('SIGTERM', () => { void shutdownGracefully('SIGTERM') })
process.once('SIGINT', () => { void shutdownGracefully('SIGINT') })

console.log('🚀 Bot Cashflow starting...')
connectToWhatsApp().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
