const _ = require('lodash/fp')
const util = require('util')
const fs = require('fs-extra')
const path = require('path')
const glob = util.promisify(require('glob'))
const exec = util.promisify(require('child_process').exec)
const git = require('simple-git/promise')
const compareVersions = require('compare-versions')

const ELM_VERSION = '0.18.0'

const MAIN_FILE_REGEX = new RegExp(
  _.map(file => `(${file}$)`, ['main.elm', 'index.elm', 'app.elm']).join('|'),
  'gi'
)

const REPO_DIR = '_repos'

async function importRepo (context) {
  const {owner, name} = context

  const repo = await fetchRepo(context)
  const latestCommit = await getLatestCommit(repo)
  const dependencies = await resolveDependencies(context)
  const pckg = await getPackage(context)

  dependencies[`${owner}/${name}`] = pckg.version

  return Promise.all(
    _.map(async reference => {
      const filePath = !reference.file.startsWith('/')
        ? '/' + reference.file
        : path.join(__dirname, REPO_DIR, owner, name, reference.file)
      const [, fileRepoPath] = filePath.split(REPO_DIR)
      const refererModule = await getModuleOfFile(filePath)
      const version = dependencies[`${reference.user}/${reference.project}`]

      const referredFile = await getFileOfModule({
        baseRepo: {owner, name},
        subRepo: {
          version,
          owner: reference.user,
          name: reference.project,
          module: reference.module
        },
        rootDir: REPO_DIR
      })

      const startLine = reference.region.start.line
      const endLine = reference.region.end.line
      const lineSelector = startLine === endLine ? `L${startLine}` : `L${startLine}:${endLine}`
      const url = `https://github.com/${owner === 'elm-lang' ? 'elm' : owner}/${name}/blob/${latestCommit.hash}${reference.file}#${
        lineSelector
      }`

      return {
        symbol: reference.symbol,
        region: reference.region,
        url,
        version,

        referer: {
          repo: `${owner}/${name}`,
          file: fileRepoPath.slice(1),
          module: refererModule
        },

        referred: {
          repo: `${reference.user}/${reference.project}`,
          file: referredFile,
          module: reference.module
        }
      }
    }, await getReferences(context))
  )
}

async function fetchRepo ({owner, name}) {
  const workingDir = getWorkingDir({owner, name})
  let repo

  if (await fs.pathExists(path.join(workingDir, '.git'))) {
    repo = git(workingDir)
    await repo.pull()
  } else {
    await fs.ensureDir(workingDir)
    repo = git(workingDir)
    await repo.clone(`https://github.com/${owner}/${name}.git`, '.')
  }

  return repo
}

const VERSION_REGEX = /^([0-9]+\.[0-9]+\.[0-9]+) <= v < ([0-9]+\.[0-9]+\.[0-9]+)$/

async function getPackage ({owner, name}) {
  const workingDir = getWorkingDir({owner, name})

  let pckg

  try {
    pckg = await fs.readJson(path.join(workingDir, 'elm-package.json'))
  } catch (err) {
    try {
      pckg = await fs.readJson(path.join(workingDir, 'elm.json'))
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ImporterError(`repository doesn't have "elm-package.json"`)
      }

      throw err
    }
  }

  const version = pckg['elm-version']
  const match = version.match(VERSION_REGEX)

  if (!match) {
    throw new ImporterError(`couldn't parse elm-version: "${version}"`)
  }

  const [, minVersion, maxVersion] = match

  // compareVersion: a < b => -1; a == b => 0; a > b => 1
  if (
    compareVersions(ELM_VERSION, minVersion) === -1 ||
    compareVersions(ELM_VERSION, maxVersion) >= 0
  ) {
    throw new ImporterError(
      `current version "${ELM_VERSION}" doesn't match required version "${version}"`
    )
  }

  return pckg
}

async function getLatestCommit (repo) {
  return (await repo.log()).latest
}

async function resolveDependencies ({owner, name, rootDir}) {
  const workingDir = getWorkingDir({owner, name, rootDir})

  // install packages
  await execWithDefaultErrorHandler(`lib/install.sh ${workingDir}`)

  return fs.readJson(path.join(workingDir, 'elm-stuff/exact-dependencies.json'))
}

