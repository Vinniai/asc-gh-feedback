export async function sendDestinations(cfg, fb, issueUrl) {
  const dests = cfg.destinations || []
  if (!dests.length) return
  const summary = `${fb.kind === 'crash' ? '💥 Crash report' : '📱 Feedback'} on ${fb.appName || fb.bundleId || 'your app'} — ${fb.device || 'unknown device'}, ${fb.osVersion || '?'}, build ${fb.build || '?'}`
  const comment = fb.comment ? `“${fb.comment.slice(0, 500)}”` : '(no comment)'

  await Promise.allSettled(dests.map(async (d) => {
    if (!d?.url || !/^https:\/\//.test(d.url)) return
    let body
    if (d.type === 'discord') {
      body = { content: `${summary}\n${comment}\n${issueUrl || ''}`.trim() }
    } else if (d.type === 'slack') {
      body = { text: `${summary}\n${comment}\n${issueUrl ? `<${issueUrl}|View issue>` : ''}`.trim() }
    } else {
      body = {
        event: 'testflight_feedback',
        kind: fb.kind,
        submissionId: fb.id,
        comment: fb.comment || null,
        device: fb.device, osVersion: fb.osVersion, build: fb.build,
        bundleId: fb.bundleId, createdDate: fb.createdDate,
        issueUrl: issueUrl || null
      }
    }
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) console.error(`destination ${d.type} ${res.status}`)
    else console.log(`destination ${d.type} delivered`)
  }))
}
