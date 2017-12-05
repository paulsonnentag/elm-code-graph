const _ = require('lodash/fp')
const util = require('util')
const fs = require('fs-extra')
const path = require('path')
const glob = util.promisify(require('glob'))
const exec = util.promisify(require('child_process').exec)
const git = require('simple-git/promise')
const compareVersions = require('compare-versions')

const ELM_VERSION = '0.18.0'

const MAIN_FILE_REGEX =
  new RegExp(
    _.map(file => `(${file}$)`, [
      'main.elm',
      'index.elm',
      'app.elm',
    ])
      .join('|')
    ,
    'gi'
  )

importRepo({
  rootDir: '_repos',
  user: 'evancz',
  repoName: 'start-app'
})

async function importRepo(context) {
  const { rootDir, user, repoName } = context


  try {
    console.log(`import ${user}/${repoName}`)

    const repo = await fetchRepo(context)
    const latestCommit = await getLatestCommit(repo)
    const package = await getPackage(context)

    const dependencies = await resolveDependencies(context)

    console.log('latest commit:', latestCommit)
    console.log('package:', package)
    console.log('dependencies:', dependencies)

    const symbols = await getReferences(context)

    console.log('symbols:', symbols)

  } catch (err) {
    if (!(err instanceof ImporterError)) {
      throw err
    }

    console.log('Failed:', err.message)
  }
}

async function fetchRepo({ user, repoName, rootDir }) {
  const workingDir = getWorkingDir({ user, repoName, rootDir })
  let repo

  if (await fs.pathExists(path.join(workingDir, '.git'))) {
    console.log('pull')
    repo = git(workingDir)
    // await repo.pull()

  } else {
    console.log('clone')
    await fs.ensureDir(workingDir)
    repo = git(workingDir)
    await repo.clone(`https://github.com/${user}/${repoName}.git`, '.')
  }

  return repo
}

const VERSION_REGEX = /^([0-9]+\.[0-9]+\.[0-9]+) <= v < ([0-9]+\.[0-9]+\.[0-9]+)$/

async function getPackage({ user, repoName, rootDir }) {
  const workingDir = getWorkingDir({ user, repoName, rootDir })

  let package

  try {
    package = await fs.readJson(path.join(workingDir, 'elm-package.json'))
  } catch (err) {
    if (err.code == 'ENOENT') {
      throw new ImporterError(`repository doens't have "elm-package.json"`)
    }

    throw err
  }

  const version = package['elm-version']
  const match = version.match(VERSION_REGEX)

  if (!match) {
    throw new ImporterError(`couldn't parse elm-version: "${version}"`)
  }

  const [, minVersion, maxVersion] = match

  // compareVersion: a < b => -1; a == b => 0; a > b => 1
  if (compareVersions(ELM_VERSION, minVersion) == -1 || compareVersions(ELM_VERSION, maxVersion) >= 0) {
    throw new ImporterError(`current version "${ELM_VERSION}" doesn't match required version "${version}"`)
  }

  console.log('version is fine!', ELM_VERSION, minVersion, maxVersion)

  return package
}

async function getLatestCommit(repo) {
  return (await repo.log()).latest
}

async function resolveDependencies({ user, repoName, rootDir }) {
  const workingDir = getWorkingDir({ user, repoName, rootDir })

  // install packages
  await execWithDefaultErrorHandler(`lib/install.sh ${workingDir}`)

  return await fs.readJson(path.join(workingDir, 'elm-stuff/exact-dependencies.json'))
}

async function getReferences({ user, repoName, rootDir }) {
  const workingDir = getWorkingDir({ user, repoName, rootDir })
  const paths = await glob(path.join(workingDir, '**/*.elm'))
  const files = _.flow(
    _.map(path => _.drop(workingDir.length, path).join('')),
    _.reject(_.startsWith('/elm-stuff'))
  )(paths)

  console.log(files)

  const [mainFiles, regularFiles] = _.partition(file => MAIN_FILE_REGEX.test(file), files)

  let queue = mainFiles.concat(regularFiles)
  let references = []

  // clear build artifacts from previous build
  await fs.emptyDir(path.join(workingDir, 'elm-stuff/build-artifacts'))

  console.log('total files:', queue.length)

  while (!_.isEmpty(queue)) {
    let current = _.first(queue)

    let newReferences = await compileFile(workingDir, _.first(queue))
    let resolvedFiles = _.reduce((map, { file }) => Object.assign(map, { [file]: true }), {}, newReferences)

    references = references.concat(newReferences)
    queue = queue.filter(file => !resolvedFiles[file] && file !== current)

    console.log('compiled', current, 'with dependen files: ', _.keys(resolvedFiles).length, ' references: ', newReferences.length)
  }

  return references
}

async function compileFile(workingDir, file) {
  const filePath = path.join(workingDir, file)
  const lines = (await execWithDefaultErrorHandler(`lib/make.sh ${workingDir} ${filePath}`)).split('\n')

  const VALUE_REGEX = /External value [(`](.*)[`)] exists!!Canonical \{_package = Name \{_user = "(.*)", _project = "(.*)"}, _module = "(.*)"}/m

  const log =
    _.flow(
      _.flatMap(line => {
        let obj = []
        try { obj = JSON.parse(line) } catch (e) { }
        return obj
      }),
      _.map(message => {
        if (message.tag !== 'external value') {
          return null
        }

        const match = message.overview.replace('\n', ' ').match(VALUE_REGEX)

        if (!match) {
          console.warn(`couldn't parse message: "${message.overview}"`)
          return null
        }

        const [symbol, user, project, module] = match

        return {
          user, project, module,
          symbol: symbol,
          region: message.region,
          file: message.file.slice(1),
        }
      }),
      _.compact
    )(lines)

  return log
}

async function execWithDefaultErrorHandler(cmd) {
  let { stdout, stderr } = await exec(cmd, { maxBuffer: 1024 * 1000 })

  if (stderr) {
    throw new Error(stderr)
  }

  return stdout
}

function getWorkingDir({ user, repoName, rootDir }) {
  return path.join(__dirname, `${rootDir}/${user}/${repoName}`)
}

class ImporterError extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, ImporterError)
  }
}

module.exports = {
  ImporterError,
  importRepo
}