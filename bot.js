import 'dotenv/config'
import express from 'express'
import mineflayer from 'mineflayer'
import { pathfinder } from 'mineflayer-pathfinder'
import autoEat from 'mineflayer-auto-eat'
import { createProxyMiddleware } from 'http-proxy-middleware'

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

const BOT_USERNAME = process.env.MC_USERNAME
const BOT_HOST = process.env.MC_HOST
const BOT_PORT = Number(process.env.MC_PORT || 25565)
const BOT_VERSION = process.env.MC_VERSION || false

const HTTP_PORT = Number(process.env.PORT || 3000)

const VIEWER_HOST_INTERNAL = '127.0.0.1'
const VIEWER_PORT_INTERNAL = 3001
const VIEWER_FIRST_PERSON = process.env.VIEWER_FIRST_PERSON === 'true'

/* ------------------------------------------------------------------ */
/* Viewer state                                                        */
/* ------------------------------------------------------------------ */

let viewerStarted = false
let viewerReady = false

/* ------------------------------------------------------------------ */
/* Express server                                                      */
/* ------------------------------------------------------------------ */

const app = express()

/**
 * Gate viewer traffic until viewer is actually ready.
 * This prevents ECONNREFUSED spam entirely.
 */
app.use('/viewer', (req, res, next) => {
  if (!viewerReady) {
    return res.status(503).send('Viewer not ready')
  }
  next()
})

/**
 * Viewer proxy
 */
app.use(
  '/viewer',
  createProxyMiddleware({
    target: `http://${VIEWER_HOST_INTERNAL}:${VIEWER_PORT_INTERNAL}`,
    changeOrigin: true,
    ws: true,
    logLevel: 'silent' // <-- prevents proxy spam
  })
)

app.get('/', (_, res) => {
  res.send('Minecraft bot is running')
})

app.listen(HTTP_PORT, () => {
  console.log(`[WEB] HTTP server listening on ${HTTP_PORT}`)
})

/* ------------------------------------------------------------------ */
/* Mineflayer bot                                                      */
/* ------------------------------------------------------------------ */

function createBot() {
  const bot = mineflayer.createBot({
    host: BOT_HOST,
    port: BOT_PORT,
    username: BOT_USERNAME,
    version: BOT_VERSION
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(autoEat)

  /* ---------------------------- */
  /* Spawn handling               */
  /* ---------------------------- */

  bot.once('spawn', async () => {
    console.log(`[SPAWN] Bot spawned as ${bot.username}`)

    // auto-eat config (safe defaults)
    try {
      bot.autoEat.options = {
        priority: 'foodPoints',
        startAt: 14,
        bannedFood: []
      }
    } catch {}

    // Start viewer ONCE per process
    if (viewerStarted) {
      console.log('[VIEWER] already started; skipping')
      return
    }

    viewerStarted = true

    try {
      const viewerPkg = await import('prismarine-viewer')
      const startViewer =
        viewerPkg.mineflayer || viewerPkg.default?.mineflayer

      if (!startViewer) {
        throw new Error('prismarine-viewer export not found')
      }

      console.log(
        `[VIEWER] Starting on ${VIEWER_HOST_INTERNAL}:${VIEWER_PORT_INTERNAL}`
      )

      startViewer(bot, {
        host: VIEWER_HOST_INTERNAL,
        port: VIEWER_PORT_INTERNAL,
        firstPerson: VIEWER_FIRST_PERSON
      })

      // viewer has no readiness callback — delay mark
      setTimeout(() => {
        viewerReady = true
        console.log('[VIEWER] Ready')
      }, 1500)
    } catch (err) {
      viewerStarted = false
      console.error('[VIEWER] Failed to start:', err?.message)
    }
  })

  /* ---------------------------- */
  /* Message handling (FIX SPAM)  */
  /* ---------------------------- */

  /**
   * Suppress action-bar / HUD messages completely.
   * These are NOT chat messages and should not be parsed.
   */
  bot.on('actionBar', () => {
    // intentionally ignored
  })

  /**
   * Handle real chat only.
   * No regex warnings. No spam.
   */
  bot.on('chat', (username, message) => {
    if (!username || username === bot.username) return
    console.log(`[CHAT] <${username}> ${message}`)
  })

  /**
   * Prevent raw message spam.
   * DO NOT attempt username extraction on system lines.
   */
  bot.on('message', (jsonMsg) => {
    if (!jsonMsg?.toString) return

    const text = jsonMsg.toString()

    // Ignore HUD / mana / health overlays
    if (
      /\d+\/\d+\??\s+.*Mana/i.test(text) ||
      /\d+\/\d+❤/.test(text)
    ) {
      return
    }
  })

  /* ---------------------------- */
  /* Lifecycle                    */
  /* ---------------------------- */

  bot.on('end', () => {
    console.warn('[BOT] Disconnected; reconnecting in 5s')
    viewerReady = false
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => {
    console.error('[BOT] Error:', err?.message)
  })
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

createBot()
