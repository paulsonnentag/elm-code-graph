const _ = require('lodash/fp')
const git = require('simple-git/promise')
const path = require('path')
const fs = require('fs-extra')
const neo4j = require('neo4j-driver').v1
const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()
const {getGithubRepo} = require('./github-api')
const {DateTime} = require('luxon')
const axios = require('axios')
const compareVersions = require('compare-versions')

const Sema = require('async-sema')

const s = new Sema(5, {capactiy: 10000})

const WORKING_DIR = '_repos'
const MAX_COMMITS = 10000

;(async () => {
  const packages = _.keyBy(({name}) => name, (await axios.get('http://package.elm-lang.org/all-packages')).data)

  await createConstraints()

  await fs.emptyDir(path.join(__dirname, WORKING_DIR))

  const repos = await getReposToImport()

  await Promise.all(_.map(async fullName => {
    await s.acquire()

    await loadRepo(fullName, packages)

    s.release()
  }, repos))

  session.close()
  driver.close()
})()

async function getReposToImport () {
  return session.run('MATCH (repo:Repo {imported: false}) RETURN repo')
    .then(({records}) => (
      _.map(record => record.toObject().repo.properties.id, records)
    ))
}

async function createConstraints () {
  await session.run('CREATE CONSTRAINT ON (repo:Repo) ASSERT repo.id IS UNIQUE')
  await session.run('CREATE CONSTRAINT ON (repo:Repo) ASSERT exists(repo.id)')
}

async function loadRepo (fullName, packages) {
  const repo = await getGithubRepo(fullName)

  if (!repo) {
    return
  }

  const history = await getHistoryOfRepo(fullName, packages)

  if (!history) {
    return
  }

  await session.run(`
    MERGE
      (repo:Repo {id: $id})
    ON MATCH SET
      ${history.firstCommitTimestamp ? 'repo.created = $created,' : ''}
      ${history.lastCommitTimestamp ? 'repo.lastUpdated = $lastUpdated,' : ''}
      ${repo.license ? 'repo.license = $license,' : ''}
      ${repo.stars ? 'repo.stars = $stars,' : ''}
      repo.id = repo.id
  `, {
    created: history.firstCommitTimestamp,
    lastUpdated: history.lastCommitTimestamp,
    license: repo.license,
    stars: repo.stars,
    id: fullName
  })

  await Promise.all(_.map(dependency => {
    return session.run(`
      MATCH
        (ownRepo:Repo {id: $ownRepoId }),
        (dependencyRepo:Repo {id: $dependencyRepoId})
      MERGE
        (ownRepo)-[:REFERENCES_REPO { 
          start: $start, 
          ${dependency.end ? 'end: $end,' : ''}
          ${dependency.version ? 'version: $version,' : ''}
          versionRange: $versionRange 
        }]->(dependencyRepo)
    `, {
      ownRepoId: fullName,
      dependencyRepoId: dependency.name,
      start: dependency.start,
      end: dependency.end,
      version: dependency.version,
      versionRange: dependency.versionRange
    })
  }, history.dependencies))

  await session.run('MATCH (repo:Repo { id: $id }) SET repo.imported = true', {
    id: fullName
  })

  console.log(`${fullName}: imported with ${history.dependencies.length} dependencies`)
}

async function getHistoryOfRepo (fullName, packages) {
  const repoPath = path.join(__dirname, WORKING_DIR, fullName)

  await fs.emptyDir(repoPath)

  const repo = git(repoPath)

  try {
    await repo.clone(`https://github.com/${fullName}.git`, '.')
  } catch (err) {
    console.log(`${fullName}: failed to fetch repo`)
    return null
  }

  const commits = (await repo.log()).all

  console.log(`${fullName}: parse ${commits.length} commits`)

  const dependencies = await getDependencies({fullName, repo, repoPath, commits, packages})

  await fs.emptyDir(repoPath)

  return {
    dependencies,
    firstCommitTimestamp: parseTimestamp(_.first(commits).date),
    lastCommitTimestamp: parseTimestamp(_.last(commits).date)
  }
}

async function getDependencies ({fullName, repo, repoPath, commits, packages}) {
  const packageFilePath = path.join(repoPath, 'elm-package.json')
  let dependencies = []
  let currentDependencies = {}

  if (commits > MAX_COMMITS) {
    console.log(`${fullName}: skip, don't parse repo with ${commits.length} commits (max ${MAX_COMMITS})`)
    return []
  }

  if (!(await fs.pathExists(packageFilePath))) {
    console.log(`${fullName}: skip, don't parse repo without elm-package.json`)
    return []
  }

  for (let i = commits.length - 1; i >= 0; i--) {
    const commit = commits[i]
    const commitTimestamp = parseTimestamp(commit.date)

    await repo.checkout(commit.hash)

    const elmPackage = await fs.readJSON(packageFilePath)
      .catch(async (err) => {
        if (err.code === 'ENOENT') {
          return null
        }

        if (err.name === 'SyntaxError') {
          console.error(`${fullName}: ${commit.hash} Failed to parse package.json`)
          return null
        }
        return Promise.reject(err)
      })

    if (!elmPackage) {
      currentDependencies = {}
      continue
    }

    let nextDependencies = {}

    _.flow(
      _.entries,
      _.forEach(([name, versionRange]) => {
        const versions = packages[name] ? packages[name].versions : []

        const version = getAbsoluteVersion(versions, versionRange)
        const prevDependency = currentDependencies[name]
        delete currentDependencies[name]

        // no changes
        if (prevDependency && prevDependency.version === version) {
          nextDependencies[name] = prevDependency
          return
        }

        // replace previous version
        if (prevDependency) {
          dependencies.push({...prevDependency, end: commitTimestamp})
        }

        nextDependencies[name] = {name, version: version, versionRange, start: commitTimestamp}
      })
    )(elmPackage.dependencies)

    _.forEach((dependency) => {
      dependencies.push({...dependency, end: commitTimestamp})
    }, currentDependencies)

    currentDependencies = nextDependencies
  }

  dependencies = dependencies.concat(_.values(currentDependencies))

  return dependencies
}

const VERSION_REGEX = /^([0-9]+\.[0-9]+\.[0-9]+) (<=|<) v (<=|<) ([0-9]+\.[0-9]+\.[0-9]+)$/

function getAbsoluteVersion (versions, version) {
  const match = version.match(VERSION_REGEX)

  if (!match) {
    console.warn(`couldn't parse elm-version: "${version}"`)
    return version
  }

  const [, minVersion, lowerComparator, upperComparator, maxVersion] = match

  // find latest matching version
  // compareVersion: a < b => -1; a == b => 0; a > b => 1
  const absoluteVersion = _.find((absoluteVersion) => {
    const lowerComparison = compareVersions(minVersion, absoluteVersion)
    const upperComparison = compareVersions(absoluteVersion, maxVersion)

    return (
      ((lowerComparator === '<' && lowerComparison === -1) || (lowerComparator === '<=' && lowerComparison <= 0)) &&
      ((upperComparator === '<' && upperComparison === -1) || (upperComparator === '<=' && upperComparison <= 0))
    )
  }, versions)

  if (absoluteVersion) {
    return absoluteVersion
  }

  return version
}

function parseTimestamp (date) {
  return DateTime.fromFormat(date, 'yyyy-MM-dd hh:mm:ss ZZZ').toMillis()
}
