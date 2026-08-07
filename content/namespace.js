window.BuilderCopy = window.BuilderCopy || {};

(function (ns) {
	const SKIP_TAGS = new Set([
		"script",
		"style",
		"link",
		"meta",
		"noscript",
		"template",
		"head",
		"title",
		"base",
		"br",
		"wbr",
	]);

	ns.util = {
		absoluteUrl(url, base) {
			if (!url) return "";
			const trimmed = String(url).trim();
			if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
			try {
				return new URL(trimmed, base || document.baseURI).href;
			} catch (error) {
				return trimmed;
			}
		},

		absolutizeCssUrls(value, base) {
			if (!value || !value.includes("url(")) return value;
			return value.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
				const absolute = ns.util.absoluteUrl(url, base);
				return `url(${quote}${absolute}${quote})`;
			});
		},

		camel(property) {
			return property.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
		},

		hash(text) {
			let value = 5381;
			for (let i = 0; i < text.length; i++) {
				value = (value << 5) + value + text.charCodeAt(i);
			}
			return Math.abs(value).toString(36);
		},

		blockId() {
			return Math.random().toString(36).substring(2, 10);
		},

		titleCase(text) {
			return text
				.replace(/[-_]+/g, " ")
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.trim()
				.split(/\s+/)
				.slice(0, 4)
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ");
		},

		trimText(text, length = 40) {
			const clean = (text || "").replace(/\s+/g, " ").trim();
			return clean.length > length ? `${clean.slice(0, length)}...` : clean;
		},

		isSkippedTag(el) {
			return SKIP_TAGS.has(el.tagName.toLowerCase());
		},

		// Off-screen or collapsed nodes carry no design intent and would only add noise.
		isRendered(el, style) {
			if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
			if (el.getAttribute("aria-hidden") === "true" && !el.querySelector("img, svg")) return false;
			if (el.tagName === "IMG" || el.tagName === "svg" || el.tagName === "SVG") return true;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0 && el.childElementCount === 0) {
				return Boolean(el.textContent.trim());
			}
			return true;
		},

		hasOnlyInlineContent(el) {
			return Array.from(el.children).every((child) => ns.util.isInlineTag(child.tagName.toLowerCase()));
		},

		isInlineTag(tag) {
			return INLINE_TAGS.has(tag);
		},
	};

	const INLINE_TAGS = new Set([
		"a",
		"abbr",
		"b",
		"br",
		"cite",
		"code",
		"del",
		"em",
		"i",
		"ins",
		"kbd",
		"mark",
		"q",
		"s",
		"samp",
		"small",
		"span",
		"strong",
		"sub",
		"sup",
		"time",
		"u",
		"var",
	]);

	ns.INLINE_TAGS = INLINE_TAGS;

	// The part of Builder's reset (builder/public/reset.css) that changes the values
	// this extension reads. Blocks are compared against this instead of the browser
	// defaults, so a style is copied when, and only when, Builder would render it
	// differently. Keep in sync if that reset changes.
	ns.BUILDER_BASELINE_CSS = `
		*, ::before, ::after { box-sizing: border-box; border: 0 solid #e5e7eb; }
		html { line-height: 1.5; font-family: InterVar, ui-sans-serif, system-ui, sans-serif; }
		body { margin: 0; line-height: inherit; }
		h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; margin: 0; }
		p, blockquote, dd, dl, figure, hr, pre, fieldset, legend { margin: 0; }
		fieldset, legend { padding: 0; }
		a { color: inherit; text-decoration: inherit; }
		b, strong { font-weight: bolder; }
		small { font-size: 80%; }
		sub, sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }
		menu, ol, ul { margin: 0; }
		ol, ul { list-style: revert; padding: revert; }
		button, input, optgroup, select, textarea {
			font-family: inherit; font-size: 100%; font-weight: inherit; line-height: inherit;
			letter-spacing: inherit; color: inherit; margin: 0; padding: 0;
		}
		button, [role="button"] { cursor: pointer; }
		button { background-color: transparent; background-image: none; }
		audio, canvas, embed, iframe, img, object, svg, video { display: block; vertical-align: middle; }
		img, video { max-width: 100%; height: auto; }
		table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
		textarea { resize: vertical; }
		summary { display: list-item; }
		input, select, textarea {
			background-color: #fff; border-color: #6b7280; border-width: 1px; border-radius: 0;
			padding: 0.5rem 0.75rem; font-size: 1rem; line-height: 1.5rem;
		}
	`;
})(window.BuilderCopy);
