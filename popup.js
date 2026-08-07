const DEFAULT_OPTIONS = {
	responsive: true,
	tokens: true,
	components: true,
	pageSettings: true,
	interactiveStyles: true,
	// off by default: it runs on the site you paste into once published
	pageScripts: false,
};

const status = document.getElementById("status");
const toggles = ["responsive", "tokens", "components", "pageSettings", "interactiveStyles", "pageScripts"];

let options = DEFAULT_OPTIONS;

init();

async function init() {
	const tab = await activeTab();
	document.getElementById("site").textContent = hostOf(tab?.url);

	const stored = await chrome.storage.sync.get("options");
	options = { ...DEFAULT_OPTIONS, ...(stored.options || {}) };
	for (const key of toggles) {
		const input = document.getElementById(`opt-${key}`);
		input.checked = options[key];
		input.addEventListener("change", () => {
			options = { ...options, [key]: input.checked };
			chrome.storage.sync.set({ options });
		});
	}

	const builderUrl = document.getElementById("builder-url");
	builderUrl.value = options.builderUrl || "";
	builderUrl.addEventListener("change", () => {
		options = { ...options, builderUrl: builderUrl.value.trim() };
		chrome.storage.sync.set({ options });
		// a different site means a different reset to compare against
		chrome.storage.local.remove("baseline");
	});

	document.getElementById("copy-page").addEventListener("click", () => send("copyPage"));
	document.getElementById("pick-element").addEventListener("click", () => send("startPicker"));
}

async function send(type) {
	const buttons = document.querySelectorAll(".button");
	buttons.forEach((button) => (button.disabled = true));
	setStatus(type === "copyPage" ? "Reading the page..." : "Starting the picker...");

	try {
		const tab = await activeTab();
		await BuilderInject.injectContentScripts(tab.id);
		const result = await chrome.tabs.sendMessage(tab.id, { type, options });

		if (result?.picking) {
			window.close();
			return;
		}
		if (!result?.ok) throw new Error(result?.error || "Nothing was copied");
		setStatus(describe(result.stats, result.deferred));
	} catch (error) {
		setStatus(hint(error), true);
	} finally {
		buttons.forEach((button) => (button.disabled = false));
	}
}

function describe(stats, deferred) {
	if (!stats) return "Copied. Paste on a Builder canvas.";
	const parts = [count(stats.blocks, "block")];
	if (stats.components) parts.push(count(stats.components, "component"));
	if (stats.tokens) parts.push(count(stats.tokens, "token"));
	if (stats.assets) parts.push(count(stats.assets, "image"));
	const tail = deferred ? " Click Copy on the page to finish." : " Paste on a Builder canvas.";
	return `${parts.join(", ")}.${tail}`;
}

function count(value, noun) {
	return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function hint(error) {
	const message = String(error?.message || error);
	if (message.includes("Cannot access") || message.includes("chrome://")) {
		return "This page is off limits to extensions. Try a normal web page.";
	}
	return message;
}

function setStatus(text, isError = false) {
	status.textContent = text;
	status.classList.toggle("error", isError);
}

async function activeTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch (error) {
		return "";
	}
}
