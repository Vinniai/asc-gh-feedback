import { SignJWT, importPKCS8 } from 'jose'

let cached = { token: null, exp: 0, keyId: null }

async function token(cfg) {
  const now = Math.floor(Date.now() / 1000)
  if (cached.token && cached.keyId === cfg.asc.keyId && now < cached.exp - 60) return cached.token
  const key = await importPKCS8(cfg.asc.privateKey(), 'ES256')
  const exp = now + 15 * 60
  const jwt = await new SignJWT({ aud: 'appstoreconnect-v1' })
    .setProtectedHeader({ alg: 'ES256', kid: cfg.asc.keyId, typ: 'JWT' })
    .setIssuer(cfg.asc.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)
  cached = { token: jwt, exp, keyId: cfg.asc.keyId }
  return jwt
}

async function get(cfg, path) {
  const res = await fetch(`${cfg.asc.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${await token(cfg)}` }
  })
  if (!res.ok) throw new Error(`ASC ${res.status} ${path}: ${(await res.text()).slice(0, 500)}`)
  return res.json()
}

function imageUrls(screenshots = []) {
  return screenshots.flatMap(s => {
    if (s?.url) return [s.url]
    if (s?.templateUrl) {
      const w = s.width || 1170
      const h = s.height || 2532
      return [s.templateUrl.replace('{w}', w).replace('{h}', h).replace('{f}', 'png')]
    }
    return []
  })
}

function deviceInfo(a = {}) {
  return {
    bundleId: a.buildBundleId || a.bundleId || null,
    comment: a.comment || '',
    email: a.email || a.contactEmail || null,
    createdDate: a.createdDate || null,
    device: a.deviceModel || a.deviceFamily || null,
    osVersion: a.osVersion || null,
    locale: a.locale || null,
    timeZone: a.timeZone || null,
    connectionType: a.connectionType || null,
    batteryPercentage: a.batteryPercentage ?? null,
    architecture: a.architecture || null,
    appPlatform: a.appPlatform || null,
    diskBytesAvailable: a.diskBytesAvailable ?? null,
    diskBytesTotal: a.diskBytesTotal ?? null,
    appUptimeMs: a.appUptimeInMilliseconds ?? null
  }
}

function buildInfo(included = []) {
  const build = included.find(i => i.type === 'builds')
  return {
    build: build?.attributes?.version || null,
    appVersion: build?.attributes?.preReleaseVersion?.version || null,
    appName: null
  }
}

export async function fetchScreenshotSubmission(cfg, id) {
  const json = await get(cfg, `/v1/betaFeedbackScreenshotSubmissions/${id}?include=build,tester`)
  const a = json.data?.attributes || {}
  return {
    kind: 'screenshot',
    id,
    ...deviceInfo(a),
    ...buildInfo(json.included),
    screenshotUrls: imageUrls(a.screenshots)
  }
}

export async function fetchCrashSubmission(cfg, id) {
  const json = await get(cfg, `/v1/betaFeedbackCrashSubmissions/${id}?include=build,tester`)
  const a = json.data?.attributes || {}
  let crashText = null
  try {
    const log = await get(cfg, `/v1/betaFeedbackCrashSubmissions/${id}/crashLog`)
    const url = log.data?.attributes?.downloadUrl || log.data?.attributes?.url
    if (url) {
      const res = await fetch(url)
      if (res.ok) crashText = (await res.text()).slice(0, 60000)
    } else if (log.data?.attributes?.logText) {
      crashText = log.data.attributes.logText.slice(0, 60000)
    }
  } catch (e) {
    crashText = `Failed to fetch crash log: ${e.message}`
  }
  return {
    kind: 'crash',
    id,
    ...deviceInfo(a),
    ...buildInfo(json.included),
    screenshotUrls: [],
    crashText
  }
}

export async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image download ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
