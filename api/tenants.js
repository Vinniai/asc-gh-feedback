import { readSession } from '../src/saas/session.js'
import { getTenant, putTenant, getOwnerTenants, setOwnerTenants, getLog, appendLog } from '../src/saas/store.js'
import { ascJwt, ascApi, recentDeliveries } from '../src/saas/asc-admin.js'

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const summarize = (id, t) => ({
  tenantId: id,
  appId: t.appId, appName: t.appName, bundleId: t.bundleId,
  repo: t.repo, labels: t.labels, createdAt: t.createdAt,
  destinations: t.destinations || [],
  routineConfigured: Boolean(t.routineId && t.routineToken),
  pipeline: t.pipeline || { createIssue: true, fireRoutine: true },
  enabled: t.enabled !== false,
  webhookUrl: null,
  links: {
    ascApp: `https://appstoreconnect.apple.com/apps/${t.appId}/testflight/ios`,
    ascFeedback: `https://appstoreconnect.apple.com/apps/${t.appId}/testflight/screenshots`,
    ascCrashes: `https://appstoreconnect.apple.com/apps/${t.appId}/testflight/crashes`,
    repo: `https://github.com/${t.repo}`,
    issues: `https://github.com/${t.repo}/issues?q=is%3Aissue+label%3Atestflight-feedback`
  }
})

async function authed(request) {
  const user = await readSession(process.env, request)
  if (!user) return { error: json(401, { error: 'sign in first' }) }
  return { user }
}

async function ownedTenant(user, tenantId) {
  const t = await getTenant(process.env, tenantId)
  if (!t || t.deleted) return { error: json(404, { error: 'unknown tenant' }) }
  if (t.owner && t.owner !== user.login) return { error: json(403, { error: 'not your app' }) }
  if (!t.owner) {
    const ids = await getOwnerTenants(process.env, user.login)
    if (!ids.includes(tenantId)) return { error: json(403, { error: 'not your app' }) }
  }
  return { t }
}

export async function GET(request) {
  const { user, error } = await authed(request)
  if (error) return error
  const url = new URL(request.url)
  const deliveriesFor = url.searchParams.get('deliveries')
  const logsFor = url.searchParams.get('logs')

  if (logsFor) {
    const { error: e } = await ownedTenant(user, logsFor)
    if (e) return e
    const log = await getLog(process.env, logsFor)
    return json(200, { log: log.slice(-60).reverse() })
  }

  if (deliveriesFor) {
    const { t, error: e } = await ownedTenant(user, deliveriesFor)
    if (e) return e
    const jwt = await ascJwt(t.ascKeyId, t.ascIssuerId, t.ascPrivateKey)
    return json(200, { deliveries: await recentDeliveries(jwt, t.webhookId) })
  }

  const ids = await getOwnerTenants(process.env, user.login)
  const tenants = []
  for (const id of ids) {
    const t = await getTenant(process.env, id)
    if (t && !t.deleted) tenants.push(summarize(id, t))
  }
  return json(200, { user, tenants })
}

export async function POST(request) {
  const { user, error } = await authed(request)
  if (error) return error
  let body
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }

  if (body.action === 'claim') {
    const t = await getTenant(process.env, body.tenantId)
    if (!t) return json(404, { error: 'unknown tenant' })
    if (t.owner && t.owner !== user.login) return json(403, { error: 'already owned' })
    t.owner = user.login
    await putTenant(process.env, body.tenantId, t)
    const ids = await getOwnerTenants(process.env, user.login)
    if (!ids.includes(body.tenantId)) await setOwnerTenants(process.env, user.login, [...ids, body.tenantId])
    return json(200, { ok: true })
  }

  const { t, error: e } = await ownedTenant(user, body.tenantId)
  if (e) return e
  const evt = (type, data = {}) => appendLog(process.env, body.tenantId, [{ t: new Date().toISOString(), type, by: user.login, ...data }]).catch(() => {})

  const patch = body.patch || {}
  if (typeof patch.labels === 'string') t.labels = patch.labels
  if (Array.isArray(patch.destinations)) {
    t.destinations = patch.destinations
      .filter(d => d && typeof d.url === 'string' && /^https:\/\//.test(d.url) && ['discord', 'slack', 'webhook'].includes(d.type))
      .slice(0, 10)
  }
  if (typeof patch.routineId === 'string') t.routineId = patch.routineId
  if (typeof patch.routineToken === 'string' && patch.routineToken) t.routineToken = patch.routineToken
  if (patch.pipeline && typeof patch.pipeline === 'object') {
    t.pipeline = { createIssue: patch.pipeline.createIssue !== false, fireRoutine: patch.pipeline.fireRoutine !== false }
  }
  if (typeof patch.enabled === 'boolean') {
    const jwt = await ascJwt(t.ascKeyId, t.ascIssuerId, t.ascPrivateKey)
    await ascApi(jwt, 'PATCH', `/v1/webhooks/${t.webhookId}`, {
      data: { type: 'webhooks', id: t.webhookId, attributes: { enabled: patch.enabled } }
    })
    t.enabled = patch.enabled
    evt(patch.enabled ? 'resumed' : 'paused')
  }

  await putTenant(process.env, body.tenantId, t)
  if (patch.labels !== undefined || patch.destinations || patch.pipeline || patch.routineId !== undefined) evt('config_saved')
  return json(200, { ok: true, tenant: summarize(body.tenantId, t) })
}

export async function DELETE(request) {
  const { user, error } = await authed(request)
  if (error) return error
  let body
  try { body = await request.json() } catch { return json(400, { error: 'invalid json' }) }
  const { t, error: e } = await ownedTenant(user, body.tenantId)
  if (e) return e

  try {
    const jwt = await ascJwt(t.ascKeyId, t.ascIssuerId, t.ascPrivateKey)
    await ascApi(jwt, 'DELETE', `/v1/webhooks/${t.webhookId}`)
  } catch (err) { console.error(`webhook delete: ${err.message}`) }

  t.deleted = true
  await putTenant(process.env, body.tenantId, t)
  const ids = await getOwnerTenants(process.env, user.login)
  await setOwnerTenants(process.env, user.login, ids.filter(i => i !== body.tenantId))
  return json(200, { ok: true })
}
