const _ = require('lodash/fp')
const fs = require('fs-extra')
const path = require('path')
const {DateTime} = require('luxon')
const neo4j = require('neo4j-driver').v1

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

const query = `
  MATCH (r:Repo) WHERE r.lastUpdated <= $timestamp AND r.created >= $timestamp RETURN count(r) as value, 'activeRepos' as key 
`

/*
const query = `
  MATCH (r1:Repo)-[ref:REFERENCES_REPO]->(r2:Repo)
  WHERE 
    r2.id in ["rtfeldman/elm-css", "mdgriffith/style-elements"] AND 
    (ref.start < $timestamp AND (ref.end > $timestamp OR (NOT EXISTS(ref.end))))
  RETURN r2.id as key, count(distinct(r1.id)) as value
`
*/

const START_DATE = DateTime.local(2012, 1, 1)
const STEP_SIZE = {months: 1}

const timeline = []

;(async () => {
  let currentDate = START_DATE

  while (currentDate < Date.now()) {
    const result = await session.run(query, {timestamp: currentDate.toMillis()})

    const entries = result.records
      .map(toObject)

    timeline.push(entries.concat([{key: 'timestamp', value: currentDate.toString()}]))

    currentDate = currentDate.plus(STEP_SIZE)
  }

  await fs.writeJson(path.join(__dirname, 'data/graphs/repos-active.json'), rowsToLabeledSequences(timeline), {spaces: 2})

  console.log('done')

  session.close()
  driver.close()
})()

function rowsToLabeledSequences (rows) {
  const sequenceNames =
    _.flow(
      _.flatMap((entries) => _.map(({key}) => key, entries)),
      _.uniq
    )(rows.map(_.identity))

  const initialSequences = _.zipObject(sequenceNames, _.map(() => [], sequenceNames))

  return _.flow(
    _.map(row => _.keyBy('key', row)),
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
