import { state } from '~/js/helpers/state'
import { getItem } from '~/js/helpers/storage'
import { showIframe } from '~/js/helpers/iframe'
import {
  formatTime,
  eventCodeToStep,
  eventCodeToType,
  timeouts,
  assistLog,
  getNotificationsPosition
} from '~/js/helpers/utilities'

import {
  openModal,
  createElement,
  notSupportedModal,
  onboardModal,
  getById,
  getByQuery,
  offsetElement,
  removeNotification,
  createTransactionBranding,
  notificationContent,
  showElement,
  setNotificationsHeight,
  startTimerInterval,
  positionElement,
  addTouchHandlers,
  removeTouchHandlers,
  removeUnwantedNotifications
} from './dom'
import { transactionMsgs } from './content'

const eventToUI = {
  initialize: {
    mobileBlocked: notSupportedUI
  },
  onboard: {
    browserFail: notSupportedUI,
    mobileBlocked: notSupportedUI,
    welcomeUser: onboardingUI,
    walletFail: onboardingUI,
    mobileWalletFail: notSupportedUI,
    walletLogin: onboardingUI,
    mobileWalletEnable: onboardingUI,
    walletLoginEnable: onboardingUI,
    walletEnable: onboardingUI,
    networkFail: onboardingUI,
    mobileNetworkFail: onboardingUI,
    nsfFail: onboardingUI,
    newOnboardComplete: onboardingUI
  },
  activePreflight: {
    mobileBlocked: notSupportedUI,
    welcomeUser: onboardingUI,
    walletFail: onboardingUI,
    mobileWalletFail: notSupportedUI,
    walletLogin: onboardingUI,
    mobileWalletEnable: onboardingUI,
    walletLoginEnable: onboardingUI,
    walletEnable: onboardingUI,
    networkFail: onboardingUI,
    mobileNetworkFail: onboardingUI,
    nsfFail: notificationsUI,
    newOnboardComplete: onboardingUI,
    txRepeat: notificationsUI
  },
  activeTransaction: {
    txAwaitingApproval: notificationsUI,
    txRequest: notificationsUI,
    txSent: notificationsUI,
    txPending: notificationsUI,
    txSendFail: notificationsUI,
    txConfirmReminder: notificationsUI,
    txConfirmed: notificationsUI,
    txConfirmedClient: notificationsUI,
    txStallPending: notificationsUI,
    txStallConfirmed: notificationsUI,
    txFailed: notificationsUI,
    txSpeedUp: notificationsUI,
    txCancel: notificationsUI,
    txUnderpriced: notificationsUI,
    txError: notificationsUI
  },
  activeContract: {
    txAwaitingApproval: notificationsUI,
    txRequest: notificationsUI,
    txSent: notificationsUI,
    txPending: notificationsUI,
    txSendFail: notificationsUI,
    txConfirmReminder: notificationsUI,
    txConfirmed: notificationsUI,
    txConfirmedClient: notificationsUI,
    txStallPending: notificationsUI,
    txStallConfirmed: notificationsUI,
    txFailed: notificationsUI,
    txSpeedUp: notificationsUI,
    txCancel: notificationsUI,
    txUnderpriced: notificationsUI,
    txError: notificationsUI
  },
  userInitiatedNotify: {
    success: notificationsUI,
    pending: notificationsUI,
    error: notificationsUI
  }
}

function notSupportedUI(eventObj, handlers) {
  const existingModal = state.iframeDocument.querySelector(
    '.bn-onboard-modal-shade'
  )

  if (existingModal) {
    return
  }

  const { eventCode } = eventObj
  const modal = createElement(
    'div',
    'bn-onboard-modal-shade',
    notSupportedModal(eventCodeToStep(eventCode))
  )

  if (state.mobileDevice) {
    addTouchHandlers(modal.children[0], 'modal')
  }

  openModal(modal, handlers)
}

function onboardingUI(eventObj, handlers) {
  const existingModal = state.iframeDocument.querySelector(
    '.bn-onboard-modal-shade'
  )

  if (existingModal) {
    return
  }

  const { eventCode } = eventObj
  const newUser = getItem('_assist_newUser') === 'true'
  const type = newUser ? 'basic' : 'advanced'

  const modal = createElement(
    'div',
    'bn-onboard-modal-shade',
    onboardModal(type, eventCodeToStep(eventCode))
  )

  if (state.mobileDevice) {
    addTouchHandlers(modal.children[0], 'modal')
  }

  openModal(modal, handlers)
}

