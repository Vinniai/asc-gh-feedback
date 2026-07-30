import { handleRequest } from './core/handler.js'

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx)
  }
}
