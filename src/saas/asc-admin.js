import { SignJWT, importPKCS8 } from 'jose'

export async function ascJwt(keyId, issuerId, p8) {
  const key = await importPKCS8(p8, 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ aud: 'appstoreconnect-v1' })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 10 * 60)
    .sign(key)
}

export async function ascApi(jwt, method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json.errors?.[0]?.detail || JSON.stringify(json).slice(0, 200)
    throw new Error(`ASC ${res.status}: ${detail}`)
  }
  return json
}

export async function listApps(jwt) {
  const json = await ascApi(jwt, 'GET', '/v1/apps?limit=50')
  return json.data.map(a => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId }))
}

export async function createWebhook(jwt, { appId, url, secret, name }) {
  const json = await ascApi(jwt, 'POST', '/v1/webhooks', {
    data: {
      type: 'webhooks',
      attributes: {
        name,
        url,
        secret,
        enabled: true,
        eventTypes: ['BETA_FEEDBACK_SCREENSHOT_SUBMISSION_CREATED', 'BETA_FEEDBACK_CRASH_SUBMISSION_CREATED']
      },
      relationships: { app: { data: { type: 'apps', id: appId } } }
    }
  })
  return json.data.id
}

export async function pingWebhook(jwt, webhookId) {
  const json = await ascApi(jwt, 'POST', '/v1/webhookPings', {
    data: { type: 'webhookPings', relationships: { webhook: { data: { type: 'webhooks', id: webhookId } } } }
  })
  return json.data.id
}

export async function recentDeliveries(jwt, webhookId) {
  const since = encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())
  const json = await ascApi(jwt, 'GET', `/v1/webhooks/${webhookId}/deliveries?filter[createdDateGreaterThanOrEqualTo]=${since}&limit=10`)
  return json.data.map(d => d.attributes)
}
