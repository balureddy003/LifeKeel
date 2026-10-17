const { MongoClient } = require('mongodb')
const url = process.env.MONGODB_URL
async function main() {
  const client = new MongoClient(url)
  await client.connect()
  const db = client.db('lifekeel')
  const tenantId = 'reddy003'

  // 1. Strategy config
  console.log('── Strategy config ────────────────────────────────────────────')
  const strat = await db.collection('tenant_settings').findOne({
    tenant_id: tenantId, key: 'defensive_trend_strategy',
  })
  if (strat) {
    console.log('  Found:', JSON.stringify(strat.value, null, 2))
  } else {
    console.log('  ❌ NO defensive_trend_strategy config found!')
    console.log('  This is why the momentum rebalance sweep skips this tenant.')
  }

  // 2. Check ALL tenant_settings keys for this tenant
  console.log('\n── All tenant_settings keys ────────────────────────────────────')
  const allSettings = await db.collection('tenant_settings').find({ tenant_id: tenantId }).toArray()
  for (const s of allSettings) {
    const valStr = s.value ? JSON.stringify(s.value) : '(no value)'
    console.log(`  key=${s.key}, value=${valStr.slice(0, 200)}`)
  }

  // 3. Check what tenantCanTrade looks for
  console.log('\n── Vertical check ──────────────────────────────────────────────')
  const ts = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  console.log('  active_vertical:', ts?.active_vertical)

  // 4. Check the momentum rebalance cron schedule
  console.log('\n── Momentum rebalance cron ─────────────────────────────────────')
  console.log('  Schedule: Mondays at 09:00 London time')
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon
  console.log('  Today is:', now.toLocaleDateString('en-GB', { weekday: 'long' }))
  console.log('  Current time:', now.toISOString())
  console.log('  Next Monday 09:00 London: depends on current day')

  // 5. Check the auto-trade path from insights
  console.log('\n── Auto-trade from insights path ───────────────────────────────')
  // The detector-driven auto-trader fires when an insight is generated
  // and the workflow engine picks it up. Let's check if there are workflows
  // registered for the trading detectors.
  const workflows = await db.collection('workflows').find({
    $or: [
      { 'triggers.detector_id': { $in: ['trading_concentration_risk', 'trading_price_drop_alert'] } },
      { detector_ids: { $in: ['trading_concentration_risk', 'trading_price_drop_alert'] } },
    ],
  }).toArray()
  console.log('  Workflows for trading detectors:', workflows.length)
  for (const w of workflows) {
    console.log(`    ${w.id}: ${w.name ?? w.title}`)
  }

  // Also check workflow definitions on disk
  console.log('\n── Checking workflow loader ────────────────────────────────────')
  // The workflow loader loads from definitions/ directory at startup
  // Let's see if there are any trading-related workflow YAMLs
  const fs = require('fs')
  const path = require('path')
  const defDir = path.join(__dirname, '..', '..', '..', 'definitions', 'workflows')
  if (fs.existsSync(defDir)) {
    const files = fs.readdirSync(defDir).filter(f => f.includes('trad') || f.includes('momentum'))
    console.log('  Trading workflow files:', files)
  }

  await client.close()
}
main().catch(e => { console.error('❌', e.message); process.exit(1) })
