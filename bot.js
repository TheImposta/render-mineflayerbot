import 'dotenv/config'
import mineflayer from 'mineflayer'
import { pathfinder, Movements } from 'mineflayer-pathfinder'
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'

/* ========================
   CONFIG
======================== */
const BOT_HOST = process.env.MC_HOST
const BOT_PORT = Number(process.env.MC_PORT || 25565)
const BOT_USERNAME = process.env.MC_USERNAME || 'renderbot'
const BOT_VERSION = process.env.MC_VERSION || false

const WEB_PORT = process.env.PORT || 3000
const VIEWER_PORT = 3001

/* ========================
   BOT
======================== */
const bot = mineflayer.createBot({
  host: BOT_HOST,
  port: BOT_PORT,
  username: BOT_USERNAME,
  version: BOT_VERSION,
  auth: 'offline'
})

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  const mcData = bot.registry
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)

  console.log('[BOT] Spawned successfully')
})

/* ========================
   SUPPRESS ACTIONBAR SPAM
======================== */
bot.on('message', (msg, position) => {
  if (position === 'actionBar') return
})

/* ========================
   ERROR HANDLING
======================== */
bot.on('error', err => {
  console.error('[BOT ERROR]', err.message)
})

bot.on('kicked', reason => {
  console.error('[BOT KICKED]', reason)
})

/* ========================
   WEB SERVER
======================== */
const app = express()

app.get('/', (_, res) => {
  res.send('Bot is online')
})

/* ========================
   VIEWER PROXY
   (NO SPAM if viewer off)
======================== */
app.use(
  '/viewer',
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIEWER_PORT}`,
    changeOrigin: true,
    logLevel: 'silent',
    onError(err, req, res) {
      if (!res.headersSent) {
        res.status(503).send('Viewer not running')
      }
    }
  })
)

app.listen(WEB_PORT, () => {
  console.log(`[WEB] Listening on port ${WEB_PORT}`)
})

/* ========================
   OPTIONAL VIEWER
======================== */
if (process.env.ENABLE_VIEWER === 'true') {
  const { mineflayer: viewer } = await import('prismarine-viewer')
  viewer(bot, { port: VIEWER_PORT, firstPerson: true })
  console.log('[VIEWER] Started')
}
