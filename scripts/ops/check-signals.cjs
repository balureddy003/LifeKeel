const { MongoClient } = require('mongodb')
const url = process.env.MONGODB_URL
async function main() {
  const client = new MongoClient(url)
  await client.connect()
  const db = client.db('lifekeel')
  const tenantId = 'reddy003'

  console.log('── Signal counts by type ──────────────────────────────────────')
  const counts = await db
    .collection('signals')
    .aggregate([
      { $match: { tenant_id: tenantId } },
      {
        $group: {
          _id: '$signal_type',
          count: { $sum: 1 },
          connectors: { $addToSet: '$connector_id' },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray()
  for (const c of counts) {
    console.log(`  ${c._id}: ${c.count} signals (connectors: ${c.connectors.join(', ')})`)
  }

  console.log('\n── Latest signals per type ─────────────────────────────────────')
  for (const c of counts) {
    const latest = await db
      .collection('signals')
      .findOne({ tenant_id: tenantId, signal_type: c._id }, { sort: { created_at: -1 } })
    console.log(
      `  ${c._id}: latest at ${latest?.created_at?.toISOString?.() ?? latest?.created_at} (${latest?.connector_id})`,
    )
    if (c._id === 'market_price') {
      console.log(
        `    latest ticker: ${latest?.data?.ticker}, price: ${latest?.data?.price}, date: ${latest?.data?.date}`,
      )
    }
    if (c._id === 'company_fundamentals') {
      console.log(
        `    latest ticker: ${latest?.data?.ticker}, gross_profit: ${latest?.data?.gross_profit}, revenue: ${latest?.data?.revenue}`,
      )
    }
  }

  console.log('\n── Market data coverage for held tickers ────────────────────────')
  const tickers = ['LIME_US_EQ', 'DPW_US_EQ']
  for (const t of tickers) {
    const marketPrices = await db.collection('signals').countDocuments({
      tenant_id: tenantId,
      signal_type: 'market_price',
      'data.ticker': t,
    })
    const fundamentals = await db.collection('signals').findOne({
      tenant_id: tenantId,
      signal_type: 'company_fundamentals',
      'data.ticker': t,
    })
    console.log(
      `  ${t}: market_price signals = ${marketPrices}, fundamentals = ${fundamentals ? 'yes' : 'no'}`,
    )
  }

  // Check all distinct tickers with market data
  console.log('\n── Tickers with market_price signals ────────────────────────────')
  const marketTickers = await db
    .collection('signals')
    .aggregate([
      { $match: { tenant_id: tenantId, signal_type: 'market_price' } },
      { $group: { _id: '$data.ticker', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .limit(20)
    .toArray()
  for (const t of marketTickers) {
    console.log(`  ${t._id}: ${t.count} price points`)
  }

  await client.close()
}
main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
