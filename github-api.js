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
}

function searchElmRepos ({pageSize, page}) {
  return throttleGet(`https://api.github.com/search/repositories`, {q: 'language:elm', page, pageSize})
    .then(data => ({
      repos: data.items,
      total: data.total_count
    }))
}

async function throttleGet (url, params = {}) {
  return axios.get(url, {params: {...secret, ...params}})
    .catch(async (err) => {
      if (err.response.status === 422) {
        var waitTime = parseInt(err.response.headers['X-RateLimit-Reset'], 10) + 500 - Date.now()

        if (waitTime > 0) {
          console.log(`sleep ${waitTime / 1000} second(s)`)
          await sleep(waitTime)
        }

        return throttleGet(url)
      }

      return Promise.reject(err)
    })
    .then(({data}) => data)
}

async function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  searchElmRepos,
  getGithubRepo
}
