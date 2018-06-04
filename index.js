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
    let totalResults = Infinity

    await createConstraints()

    do {
      const response = await axios.get(
        `https://api.github.com/search/repositories?q=language:elm&per_page=${PAGE_SIZE}&page=${
          currentPage
        }`
      )
      const repos = response.data.items

      totalResults = response.data.total_count
      currentPage++

      for (let i = 0; i < repos.length; i++) {
        const repo = repos[i]

        try {
          await loadRepo({
            stars: repo.stargazers_count,
            owner: repo.owner.login === 'elm' ? 'elm-lang' : repo.owner.login,
            name: repo.name,
            lastUpdated: repo.updated_at,
            license: repo.license.key
          })
        } catch (err) {
          console.error('Failed import, Unexpected Error:', err)
        }
      }
    } while ((currentPage - 1) * PAGE_SIZE < totalResults)
  } catch (err) {
    console.error(err)
  }

  process.exit()
})()

async function createConstraints () {
  await session.run('CREATE CONSTRAINT ON (repo:Repo) ASSERT repo.id IS UNIQUE')
  await session.run('CREATE CONSTRAINT ON (repo:Repo) ASSERT exists(repo.id)')
  await session.run('CREATE CONSTRAINT ON (file:File) ASSERT file.id IS UNIQUE')
  await session.run('CREATE CONSTRAINT ON (file:File) ASSERT exists(file.id)')
  await session.run('CREATE CONSTRAINT ON (symbol:Symbol) ASSERT symbol.id IS UNIQUE')
  await session.run('CREATE CONSTRAINT ON (symbol:Symbol) ASSERT exists(symbol.id)')
}

async function loadRepo (repo) {
  const {owner, name} = repo
  const timestamp = Date.now()
  console.log(`${owner}/${name} start import`)

  let references = []

  try {
    references = await importRepo({owner, name})
  } catch (err) {
    if (err instanceof ImporterError) {
      console.error('Importer Error:', err)
    } else {
      throw err
    }
  }

  await fs.writeFile(`_references/${owner}_${name}.json`, JSON.stringify(references, null, 2))

  await addRepoMetaDataToGraph(repo)

  await addReferencesToGraph(references)

  const duration = Math.round((Date.now() - timestamp) / 1000)

  console.log(
    `${owner}/${name} successfully imported ${references.length} reference(s) in ${
      duration
    } second(s)`
  )
}

async function addRepoMetaDataToGraph ({owner, stars, lastUpdated, license, name}) {
  await session.run(
    `
    MERGE
      (repo:Repo {id: $repo})
    ON MATCH SET
      repo.lastUpdated = $lastUpdated,
      repo.license = $license,
      repo.stars = $stars
    ON CREATE SET
      repo.lastUpdated = $lastUpdated,
      repo.license = $license,
      repo.stars = $stars
  `,
    {
      repo: `${owner}/${name}`,
      lastUpdated,
      license,
      stars
    }
  )
}

async function addReferencesToGraph (references) {
  // ensure referenced projects, modules and symbols exist
  await Promise.all(
    _.flow(
      _.flatMap(({referer, referred, symbol}) => [
        {repo: referer.repo, module: referer.module, file: referer.file, symbol: []},
        {repo: referred.repo, module: referred.module, file: referred.file, symbol: [symbol]}
      ]),
      _.groupBy(({repo}) => repo),
      _.entries,
      _.map(async ([repo, references]) => {
        // create repo
        await session.run(
          `
        MERGE (repo:Repo { id: $repo })          
      `,
          {repo}
        )

        await Promise.all(
          _.flow(
            _.groupBy(({file}) => file),
            _.entries,
            _.map(async ([file, references]) => {
              const module = references[0].module

              // create files of repo
              await session.run(
                `
            MATCH 
              (repo:Repo { id: $repo }) 
            MERGE 
              (repo)-[:HAS_FILE]->(file:File { id: $file, module: $repo + "/" + $module, name: $name  })
          `,
                {
                  repo,
                  file,
                  module,
                  name: file.slice(repo.length)
                }
              )

              await Promise.all(
                _.flow(
                  _.flatMap(({symbol}) => symbol),
                  _.uniq,
                  _.map(async symbol => {
                    // create symbols of file
                    await session.run(
                      `
                MATCH 
                  (file:File { id: $file })
                MERGE 
                  (file)-[:DEFINES_SYMBOL]->(symbol:Symbol { id: $id, name: $symbol })
              `,
                      {
                        file,
                        symbol,
                        id: `${file.slice(0, -4)}.${symbol}`
                      }
                    )
                  })
                )(references)
              )
            })
          )(references)
        )
      })
    )(references)
  )

  // create reference edges
  await Promise.all(
    _.map(async ({referer, referred, symbol, url, version}) => {
      await session.run(
        `
        MATCH 
          (file:File { id: $fileId }),
          (symbol:Symbol { id: $symbolId }) 
        MERGE 
          (file)-[:REFERENCES_SYMBOL { url: $url, version: $version }]->(symbol)
      `,
        {
          symbolId: `${referred.file.slice(0, -4)}.${symbol}`,
          fileId: referer.file,
          url,
          version
        }
      )
    }, references)
  )
}
