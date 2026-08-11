(function (ns) {
	const DEFAULT_OPTIONS = {
		tokens: true,
		components: true,
		responsive: true,
		pageSettings: true,
		interactiveStyles: true,
		pageScripts: false,
	};

	class Copier {
		constructor() {
			this.cascade = null;
			this.baseline = null;
		}

		// Both are done once per page and before the picker arms, so that a copy
		// triggered by a click stays inside the user gesture the clipboard needs.
		// Reading every stylesheet (including refetching the cross-origin ones) is
		// the slow part.
		async prepare(options) {
			if (this.baseline === null) this.baseline = await requestBaseline();
			if (!options.responsive) return null;
			if (!this.cascade) this.cascade = await ns.CascadeIndex.build();
			return this.cascade;
		}

		async copyPage(options) {
			return this.deliver(await this.buildPage(options), "page");
		}

		copyElement(el, options) {
			return this.deliver(this.buildElement(el, options), "selection");
		}

		async buildPage(options) {
			const cascade = await this.prepare(options);
			const { builder, extractor } = this.newBuilder(cascade, document.body, options);
			const root = builder.buildPage();
			const payload = this.wrap(root, builder, options);
			if (options.pageSettings) {
				// blocks stay out of pageDoc: Builder fills them in from payload.blocks
				payload.pageDoc = ns.page.settings(cascade?.fontFaces || []);
			}
			this.attachScripts(payload, extractor, builder, options);
			return payload;
		}

		buildElement(el, options) {
			const { builder, extractor } = this.newBuilder(this.cascade, el, options);
			const block = builder.buildElement(el);
			if (!block) return null;
			const payload = this.wrap(block, builder, options);
			this.attachScripts(payload, extractor, builder, options);
			return payload;
		}

		newBuilder(cascade, root, options) {
			const extractor = new ns.ScriptExtractor(location.href);
			const keepClasses = options.interactiveStyles ? extractor.collectStyles(cascade, root) : new Set();
			const reader = new ns.styles.StyleReader(cascade, this.baseline);
			const builder = new ns.BlockBuilder(reader, { ...options, keepClasses });
			return { builder, extractor };
		}

		// Hover, focus and keyframes cannot be block styles, and page behaviour is not
		// a block at all. Both ride along as Builder Client Scripts, which is where a
		// page's own CSS and JS already live.
		attachScripts(payload, extractor, builder, options) {
			const docs = [];
			if (options.interactiveStyles) {
				const styleDoc = extractor.styleDoc(builder.animations);
				if (styleDoc) docs.push(styleDoc);
			}
			if (options.pageScripts) {
				const scriptDoc = extractor.scripts();
				if (scriptDoc) docs.push(scriptDoc);
			}
			payload.pageScripts = docs;
			payload.stats.scripts = docs.length;
			payload.fonts = pickFontFaces(this.cascade?.fontFaces, builder.fonts);
			payload.stats.fonts = payload.fonts.length;
			if (payload.pageDoc) {
				payload.pageDoc.client_scripts = docs.map((doc, index) => ({
					builder_script: doc.name,
					idx: index + 1,
				}));
			}
		}

		wrap(root, builder, options) {
			const components = options.components ? new ns.ComponentExtractor(location.href).extract(root) : [];
			const tokens = options.tokens ? new ns.TokenExtractor(location.href).extract(root) : [];
			return {
				blocks: [root],
				components,
				variables: tokens,
				sourceURL: location.origin,
				assets: [...builder.assets],
				stats: {
					blocks: builder.count,
					components: components.length,
					tokens: tokens.length,
					assets: builder.assets.size,
					truncated: builder.truncated,
				},
			};
		}

		deliver(payload, kind) {
			if (!payload) {
				ns.toast.show("Nothing to copy here", "error");
				return { ok: false };
			}
			const stats = payload.stats;
			delete payload.stats;
			const json = JSON.stringify(payload);

			if (window.BuilderClipboard.writeBuilderClipboard(json)) {
				ns.toast.show(summary(stats, kind));
				return { ok: true, stats };
			}
			ns.toast.action("Ready to copy for Frappe Builder", "Copy", () => {
				const wrote = window.BuilderClipboard.writeBuilderClipboard(json);
				ns.toast.show(
					wrote ? summary(stats, kind) : "Could not reach the clipboard",
					wrote ? "info" : "error",
				);
			});
			return { ok: true, stats, deferred: true };
		}
	}

	function summary(stats, kind) {
		const parts = [count(stats.blocks, "block")];
		if (stats.components) parts.push(count(stats.components, "component"));
		if (stats.tokens) parts.push(count(stats.tokens, "token"));
		if (stats.scripts) parts.push(count(stats.scripts, "script"));
		const tail = stats.truncated ? " The page was large, so some blocks were skipped." : "";
		return `Copied ${kind === "page" ? "page" : "selection"} as ${parts.join(", ")}. Paste in Builder.${tail}`;
	}

	function count(value, noun) {
		return `${value} ${noun}${value === 1 ? "" : "s"}`;
	}

	// Builder stores one file per family, so each family that the blocks actually use
	// contributes its most ordinary face: upright, and as close to regular as it has.
	function pickFontFaces(fontFaces = [], usedFamilies = new Set()) {
		const used = new Set([...usedFamilies].map((family) => family.toLowerCase()));
		const best = new Map();

		for (const face of fontFaces) {
			if (!face.url || !used.has(face.family.toLowerCase())) continue;
			// a subset without basic latin (Google lists latin-ext first) downloads
			// fine and then draws nothing but fallback glyphs
			if (!coversBasicLatin(face.unicodeRange)) continue;
			const key = face.family.toLowerCase();
			const current = best.get(key);
			if (!current || faceScore(face) < faceScore(current)) best.set(key, face);
		}
		return [...best.values()].map((face) => ({
			family: face.family,
			url: face.url,
			weight: face.weight,
			style: face.style,
		}));
	}

	// "A" (U+41) stands in for the whole basic latin block: any subset that can
	// draw ordinary text declares it, and latin-ext or cyrillic ones do not.
	function coversBasicLatin(unicodeRange) {
		if (!unicodeRange) return true;
		return unicodeRange.split(",").some((part) => {
			const match = part.trim().match(/^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?$/);
			if (!match) return false;
			const start = parseInt(match[1].replace(/\?/g, "0"), 16);
			const end = match[2] ? parseInt(match[2], 16) : parseInt(match[1].replace(/\?/g, "F"), 16);
			return start <= 0x41 && 0x41 <= end;
		});
	}

	function faceScore(face) {
		const italic = /italic|oblique/i.test(face.style) ? 100 : 0;
		// a variable face covers every weight, so it beats any single one
		if (/\s/.test(face.weight.trim())) return italic;
		const weight = face.weight.trim() === "normal" ? 400 : parseInt(face.weight, 10) || 400;
		return italic + Math.abs(weight - 400) / 100 + 1;
	}

	function requestBaseline() {
		return chrome.runtime
			.sendMessage({ type: "builderBaseline" })
			.then((response) => response?.css || "")
			.catch(() => "");
	}

	const copier = new Copier();

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		const options = { ...DEFAULT_OPTIONS, ...(message.options || {}) };

		if (message.type === "copyPage") {
			copier
				.copyPage(options)
				.then((result) => sendResponse(result || { ok: true }))
				.catch((error) => {
					ns.toast.show(`Copy failed: ${error.message}`, "error");
					sendResponse({ ok: false, error: error.message });
				});
			return true;
		}

		if (message.type === "startPicker") {
			copier.prepare(options).then(() => {
				ns.picker.start((el) => copier.copyElement(el, options));
			});
			sendResponse({ ok: true, picking: true });
			return true;
		}
		return false;
	});

	ns.ready = true;
})(window.BuilderCopy);
