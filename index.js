// ================= IMPORTS =================
const mineflayer = require('mineflayer')
const express = require('express')

// ================= CONFIG =================
const config = require('./settings.json')

// ================= WEB =================
const app = express()
app.get('/', (req, res) => res.send('Bot is running'))
app.listen(3000, () => console.log('[Web] Running on port 3000'))

// ================= BOT =================
let bot

function createBot() {
  console.log('\n[BOOT] Starting bot...')
  console.log('[INFO] Server:', config.server.ip)

  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port || 25565,
    username: config['bot-account'].username,
    version: false // auto detect (IMPORTANT for 1.21+)
  })

  // ===== CONNECTION EVENTS =====
  bot.on('login', () => {
    console.log('[BOT] Logged in')
  })

  bot.on('spawn', () => {
    console.log('[BOT] Spawned successfully')
    console.log('[BOT] Version detected:', bot.version)

    startAntiAFK()
  })

  bot.on('error', (err) => {
    console.log('[ERROR]', err.message)
  })

  bot.on('kicked', (reason) => {
    console.log('[KICKED]', reason)
  })

  bot.on('end', () => {
    console.log('[DISCONNECTED] Reconnecting in 5 seconds...')
    setTimeout(createBot, 5000)
  })

  bot.on('message', (msg) => {
    console.log('[CHAT]', msg.toString())

    // Auto login for AuthMe (Aternos plugins)
    if (msg.toString().includes('/login')) {
      bot.chat('/login password123')
    }
    if (msg.toString().includes('/register')) {
      bot.chat('/register password123 password123')
    }
  })
}

createBot()

// ================= ANTI AFK =================
function startAntiAFK() {
  console.log('[AFK] Anti-AFK started')

  setInterval(() => {
    if (!bot.entity) return

    const yaw = Math.random() * Math.PI * 2
    const pitch = (Math.random() - 0.5) * 0.5

    bot.look(yaw, pitch, true)

    if (Math.random() < 0.5) {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 500)
    }

    if (Math.random() < 0.3) {
      bot.swingArm()
    }

  }, 10000)
}