function getCustomTxMsg(eventCode, data, inlineCustomMsgs = {}) {
  const msgFunc =
    typeof inlineCustomMsgs[eventCode] === 'function'
      ? inlineCustomMsgs[eventCode]
      : state.config.messages &&
        typeof state.config.messages[eventCode] === 'function' &&
        state.config.messages[eventCode]

  if (!msgFunc) return undefined

  try {
    const customMsg = msgFunc(data)
    if (typeof customMsg === 'string') {
      return customMsg
    }
    assistLog('Custom transaction message callback must return a string')

    return undefined
  } catch (error) {
    assistLog(
      `An error was thrown from custom transaction callback message for the ${eventCode} event: `
    )
    assistLog(error)

    return undefined
  }
}

function notificationsUI({
  transaction = {},
  contract = {},
  inlineCustomMsgs,
  clickHandlers,
  eventCode,
  categoryCode,
  customTimeout
}) {
  // treat txConfirmedClient as txConfirm
  if (eventCode === 'txConfirmedClient') eventCode = 'txConfirmed'

  const { id, startTime } = transaction
  const type = eventCodeToType(eventCode)
  const timeStamp = formatTime(Date.now())
  const message =
    getCustomTxMsg(eventCode, { transaction, contract }, inlineCustomMsgs) ||
    transactionMsgs[eventCode]({ transaction, contract })

  const hasTimer =
    eventCode === 'txPending' ||
    eventCode === 'txSent' ||
    eventCode === 'txStallPending' ||
    eventCode === 'txStallConfirmed' ||
    eventCode === 'txSpeedUp' ||
    eventCode === 'pending'

  const showTime =
    hasTimer || eventCode === 'txConfirmed' || eventCode === 'txFailed'

  let blockNativeBrand
  let existingNotifications
  let notificationsList
  let notificationsScroll
  let notificationsContainer = getById('blocknative-notifications')

  const position = getNotificationsPosition()

  if (notificationsContainer) {
    existingNotifications = true
    notificationsList = getByQuery('.bn-notifications')

    removeUnwantedNotifications(eventCode, id)
  } else {
    existingNotifications = false
    notificationsContainer = positionElement(
      offsetElement(
        createElement('div', null, null, 'blocknative-notifications')
      )
    )

    blockNativeBrand = createTransactionBranding()
    notificationsList = createElement('ul', 'bn-notifications')
    notificationsScroll = createElement('div', 'bn-notifications-scroll')
    if (position === 'topRight') {
      notificationsScroll.style.float = 'right'
    }
    showIframe()
  }

  const notificationClickHandler =
    clickHandlers && (clickHandlers[eventCode] || clickHandlers.onclick)

  const notification = offsetElement(
    createElement(
      'li',
      `bn-notification bn-${type} bn-${eventCode} bn-${id} ${
        state.mobileDevice
          ? position.includes('top')
            ? 'bn-bottom-border'
            : 'bn-top-border'
          : position.includes('Left')
          ? 'bn-right-border'
          : ''
      }`,
      notificationContent(type, message, { startTime, showTime, timeStamp }),
      null,
      notificationClickHandler
    )
  )

  if (state.mobileDevice) {
    notification.appendChild(createTransactionBranding())
    addTouchHandlers(notification, 'notification', notificationClickHandler)
  }

  notificationsList.appendChild(notification)

  if (!existingNotifications) {
    notificationsScroll.appendChild(notificationsList)

    if (position.includes('top')) {
      if (!state.mobileDevice) {
        notificationsContainer.appendChild(blockNativeBrand)
      }
      notificationsContainer.appendChild(notificationsScroll)
    } else {
      notificationsContainer.appendChild(notificationsScroll)
      if (!state.mobileDevice) {
        notificationsContainer.appendChild(blockNativeBrand)
      }
    }
    state.iframeDocument.body.appendChild(notificationsContainer)
    showElement(notificationsContainer, timeouts.showElement)
  }

  showElement(notification, timeouts.showElement)

  setNotificationsHeight()

  let intervalId
  if (hasTimer) {
    setTimeout(() => {
      intervalId = startTimerInterval(id, eventCode, startTime)
    }, timeouts.changeUI)
  }

  const dismissButton = notification.querySelector('.bn-status-icon')
  dismissButton.onclick = () => {
    intervalId && clearInterval(intervalId)
    removeNotification(notification)
    setTimeout(setNotificationsHeight, timeouts.changeUI)
  }

  if (state.mobileDevice) {
    dismissButton.addEventListener('touchstart', () => {
      intervalId && clearInterval(intervalId)
      removeTouchHandlers(notification, 'notification')
      removeNotification(notification)
      setTimeout(setNotificationsHeight, timeouts.changeUI)
    })
  }

  const notificationShouldTimeout =
    (type === 'complete' && categoryCode !== 'userInitiatedNotify') ||
    customTimeout
  if (notificationShouldTimeout) {
    setTimeout(() => {
      if (state.mobileDevice) {
        removeTouchHandlers(notification, 'notification')
      }
      removeNotification(notification)
      setTimeout(setNotificationsHeight, timeouts.changeUI)
    }, customTimeout || timeouts.autoRemoveNotification)
  }
}

export default eventToUI
