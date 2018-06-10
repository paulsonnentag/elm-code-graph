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

  const rawReferences = await getAllReferences(context)

  return Promise.all(
    _.map(async reference => {
      const fileAbsPath = reference.file.split(REPO_DIR)[1].slice(1)
      const fileRelPath = reference.file.split(`${owner}/${name}`)[1].slice(1)
      const refererModule = await getModuleOfFile(reference.file)

      const startLine = reference.region.start.line
      const endLine = reference.region.end.line
      const lineSelector = startLine === endLine ? `L${startLine}` : `L${startLine}:${endLine}`
      const normalizedOwner = owner === 'elm-lang' ? 'elm' : owner // Fix because elm repo is listed as elm-lang in dependencies
      const url = `https://github.com/${normalizedOwner}/${name}/blob/${latestCommit.hash}${fileRelPath}#${lineSelector}`

      return {
        symbol: reference.symbol,
        region: reference.region,
        url,
        version: reference.version,
        referer: {
          repo: `${owner}/${name}`,
          file: fileAbsPath,
          module: refererModule
        },

        referred: {
          repo: `${reference.user}/${reference.project}`,
          file: reference.moduleFile,
          module: reference.module
        }
      }
    }, rawReferences)
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

async function getPackage (workingDir) {
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

async function resolveDependencies (workingDir) {
  // install packages
  await execWithDefaultErrorHandler(`lib/install.sh ${workingDir}`)

  return fs.readJson(path.join(workingDir, 'elm-stuff/exact-dependencies.json'))
}

const MODULE_NAME_REGEX = /module ([\w.]+)/
const getModuleOfFile = _.memoize(async path => {
  let file

  try {
    file = await fs.readFile(path, 'utf-8')
  } catch (err) {
    throw new ImporterError(`Can't extract module because of invalid path: ${path}`)
  }

  const match = file.match(MODULE_NAME_REGEX)

  if (!match) {
    return null
  }

  return match[1]
})

async function getFileOfModule ({workingDir, owner, name, module, version}) {
  let repoPath

  if (!version) { // local reference
    repoPath = workingDir
  } else {
    repoPath = path.join(workingDir, 'elm-stuff/packages', owner, name, version)
  }

  const pckg = await fs.readJson(path.join(repoPath, 'elm-package.json'))
  const srcDirs = pckg['source-directories']

  const modulePath = `${module.split('.').join('/')}.elm`

  const pathCandidates = []

  for (let i = 0; i < srcDirs.length; i++) {
    const pathCandidate = path.join(repoPath, srcDirs[i], modulePath)
    pathCandidates.push(pathCandidate)
    if (await fs.pathExists(pathCandidate)) {
      return path.join(owner, name, srcDirs[i], modulePath)
    }
  }

  if (module === 'Main') {
    console.log(`Couldn't find file of module Main: ${modulePath},  fine is self reference`)
    return
  }

  throw new ImporterError(`Couldn't find file of module ${modulePath}`)
}

async function getAllReferences ({owner, name}) {
  const elmPackages = await getElmPackages({owner, name})

  return _.flow(
    _.map(({root, files}) => getReferences({workingDir: root, files, owner, name})),
    _.thru(references => Promise.all(references)),
    _.thru(async references => _.flatten(await references))
  )(elmPackages)
}

async function getReferences ({owner, name, workingDir, files}) {
  const pckg = await getPackage(workingDir)

  const dependencies = await resolveDependencies(workingDir)
  dependencies[`${owner}/${pckg.name}`] = pckg.version

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

  return _.flow(
    _.map(async reference => {
      const moduleFile =
        await getFileOfModule({
          workingDir,
          owner: reference.user,
          name: reference.project,
          module: reference.module,
          version: dependencies[`${reference.user}/${reference.project}`]
        })

      if (!moduleFile) {
        return []
      }

      return [{
        ...reference,
        moduleFile,
        file: !reference.file.startsWith('/') ? `/${reference.file}` : path.join(workingDir, reference.file)
      }]
    }),
    _.thru(refs => Promise.all(refs)),
    _.thru(async refs => _.flatten(await refs))
  )(references)
}

async function getElmPackages ({owner, name}) {
  // get folders which have elm-package.json
  const roots =
    _.flow(
      _.filter(path => path.indexOf('/elm-stuff/') === -1),
      _.sortBy(path => -path.length),
      _.map(path => path.slice(0, -('/elm-package.json'.length)))
    )(await glob(path.join(__dirname, REPO_DIR, owner, name, '**/elm-package.json')))

  // get elm files
  const files = await glob(path.join(__dirname, REPO_DIR, owner, name, '**/*.elm'))

  // group files by root to which they belong
  const elmPackages = _.flow(
    _.flatMap((file) => {
      const root = _.find((root) => file.indexOf(root) === 0, roots)

      if (root === undefined) {
        return []
      }

      return [{root, file}]
    }),
    _.groupBy(({root}) => root),
    _.entries,
    _.map(([root, files]) => {
      return {
        root,
        files: _.flow( // remove elm-stuff files
          _.filter(({file, root}) => file.indexOf('/elm-stuff') === -1),
          _.map(({file}) => file)
        )(files)
      }
    })
  )(files)

  return elmPackages
}

async function compileFile (workingDir, file) {
  const lines = (await execWithDefaultErrorHandler(`lib/make.sh ${workingDir} ${file}`)).split(
    '\n'
  )
  const VALUE_REGEX = /External value [(`](.*)[`)] exists!!Canonical {_package = Name {_user = "(.*)", _project = "(.*)"}, _module =\s"(.*)"}/m

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

      const normalizedMessage = message.overview.replace('\n', ' ')
      const match = normalizedMessage.match(VALUE_REGEX)

      if (!match) {
        console.warn(`couldn't parse message: "${normalizedMessage}"`)
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
  let {stdout, stderr} = await exec(cmd, {maxBuffer: 1024 * 10000})

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
