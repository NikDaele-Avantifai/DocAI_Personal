import type { PlasmoMessaging } from "@plasmohq/messaging"

export {}

// Background service worker — handles long-running tasks,
// API calls that shouldn't block the UI, and message routing.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[DocAI] Extension installed")
})

// Example message handler — extend this as features grow
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ type: "PONG", status: "ok" })
  }
  return true // Keep channel open for async response
})
