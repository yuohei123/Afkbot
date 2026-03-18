const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalBlock } = goals
const mcDataLoader = require('minecraft-data')

const config = require('./settings.json')

// ================= BOT STATE =================
let bot
let botState = {
  connected: false,
  lastActivity: Date.now()
}

// ================= HELPERS =================
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms))
}

function isAdmin(name) {
  const keywords = ['admin', 'mod', 'owner', 'staff']
  return keywords.some(k => name.toLowerCase().includes(k))
}

// ================= CREATE BOT =================
function createBot() {
  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config['bot-account'].username,
    version: config.server.version
  })

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    console.log('[Bot] Spawned')

    botState.connected = true
    const mcData = mcDataLoader(config.server.version)
    const defaultMove = new Movements(bot, mcData)

    // INIT SYSTEMS
    startAFK(bot)
    detectPlayers(bot)
    autoFarm(bot)
    autoStore(bot)
    autoSleep(bot)
    farmNavigator(bot, defaultMove)
    autoMine(bot)
    explore(bot, defaultMove)
    mimic(bot)
  })

  bot.on('end', () => {
    console.log('[Bot] Disconnected, reconnecting...')
    botState.connected = false
    setTimeout(createBot, 5000)
  })

  bot.on('kicked', r => console.log('[Kicked]', r))
  bot.on('error', err => console.log('[Error]', err.message))
}

createBot()

// ================= ANTI-AFK =================
function startAFK(bot) {
  function loop() {
    if (!botState.connected) return

    const actions = [
      () => bot.swingArm(),
      () => bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, true)
    ]

    actions[Math.floor(Math.random() * actions.length)]()

    setTimeout(loop, 15000 + Math.random() * 20000)
  }

  loop()
}

// ================= PLAYER DETECTION =================
function detectPlayers(bot) {
  setInterval(() => {
    if (!bot.entity) return

    const players = Object.values(bot.entities).filter(e =>
      e.type === 'player' && e.username !== bot.username
    )

    for (const p of players) {
      const dist = bot.entity.position.distanceTo(p.position)

      if (dist < 10) {
        console.log('[Player Nearby]', p.username)

        bot.clearControlStates()
        bot.lookAt(p.position.offset(0, 1.6, 0))

        if (isAdmin(p.username)) {
          console.log('[Admin Detected] Leaving...')
          bot.quit()
        }
      }
    }
  }, 4000)
}

// ================= FARMING =================
function autoFarm(bot) {
  async function loop() {
    if (!bot.entity) return

    try {
      const crop = bot.findBlock({
        matching: b => b.name === 'wheat' && b.metadata === 7,
        maxDistance: 5
      })

      if (crop) {
        await bot.dig(crop)
        await sleep(800)
        return schedule()
      }

      const farmland = bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 5
      })

      if (farmland) {
        const seed = bot.inventory.items().find(i => i.name.includes('seeds'))
        if (seed) {
          await bot.equip(seed, 'hand')
          await bot.placeBlock(farmland, { x: 0, y: 1, z: 0 })
        }
      }

    } catch {}

    schedule()
  }

  function schedule() {
    setTimeout(loop, 4000 + Math.random() * 4000)
  }

  loop()
}

// ================= STORAGE =================
function autoStore(bot) {
  setInterval(async () => {
    if (!bot.entity) return

    if (bot.inventory.emptySlotCount() > 2) return

    const chestBlock = bot.findBlock({
      matching: b => b.name.includes('chest'),
      maxDistance: 6
    })

    if (!chestBlock) return

    try {
      const chest = await bot.openChest(chestBlock)

      for (const item of bot.inventory.items()) {
        if (item.name.includes('seeds')) continue
        await chest.deposit(item.type, null, item.count)
        await sleep(200)
      }

      chest.close()
      console.log('[Stored Items]')
    } catch {}

  }, 15000)
}

// ================= SLEEP =================
function autoSleep(bot) {
  setInterval(async () => {
    if (!bot.time) return

    const time = bot.time.timeOfDay
    const isNight = time > 13000 && time < 23000

    if (isNight && !bot.isSleeping) {
      const bed = bot.findBlock({
        matching: b => b.name.includes('bed'),
        maxDistance: 5
      })

      if (bed) {
        try {
          await bot.sleep(bed)
          console.log('[Sleeping]')
        } catch {}
      }
    }
  }, 10000)
}

// ================= FARM NAV =================
function farmNavigator(bot, defaultMove) {
  let i = 0

  function move() {
    if (!bot.entity) return

    const farms = config.farms || []
    if (farms.length === 0) return

    const f = farms[i]

    bot.pathfinder.setMovements(defaultMove)
    bot.pathfinder.setGoal(new GoalBlock(f.x, f.y, f.z))

    i = (i + 1) % farms.length

    setTimeout(move, 30000 + Math.random() * 20000)
  }

  move()
}

// ================= MINING =================
function autoMine(bot) {
  const ores = ['coal_ore', 'iron_ore']

  async function loop() {
    if (!bot.entity) return

    const block = bot.findBlock({
      matching: b => ores.includes(b.name),
      maxDistance: 5
    })

    if (block) {
      try {
        await bot.dig(block)
        console.log('[Mining]', block.name)
      } catch {}
    }

    setTimeout(loop, 6000 + Math.random() * 6000)
  }

  loop()
}

// ================= EXPLORER =================
function explore(bot, defaultMove) {
  function wander() {
    if (!bot.entity) return

    const dx = Math.floor(Math.random() * 10 - 5)
    const dz = Math.floor(Math.random() * 10 - 5)

    const pos = bot.entity.position.offset(dx, 0, dz)

    bot.pathfinder.setMovements(defaultMove)
    bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z))

    setTimeout(wander, 30000 + Math.random() * 30000)
  }

  wander()
}

// ================= MIMIC =================
function mimic(bot) {
  setInterval(() => {
    if (!bot.entity) return

    const players = Object.values(bot.entities).filter(e =>
      e.type === 'player' && e.username !== bot.username
    )

    if (players.length === 0) return

    const target = players[Math.floor(Math.random() * players.length)]

    if (!target.position) return

    bot.lookAt(target.position.offset(0, 1.6, 0))

    const dist = bot.entity.position.distanceTo(target.position)

    if (dist > 3 && dist < 8) {
      bot.setControlState('forward', true)
    } else {
      bot.clearControlStates()
    }

    if (Math.random() < 0.2) bot.swingArm()

    setTimeout(() => bot.clearControlStates(), 500)

  }, 3000)
}
