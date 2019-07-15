import { state, updateState } from './state'
import { handleEvent } from './events'
import { storeItem, getItem } from './storage'
import { timeouts } from './utilities'
import {
  updateTransactionInQueue,
  getTxObjFromQueue,
  removeTransactionFromQueue
} from './transaction-queue'

// Create websocket connection
export function openWebsocketConnection() {
  return new Promise((resolve, reject) => {
    updateState({ pendingSocketConnection: true })

    let socket
    try {
      socket = new WebSocket('wss://api.blocknative.com/v0')
    } catch (errorObj) {
      updateState({ pendingSocketConnection: false })
      reject(false)
    }

    socket.addEventListener('message', handleSocketMessage)
    socket.addEventListener('close', () =>
      updateState({ socketConnection: false })
    )
    socket.addEventListener('error', () => {
      updateState({ pendingSocketConnection: false })
      reject(false)
    })
    socket.addEventListener('open', () => {
      updateState({
        socket,
        socketConnection: true,
        pendingSocketConnection: false
      })

      handleEvent({
        categoryCode: 'initialize',
        eventCode: 'checkDappId',
        connectionId: getItem('connectionId')
      })

      resolve(true)
    })
  })
}

export function checkForSocketConnection() {
  return new Promise(resolve => {
    setTimeout(() => {
      if (!state.socketConnection) {
        resolve(false)
      }
      resolve(true)
    }, timeouts.checkSocketConnection)
  })
}

export function retryLogEvent(logFunc) {
  openWebsocketConnection()
    .then(logFunc)
    .catch(() => setTimeout(logFunc, timeouts.checkSocketConnection))
}

// Handle in coming socket messages
export function handleSocketMessage(msg) {
  const { status, reason, event, connectionId, nodeSynced } = JSON.parse(
    msg.data
  )
  const { validApiKey, supportedNetwork } = state
  if (!validApiKey || !supportedNetwork) {
    return
  }

  if (nodeSynced !== undefined) {
    updateState({ nodeSynced })
  }

  // handle any errors from the server
  if (status === 'error') {
    if (
      reason.includes('not a valid API key') &&
      event.eventCode !== 'initFail'
    ) {
      updateState({ validApiKey: false })

      handleEvent({
        eventCode: 'initFail',
        categoryCode: 'initialize',
        reason
      })

      const errorObj = new Error(reason)
      errorObj.eventCode = 'initFail'
      throw errorObj
    }

    if (
      reason.includes('network not supported') &&
      event.eventCode !== 'initFail'
    ) {
      updateState({ supportedNetwork: false })

      handleEvent({
        eventCode: 'initFail',
        categoryCode: 'initialize',
        reason
      })

      const errorObj = new Error(reason)
      errorObj.eventCode = 'initFail'
      throw errorObj
    }
  }

  if (status === 'ok' && event && event.eventCode === 'checkDappId') {
    handleEvent({ eventCode: 'initSuccess', categoryCode: 'initialize' })
    updateState({ validApiKey: true, supportedNetwork: true })
  }

  if (
    connectionId &&
    (!state.connectionId || connectionId !== state.connectionId)
  ) {
    storeItem('connectionId', connectionId)
    updateState({ connectionId })
  }

  if (event && event.transaction) {
    const { transaction, eventCode } = event
    let txObj

    switch (transaction.status) {
      case 'pending':
        txObj = updateTransactionInQueue(transaction.id, {
          status: 'pending',
          nonce: transaction.nonce,
          hash: transaction.hash,
          originalHash: transaction.originalHash
        })

        handleEvent({
          eventCode: eventCode === 'txPool' ? 'txPending' : eventCode,
          categoryCode: 'activeTransaction',
          transaction: txObj.transaction,
          contract: txObj.contract,
          inlineCustomMsgs: txObj.inlineCustomMsgs
        })
        break
      case 'confirmed':
        // have already dealt with txConfirmedClient event
        if (eventCode === 'txConfirmedClient') {
          return
        }

        txObj = getTxObjFromQueue(transaction.id)

        if (txObj.transaction.status === 'confirmed') {
          txObj = updateTransactionInQueue(transaction.id, {
            status: 'completed',
            hash: transaction.hash
          })
        } else {
          txObj = updateTransactionInQueue(transaction.id, {
            status: 'confirmed',
            hash: transaction.hash
          })
        }

        handleEvent({
          eventCode: 'txConfirmed',
          categoryCode: 'activeTransaction',
          transaction: txObj.transaction,
          contract: txObj.contract,
          inlineCustomMsgs: txObj.inlineCustomMsgs
        })

        if (txObj.transaction.status === 'completed') {
          removeTransactionFromQueue(transaction.id)
        }

        break
      case 'failed':
        txObj = updateTransactionInQueue(transaction.id, {
          status: 'failed',
          hash: transaction.hash
        })

        handleEvent({
          eventCode: 'txFailed',
          categoryCode: 'activeTransaction',
          transaction: txObj.transaction,
          contract: txObj.contract,
          inlineCustomMsgs: txObj.inlineCustomMsgs
        })

        removeTransactionFromQueue(transaction.id)
        break
      default:
    }
  }
}
