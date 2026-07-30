import { webhookResponse } from '../src/core/handler.js'
import { getTenant } from '../src/saas/store.js'

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
    }
  }
}

async function resolveTenant(request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('tenant') || url.pathname.match(/\/t\/([a-z0-9-]+)\/webhook/)?.[1]
  if (!id) return { error: json(404, { error: 'missing tenant' }) }
  const tenant = await getTenant(process.env, id)
  if (!tenant) return { error: json(404, { error: 'unknown tenant' }) }
  return { tenant }
}

export async function GET(request) {
  const { error } = await resolveTenant(request)
  return error || json(200, { ok: true })
}

export async function POST(request) {
  const { tenant, error } = await resolveTenant(request)
  if (error) return error
  return webhookResponse(request, tenantCfg(tenant))
}
