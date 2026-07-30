import { handleRequest } from '../src/core/handler.js'

export async function POST(request) {
  return handleRequest(request, process.env)
}

export async function GET(request) {
  return handleRequest(request, process.env)
}