const MODULE_NAME_REGEX = /module ([\w.]+)/
const getModuleOfFile = _.memoize(async path => {
  const file = await fs.readFile(path, 'utf-8')
  const match = file.match(MODULE_NAME_REGEX)

  if (!match) {
    return null
  }

  return match[1]
})

async function getFileOfModule ({baseRepo, subRepo, rootDir}) {
  let repoPath
  const basePath = path.join(rootDir, baseRepo.owner, baseRepo.name)

  if (baseRepo.owner === subRepo.owner && baseRepo.name === subRepo.name) {
    repoPath = basePath
  } else {
    const subPath = path.join('elm-stuff/packages', subRepo.owner, subRepo.name, subRepo.version)
    repoPath = path.join(__dirname, basePath, subPath)
  }

  const pckg = await fs.readJson(path.join(repoPath, 'elm-package.json'))

  const srcDirs = pckg['source-directories']

  const modulePath = `${subRepo.module.split('.').join('/')}.elm`

  for (let i = 0; i < srcDirs.length; i++) {
    const pathCandidate = path.join(repoPath, srcDirs[i], modulePath)
    if (await fs.pathExists(pathCandidate)) {
      return path.join(subRepo.owner, subRepo.name, srcDirs[i], modulePath)
    }
  }

  throw new ImporterError(`Couldn't find file of module ${modulePath}`)
}

async function getReferences ({owner, name, rootDir}) {
  const workingDir = getWorkingDir({owner, name, rootDir})
  const paths = await glob(path.join(workingDir, '**/*.elm'))
  const files = _.flow(
    _.map(path => _.drop(workingDir.length, path).join('')),
    _.reject(_.startsWith('/elm-stuff'))
  )(paths)
  const [mainFiles, regularFiles] = _.partition(file => MAIN_FILE_REGEX.test(file), files)

  let queue = mainFiles.concat(regularFiles)
  let references = []

  // clear build artifacts from previous build
  await fs.emptyDir(path.join(workingDir, 'elm-stuff/build-artifacts'))

  while (!_.isEmpty(queue)) {
    let currentFileName = _.first(queue)

    let resolvedFiles = {[currentFileName]: true}

    try {
      let newReferences = await compileFile(workingDir, _.first(queue))
      resolvedFiles = _.reduce(
        (map, {file}) => Object.assign(map, {[file]: true}),
        resolvedFiles,
        newReferences
      )
      references = references.concat(newReferences)

      console.log(`compile ${currentFileName}: success`)
    } catch (e) {
      console.warn(`compile ${currentFileName}: failed`)
      if (currentFileName.startsWith('/tests/') || currentFileName.startsWith('/test/')) {
        console.log('fine is test')
      } else {
        console.log(`\n${e}\n`)
      }
    }

    queue = queue.filter(file => !resolvedFiles[file])
  }

  return references
}

async function compileFile (workingDir, file) {
  const filePath = path.join(workingDir, file)
  const lines = (await execWithDefaultErrorHandler(`lib/make.sh ${workingDir} ${filePath}`)).split(
    '\n'
  )
  const VALUE_REGEX = /External value [(`](.*)[`)] exists!!Canonical {_package = Name {_user = "(.*)", _project = "(.*)"}, _module = "(.*)"}/m

  return _.flow(
    _.flatMap(line => {
      let obj = []
      try {
        obj = JSON.parse(line)
      } catch (e) {}
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

      const [, symbol, user, project, module] = match

      // ignore project internal references for now
      // TODO: handle local references
      if (user === 'user' && project === 'project') {
        return null
      }

      return {
        user,
        project,
        module,
        symbol: symbol,
        region: message.region,
        file: message.file.slice(1)
      }
    }),
    _.compact
  )(lines)
}

async function execWithDefaultErrorHandler (cmd) {
  let {stdout, stderr} = await exec(cmd, {maxBuffer: 1024 * 1000})

  if (stderr) {
    throw new Error(stderr)
  }

  return stdout
}

function getWorkingDir ({owner, name}) {
  return path.join(__dirname, REPO_DIR, owner, name)
}

class ImporterError extends Error {
  constructor (...args) {
    super(...args)
    Error.captureStackTrace(this, ImporterError)
  }
}

module.exports = {
  ImporterError,
  importRepo
}
