// ================= IMPORTS =================
const mineflayer = require('mineflayer')
const express = require('express')
const { Client, GatewayIntentBits } = require('discord.js')
const { pathfinder, goals } = require('mineflayer-pathfinder')

// ================= CONFIG =================
const config = {
  server: {
    ip: "ward1.aternos.me",
    port: 35547,
    version: false // auto-detect for any 1.21.x version
  },
  bot: {
    username: "Bot123"
  },
  discord: {
    token: process.env.DISCORD_TOKEN || "MTQ4MzczOTk3MzkwMjUzNjg0Ng.G7ovbK.siJ81f3XBu2H3sJIz4yxp9NUSmzoF9Kt7qfXKs"
  }
}

// ================= WEB (KEEP ALIVE) =================
const app = express()
app.get('/', (req, res) => res.send('Bot is running'))
app.listen(3000, () => console.log('[Web] Running'))

// ================= MINECRAFT BOT =================
let bot
let afkInterval
let retryDelay = 5000

function createBot() {
  console.log(`[MC] Connecting to ${config.server.ip}:${config.server.port}...`)

  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config.bot.username,

    auth: "offline",
    version: config.server.version,
    connectTimeout: 30000
  })

  bot.on('login', () => console.log('[MC] Logged in'))

  bot.on('spawn', () => {
    console.log('[MC] ✅ Spawned')
    retryDelay = 5000
    bot.loadPlugin(pathfinder)
    startAntiAFK()
  })

  bot.on('kicked', reason => console.log('[MC] ❌ Kicked:', reason))

  bot.on('error', err => console.log('[MC ERROR]', err.code || err.message))

  bot.on('end', () => {
    console.log(`[MC] Disconnected. Reconnecting in ${retryDelay / 1000}s...`)
    if (afkInterval) clearInterval(afkInterval)
    setTimeout(() => {
      retryDelay = Math.min(retryDelay + 5000, 60000)
      createBot()
    }, retryDelay)
  })
}

createBot()

// ================= ANTI AFK =================
function startAntiAFK() {
  if (afkInterval) clearInterval(afkInterval)

  afkInterval = setInterval(() => {
    if (!bot || !bot.entity) return

    // Random look
    bot.look(Math.random() * Math.PI * 2, 0, true)

    // Random jump
    if (Math.random() < 0.5) {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 300)
    }
  }, 10000)
}

// ================= DISCORD BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const cooldown = new Set()

client.once('ready', () => console.log(`[DISCORD] Logged in as ${client.user.tag}`))

client.on('messageCreate', async msg => {
  if (!msg.content.startsWith('!') || msg.author.bot) return

  // Cooldown 2 seconds per user
  if (cooldown.has(msg.author.id)) return
  cooldown.add(msg.author.id)
  setTimeout(() => cooldown.delete(msg.author.id), 2000)

  const args = msg.content.slice(1).trim().split(/ +/)
  const cmd = args.shift().toLowerCase()

  if (!bot || !bot.entity) return msg.reply('⚠️ Minecraft bot not ready')

  try {
    if (cmd === 'say') {
      const text = args.join(' ')
      if (!text) return msg.reply('❌ Provide a message')
      bot.chat(text)
      return msg.reply('✅ Message sent')
    }

    if (cmd === 'jump') {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 500)
      return msg.reply('🦘 Jumped')
    }

    if (cmd === 'pos') {
      const p = bot.entity.position
      return msg.reply(`📍 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
    }

    if (cmd === 'stop') {
      bot.clearControlStates()
      return msg.reply('🛑 Stopped')
    }

    if (cmd === 'come') {
      const { GoalNear } = goals
      const player = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username)
      if (!player) return msg.reply('❌ No player nearby')
      bot.pathfinder.setGoal(new GoalNear(player.position.x, player.position.y, player.position.z, 1))
      return msg.reply(`🏃 Coming to ${player.username}`)
    }

    return msg.reply('❓ Unknown command')
  } catch (err) {
    console.log('[COMMAND ERROR]', err)
    msg.reply('❌ Command error')
  }
})

// ================= LOGIN =================
client.login(config.discord.token)
