importScripts("shared/inject.js");

const { injectContentScripts } = self.BuilderInject;

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: "copy-page",
		title: "Copy this page for Frappe Builder",
		contexts: ["page"],
	});
	chrome.contextMenus.create({
		id: "pick-element",
		title: "Pick an element to copy for Frappe Builder",
		contexts: ["all"],
	});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (!tab?.id) return;
	run(tab.id, info.menuItemId === "copy-page" ? "copyPage" : "startPicker");
});

chrome.commands.onCommand.addListener((command, tab) => {
	if (!tab?.id) return;
	run(tab.id, command === "copy-page" ? "copyPage" : "startPicker");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Stylesheets from other origins are unreadable through the CSSOM, so the media
	// queries behind responsive styles need the extension's own reach.
	if (message?.type === "fetchStylesheet") {
		fetch(message.url, { credentials: "omit" })
			.then((response) => (response.ok ? response.text() : ""))
			.then((text) => sendResponse({ text }))
			.catch(() => sendResponse({ text: "" }));
		return true;
	}
	if (message?.type === "builderBaseline") {
		builderBaseline()
			.then((css) => sendResponse({ css }))
			.catch(() => sendResponse({ css: "" }));
		return true;
	}
	return false;
});

const BASELINE_TTL = 24 * 60 * 60 * 1000;

// Styles are only worth copying when Builder would render them differently, which
// means the comparison needs Builder's reset. Reading it from the site you paste
// into keeps the two in step; the bundled copy is only a fallback.
async function builderBaseline() {
	const { options } = await chrome.storage.sync.get("options");
	const site = (options?.builderUrl || "").trim().replace(/\/+$/, "");
	if (!site) return "";

	const { baseline } = await chrome.storage.local.get("baseline");
	if (baseline?.site === site && Date.now() - baseline.at < BASELINE_TTL) return baseline.css;

	try {
		const response = await fetch(`${site}/assets/builder/reset.css`, { credentials: "omit" });
		const css = response.ok ? await response.text() : "";
		if (css) await chrome.storage.local.set({ baseline: { site, css, at: Date.now() } });
		return css || baseline?.css || "";
	} catch (error) {
		return baseline?.css || "";
	}
}

async function run(tabId, action) {
	try {
		await injectContentScripts(tabId);
		await chrome.tabs.sendMessage(tabId, {
			type: action,
			options: await loadOptions(),
		});
	} catch (error) {
		console.warn("Copy to Frappe Builder", error);
	}
}

async function loadOptions() {
	const { options } = await chrome.storage.sync.get("options");
	return options || {};
}
