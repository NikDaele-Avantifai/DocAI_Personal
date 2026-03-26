import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://*.atlassian.net/*", "https://*.atlassian.com/*"],
  run_at: "document_idle"
}

function scrapeConfluencePage() {
  const contentSelectors = [
    ".ak-renderer-document",
    '[data-testid="confluence-frontend-page-content"]',
    "#main-content .wiki-content",
    ".wiki-content",
    "#main-content",
    "#content .body-content",
    ".body-content",
    "#content",
  ]

  let content = ""
  let foundSelector = ""

  for (const selector of contentSelectors) {
    const el = document.querySelector(selector)
    if (el && (el as HTMLElement).innerText?.trim().length > 50) {
      content = (el as HTMLElement).innerText || el.textContent || ""
      foundSelector = selector
      break
    }
  }

  const title =
    document.querySelector('[data-testid="confluence-frontend-page-title"]')?.textContent?.trim() ||
    document.querySelector("#title-text")?.textContent?.trim() ||
    document.querySelector(".confluence-page-title")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.title.replace(/ - Confluence.*$/, "").trim()

  const lastModified =
    document.querySelector('[data-testid="byline-last-modified"]')?.textContent?.trim() ||
    document.querySelector(".last-modified time")?.getAttribute("datetime") ||
    document.querySelector(".last-modified")?.textContent?.trim() ||
    document.querySelector("time[datetime]")?.getAttribute("datetime") ||
    null

  const owner =
    document.querySelector('[data-testid="byline-author"]')?.textContent?.trim() ||
    document.querySelector(".author .user-mention")?.textContent?.trim() ||
    document.querySelector(".author")?.textContent?.trim() ||
    null

  const labels = Array.from(
    document.querySelectorAll('[data-testid="label-list"] a, .label-list a, .labels-section a')
  ).map(el => el.textContent?.trim()).filter(Boolean)

  return {
    title: title || "Unknown Page",
    content: content.slice(0, 10000),
    lastModified,
    owner,
    labels,
    url: window.location.href,
    contentFound: content.length > 50,
    debugSelector: foundSelector,
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPE_PAGE") {
    const data = scrapeConfluencePage()
    sendResponse(data)
  }
  return true
})