// ================= IMPORTS =================
require('dotenv').config() // load environment variables
const mineflayer = require('mineflayer')
const express = require('express')
const fs = require('fs')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalBlock } = goals
const mcDataLoader = require('minecraft-data')

// ================= CONFIG =================
const config = {
  server: {
    ip: process.env.SERVER_IP || 'ward1.aternos.me',
    port: parseInt(process.env.SERVER_PORT) || 35547,
    version: process.env.SERVER_VERSION || '1.21.11(127)'
  },
  'bot-account': {
    username: process.env.BOT_USERNAME || 'MyBot'
  }
}

// ================= WEB =================
const app = express()
app.get('/', (req, res) => res.json({ brain, memory, learning }))
app.get('/task/:t', (req, res) => { brain.force = req.params.t; res.send('Forced: ' + brain.force) })
app.listen(parseInt(process.env.PORT) || 3000, () => console.log('[Web] Running'))

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
const offlineThresholdSec = 300

// ================= RECONNECT BACKOFF =================
let reconnectTimeout = 5000
let reconnectAttempts = 0
const maxReconnectTimeout = 60000

// ================= CREATE BOT =================
function createBot() {
  try {
    bot = mineflayer.createBot({
      host: config.server.ip,
      port: config.server.port,
      username: config['bot-account'].username,
      version: config.server.version
    })
  } catch (err) {
    console.log('[Bot] Initial connection failed. Retrying in 5s:', err.message)
    setTimeout(createBot, 5000)
    return
  }

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    botOnlineSince = Date.now()
    lastReconnect = new Date(botOnlineSince).toISOString()
    reconnectAttempts = 0
    reconnectTimeout = 5000
    console.log('[Bot] Connected successfully')

    mcData = mcDataLoader(config.server.version)
    move = new Movements(bot, mcData)
    memory.home = memory.home || bot.entity.position.floored()

    scan()
    brainLoop()
    humanizeLoop()
  })

  bot.on('end', handleDisconnect)
  bot.on('error', handleError)
  bot.on('kicked', handleKick)
}

// ================= HANDLER FUNCTIONS =================
function handleDisconnect() {
  const now = Date.now()
  if(botOnlineSince) totalOnlineMs += now - botOnlineSince
  botOnlineSince = null
  lastDisconnect = now

  let offlineSec = lastReconnect ? (now - new Date(lastReconnect))/1000 : 0
  if(offlineSec > offlineThresholdSec) {
    console.log(`\x1b[31m[LONG OFFLINE ALERT] Bot was offline for ${Math.floor(offlineSec/60)}m ${Math.floor(offlineSec%60)}s\x1b[0m`)
  }

  console.log(`[Bot] Disconnected. Reconnecting in ${reconnectTimeout/1000}s...`)
  reconnectAttempts++
  reconnectTimeout = Math.min(reconnectTimeout * 1.5, maxReconnectTimeout)
  setTimeout(createBot, reconnectTimeout)
}

function handleError(err) {
  console.log('[Bot] Error:', err.message)
  if(err.code === 'ECONNREFUSED' || err.message.includes('Timed out')) {
    console.log('[Bot] Connection refused or timed out. Retrying...')
    setTimeout(createBot, reconnectTimeout)
  }
}

function handleKick(reason) {
  console.log('[Bot] Kicked:', reason.toString())
  setTimeout(createBot, reconnectTimeout)
}

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
    try { await tasks[task]() ; learning[task] = (learning[task]||1)+0.2 } catch {}
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
  async avoid() { if(!canRun('avoid')) return; cd('avoid',5000); bot.clearControlStates(); const p = Object.values(bot.entities).find(e=>e.type==='player'); if(p) bot.lookAt(p.position.offset(0,1.6,0)); await sleep(2000) },
  async sleep() { const bed = bot.findBlock({ matching:b=>b.name.includes('bed'), maxDistance:5 }); if(!bed) return; try { await bot.sleep(bed) } catch {} },
  async store() { const pos = memory.chests[0]; if(!pos) return; await go(pos); const chest = await bot.openChest(bot.blockAt(pos)); for(const item of bot.inventory.items()){if(!item.name.includes('seeds')) await chest.deposit(item.type,null,item.count)} chest.close() },
  async farm() { const pos = memory.farms[0]; if(!pos) return; const block = bot.blockAt(pos); if(block) await bot.dig(block) },
  async mine() { const pos = memory.ores[0]; if(!pos) return; const block = bot.blockAt(pos); if(block) await bot.dig(block) },
  async explore() { const dx = Math.floor(Math.random()*10-5); const dz = Math.floor(Math.random()*10-5); await go(bot.entity.position.offset(dx,0,dz)) }
}

