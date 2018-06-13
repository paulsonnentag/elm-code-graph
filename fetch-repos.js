const _ = require('lodash/fp')
const axios = require('axios')
const fs = require('fs-extra')
const { searchElmRepos } = require('./github-api')
const path = require('path')

;(async () => {
  let allRepos = []

  console.log('big query:')
  const bigQueryRepos = await getBigQueryRepos()
  allRepos = mergeRepos(allRepos, bigQueryRepos)

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

async function getBigQueryRepos () {
  return _.map(repo => repo['repo_name'], await fs.readJSON('./data/big-query-result.json'))
}

async function getElmPackageRepos () {
  return _.map(({name}) => name, (await axios.get('http://package.elm-lang.org/all-packages')).data)
}

async function getGithubSearchRepos () {
  const PAGE_SIZE = 100
  const MAX_RESULTS = 1000

  let currentPage = 1
  let searchRepos = []
  let totalResults

  do {
    const { total, repos } = await searchElmRepos({ pageSize: PAGE_SIZE, page: currentPage })
    totalResults = total

    console.log(`import page ${currentPage}`)

    currentPage++

    searchRepos = searchRepos.concat(_.map(repo => repo['full_name'], repos))
  } while ((currentPage - 1) * PAGE_SIZE < Math.min(MAX_RESULTS, totalResults))

  return searchRepos
}
