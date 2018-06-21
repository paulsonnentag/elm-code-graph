const axios = require('axios')
const secret = require('./secret.json')

function getGithubRepo (fullName) {
  return throttleGet(`https://api.github.com/repos/${fullName}`)
    .then(repo => ({
      stars: repo.stargazers_count,
      owner: repo.owner.login === 'elm' ? 'elm-lang' : repo.owner.login,
      name: repo.name,
      lastUpdated: repo.updated_at,
      license: repo.license ? repo.license.key : 'unknown'
    }))
    .catch((err) => {
      if (err.response.status === 404) {
        return null
      }

      return Promise.reject(err)
    })
}

function searchElmRepos ({pageSize, page, lastCommitted}) {
  return throttleGet(`https://api.github.com/search/repositories`, {
    q: `language:elm${lastCommitted ? ` pushed:<=${lastCommitted}` : ''}`,
    page,
    pageSize,
    sort: 'updated'
  })
    .then(data => ({
      repos: data.items,
      total: data.total_count
    }))
}

async function throttleGet (url, params = {}) {
  return axios.get(url, {params: {...secret, ...params}})
    .catch(async (err) => {
      if (err.response.status === 422 || err.response.status === 403) {
        var waitTime = (parseInt(err.response.headers['x-ratelimit-reset'], 10) * 1000) + 500 - Date.now()

        if (waitTime > 0) {
          console.log(`sleep ${waitTime / 1000} second(s)`)
          await sleep(waitTime)
        }

        return throttleGet(url, params)
      }

      return Promise.reject(err)
    })
    .then((result) => {
      if (result.data) {
        return result.data
      }

      return result
    })
}

async function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  searchElmRepos,
  getGithubRepo
}
