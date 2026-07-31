export async function sendDestinations(cfg, fb, issueUrl, screenshots = []) {
  const dests = cfg.destinations || []
  if (!dests.length) return
  const summary = `${fb.kind === 'crash' ? 'Crash report' : 'Feedback'} on ${fb.appName || fb.bundleId || 'your app'} — ${fb.device || 'unknown device'}, ${fb.osVersion || '?'}, build ${fb.build || '?'}`
  const comment = fb.comment ? `“${fb.comment.slice(0, 500)}”` : '(no comment)'

  await Promise.allSettled(dests.map(async (d) => {
    if (!d?.url || !/^https:\/\//.test(d.url)) return
    let body
    if (d.type === 'discord') {
      body = {
        content: `${summary}\n${comment}\n${issueUrl || ''}`.trim(),
        embeds: screenshots.slice(0, 4).map(u => ({ image: { url: u } }))
      }
    } else if (d.type === 'slack') {
      body = {
        text: `${summary}\n${comment}\n${issueUrl ? `<${issueUrl}|View issue>` : ''}`.trim(),
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `${summary}\n${comment}${issueUrl ? `\n<${issueUrl}|View issue>` : ''}` } },
          ...screenshots.slice(0, 4).map(u => ({ type: 'image', image_url: u, alt_text: 'tester screenshot' }))
        ]
      }
    } else {
      body = {
        event: 'testflight_feedback',
        kind: fb.kind,
        submissionId: fb.id,
        comment: fb.comment || null,
        device: fb.device, osVersion: fb.osVersion, build: fb.build,
        bundleId: fb.bundleId, createdDate: fb.createdDate,
        issueUrl: issueUrl || null,
        screenshots
      }
    }
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) { console.error(`destination ${d.type} ${res.status}`); cfg.audit?.('destination_failed', { dest: d.type, status: res.status }) }
    else { console.log(`destination ${d.type} delivered`); cfg.audit?.('destination_sent', { dest: d.type }) }
  }))
}
