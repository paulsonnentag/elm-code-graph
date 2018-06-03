const _ = require('lodash/fp')
const {importRepo, ImporterError} = require('./importer')
const fs = require('fs-extra')

const neo4j = require('neo4j-driver').v1

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

;(async () => {
  try {

    await loadRepo({
      rootDir: '_repos',
      user: 'rtfeldman',
      repoName: 'elm-spa-example'
    })

    await session.close()

  } catch (err) {
    if (err instanceof ImporterError) {
      console.error('Importer Error:', err.message)
    } else {
      console.error('Unexpected Error:', err)
    }
  }
})()

async function loadRepo ({rootDir, user, repoName}) {
  console.log(`${user}/${repoName} start import`)

  const references = await importRepo({rootDir, user, repoName})

  await fs.writeFile(`_references/${user}_${repoName}.json`, JSON.stringify(references, null, 2))

  await addReferencesToGraph(references)

  console.log(`${user}/${repoName} successfully imported ${references.length} reference(s)`)
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