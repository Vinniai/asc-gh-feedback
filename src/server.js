import { createServer } from 'node:http'
import { handleRequest } from './core/handler.js'

const port = Number(process.env.PORT || 8484)

const server = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)

  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  })

  const pending = []
  const ctx = { waitUntil: (p) => pending.push(p) }

  try {
    const response = await handleRequest(request, process.env, ctx)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (e) {
    console.error(`unhandled: ${e.message}`)
    res.writeHead(500)
    res.end()
  }

  Promise.allSettled(pending)
})

server.listen(port, () => {
  console.log(`asc-gh-feedback listening on :${port} (POST /webhook)`)
})
