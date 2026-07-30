export async function fireRoutine(cfg, fb, issueUrl) {
  if (!cfg.routine.id || !cfg.routine.token) {
    console.log('routine fire skipped (CLAUDE_ROUTINE_ID / CLAUDE_ROUTINE_TOKEN not set)')
    return null
  }
  const text = [
    `New TestFlight ${fb.kind === 'crash' ? 'crash report' : 'feedback'} filed as a GitHub issue — triage it now.`,
    `Issue: ${issueUrl}`,
    `Repo: ${cfg.github.repo}`,
    fb.comment ? `Tester comment: ${fb.comment.slice(0, 2000)}` : 'No tester comment.',
    `Device: ${fb.device || '?'} on ${fb.osVersion || '?'}, build ${fb.build || '?'}`,
    `Submission id: ${fb.id}`
  ].join('\n')

  const res = await fetch(cfg.routine.fireUrl(cfg.routine.id), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.routine.token}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  })
  if (!res.ok) throw new Error(`routine fire ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const json = await res.json()
  console.log(`routine session started: ${json.claude_code_session_url}`)
  return json.claude_code_session_url
}
