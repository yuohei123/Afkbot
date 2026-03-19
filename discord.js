// ================= DISCORD BOT =================
const { Client, GatewayIntentBits } = require('discord.js')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

// Simple cooldown system
const cooldown = new Set()

client.once('ready', () => {
  console.log(`[DISCORD] Logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('!') || msg.author.bot) return

  // Cooldown (2 seconds per user)
  if (cooldown.has(msg.author.id)) return
  cooldown.add(msg.author.id)
  setTimeout(() => cooldown.delete(msg.author.id), 2000)

  const args = msg.content.slice(1).trim().split(/ +/)
  const cmd = args.shift().toLowerCase()

  // Check Minecraft bot
  if (!bot || !bot.entity) {
    return msg.reply('⚠️ Minecraft bot is not ready')
  }

  try {

    // ===== COMMAND: !say =====
    if (cmd === 'say') {
      const text = args.join(' ')
      if (!text) return msg.reply('❌ Please provide a message')

      bot.chat(text)
      return msg.reply('✅ Message sent to Minecraft')
    }

    // ===== COMMAND: !jump =====
    if (cmd === 'jump') {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 500)
      return msg.reply('🦘 Jumped')
    }

    // ===== COMMAND: !pos =====
    if (cmd === 'pos') {
      const p = bot.entity.position
      return msg.reply(
        `📍 Position: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
      )
    }

    // ===== COMMAND: !stop =====
    if (cmd === 'stop') {
      bot.clearControlStates()
      return msg.reply('🛑 Movement stopped')
    }

    // ===== COMMAND: !come =====
    if (cmd === 'come') {
      const { GoalNear } = require('mineflayer-pathfinder').goals

      const player = bot.nearestEntity(
        e => e.type === 'player' && e.username !== bot.username
      )

      if (!player) return msg.reply('❌ No player nearby')

      bot.pathfinder.setGoal(new GoalNear(
        player.position.x,
        player.position.y,
        player.position.z,
        1
      ))

      return msg.reply(`🏃 Coming to ${player.username}`)
    }

    // ===== UNKNOWN COMMAND =====
    return msg.reply('❓ Unknown command')

  } catch (err) {
    console.log('[DISCORD COMMAND ERROR]', err)
    msg.reply('❌ Error executing command')
  }
})

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN)
