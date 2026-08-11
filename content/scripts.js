(function (ns) {
	const { hash, absoluteUrl } = ns.util;

	const MAX_CSS_BYTES = 80000;
	const MAX_JS_BYTES = 60000;

	// Analytics and consent snippets belong to the site that was copied, not to the
	// one pasting it. Carrying them over would silently report to someone else.
	const TRACKERS =
		/gtag\(|googletagmanager|dataLayer|fbq\(|_fbq|hotjar|clarity\.ms|segment\.(com|io)|analytics\.track|plausible|matomo|_paq|mixpanel|amplitude|intercom|drift|onetrust|cookieconsent|cookiebot/i;

	// Hydration payloads are data for a framework that is not coming with the copy.
	const DATA_TYPES = /json|importmap|speculationrules/i;
	const FRAMEWORK_PAYLOAD =
		/self\.__next_f|__NEXT_DATA__|__NUXT__|__sveltekit|__remixContext|webpackJsonp|__webpack_require__|window\.__INITIAL_STATE__/;

	class ScriptExtractor {
		constructor(sourceUrl) {
			this.sourceUrl = sourceUrl;
			this.host = safeHost(sourceUrl);
		}

		// Two steps, because the blocks in between need the answer to the first: the
		// class names the kept rules depend on have to survive the DOM walk, and the
		// keyframes worth shipping are only known once the walk reports which
		// animations are actually used.
		collectStyles(cascade, root) {
			this.cascade = cascade;
			this.rules = [];
			const classes = new Set();
			if (!cascade) return classes;

			for (const rule of cascade.interactiveRules) {
				const target = matchWithin(root, rule.selector);
				if (!target) continue;
				// custom properties come from the copied site's :root, which is not
				// coming along, so they are resolved against the element they styled
				this.rules.push({ ...rule, body: ns.styles.resolveVars(rule.body, target) });
				classNamesIn(rule.selector).forEach((name) => classes.add(name));
			}
			return classes;
		}

		styleDoc(animationNames = new Set()) {
			if (!this.rules?.length && !animationNames.size) return null;

			const byMedia = new Map();
			for (const rule of this.rules || []) {
				const bucket = byMedia.get(rule.media) || [];
				bucket.push(`${rule.selector} { ${rule.body} }`);
				byMedia.set(rule.media, bucket);
			}

			const parts = [];
			for (const [media, rules] of byMedia) {
				const block = rules.join("\n");
				parts.push(media ? `@media ${media} {\n${block}\n}` : block);
			}
			for (const name of animationNames) {
				const frames = this.cascade?.keyframes.get(name);
				if (frames) parts.push(frames);
			}
			if (!parts.length) return null;

			const css = capped(parts.join("\n\n"), MAX_CSS_BYTES);
			return this.doc("styles", "CSS", `/* Interactive styles from ${this.host} */\n${css}`);
		}

		// Only inline first party scripts travel. A remote script is left as a comment
		// rather than pulled in, since importing someone else's URL into a published
		// page is a decision the person pasting should make deliberately.
		scripts() {
			const inline = [];
			const external = [];

			for (const script of document.querySelectorAll("script")) {
				const type = script.getAttribute("type") || "";
				if (DATA_TYPES.test(type)) continue;
				const src = script.getAttribute("src");
				if (src) {
					if (!TRACKERS.test(src)) external.push(absoluteUrl(src));
					continue;
				}
				const code = script.textContent.trim();
				if (!code || TRACKERS.test(code) || FRAMEWORK_PAYLOAD.test(code)) continue;
				// an inline loader whose only job is to inject a third party script
				// would reinstate exactly what the src filter above refuses (usually
				// a tag manager reporting to the copied site's account)
				const loaderTargets = remoteLoaderUrls(code, this.host);
				if (loaderTargets) {
					external.push(...loaderTargets);
					continue;
				}
				inline.push(code);
			}
			if (!inline.length && !external.length) return null;

			const notImported = [...new Set(external)];
			const header = [
				`/* Scripts copied from ${this.host}.`,
				" * They ran against that site's markup, so selectors may need updating.",
				notImported.length ? ` * Not imported: ${notImported.slice(0, 12).join(", ")}` : "",
				" */",
			]
				.filter(Boolean)
				.join("\n");

			if (!inline.length) return this.doc("scripts", "JavaScript", header);
			return this.doc("scripts", "JavaScript", `${header}\n${capped(inline.join("\n\n"), MAX_JS_BYTES)}`);
		}

		doc(kind, scriptType, script) {
			return {
				name: `imported-${slug(this.host)}-${kind}-${hash(this.sourceUrl)}`,
				script_type: scriptType,
				script,
			};
		}
	}

	// Interaction states only matter for elements that came along, so a rule is kept
	// when the part of its selector before the state still matches inside the copy.
	// The matched element is returned to stand in for the rule when resolving var().
	function matchWithin(root, selector) {
		const base = selector
			.replace(/::[a-z-]+(\([^)]*\))?/gi, "")
			// longest state first, or :focus-visible loses its colon and keeps "-visible"
			.replace(
				/(^|[^\\]):(focus-visible|focus-within|placeholder-shown|hover|focus|active|checked|disabled)/gi,
				"$1",
			)
			.trim();
		if (!base || /^[>+~]/.test(base)) return null;
		try {
			return (root.matches?.(base) ? root : null) || root.querySelector(base);
		} catch (error) {
			return null;
		}
	}

	function classNamesIn(selector) {
		return [...selector.matchAll(/\.((?:\\.|[^\s.#[\]:>+~()])+)/g)].map((match) =>
			match[1].replace(/\\(.)/g, "$1"),
		);
	}

	function capped(text, limit) {
		return text.length > limit ? `${text.slice(0, limit)}\n/* truncated */` : text;
	}

	function slug(text) {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
	}

	function safeHost(url) {
		try {
			return new URL(url).hostname.replace(/^www\./, "") || "page";
		} catch (error) {
			return "page";
		}
	}

	// A snippet counts as a loader when it creates a script element and every
	// absolute URL it mentions points off-site.
	function remoteLoaderUrls(code, host) {
		if (!/createElement\(\s*["']script["']\s*\)/.test(code)) return null;
		const urls = [...code.matchAll(/https?:\/\/[^\s"'`\\)]+/g)].map((match) => match[0]);
		if (!urls.length) return null;
		const remote = urls.filter((url) => safeHost(url) !== host);
		return remote.length === urls.length ? remote : null;
	}

	ns.ScriptExtractor = ScriptExtractor;
})(window.BuilderCopy);
