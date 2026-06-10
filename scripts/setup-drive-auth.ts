const { google } = require('googleapis')
const readline = require('readline')

const SCOPES = ['https://www.googleapis.com/auth/drive.file']

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, (answer: string) => { rl.close(); resolve(answer) }))
}

async function main() {
  console.log('=== Setup Google Drive OAuth2 untuk Upload Invoice ===\n')

  console.log('Step 1: Buka https://console.cloud.google.com/apis/credentials')
  console.log('Step 2: Create Credentials → OAuth client ID → Desktop app')
  console.log('Step 3: Copy Client ID dan Client Secret\n')

  const clientId = await ask('Client ID: ')
  const clientSecret = await ask('Client Secret: ')

  const oauth2Client = new google.auth.OAuth2(
    clientId.trim(),
    clientSecret.trim(),
    'http://localhost'
  )

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  console.log(`\nStep 4: Buka URL ini di browser:\n\n${authUrl}\n`)
  console.log('Step 5: Login dengan akun Google kamu, lalu allow akses.')
  console.log('Step 6: Setelah redirect ke localhost (error page is normal), copy kode dari URL.')
  console.log('   URL akan seperti: http://localhost/?code=4/xxxx&scope=...')
  console.log('   Copy bagian setelah "code=" sampai sebelum "&scope"\n')

  const code = await ask('Authorization code: ')

  const { tokens } = await oauth2Client.getToken(code.trim())
  if (!tokens.refresh_token) {
    throw new Error('Refresh token tidak didapat. Coba lagi dan pastikan prompt=consent.')
  }

  console.log('\n✅ Berhasil! Tambahkan ini ke .env kamu:\n')
  console.log(`GOOGLE_DRIVE_CLIENT_ID=${clientId.trim()}`)
  console.log(`GOOGLE_DRIVE_CLIENT_SECRET=${clientSecret.trim()}`)
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`)
  console.log('\nSimpan juga di .env VPS (fabian-vps).')
}

main().catch(err => { console.error('Error:', err); process.exit(1) })
