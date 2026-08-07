(function (ns) {
	const { absolutizeCssUrls, camel } = ns.util;

	// A read-only re-implementation of the parts of the cascade we need: which
	// declarations win for an element at a given viewport width. getComputedStyle
	// only ever answers for the current width, so responsive styles have to come
	// from the rules themselves.
	class CascadeIndex {
		constructor() {
			this.buckets = new Map();
			this.order = 0;
			this.fontFaces = [];
			this.hasMediaRules = false;
			// hover, focus and ::before styles cannot live on a block; they are kept
			// aside so they can travel as a stylesheet instead of being lost
			this.interactiveRules = [];
			this.keyframes = new Map();
		}

		static async build() {
			const index = new CascadeIndex();
			for (const sheet of Array.from(document.styleSheets)) {
				const rules = await readRules(sheet);
				const base = sheet.href || document.baseURI;
				index.addRules(rules, base, [], []);
			}
			return index;
		}

		addRules(rules, base, conditions, media) {
			for (const rule of rules) {
				if (rule instanceof CSSStyleRule) {
					this.addStyleRule(rule, base, conditions, media);
				} else if (rule instanceof CSSMediaRule) {
					const text = rule.conditionText || rule.media.mediaText;
					const condition = parseMediaCondition(text);
					if (condition === SKIP) continue;
					if (condition) this.hasMediaRules = true;
					this.addRules(
						Array.from(rule.cssRules),
						base,
						conditions.concat(condition ? [condition] : []),
						media.concat([text]),
					);
				} else if (rule instanceof CSSKeyframesRule) {
					this.keyframes.set(rule.name, rule.cssText);
				} else if (rule instanceof CSSSupportsRule || rule.cssRules) {
					if (rule instanceof CSSFontFaceRule) {
						this.addFontFace(rule, base);
						continue;
					}
					this.addRules(Array.from(rule.cssRules), base, conditions, media);
				} else if (rule instanceof CSSFontFaceRule) {
					this.addFontFace(rule, base);
				}
			}
		}

		// Kept both as CSS, for pages that keep loading the fonts from where they came
		// from, and as descriptors, so Builder can recreate them as its own fonts.
		addFontFace(rule, base) {
			const family = unquote(rule.style.getPropertyValue("font-family"));
			if (!family) return;
			this.fontFaces.push({
				css: absolutizeCssUrls(rule.cssText, base),
				family,
				weight: rule.style.getPropertyValue("font-weight") || "400",
				style: rule.style.getPropertyValue("font-style") || "normal",
				url: bestFontUrl(rule.style.getPropertyValue("src"), base),
			});
		}

		addStyleRule(rule, base, conditions, media) {
			const declarations = readDeclarations(rule.style, base);

			for (const selector of splitSelectors(rule.selectorText)) {
				if (isInteractiveSelector(selector)) {
					const body = rule.style.cssText;
					if (body) {
						this.interactiveRules.push({
							selector,
							body: absolutizeCssUrls(body, base),
							media: media.join(" and "),
						});
					}
					continue;
				}
				if (!declarations || isUnusableSelector(selector)) continue;
				const entry = {
					selector,
					declarations,
					conditions,
					specificity: specificityOf(selector),
					order: this.order++,
				};
				const key = bucketKey(selector);
				if (!this.buckets.has(key)) this.buckets.set(key, []);
				this.buckets.get(key).push(entry);
			}
		}

		candidatesFor(el) {
			const keys = ["*", el.tagName.toLowerCase()];
			if (el.id) keys.push(`#${el.id}`);
			for (const className of el.classList) keys.push(`.${className}`);

			const candidates = [];
			for (const key of keys) {
				const bucket = this.buckets.get(key);
				if (bucket) candidates.push(...bucket);
			}
			return candidates;
		}

		// Winning declarations for the element as if the viewport were `width` wide.
		resolveAtWidth(el, width) {
			const winners = new Map();
			const matched = this.candidatesFor(el)
				.filter((entry) => entry.conditions.every((condition) => condition(width)))
				.filter((entry) => safeMatches(el, entry.selector))
				.sort((a, b) => a.specificity - b.specificity || a.order - b.order);

			for (const entry of matched) {
				for (const [property, value] of Object.entries(entry.declarations)) {
					winners.set(property, value);
				}
			}
			return winners;
		}
	}

	// Cross-origin sheets throw on .cssRules, so refetch the text and reparse it.
	async function readRules(sheet) {
		try {
			return Array.from(sheet.cssRules);
		} catch (error) {
			if (!sheet.href) return [];
			const text = await fetchStylesheet(sheet.href);
			if (!text) return [];
			try {
				const parsed = new CSSStyleSheet();
				parsed.replaceSync(text);
				return Array.from(parsed.cssRules);
			} catch (parseError) {
				return [];
			}
		}
	}

	const sheetCache = new Map();

	function fetchStylesheet(url) {
		if (!sheetCache.has(url)) {
			sheetCache.set(
				url,
				chrome.runtime
					.sendMessage({ type: "fetchStylesheet", url })
					.then((response) => response?.text || "")
					.catch(() => ""),
			);
		}
		return sheetCache.get(url);
	}

	function readDeclarations(style, base) {
		const declarations = {};
		const set = (property, value) => {
			declarations[camel(property)] = absolutizeCssUrls(value.trim(), base);
		};

		for (const property of style) {
			const targets = physicalProperties(property);
			if (!targets.length) continue;
			const value = style.getPropertyValue(property);
			if (!value) continue;
			targets.forEach((target) => set(target, value));
		}
		expandVarShorthands(style, declarations, set);
		return Object.keys(declarations).length ? declarations : null;
	}

	// A shorthand holding a var() keeps its longhands empty in the CSSOM until the
	// value is substituted, which hides most of a utility framework's rules from the
	// loop above. Reading the shorthand back gets them.
	const SHORTHAND_EXPANSIONS = {
		padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
		"padding-inline": ["padding-left", "padding-right"],
		"padding-block": ["padding-top", "padding-bottom"],
		margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
		"margin-inline": ["margin-left", "margin-right"],
		"margin-block": ["margin-top", "margin-bottom"],
		gap: ["row-gap", "column-gap"],
		inset: ["top", "right", "bottom", "left"],
		"inset-inline": ["left", "right"],
		"inset-block": ["top", "bottom"],
		"border-radius": [
			"border-top-left-radius",
			"border-top-right-radius",
			"border-bottom-right-radius",
			"border-bottom-left-radius",
		],
		"border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
		"border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
	};

	function expandVarShorthands(style, declarations, set) {
		for (const [shorthand, longhands] of Object.entries(SHORTHAND_EXPANSIONS)) {
			const value = style.getPropertyValue(shorthand);
			// a multi part value cannot be split reliably while it still holds var()
			if (!value || hasMultipleParts(value)) continue;
			for (const longhand of longhands) {
				if (declarations[camel(longhand)] === undefined) set(longhand, value);
			}
		}
	}

	function hasMultipleParts(value) {
		let depth = 0;
		for (const char of value.trim()) {
			if (char === "(") depth++;
			else if (char === ")") depth--;
			else if (depth === 0 && /\s/.test(char)) return true;
		}
		return false;
	}

	// Modern CSS (all of Tailwind v4) writes logical properties. They never show up
	// as padding-left or width in the CSSOM, so without this map every rule built
	// from them is invisible to the index.
	const LOGICAL_TO_PHYSICAL = {
		"inline-size": ["width"],
		"block-size": ["height"],
		"min-inline-size": ["min-width"],
		"max-inline-size": ["max-width"],
		"min-block-size": ["min-height"],
		"max-block-size": ["max-height"],
		"padding-block-start": ["padding-top"],
		"padding-block-end": ["padding-bottom"],
		"margin-block-start": ["margin-top"],
		"margin-block-end": ["margin-bottom"],
		"inset-block-start": ["top"],
		"inset-block-end": ["bottom"],
		"border-block-start-width": ["border-top-width"],
		"border-block-end-width": ["border-bottom-width"],
		"border-block-start-style": ["border-top-style"],
		"border-block-end-style": ["border-bottom-style"],
		"border-block-start-color": ["border-top-color"],
		"border-block-end-color": ["border-bottom-color"],
	};

	// start and end follow the writing direction
	const INLINE_SIDES = {
		"padding-inline-start": ["padding-left", "padding-right"],
		"padding-inline-end": ["padding-right", "padding-left"],
		"margin-inline-start": ["margin-left", "margin-right"],
		"margin-inline-end": ["margin-right", "margin-left"],
		"inset-inline-start": ["left", "right"],
		"inset-inline-end": ["right", "left"],
		"border-inline-start-width": ["border-left-width", "border-right-width"],
		"border-inline-end-width": ["border-right-width", "border-left-width"],
		"border-inline-start-color": ["border-left-color", "border-right-color"],
		"border-inline-end-color": ["border-right-color", "border-left-color"],
		"border-inline-start-style": ["border-left-style", "border-right-style"],
		"border-inline-end-style": ["border-right-style", "border-left-style"],
		"border-start-start-radius": ["border-top-left-radius", "border-top-right-radius"],
		"border-start-end-radius": ["border-top-right-radius", "border-top-left-radius"],
		"border-end-end-radius": ["border-bottom-right-radius", "border-bottom-left-radius"],
		"border-end-start-radius": ["border-bottom-left-radius", "border-bottom-right-radius"],
	};

	let rtl = null;

	function physicalProperties(property) {
		if (ns.styles.isTrackedProperty(property)) return [property];
		if (LOGICAL_TO_PHYSICAL[property]) return LOGICAL_TO_PHYSICAL[property];
		const sides = INLINE_SIDES[property];
		if (!sides) return [];
		if (rtl === null) rtl = getComputedStyle(document.documentElement).direction === "rtl";
		return [rtl ? sides[1] : sides[0]];
	}

	const SKIP = Symbol("skip");

	// Returns a width predicate, null when the condition is width independent,
	// or SKIP for conditions that should never contribute (print, dark mode).
	function parseMediaCondition(text) {
		const condition = (text || "").toLowerCase().trim();
		if (!condition || condition === "all" || condition === "screen") return null;
		if (condition.includes("print") || condition.includes("prefers-color-scheme")) return SKIP;
		if (condition.includes("prefers-reduced-motion") || condition.includes("forced-colors")) return SKIP;

		const branches = condition.split(",").map((branch) => branch.trim());
		const predicates = branches.map(branchPredicate).filter(Boolean);
		if (!predicates.length) return null;
		return (width) => predicates.some((predicate) => predicate(width));
	}

	function branchPredicate(branch) {
		if (branch.startsWith("not ")) return null;
		const bounds = { min: 0, max: Infinity };
		let sawWidth = false;

		for (const [, feature, raw] of branch.matchAll(/\((min|max)-width:\s*([^)]+)\)/g)) {
			const px = toPx(raw);
			if (px === null) continue;
			sawWidth = true;
			if (feature === "min") bounds.min = Math.max(bounds.min, px);
			else bounds.max = Math.min(bounds.max, px);
		}
		// Range syntax: (width <= 600px), (400px < width <= 900px)
		for (const [, operator, raw] of branch.matchAll(/width\s*(<=|<|>=|>)\s*([\d.]+(?:px|r?em)?)/g)) {
			const px = toPx(raw);
			if (px === null) continue;
			sawWidth = true;
			if (operator.startsWith("<")) bounds.max = Math.min(bounds.max, operator === "<" ? px - 0.02 : px);
			else bounds.min = Math.max(bounds.min, operator === ">" ? px + 0.02 : px);
		}
		for (const [, raw, operator] of branch.matchAll(/([\d.]+(?:px|r?em)?)\s*(<=|<)\s*width/g)) {
			const px = toPx(raw);
			if (px === null) continue;
			sawWidth = true;
			bounds.min = Math.max(bounds.min, operator === "<" ? px + 0.02 : px);
		}

		if (!sawWidth) {
			// Non-width features (hover, pointer, orientation) keep whatever the real
			// browser says, since the copy is taken on this device anyway.
			const matches = safeMatchMedia(branch);
			return matches ? null : () => false;
		}
		return (width) => width >= bounds.min && width <= bounds.max;
	}

	function toPx(raw) {
		const match = String(raw)
			.trim()
			.match(/^([\d.]+)(px|em|rem)?$/);
		if (!match) return null;
		const value = parseFloat(match[1]);
		if (Number.isNaN(value)) return null;
		if (match[2] === "em" || match[2] === "rem") return value * rootFontSize();
		return value;
	}

	let rootSize = 0;

	function rootFontSize() {
		if (!rootSize) rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		return rootSize;
	}

	function safeMatchMedia(condition) {
		try {
			return window.matchMedia(condition).matches;
		} catch (error) {
			return true;
		}
	}

	function splitSelectors(selectorText) {
		const parts = [];
		let depth = 0;
		let current = "";
		for (const char of selectorText || "") {
			if (char === "(" || char === "[") depth++;
			if (char === ")" || char === "]") depth--;
			if (char === "," && depth === 0) {
				parts.push(current.trim());
				current = "";
				continue;
			}
			current += char;
		}
		if (current.trim()) parts.push(current.trim());
		return parts;
	}

	// Pseudo elements and interaction states would land on the block as if they were
	// its resting style. They are pulled out of the cascade and shipped as CSS instead.
	// An escaped colon (Tailwind's .md\:flex) is part of a class name, not a state.
	const INTERACTIVE =
		/(^|[^\\])(::|:hover|:focus|:focus-visible|:focus-within|:active|:checked|:disabled|:placeholder-shown)/;
	const UNUSABLE = /:target|:visited|:where\(\s*\)/;

	function isInteractiveSelector(selector) {
		return Boolean(selector) && INTERACTIVE.test(selector);
	}

	function isUnusableSelector(selector) {
		return !selector || UNUSABLE.test(selector);
	}

	function safeMatches(el, selector) {
		try {
			return el.matches(selector);
		} catch (error) {
			return false;
		}
	}

	// The rightmost simple selector decides the bucket, the same way browsers
	// avoid matching every element against every rule. Class names carry CSS
	// escapes (Tailwind writes .md\:grid-cols-3), so the token has to be read
	// with its escapes intact and unescaped only to compare with classList.
	function bucketKey(selector) {
		const last =
			selector
				.split(/[\s>+~]+/)
				.filter(Boolean)
				.pop() || "";
		const id = last.match(/#((?:\\.|[^\s.#[\]:>+~()])+)/);
		if (id) return `#${unescapeSelector(id[1])}`;
		const className = last.match(/\.((?:\\.|[^\s.#[\]:>+~()])+)/);
		if (className) return `.${unescapeSelector(className[1])}`;
		const tag = last.match(/^([a-zA-Z][\w-]*)/);
		if (tag) return tag[1].toLowerCase();
		return "*";
	}

	function unescapeSelector(token) {
		return token.replace(/\\(.)/g, "$1");
	}

	function unquote(value) {
		return (value || "").trim().replace(/^["']|["']$/g, "");
	}

	// woff2 first: it is the smallest and every browser Builder targets reads it.
	const FORMAT_RANK = { woff2: 0, woff: 1, "opentype-variations": 2, opentype: 3, truetype: 4 };

	function bestFontUrl(src, base) {
		const sources = [];
		for (const [, , url, , format] of (src || "").matchAll(
			/url\((['"]?)([^'")]+)\1\)(?:\s*format\((['"]?)([^'")]+)\3\))?/g,
		)) {
			if (url.startsWith("data:")) continue;
			const extension = (url.split("?")[0].split(".").pop() || "").toLowerCase();
			sources.push({ url, rank: FORMAT_RANK[format] ?? FORMAT_RANK[extension] ?? 9 });
		}
		if (!sources.length) return "";
		sources.sort((a, b) => a.rank - b.rank);
		return ns.util.absoluteUrl(sources[0].url, base);
	}

	function specificityOf(selector) {
		const ids = (selector.match(/#[\w-]+/g) || []).length;
		const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+/gi) || []).length;
		const tags = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
		return ids * 10000 + classes * 100 + tags;
	}

	ns.CascadeIndex = CascadeIndex;
})(window.BuilderCopy);
