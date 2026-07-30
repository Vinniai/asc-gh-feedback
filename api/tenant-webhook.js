import { webhookResponse } from '../src/core/handler.js'
import { getTenant, appendLog } from '../src/saas/store.js'

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

function tenantCfg(t) {
  return {
    webhookSecret: t.secret,
    asc: {
      keyId: t.ascKeyId,
      issuerId: t.ascIssuerId,
      privateKey: () => t.ascPrivateKey,
      baseUrl: 'https://api.appstoreconnect.apple.com'
    },
    github: {
      token: t.githubToken,
      repo: t.repo,
      assetDir: t.assetDir || '.testflight/feedback',
      labels: (t.labels || 'testflight-feedback,needs-triage').split(',').map(s => s.trim()).filter(Boolean)
    },
    routine: {
      id: t.routineId || '',
      token: t.routineToken || '',
      fireUrl: (id) => `https://api.anthropic.com/v1/claude_code/routines/${id}/fire`
    },
    destinations: t.destinations || [],
    pipeline: t.pipeline || { createIssue: true, fireRoutine: true }
  }
}

async function resolveTenant(request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('tenant') || url.pathname.match(/\/t\/([a-z0-9-]+)\/webhook/)?.[1]
  if (!id) return { error: json(404, { error: 'missing tenant' }) }
  const tenant = await getTenant(process.env, id)
  if (!tenant || tenant.deleted) return { error: json(404, { error: 'unknown tenant' }) }
  if (tenant.enabled === false) return { error: json(200, { received: true, note: 'tenant paused' }) }
  return { tenant }
}

export async function GET(request) {
  const { error } = await resolveTenant(request)
  return error || json(200, { ok: true })
}

export async function POST(request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('tenant') || url.pathname.match(/\/t\/([a-z0-9-]+)\/webhook/)?.[1]
  const { tenant, error } = await resolveTenant(request)
  if (error) return error
  const events = []
  const cfg = tenantCfg(tenant)
  cfg.audit = (type, data = {}) => events.push({ t: new Date().toISOString(), type, ...data })
  const res = await webhookResponse(request, cfg)
  if (events.length) await appendLog(process.env, id, events).catch(e => console.error(`log append: ${e.message}`))
  return res
}
