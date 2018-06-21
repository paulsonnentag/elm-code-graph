const _ = require('lodash/fp')
const path = require('path')
const neo4j = require('neo4j-driver').v1
const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

;(async () => {
  const repos = require(path.join(__dirname, 'data/repos.json'))
  const inserts = await Promise.all(_.map(repo => {
    return session.run(`
      MERGE 
        (repo:Repo { id: $repo })
      ON CREATE SET 
        repo.imported = false 
    `, {repo})
  }, repos))

  const nodeCount = _.reduce((sum, insert) => sum + insert.summary.counters._stats.nodesCreated, 0, inserts)

  console.log(`Imported ${nodeCount} new repo(s)`)

  session.close()
  driver.close()
})()
