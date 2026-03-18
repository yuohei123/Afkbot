// ================= IMPORTS =================
const mineflayer = require('mineflayer')
const express = require('express')
const { Client, GatewayIntentBits } = require('discord.js')

// ================= CONFIG =================
const config = require('./settings.json')

// ================= WEB =================
const app = express()
app.get('/', (req, res) => res.send('Bot is running'))
app.listen(3000, () => console.log('[Web] Running'))

// ================= MINECRAFT BOT =================
let bot

function createBot() {
  console.log('[MC] Connecting...')

  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port || 35547,
    username: config['bot-account'].username,
    version: false
  })

  bot.on('login', () => console.log('[MC] Logged in'))

  bot.on('spawn', () => {
    console.log('[MC] Spawned')
    antiAFK()
  })

  bot.on('end', () => {
    console.log('[MC] Disconnected, reconnecting...')
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => console.log('[MC ERROR]', err.message))
}

createBot()

// ================= DISCORD BOT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
})

client.once('ready', () => {
  console.log(`[DISCORD] Logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('!')) return

  const args = msg.content.slice(1).split(' ')
  const cmd = args[0]

  if (!bot || !bot.entity) {
    return msg.reply('Minecraft bot not ready')
  }

  // ===== COMMANDS =====

  if (cmd === 'say') {
    const text = args.slice(1).join(' ')
    bot.chat(text)
    msg.reply('Sent message')
  }

  if (cmd === 'jump') {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 500)
    msg.reply('Jumped')
  }

  if (cmd === 'pos') {
    const p = bot.entity.position
    msg.reply(`Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
  }

  if (cmd === 'stop') {
    bot.clearControlStates()
    msg.reply('Stopped')
  }

  if (cmd === 'come') {
    const player = bot.nearestEntity(e => e.type === 'player')
    if (!player) return msg.reply('No player nearby')

    const { pathfinder, goals } = require('mineflayer-pathfinder')
    const { GoalNear } = goals

    if (!bot.pathfinder) bot.loadPlugin(pathfinder)

    bot.pathfinder.setGoal(new GoalNear(
      player.position.x,
      player.position.y,
      player.position.z,
      1
    ))

    msg.reply('Coming to player')
  }
})

// ================= LOGIN =================
client.login(config.discord.token)

// ================= ANTI AFK =================
function antiAFK() {
  setInterval(() => {
    if (!bot.entity) return

    bot.look(Math.random() * Math.PI * 2, 0, true)

    if (Math.random() < 0.5) {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 300)
    }

  }, 10000)
}
