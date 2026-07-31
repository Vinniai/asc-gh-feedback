import { makeConfig } from './config.js'
import { verifySignature } from './verify.js'
import { fetchScreenshotSubmission, fetchCrashSubmission, downloadImage } from './asc.js'
import { alreadyFiled, uploadScreenshot, createIssue } from './github.js'
import { fireRoutine } from './routine.js'
import { sendDestinations } from './destinations.js'

const EVENT_HANDLERS = {
  betaFeedbackScreenshotSubmissionCreated: fetchScreenshotSubmission,
  betaFeedbackCrashSubmissionCreated: fetchCrashSubmission
}

function parseEvent(payload) {
  const data = payload?.data
  if (!data) return null
  const type = data.type || payload.eventType
  const instanceId =
    data.relationships?.instance?.data?.id ||
    data.attributes?.instanceId ||
    null
  return { type, instanceId, eventId: data.id || null }
}

async function processEvent(cfg, event) {
  const handler = EVENT_HANDLERS[event.type]
  if (!handler) {
    console.log(`ignoring event type: ${event.type}`)
    return
  }
  if (!event.instanceId) {
    console.error(`event ${event.type} missing instance id`)
    return
  }

  cfg.audit?.('feedback_received', { eventType: event.type, submissionId: event.instanceId })

  const existing = await alreadyFiled(cfg, event.instanceId)
  if (existing) {
    console.log(`submission ${event.instanceId} already filed: ${existing}`)
    cfg.audit?.('duplicate_skipped', { issueUrl: existing })
    return
  }

  const fb = await handler(cfg, event.instanceId)

  const screenshotLinks = []
  for (const [i, url] of fb.screenshotUrls.entries()) {
    try {
      const bytes = await downloadImage(url)
      const stored = await uploadScreenshot(cfg, fb.id, i, bytes)
      screenshotLinks.push(cfg.shotUrl ? await cfg.shotUrl(fb.id, i + 1) : stored)
    } catch (e) {
      console.error(`screenshot ${i + 1} failed: ${e.message}`)
    }
  }

  let issueUrl = null
  if (cfg.pipeline?.createIssue !== false) {
    issueUrl = await createIssue(cfg, fb, screenshotLinks)
    console.log(`issue created: ${issueUrl}`)
    cfg.audit?.('issue_created', { issueUrl, screenshots: screenshotLinks.length })
  }

  if (cfg.pipeline?.fireRoutine !== false) {
    try {
      const sessionUrl = await fireRoutine(cfg, fb, issueUrl)
      if (sessionUrl) cfg.audit?.('routine_fired', { sessionUrl })
    } catch (e) {
      console.error(`routine fire failed (issue still created): ${e.message}`)
      cfg.audit?.('routine_failed', { error: e.message.slice(0, 200) })
    }
  }

  try {
    await sendDestinations(cfg, fb, issueUrl, screenshotLinks)
  } catch (e) {
    console.error(`destinations failed: ${e.message}`)
  }
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export async function handleRequest(request, env, ctx = {}) {
  const url = new URL(request.url)

  const isWebhookPath = url.pathname.endsWith('/webhook')
  if (request.method === 'GET' && (url.pathname.endsWith('/healthz') || isWebhookPath)) return json(200, { ok: true })
  if (request.method !== 'POST' || !isWebhookPath) return json(404, { error: 'not found' })

  let cfg
  try {
    cfg = makeConfig(env)
  } catch (e) {
    console.error(e.message)
    return json(500, { error: 'server misconfigured' })
  }

  return webhookResponse(request, cfg, ctx)
}

export async function webhookResponse(request, cfg, ctx = {}) {
  const bodyBytes = new Uint8Array(await request.arrayBuffer())
  if (bodyBytes.length > 5_000_000) return json(413, { error: 'payload too large' })

  if (!(await verifySignature(bodyBytes, request.headers, cfg.webhookSecret))) {
    console.error('signature verification failed')
    return json(401, { error: 'invalid signature' })
  }

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBytes))
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const event = parseEvent(payload)
  if (!event) return json(200, { received: true })
  console.log(`event: ${event.type} instance=${event.instanceId}`)

  const work = processEvent(cfg, event).catch(e => { console.error(`processing failed: ${e.message}`); cfg.audit?.('error', { error: e.message.slice(0, 200) }) })
  if (typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work)
  } else {
    await work
  }
  return json(200, { received: true })
}
