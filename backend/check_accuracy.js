const dotenv = require('dotenv');
dotenv.config();
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
client.connect().then(async () => {
  const db = client.db('probability_os');
  const snaps = await db.collection('feature_snapshots')
    .find({ model_prob_yes: { $ne: null }, settlement_outcome: { $ne: null } })
    .toArray();
  console.log('Settled snaps with model data:', snaps.length);
  const buckets = { '0-5%': [], '6-10%': [], '11-20%': [], '20%+': [] };
  snaps.forEach(s => {
    const diff = Math.abs((s.model_prob_yes || 0) - (s.market_prob_yes || 0));
    const won = s.settlement_outcome === 'YES';
    if (diff <= 5) buckets['0-5%'].push(won);
    else if (diff <= 10) buckets['6-10%'].push(won);
    else if (diff <= 20) buckets['11-20%'].push(won);
    else buckets['20%+'].push(won);
  });
  Object.entries(buckets).forEach(([label, results]) => {
    if (!results.length) return console.log(label + ': no data yet');
    const wr = (results.filter(Boolean).length / results.length * 100).toFixed(1);
    console.log(label + ' disagreement: ' + results.length + ' trades, ' + wr + '% win rate');
  });
  await client.close();
}).catch(console.error);
