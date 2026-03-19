// ================= IMPORTS =================
const mineflayer = require('mineflayer')
const express = require('express')
const { Client, GatewayIntentBits } = require('discord.js')
const { pathfinder, goals } = require('mineflayer-pathfinder')

// ================= CONFIG =================
const config = require('./settings.json')

// ================= WEB =================
const app = express()
app.get('/', (req, res) => res.send('Bot is running'))
app.listen(3000, () => console.log('[Web] Running'))

// ================= MINECRAFT BOT =================
let bot
let afkInterval

function createBot() {
  console.log('[MC] Connecting...')

  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port || 25565,
    username: config['bot-account'].username,
    version: false
  })

  bot.on('login', () => console.log('[MC] Logged in'))

  bot.on('spawn', () => {
    console.log('[MC] Spawned')

    // Load plugins once
    bot.loadPlugin(pathfinder)

    startAntiAFK()
  })

  bot.on('end', () => {
    console.log('[MC] Disconnected, reconnecting...')

    // Clear AFK loop to prevent stacking
    if (afkInterval) clearInterval(afkInterval)

    setTimeout(createBot, 5000)
  })

  bot.on('error', err => console.log('[MC ERROR]', err.message))
}

createBot()

// ================= DISCORD BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

const cooldown = new Set()

client.once('ready', () => {
  console.log(`[DISCORD] Logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('!') || msg.author.bot) return

  // Cooldown (2 sec)
  if (cooldown.has(msg.author.id)) return
  cooldown.add(msg.author.id)
  setTimeout(() => cooldown.delete(msg.author.id), 2000)

  const args = msg.content.slice(1).split(' ')
  const cmd = args[0].toLowerCase()

  if (!bot || !bot.entity) {
    return msg.reply('Minecraft bot not ready')
  }

  try {

    // ===== COMMANDS =====

    if (cmd === 'say') {
      const text = args.slice(1).join(' ')
      if (!text) return msg.reply('Provide a message')
      bot.chat(text)
      return msg.reply('Sent message')
    }

    if (cmd === 'jump') {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 500)
      return msg.reply('Jumped')
    }

    if (cmd === 'pos') {
      const p = bot.entity.position
      return msg.reply(`Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
    }

    if (cmd === 'stop') {
      bot.clearControlStates()
      return msg.reply('Stopped')
    }

    if (cmd === 'come') {
      const { GoalNear } = goals

      const player = bot.nearestEntity(
        e => e.type === 'player' && e.username !== bot.username
      )

      if (!player) return msg.reply('No player nearby')

      bot.pathfinder.setGoal(new GoalNear(
        player.position.x,
        player.position.y,
        player.position.z,
        1
      ))

      return msg.reply(`Coming to ${player.username}`)
    }

  } catch (err) {
    console.log('[COMMAND ERROR]', err.message)
    msg.reply('Error executing command')
  }
})

// ================= LOGIN =================
client.login(config.discord.token)

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
