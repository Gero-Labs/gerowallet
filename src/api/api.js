import axios from 'axios'
import { decode } from 'cborg'

const axiosApi = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {'Content-Type': 'application/json'},
})
const baseUrl = process.env.VUE_APP_AUTH_SERVER_URL
// const apiBaseUrl = process.env.VUE_APP_API_URL

const tempBalance = new Map()

export default {
  updateProfilePic(token, cid, userId) {
    return axiosApi.put(`/users/${userId}/profile-picture?token=${token}&cid=${cid}`, {withCredentials: true})
  },
  projectChange(project, imageFile, update) {
    const formData = new FormData()
    if (imageFile) {
      formData.append('imageFile', imageFile)
    }
    formData.append('projectRequest', new Blob([JSON.stringify(project)], { type: 'application/json' }))
    if (!update) {
      return axiosApi.post('/projects', formData, {withCredentials: true})
    }

    return axiosApi.patch(`/projects/${project.id}`, formData, {withCredentials: true})
  },
  deleteProject(token, id) {
    return axiosApi.delete(`/projects/${id}?token=${token}`, {withCredentials: true})
  },
  createRoyaltyTokenMintTx(token, id, addr, rate, sender, changeAddress) {
    return axiosApi.get(`/projects/${id}/RoyaltyMint?token=${token}&addr=${addr}&rate=${rate}&sender=${sender}&changeAddress=${changeAddress}`, {withCredentials: true})
  },
  submitRoyaltyTokenMintTx(token, id, tempCode, txn) {
    return axiosApi.post(`/projects/${id}/RoyaltyMint?token=${token}&txn=${txn}&tempCode=${tempCode}`, {withCredentials: true})
  },
  createAssetMintTx(token, id, assetId, addr, receiver, sender, changeAddress) {
    return axiosApi.get(`/projects/${id}/AssetMint?token=${token}&assetId=${assetId}&receiver=${receiver}&sender=${sender}&changeAddress=${changeAddress}`, {withCredentials: true})
  },
  expire(token, id, assetId, prevState) {
    return axiosApi.delete(`/projects/${id}/expiration/${assetId}?token=${token}&prevState=${prevState}`)
  },
  submitMintTx(token, id, signedTx, tempCode, reservationId) {
    return axiosApi.post(`/projects/${id}/AssetMint?token=${token}&txn=${signedTx}&tempCode=${tempCode}&reservationId=${reservationId}`, {withCredentials: true})
  },
  // Assets
  // getAssets(token, projectId, page, size, sortDesc, sortBy, query) {
  //   let url = `/projects/${projectId}/assets?token=${token}&page=${page}&size=${size}&sortDesc=${sortDesc}`
  //   if (sortBy.length > 0) {
  //     url += `&sortBy=${sortBy[0]}`
  //   }
  //   if (query !== '' && query !== null) {
  //     url += `&query=${encodeURIComponent(query)}`
  //   }
  //   return axiosApi.get(url, {withCredentials: true})
  // },
  getAssets(projectId) {
    const url = `/projects/${projectId}/assets`

    return axiosApi.get(url, {withCredentials: true})
  },
  modifyAsset(projectId, assetId, formData) {
    return axiosApi.patch(`/projects/${projectId}/assets/${assetId}`, formData, {withCredentials: true, headers: {'Content-Type': 'multipart/form-data;'}})
        .then(async response => response.data)
        .catch(error => {
          throw error
        })
  },
  uploadAsset(projectId, formData) {
    return axiosApi.post(`/projects/${projectId}/assets`, formData, {withCredentials: true, headers: {'Content-Type': 'multipart/form-data;'}})
        .then(async response => response.data)
        .catch(error => {
          throw error
        })
  },
  // bulkUpload(token, projectId, formData) {
  //   return axiosApi.post(`/projects/${projectId}/assets/bulk?token=${token}`, formData, {timeout: 1800000, withCredentials: true, headers: {'Content-Type': 'multipart/form-data;'}})
  // },
  deleteAsset(projectId, id) {
    return axiosApi.delete(`/projects/${projectId}/assets/${id}`, {withCredentials: true})
  },
  prepareSignature(token, walletAddress) {
    return axiosApi.get(`/auth/prepareSignature?token=${token}&walletAddress=${walletAddress}`).then(async response => response.data).catch(error => {
      throw error
    })
  },
  verifySignature(token, dataSignature) {
    return axiosApi.post(`/auth/verifySignature?token=${token}`, dataSignature).then(async response => response.data).catch(error => {
      throw error
    })
  },
  fetchUser(token) {
    return axiosApi.get(`/auth/me?token=${token}`, {withCredentials: true}).then(async response => response.data).catch(error => {
      throw error
    })
  },
  deserializeBalance(balance) {
    if (tempBalance.has(balance)) {
      return tempBalance.get(balance)
    } else {
      tempBalance.clear()
    }
    let coin = 0
    const assets = new Map()
    const balanceDecoded = decode(Buffer.from(balance, 'hex'), { useMaps: true })
    if (Number(balanceDecoded)) {
      coin = balanceDecoded
    } else if (Array.isArray(balanceDecoded)) {
      coin = balanceDecoded[0]
      const multiAssetMap = balanceDecoded[1]
      if (multiAssetMap != null) {
        multiAssetMap.forEach((value, key) => {
          let policyId = Buffer.from(key).toString('hex')
          if (!assets.has(policyId)) {
            assets.set(policyId, new Map())
          }
          const assetMap = assets.get(policyId)
          value.forEach((v, k) => {
            let assetName = Buffer.from(k).toString('hex')
            assetMap.set(assetName, v)
          })
        })
      }
    }
    const result = { coin, assets }
    tempBalance.set(balance, result)
    return result
  },
  getTip(network) {
    return axiosApi.get(`/tip?network=${network}`).then(async response => response.data).catch(error => {
      throw error
    })
  },
  logout(token) {
    return axios.post(`${baseUrl}/auth/logout?token=${token}`, {withCredentials: true}).then(async response => response.data).catch(error => {
      throw error
    })
  },
  inviteToProject(token, memberId, projectId) {
    return axiosApi.post(`/projects/${projectId}/invite?token=${token}&memberId=${memberId}`, {}, { withCredentials: true, credentials: 'include', headers: { 'Content-Type': 'application/json' }})
  },
  acceptProjectInvitation(token, id) {
    return axiosApi.post(`/notifications/${id}/acceptInvitation?token=${token}`, {}, { withCredentials: true, credentials: 'include', headers: { 'Content-Type': 'application/json' }})
  },
  getLogs(token, projectId, page, size, sortDesc, sortBy, query) {
    let url = `/projects/${projectId}/logs?token=${token}&page=${page}&size=${size}&sortDesc=${sortDesc}`
    if (sortBy.length > 0) {
      url += `&sortBy=${sortBy[0]}`
    }
    if (query !== '' && query !== null) {
      url += `&query=${encodeURIComponent(query)}`
    }

    return axiosApi.get(url, { withCredentials: true })
  },
  getMonetaryStats(token, projectId) {
    return axiosApi.get(`/projects/${projectId}/monetaryStats?token=${token}`, { timeout: 1800000, withCredentials: true })
  },
  getRedeemableBalance(balance) {
    return axiosApi.post(`/tokens/redeemable`, { balance },{ withCredentials: true })
  },
  prepareMusicBoxOwnershipSignature(stakeAddress, changeAddress, assetIds, network) {
    return axiosApi.get(`/tokens/redeem/prepareSignatures?stakeAddress=${stakeAddress}&changeAddress=${changeAddress}&assetIds=${assetIds}&network=${network}`).then(async response => response.data).catch(error => {
      throw error
    })
  },
  verifyMusicBoxOwnershipSignatures(network, map) {
    return axiosApi.post(`/tokens/redeem/verifySignatures?network=${network}`, map).then(async response => response.data).catch(error => {
      throw error
    })
  },
  submitForgeTokenMintTx(tempCode, signedTx) {
    return axiosApi.post(`/tokens/redeem/submitForgeTokenMintTx?tempCode=${tempCode}`, signedTx)
  },
  async verifyTx(network, txId) {
    return axiosApi.get(`/tx_info/${txId}?network=${network}`)
      .then(response => {
        console.log(response)
        return response
        // !!(response.status === 200 && response.data.length > 0)
      }).catch(e => {
        if (e.response && e.response.status === 404) {
          return e.response
        }

        throw e
      })
  },
  createForgeTokensBurnTx(changeAddress, utxos, projectId, quantity, network) {
    return axiosApi.post(`/tokens/createForgeTokensBurnTx?projectId=${projectId}&changeAddress=${changeAddress}&quantity=${quantity}&network=${network}`, { utxos }).then(async response => response.data).catch(error => {
      throw error
    })
  },
  submitForgeTokenBurnTx(tempCode, signedTx) {
    return axiosApi.post(`/tokens/submitForgeTokenBurnTx?tempCode=${tempCode}`, signedTx)
  },
}
