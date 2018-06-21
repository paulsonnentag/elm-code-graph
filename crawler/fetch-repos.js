const _ = require('lodash/fp')
const axios = require('axios')
const fs = require('fs-extra')
const { searchElmRepos } = require('./github-api')
const path = require('path')

;(async () => {
  let allRepos = []

  console.log('elm packages:')
  const elmPackageRepos = await getElmPackageRepos()
  allRepos = mergeRepos(allRepos, elmPackageRepos)

  console.log('github search:')
  const githubSearchRepos = await getGithubSearchRepos()
  allRepos = mergeRepos(allRepos, githubSearchRepos)

  console.log(`all repos ${allRepos.length} repo(s)`)

  await fs.writeJSON(path.join(__dirname, 'data/repos.json'), allRepos.sort(), {spaces: 2})
})()

function mergeRepos (allRepos, newRepos) {
  const mergedRepos = _.uniq(allRepos.concat(newRepos))

  console.log(`+ ${mergedRepos.length - allRepos.length} repo(s)`)

  return mergedRepos
}

async function getElmPackageRepos () {
  return _.map(({name}) => name, (await axios.get('http://package.elm-lang.org/all-packages')).data)
}

async function getGithubSearchRepos () {
  const PAGE_SIZE = 100
  const MAX_PAGE = 10

  let searchRepos = []
  let currentPage = 1
  let lastCommitted

  while (true) {
    console.log(`page ${currentPage}, date: ${lastCommitted}`)

    const { total, repos } = await searchElmRepos({ pageSize: PAGE_SIZE, page: currentPage, lastCommitted })

    const newRepos = _.map(repo => repo['full_name'], repos)

    console.log(`total: ${total}, repos: ${newRepos.slice(0, 5).join(',')}`)

    searchRepos = searchRepos.concat(newRepos)

    if (currentPage * PAGE_SIZE < total) {
      if (currentPage < MAX_PAGE) {
        currentPage++
      } else {
        currentPage = 1
        lastCommitted = _.last(repos).pushed_at.slice(0, 10)
      }
      continue
    }

    break
  }

  return searchRepos
}
