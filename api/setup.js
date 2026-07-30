import { ascJwt, listApps, createWebhook, pingWebhook, recentDeliveries } from '../src/saas/asc-admin.js'
import { getTenant, putTenant, getOwnerTenants, setOwnerTenants } from '../src/saas/store.js'
import { readSession } from '../src/saas/session.js'

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const randomHex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('')

async function checkRepo(githubToken, repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'asc-gh-feedback-saas' }
  })
  if (!res.ok) throw new Error(`GitHub cannot access ${repo} (${res.status}) — check the token and repo name`)
  const data = await res.json()
  if (!data.permissions?.push) throw new Error(`Token lacks write access to ${repo}`)
  return data.full_name
}

function normalizeP8(p8) {
  const s = (p8 || '').trim()
  if (s.includes('BEGIN PRIVATE KEY')) return s
  try { return atob(s) } catch { throw new Error('ASC private key must be the .p8 contents or its base64') }
}

export async function POST(request) {
  const env = process.env
  let body
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }

  if (!env.SETUP_CODE || body.code !== env.SETUP_CODE) return json(401, { error: 'invalid setup code' })

  try {
    if (body.action === 'validate') {
      const repo = await checkRepo(body.githubToken, body.repo)
      const jwt = await ascJwt(body.ascKeyId, body.ascIssuerId, normalizeP8(body.ascPrivateKey))
      const apps = await listApps(jwt)
      return json(200, { ok: true, repo, apps })
    }

    if (body.action === 'provision') {
      const repo = await checkRepo(body.githubToken, body.repo)
      const p8 = normalizeP8(body.ascPrivateKey)
      const jwt = await ascJwt(body.ascKeyId, body.ascIssuerId, p8)
      const apps = await listApps(jwt)
      const app = apps.find(a => a.id === body.appId)
      if (!app) throw new Error(`App ${body.appId} not visible to this ASC key`)

      const tenantId = 't' + randomHex(8)
      const secret = randomHex(32)
      const origin = new URL(request.url).origin
      const webhookUrl = `${origin}/t/${tenantId}/webhook`
      const webhookId = await createWebhook(jwt, { appId: app.id, url: webhookUrl, secret, name: `asc-gh-feedback ${tenantId}` })

      const sessionUser = await readSession(env, request)
      await putTenant(env, tenantId, {
        owner: sessionUser?.login || null,
        createdAt: new Date().toISOString(),
        repo,
        githubToken: body.githubToken,
        ascKeyId: body.ascKeyId,
        ascIssuerId: body.ascIssuerId,
        ascPrivateKey: p8,
        appId: app.id,
        appName: app.name,
        bundleId: app.bundleId,
        webhookId,
        secret,
        labels: body.labels || 'testflight-feedback,needs-triage',
        assetDir: body.assetDir || '.testflight/feedback',
        routineId: body.routineId || '',
        routineToken: body.routineToken || ''
      })

      if (sessionUser?.login) {
        const ids = await getOwnerTenants(env, sessionUser.login)
        if (!ids.includes(tenantId)) await setOwnerTenants(env, sessionUser.login, [...ids, tenantId])
      }

      await pingWebhook(jwt, webhookId)
      return json(200, { ok: true, tenantId, webhookUrl, webhookId, app })
    }

    if (body.action === 'status') {
      const tenant = await getTenant(env, body.tenantId)
      if (!tenant) return json(404, { error: 'unknown tenant' })
      const jwt = await ascJwt(tenant.ascKeyId, tenant.ascIssuerId, tenant.ascPrivateKey)
      const deliveries = await recentDeliveries(jwt, tenant.webhookId)
      return json(200, { ok: true, app: tenant.appName, repo: tenant.repo, deliveries })
    }

    return json(400, { error: 'unknown action' })
  } catch (e) {
    return json(422, { error: e.message })
  }
}
