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
function load() { try { return JSON.parse(fs.readFileSync(FILE)) } catch { return { chests: [], farms: [], ores: [], home: null } } }
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
let botOnlineSince = null
let totalOnlineMs = 0
let lastDisconnect = null
let lastReconnect = null
const offlineThresholdSec = 300 // 5 minutes for [LONG OFFLINE] warning

function createBot() {
  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config['bot-account'].username,
    version: config.server.version
  })

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    botOnlineSince = Date.now()
    lastReconnect = new Date(botOnlineSince).toISOString()

    logUptime() // immediate log on reconnect

    mcData = mcDataLoader(config.server.version)
    move = new Movements(bot, mcData)

    memory.home = memory.home || bot.entity.position.floored()

    scan()
    brainLoop()
    humanizeLoop()

    console.log('[AI] FINAL FORM ONLINE')
  })

  bot.on('end', () => {
    if (botOnlineSince) {
      totalOnlineMs += Date.now() - botOnlineSince
      botOnlineSince = null
    }
    lastDisconnect = Date.now()
    console.log('\x1b[33m[Bot disconnected] Reconnecting in 5 seconds...\x1b[0m')
    setTimeout(createBot, 5000)
  })

  bot.on('error', err => {
    console.log('\x1b[31m[Bot error]\x1b[0m', err)
  })
}
createBot()

// ================= SCAN =================
function scan() {
  setInterval(() => {
    if (!bot.entity) return
    const blocks = bot.findBlocks({ matching: b => true, maxDistance: 6, count: 30 })
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
  if (!memory[type].some(x => x.x===pos.x && x.y===pos.y && x.z===pos.z))
    memory[type].push(pos)
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

    try {
      await tasks[task]()
      learning[task] = (learning[task] || 1) + 0.2
    } catch {}
  }, 2000)
}

// ================= DECISION =================
function decide() {
  const options = [
    ['avoid', playerNear()],
    ['sleep', isNight()],
    ['store', fullInv()],
    ['farm', memory.farms.length],
    ['mine', memory.ores.length],
    ['explore', true]
  ]
  return options.filter(o => o[1]).sort((a,b)=>(learning[b[0]]||1)-(learning[a[0]]||1))[0][0]
}

// ================= CONDITIONS =================
function playerNear() { return Object.values(bot.entities).some(e => e.type==='player' && e.username!==bot.username && bot.entity.position.distanceTo(e.position)<10) }
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
  async sleep() { const bed = bot.findBlock({ matching:b=>b.name.includes('bed'), maxDistance:5 }); if (!bed) return; try { await bot.sleep(bed) } catch {} },
  async store() {
    const pos = memory.chests[0]; if (!pos) return
    await go(pos)
    const chest = await bot.openChest(bot.blockAt(pos))
    for (const item of bot.inventory.items()) { if (!item.name.includes('seeds')) await chest.deposit(item.type,null,item.count) }
    chest.close()
  },
  async farm() { const pos = memory.farms[0]; if (!pos) return; await go(pos); await bot.dig(bot.blockAt(pos)) },
  async mine() { const pos = memory.ores[0]; if (!pos) return; await go(pos); await bot.dig(bot.blockAt(pos)) },
  async explore() { const dx = Math.floor(Math.random()*10-5); const dz = Math.floor(Math.random()*10-5); await go(bot.entity.position.offset(dx,0,dz)) }
}

// ================= MOVEMENT =================
function go(pos) { return new Promise(res => { bot.pathfinder.setMovements(move); bot.pathfinder.setGoal(new GoalBlock(pos.x,pos.y,pos.z)); setTimeout(res, 5000 + Math.random()*5000) }) }

// ================= HUMANIZE =================
function humanizeLoop() { setInterval(()=>{ if (!bot.entity) return; if (Math.random()<0.3) bot.swingArm(); if (Math.random()<0.2) bot.look(Math.random()*Math.PI*2,(Math.random()-0.5)*0.5,true) },5000) }

// ================= UTIL =================
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

// ================= UPTIME LOG =================
function logUptime() {
  let msTotal = totalOnlineMs
  if (botOnlineSince) msTotal += Date.now() - botOnlineSince

  const totalSec = Math.floor(msTotal/1000), totalMin = Math.floor(totalSec/60), totalH = Math.floor(totalMin/60)
  const totalFormatted = `${totalH}h ${totalMin%60}m ${totalSec%60}s`

  let sessionFormatted = '0s'
  if (botOnlineSince) {
    const sessSec = Math.floor((Date.now()-botOnlineSince)/1000)
    const sh = Math.floor(sessSec/3600), sm=Math.floor((sessSec%3600)/60), ss=sessSec%60
    sessionFormatted = `${sh}h ${sm}m ${ss}s`
  }

  let offlineFormatted = null, offlineWarning = ''
  if (lastDisconnect && lastReconnect) {
    const offMs = new Date(lastReconnect)-new Date(lastDisconnect)
    const offSec = Math.floor(offMs/1000)
    const oh=Math.floor(offSec/3600), om=Math.floor((offSec%3600)/60), os=offSec%60
    offlineFormatted = `${oh}h ${om}m ${os}s`
    if (offSec > offlineThresholdSec) offlineWarning = '\x1b[31m[LONG OFFLINE]\x1b[0m '
  }

  let summary = `Bot online for ${totalFormatted} (current session ${sessionFormatted})`
  if (offlineFormatted) summary += `, last offline ${offlineFormatted}`
  console.log(`${offlineWarning}[Uptime] ${summary}`)
}

setInterval(logUptime, 180000) // every 3 minutes

// ================= UPTIME API =================
app.get('/uptime', (req,res)=>{
  let msTotal = totalOnlineMs; if (botOnlineSince) msTotal+=Date.now()-botOnlineSince
  const totalSec = Math.floor(msTotal/1000), totalMin = Math.floor(totalSec/60), totalH = Math.floor(totalMin/60)
  const totalFormatted = `${totalH}h ${totalMin%60}m ${totalSec%60}s`

  let sessionFormatted='0s'
  if(botOnlineSince){const sessSec=Math.floor((Date.now()-botOnlineSince)/1000),sh=Math.floor(sessSec/3600),sm=Math.floor((sessSec%3600)/60),ss=sessSec%60;sessionFormatted=`${sh}h ${sm}m ${ss}s`}

  let offlineFormatted=null
  if(lastDisconnect && lastReconnect){const offMs=new Date(lastReconnect)-new Date(lastDisconnect),offSec=Math.floor(offMs/1000),oh=Math.floor(offSec/3600),om=Math.floor((offSec%3600)/60),os=offSec%60;offlineFormatted=`${oh}h ${om}m ${os}s`}

  const summary=`Bot online for ${totalFormatted} (current session ${sessionFormatted})${offlineFormatted?`, last offline ${offlineFormatted}`:''}`

  res.json({
    total:{ms:msTotal,seconds:totalSec,formatted:totalFormatted},
    session:{ms:botOnlineSince?Date.now()-botOnlineSince:0,seconds:botOnlineSince?Math.floor((Date.now()-botOnlineSince)/1000):0,formatted:sessionFormatted},
    lastDisconnect:lastDisconnect?new Date(lastDisconnect).toISOString():null,
    lastReconnect:lastReconnect,
    offlineDuration:offlineFormatted,
    summary
  })
})
