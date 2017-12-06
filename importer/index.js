const _ = require('lodash/fp')
const MongoClient = require('mongodb').MongoClient
const {importRepo, ImporterError} = require('./importer')

const DB_URL = 'mongodb://localhost:27017/elm'

async function run () {

  try {
    const db = await MongoClient.connect(DB_URL)
    const col = await db.collection('references')

    console.log('start import')

    const {references, hash} = await importRepo({
      rootDir: '_repos',
      user: 'rtfeldman',
      repoName: 'elm-spa-example'
    })

    console.log('find and remove', { commit: hash })

    // clear previous values
    await col.deleteMany({ commit: hash })

    // insert new references
    await col.insertMany(references)

    console.log(`imported ${references.length} reference(s)`)

    db.close()

  } catch (err) {
    if (err instanceof ImporterError) {
      console.log('Importer Error:', err.message)
    } else {
      throw err
    }
  }
}

run()