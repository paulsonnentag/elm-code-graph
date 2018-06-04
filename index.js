const _ = require('lodash/fp')
const {importRepo, ImporterError} = require('./importer')
const fs = require('fs-extra')
const axios = require('axios')
const neo4j = require('neo4j-driver').v1

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

const PAGE_SIZE = 10

;(async () => {
  try {
    let currentPage = 1

    do {
      const response = await axios.get(`https://api.github.com/search/repositories?q=language:elm&per_page=${PAGE_SIZE}&page=${currentPage}`)
      const repos = response.data.items

      totalResults = response.data.total_count
      currentPage++

      for (let i = 0; i < repos.length; i++) {
        const repo = repos[i];

        try {
          await loadRepo({
            stars: repo.stargazers_count,
            owner: repo.owner.login,
            name: repo.name,
            lastUpdated: repo.updated_at,
            license: repo.license.key
          })
        } catch (err) {
          console.error('Failed import, Unexpected Error:', err)
        }
      }
    } while (((currentPage - 1) * PAGE_SIZE) < totalResults)

  } catch (err) {
    console.error(err)
  }

  process.exit();

})()

async function loadRepo (repo) {
  const {owner, stars, lastUpdated, license, name} = repo
  const timestamp = Date.now()
  console.log(`${owner}/${name} start import`)

  let references = []

  try {
    await importRepo({owner, name})
  } catch (err) {
    if (err instanceof ImporterError) {
      console.error('Importer Error:', err.message)
    } else {
      throw err
    }
  }

  await fs.writeFile(`_references/${owner}_${name}.json`, JSON.stringify(references, null, 2))

  await addRepoMetaDataToGraph(repo)

  await addReferencesToGraph(references)

  const duration = Math.round((Date.now() - timestamp) / 1000)

  console.log(`${owner}/${name} successfully imported ${references.length} reference(s) in ${duration} second(s)`)
}

async function addRepoMetaDataToGraph ({owner, stars, lastUpdated, license, name}) {
  await session.run(`
    MERGE
      (project:Project {id: $project})
    ON MATCH SET
      p.lastUpdated = $lastUpdated,
      p.license = $license,
      p.starts = $stars
    ON CREATE SET
      p.lastUpdated = $lastUpdated,
      p.license = $license,
      p.starts = $stars
  `, {
    project: `${owner}/${name}`,
    lastUpdated,
    license,
    stars
  })
}

async function addReferencesToGraph (references) {
  // ensure referenced projects, modules and symbols exist
  await Promise.all(_.flow(
    _.flatMap(({referer, referred, symbol}) => [
      {project: referer.project, module: referer.module, symbol: []},
      {project: referred.project, module: referred.module, symbol: [symbol]},
    ]),
    _.groupBy(({project}) => project),
    _.entries,
    _.map(async ([project, references]) => {

      const res = await session.run(`
          MERGE (project:Project { id: $project })          
        `, {project})

      await Promise.all(_.flow(
        _.groupBy(({module}) => module),
        _.entries,
        _.map(async ([module, references]) => {
          await session.run(`
              MATCH 
                (project:Project { id: $project}) 
              MERGE 
                (project)-[:HAS_MODULE]->(module:Module { id: $project + "/" + $module, name: $module })
            `, {project, module})

          await Promise.all(_.flow(
            _.flatMap(({symbol}) => symbol),
            _.uniq,
            _.map(async symbol => {
              await session.run(`
                  MATCH 
                    (module:Module { id: $project + "/" + $module })
                  MERGE 
                    (module)-[:HAS_SYMBOL]->(symbol:Symbol { id: $project + "/" + $module + "." + $symbol, name: $symbol })
                `, {project, module, symbol})
            })
          )(references))
        }),
      )(references))
    })
  )(references))

  // create reference edges
  await Promise.all(_.map(async ({referer, referred, symbol, url}) => {
    await session.run(`
        MATCH 
          (module:Module { id: $module }),
          (symbol:Symbol { id: $symbol }) 
        MERGE 
          (module)-[:REFERENCES { url: $url }]->(symbol)
      `, {
      symbol: `${referred.project}/${referred.module}.${symbol}`,
      module: `${referer.project}/${referer.module}`,
      url: url
    })
  }, references))
}