// ================= IMPORTS =================
const mineflayer = require('mineflayer')
const express = require('express')
const fs = require('fs')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalBlock } = goals
const mcDataLoader = require('minecraft-data')

// ================= CONFIG =================
const config = require('./settings.json')

// ================= WEB =================
const app = express()
app.get('/', (req, res) => res.json({ brain, memory, learning }))
app.get('/task/:t', (req, res) => {
  brain.force = req.params.t
  res.send('Forced: ' + brain.force)
})
app.listen(3000, () => console.log('[Web] Running'))

// ================= MEMORY =================
const FILE = './memory.json'
function load() {
  try { return JSON.parse(fs.readFileSync(FILE)) }
  catch { return { chests: [], farms: [], ores: [], home: null } }
}
function save() { fs.writeFileSync(FILE, JSON.stringify(memory, null, 2)) }
let memory = load()
setInterval(save, 30000)

// ================= LEARNING =================
let learning = { farm:1, mine:1, explore:1, store:1 }

// ================= BRAIN =================
let brain = { state: 'idle', task: null, last: 0, force: null }
let cooldowns = {}
function canRun(name) { return !cooldowns[name] || Date.now() > cooldowns[name] }
function cd(name, ms) { cooldowns[name] = Date.now() + ms }

// ================= BOT =================
let bot, mcData, move

function createBot() {
  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config['bot-account'].username,
    version: false // auto-detect server version
  })

  bot.once('spawn', () => {
    console.log('[BOT] Spawned, detected version:', bot.version)

    // Load mcData for detected version
    try {
      mcData = mcDataLoader(bot.version)
      if (!mcData) throw new Error('mcData is null for version ' + bot.version)
    } catch (err) {
      console.error('[ERROR] Failed to load mcData', err)
      bot.end()
      return
    }

    bot.loadPlugin(pathfinder)
    move = new Movements(bot, mcData)
    memory.home = memory.home || bot.entity.position.floored()

    scan()
    brainLoop()
    humanizeLoop()

    console.log('[AI] FINAL FORM ONLINE')
  })

  bot.on('end', () => {
    console.warn('[BOT] Disconnected, retrying in 5s...')
    setTimeout(createBot, 5000)
  })

  bot.on('error', (err) => console.error('[BOT ERROR]', err))
}
createBot()

// ================= SCAN =================
function scan() {
  setInterval(() => {
    if (!bot.entity) return
    const blocks = bot.findBlocks({
      matching: b => b.name.includes('ore') || b.name.includes('wheat') || b.name.includes('chest'),
      maxDistance: 6,
      count: 30
    })
    blocks.forEach(p => {
      const b = bot.blockAt(p)
      if (!b) return
      remember('chests', b.name.includes('chest'), p)
      remember('farms', b.name.includes('wheat'), p)
      remember('ores', b.name.includes('ore'), p)
    })
  }, 10000)
}
function remember(type, cond, pos) {
  if (!cond) return
  if (!memory[type].some(x => x.x===pos.x && x.y===pos.y && x.z===pos.z)) {
    memory[type].push(pos)
    console.log(`[MEMORY] Added ${type} at ${pos.x},${pos.y},${pos.z}`)
  }
}

// ================= BRAIN LOOP =================
function brainLoop() {
  setInterval(async () => {
    if (!bot.entity) return
    if (Date.now() - brain.last < 3000) return

    let task = brain.force || decide()
    if (!task) return

    brain.task = task
    brain.last = Date.now()

    console.log(`[BRAIN] Executing task: ${task}`)
    try {
      await tasks[task]()
      learning[task] = (learning[task] || 1) + 0.2
    } catch (err) {
      console.error('[TASK ERROR]', task, err)
    }
  }, 2000)
}

// ================= DECISION =================
function decide() {
  const options = [
    ['avoid', playerNear()],
    ['sleep', isNight()],
    ['store', fullInv()],
    ['farm', memory.farms.length > 0],
    ['mine', memory.ores.length > 0],
    ['explore', true]
  ]
  const valid = options.filter(o => o[1])
  if (!valid.length) return 'explore'
  return valid.sort((a,b)=>(learning[b[0]]||1)-(learning[a[0]]||1))[0][0]
}

// ================= CONDITIONS =================
function playerNear() {
  return Object.values(bot.entities).some(e =>
    e.type==='player' && e.username!==bot.username &&
    bot.entity.position.distanceTo(e.position)<10)
}
function isNight() { return bot.time.timeOfDay > 13000 }
function fullInv() { return bot.inventory.emptySlotCount()<2 }

// ================= TASKS =================
const tasks = {
  async avoid() {
    if (!canRun('avoid')) return
    cd('avoid', 5000)
    bot.clearControlStates()
    const p = Object.values(bot.entities).find(e=>e.type==='player')
    if (p) bot.lookAt(p.position.offset(0,1.6,0))
    await sleep(2000)
  },

  async sleep() {
    const bed = bot.findBlock({ matching:b=>b.name.includes('bed'), maxDistance:5 })
    if (!bed) return
    try { await bot.sleep(bed) } catch {}
  },

  async store() {
    const pos = memory.chests[0]
    if (!pos) return
    await go(pos)
    const chest = await bot.openChest(bot.blockAt(pos))
    for (const item of bot.inventory.items()) {
      if (item.name.includes('seeds')) continue
      await chest.deposit(item.type, null, item.count)
    }
    chest.close()
  },

  async farm() {
    const pos = memory.farms[0]
    if (!pos) return
    await go(pos)
    await bot.dig(bot.blockAt(pos))
    memory.farms.shift()
  },

  async mine() {
    const pos = memory.ores[0]
    if (!pos) return
    await go(pos)
    await bot.dig(bot.blockAt(pos))
    memory.ores.shift()
  },

  async explore() {
    const dx = Math.floor(Math.random()*10-5)
    const dz = Math.floor(Math.random()*10-5)
    await go(bot.entity.position.offset(dx,0,dz))
  }
}

// ================= MOVEMENT =================
function go(pos) {
  return new Promise((resolve) => {
    bot.pathfinder.setMovements(move)
    bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z))
    const onArrived = () => {
      bot.removeListener('goal_reached', onArrived)
      resolve()
    }
    bot.once('goal_reached', onArrived)
  })
}

// ================= HUMANIZE =================
function humanizeLoop() {
  setInterval(()=>{
    if (!bot.entity) return
    if (Math.random()<0.3) bot.swingArm()
    if (Math.random()<0.2)
      bot.look(Math.random()*Math.PI*2,(Math.random()-0.5)*0.5,true)
  }, 5000)
}

// ================= UTIL =================
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
