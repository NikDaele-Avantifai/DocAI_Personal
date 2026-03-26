export {}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[DocAI] Extension installed")
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ type: "PONG", status: "ok" })
  }
  return true
})