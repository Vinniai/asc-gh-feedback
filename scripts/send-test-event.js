import { createHmac } from 'node:crypto'

const url = process.env.WEBHOOK_URL || 'http://localhost:8484/webhook'
const secret = process.env.ASC_WEBHOOK_SECRET
if (!secret) {
  console.error('Set ASC_WEBHOOK_SECRET')
  process.exit(1)
}

const eventType = process.argv[2] || 'betaFeedbackScreenshotSubmissionCreated'
const instanceId = process.argv[3] || 'test-submission-id'

const payload = JSON.stringify({
  data: {
    type: eventType,
    id: 'evt_test_001',
    attributes: { timestamp: new Date().toISOString() },
    relationships: {
      instance: {
        data: {
          type: eventType.startsWith('betaFeedbackCrash')
            ? 'betaFeedbackCrashSubmissions'
            : 'betaFeedbackScreenshotSubmissions',
          id: instanceId
        }
      }
    }
  }
})

const sig = createHmac('sha256', secret).update(payload).digest('hex')

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Apple-Signature': sig },
  body: payload
})
console.log(res.status, await res.text())
