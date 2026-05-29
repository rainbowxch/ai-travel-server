import 'dotenv/config'
import { serve } from '@hono/node-server'
import { config } from './config.js'
import { initDb } from './db.js'
import { app } from './app.js'

if (!config.baseUrl) throw new Error('缺少环境变量 AI_BASE_URL')
if (!config.apiKey) throw new Error('缺少环境变量 AI_API_KEY')

initDb()

console.log(`[server] starting on port ${config.port}`)
console.log(`[server] model: ${config.model}`)
console.log(`[server] baseUrl: ${config.baseUrl}`)

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' })
