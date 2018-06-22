const _ = require('lodash/fp')
const {DateTime} = require('luxon')
const neo4j = require('neo4j-driver').v1
const {send} = require('micro')
const query = require('micro-query')
const microCors = require('micro-cors')

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

const cors = microCors({ allowMethods: ['GET'] })

module.exports = cors(async (req, res) => {
  const {q} = query(req)

  if (!q) {
    send(res, 400, 'Missing query parameter "q"')
    return
  }

  let result

  try {
    result = await runQuery(q)
  } catch (e) {
    send(res, 500, e.message)
    return
  }

  send(res, 200, result)
})

const START_DATE = DateTime.local(2012, 1, 1)
const STEP_SIZE = {months: 1}

async function runQuery (query) {
  const timeline = []

  let currentDate = START_DATE

  while (currentDate < Date.now()) {
    const result = await session.run(query, {timestamp: currentDate.toMillis()})

    const entries = result.records.map(toObject)

    // timeline.push(entries.concat([{label: 'timestamp', value: currentDate.toString()}]))
    timeline.push(entries)

    currentDate = currentDate.plus(STEP_SIZE)
  }

  return rowsToLabeledSequences(timeline)
}

function rowsToLabeledSequences (rows) {
  const sequenceNames =
    _.flow(
      _.flatMap((entries) => _.map(({label}) => label, entries)),
      _.uniq
    )(rows.map(_.identity))

  const initialSequences = _.zipObject(sequenceNames, _.map(() => [], sequenceNames))

  return _.flow(
    _.map(row => _.keyBy('label', row)),
    _.reduce((sequences, row) => {
      _.forEach(name => {
        sequences[name].push(row[name] ? row[name].value : 0)
      }, sequenceNames)
      return sequences
    }, initialSequences)
  )(rows)
}

function toObject (record) {
  const data = {}

  const obj = record.toObject()
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      data[key] = obj[key].toNumber ? obj[key].toNumber() : obj[key]
    }
  }

  return data
}
