import { google } from 'googleapis'
import { drive_v3, sheets_v4 } from 'googleapis'
import fs from 'fs'
import path from 'path'

let _sheets: sheets_v4.Sheets | null = null
let _drive: drive_v3.Drive | null = null
let _driveUpload: drive_v3.Drive | null = null
let _auth: ReturnType<typeof loadAuth> | null = null
let _oauthAuth: InstanceType<typeof google.auth.OAuth2> | null = null

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
]

function loadAuth() {
  const jsonPath = path.join(process.cwd(), 'credentials', 'google-service-account.json')
  if (fs.existsSync(jsonPath)) {
    const credentials = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    return new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_PRIVATE_KEY
  if (!email || !rawKey) {
    throw new Error(
      'Letakkan file JSON di credentials/google-service-account.json\n' +
      'atau set GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY di .env'
    )
  }
  const key = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: SCOPES,
  })
}

function getAuth() {
  if (_auth) return _auth
  _auth = loadAuth()
  return _auth
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (_sheets) return _sheets
  _sheets = google.sheets({ version: 'v4', auth: getAuth() })
  return _sheets
}

export function getDriveClient(): drive_v3.Drive {
  if (_drive) return _drive
  _drive = google.drive({ version: 'v3', auth: getAuth() })
  return _drive
}

export function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID
  if (!id) throw new Error('SPREADSHEET_ID not set. Run: npm run setup-sheets')
  return id
}

function getOAuthAuth() {
  if (_oauthAuth) return _oauthAuth
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_DRIVE_CLIENT_ID, CLIENT_SECRET, dan REFRESH_TOKEN harus di-set untuk upload Drive')
  }
  _oauthAuth = new google.auth.OAuth2(clientId, clientSecret)
  _oauthAuth.setCredentials({ refresh_token: refreshToken })
  return _oauthAuth
}

export function getDriveUploadClient(): drive_v3.Drive {
  if (_driveUpload) return _driveUpload
  _driveUpload = google.drive({ version: 'v3', auth: getOAuthAuth() })
  return _driveUpload
}
