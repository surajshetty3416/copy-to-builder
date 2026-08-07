// Content scripts are injected on demand instead of on every page load, so the
// extension costs nothing until it is used. Order matters: each file adds to the
// same BuilderCopy namespace.
(function (root) {
	const CONTENT_FILES = [
		"content/namespace.js",
		"content/cascade.js",
		"content/styles.js",
		"content/elements.js",
		"content/tokens.js",
		"content/components.js",
		"content/scripts.js",
		"content/blocks.js",
		"content/page.js",
		"content/picker.js",
		"content/main.js",
		"shared/clipboard.js",
	];

	async function injectContentScripts(tabId) {
		const [{ result }] = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => Boolean(window.BuilderCopy && window.BuilderCopy.ready),
		});
		if (result) return;

		await chrome.scripting.insertCSS({
			target: { tabId },
			files: ["content/overlay.css"],
		});
		await chrome.scripting.executeScript({
			target: { tabId },
			files: CONTENT_FILES,
		});
	}

	root.BuilderInject = { injectContentScripts };
})(typeof window !== "undefined" ? window : self);
