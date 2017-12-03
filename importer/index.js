const fs = require('fs-extra')
const path = require('path')
const git = require('simple-git/promise')
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const USER = 'evancz'
const REPO_NAME = 'elm-todomvc'
const TMP_DIR = '_repos'

async function run () {
  console.log('run')

  try {
    console.log(`start sync ${USER}/${REPO_NAME}`)

    const context = {
      rootDir: TMP_DIR,
      user: USER,
      repoName: REPO_NAME
    }

    const repo = await fetchRepo(context)

    console.log('done')

    const package = await getPackage(context)

    console.log('package:', package)

  } catch (e) {
    console.log(e)
  }
}

async function fetchRepo ({user, repoName, rootDir}) {
  const workingDir = getWorkingDir({user, repoName, rootDir})
  let repo

  if (await fs.pathExists(path.join(workingDir, '.git'))) {
    console.log('pull')
    repo = git(workingDir)
    await repo.pull()

  } else {
    console.log(`clone https://github.com/${user}/${repoName}.git`)
    await fs.ensureDir(workingDir)
    repo = git(workingDir)
    await repo.clone(`https://github.com/${user}/${repoName}.git`, '.')
  }

  return repo
}

async function getPackage ({user, repoName, rootDir}) {
  const workingDir = getWorkingDir({user, repoName, rootDir})


  const package = await fs.readJson(path.join(workingDir, 'elm-package.json'))

  return package
}

function getWorkingDir({user, repoName, rootDir}) {
  return path.join(__dirname, `${rootDir}/${user}/${repoName}`)
}

run()