// ================= MOVEMENT =================
function go(pos) { return new Promise(res => { bot.pathfinder.setMovements(move); bot.pathfinder.setGoal(new GoalBlock(pos.x,pos.y,pos.z)); setTimeout(res, 5000 + Math.random()*5000) }) }

// ================= HUMANIZE =================
function humanizeLoop() { setInterval(()=>{ if(!bot.entity) return; if(Math.random()<0.3) bot.swingArm(); if(Math.random()<0.2) bot.look(Math.random()*Math.PI*2,(Math.random()-0.5)*0.5,true) },5000) }

// ================= UTIL =================
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

// ================= UPTIME LOG =================
function logUptime() {
  let msTotal = totalOnlineMs
  if(botOnlineSince) msTotal += Date.now() - botOnlineSince
  const totalSec = Math.floor(msTotal/1000), totalMin = Math.floor(totalSec/60), totalH = Math.floor(totalMin/60)
  const totalFormatted = `${totalH}h ${totalMin%60}m ${totalSec%60}s`

  let sessionFormatted = '0s'
  if(botOnlineSince){
    const sessSec = Math.floor((Date.now()-botOnlineSince)/1000)
    const sh = Math.floor(sessSec/3600)
    const sm = Math.floor((sessSec%3600)/60)
    const ss = sessSec%60
    sessionFormatted = `${sh}h ${sm}m ${ss}s`
  }

  let offlineFormatted = null
  let offlineWarning = ''
  if(lastDisconnect && lastReconnect){
    const offMs = new Date(lastReconnect)-new Date(lastDisconnect)
    const offSec = Math.floor(offMs/1000)
    const oh = Math.floor(offSec/3600), om = Math.floor((offSec%3600)/60), os = offSec%60
    offlineFormatted = `${oh}h ${om}m ${os}s`
    if(offSec > offlineThresholdSec) offlineWarning = '\x1b[31m[LONG OFFLINE]\x1b[0m '
  }

  let summary = `Bot online for ${totalFormatted} (current session ${sessionFormatted})`
  if(offlineFormatted) summary += `, last offline ${offlineFormatted}`
  console.log(`${offlineWarning}[Uptime] ${summary}`)
}
setInterval(logUptime, 180000)

// ================= LIVE UPTIME EVERY MINUTE =================
setInterval(() => {
  if (!botOnlineSince) return
  const ms = Date.now() - botOnlineSince
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const h = Math.floor(min / 60)
  const m = min % 60
  const s = sec % 60
  process.stdout.write(`\r[Live Uptime] Session: ${h}h ${m}m ${s}s `)
}, 60000)

// ================= UPTIME API =================
app.get('/uptime', (req,res)=>{
  let msTotal = totalOnlineMs; if(botOnlineSince) msTotal+=Date.now()-botOnlineSince
  const totalSec=Math.floor(msTotal/1000), totalMin=Math.floor(totalSec/60), totalH=Math.floor(totalMin/60)
  const totalFormatted=`${totalH}h ${totalMin%60}m ${totalSec%60}s`
  let sessionFormatted='0s'; if(botOnlineSince){const sessSec=Math.floor((Date.now()-botOnlineSince)/1000),sh=Math.floor(sessSec/3600),sm=Math.floor((sessSec%3600)/60),ss=sessSec%60;sessionFormatted=`${sh}h ${sm}m ${ss}s`}
  let offlineFormatted=null; if(lastDisconnect && lastReconnect){const offMs=new Date(lastReconnect)-new Date(lastDisconnect),offSec=Math.floor(offMs/1000),oh=Math.floor(offSec/3600),om=Math.floor((offSec%3600)/60),os=Math.floor(offSec%60);offlineFormatted=`${oh}h ${om}m ${os}s`}
  const summary=`Bot online for ${totalFormatted} (current session ${sessionFormatted})${offlineFormatted?`, last offline ${offlineFormatted}`:''}`
  res.json({ total:{ms:msTotal,seconds:totalSec,formatted:totalFormatted}, session:{ms:botOnlineSince?Date.now()-botOnlineSince:0,seconds:botOnlineSince?Math.floor((Date.now()-botOnlineSince)/1000):0,formatted:sessionFormatted}, lastDisconnect:lastDisconnect?new Date(lastDisconnect).toISOString():null, lastReconnect:lastReconnect, offlineDuration:offlineFormatted, summary })
})

// ================= START BOT =================
createBot()
