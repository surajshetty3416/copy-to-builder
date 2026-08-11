(function (ns) {
	const { absoluteUrl, titleCase, trimText, isInlineTag } = ns.util;

	const RAW_TAGS = new Set(["iframe", "canvas", "object", "embed", "audio", "map", "table", "select"]);
	const TEXT_TAGS = new Set([
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"p",
		"span",
		"a",
		"li",
		"blockquote",
		"label",
		"cite",
		"strong",
		"em",
		"b",
		"i",
		"summary",
	]);
	// Text-shaped content living in a tag Builder does not treat as text; the copy
	// keeps the styling but swaps the tag so the text stays inline editable.
	const TEXT_FALLBACK = new Set([
		"div",
		"figcaption",
		"td",
		"th",
		"dt",
		"dd",
		"address",
		"pre",
		"time",
		"small",
		"code",
		"legend",
		"caption",
		"figure",
	]);

	const KEEP_INLINE = new Set([
		"a",
		"b",
		"strong",
		"i",
		"em",
		"u",
		"s",
		"small",
		"mark",
		"sub",
		"sup",
		"br",
		"span",
		"code",
		"abbr",
		"time",
		"cite",
	]);

	const NAME_HINTS = [
		"hero",
		"navbar",
		"nav",
		"header",
		"footer",
		"card",
		"banner",
		"cta",
		"testimonial",
		"feature",
		"pricing",
		"gallery",
		"grid",
		"sidebar",
		"menu",
		"modal",
		"badge",
		"avatar",
		"logo",
		"stat",
		"faq",
		"tab",
		"toolbar",
		"breadcrumb",
	];

	const SEMANTIC_NAMES = {
		header: "Header",
		nav: "Nav",
		footer: "Footer",
		main: "Main",
		aside: "Aside",
		section: "Section",
		article: "Article",
		form: "Form",
		ul: "List",
		ol: "List",
		li: "List Item",
		figure: "Figure",
		fieldset: "Fieldset",
	};

	class ElementReader {
		// What kind of Builder block this element should become.
		classify(el) {
			const tag = el.tagName.toLowerCase();
			if (tag === "picture") return { kind: "image", tag: "img" };
			if (tag === "img") return { kind: "image", tag: "img" };
			if (tag === "svg") return { kind: "svg", tag: "div" };
			if (tag === "video") return { kind: "video", tag: "video" };
			if (tag === "input" || tag === "textarea") return { kind: "input", tag };
			if (RAW_TAGS.has(tag)) return { kind: "raw", tag: "div" };
			if (this.isTextual(el)) return { kind: "text", tag: this.textTag(tag) };
			return { kind: "container", tag: this.containerTag(tag) };
		}

		isTextual(el) {
			const tag = el.tagName.toLowerCase();
			if (!TEXT_TAGS.has(tag) && !TEXT_FALLBACK.has(tag) && tag !== "button") return false;
			if (!el.textContent.trim()) return false;
			if (el.querySelector("img, svg, video, iframe, input, textarea, table")) return false;
			if (this.wrapsSingleLink(el)) return false;
			return Array.from(el.children).every((child) => isInlineTag(child.tagName.toLowerCase()));
		}

		// A list item or wrapper whose whole content is one link keeps more of its
		// design as a container plus a link block, since the link carries its own
		// colour, padding and hover target rather than being flattened into text.
		wrapsSingleLink(el) {
			if (el.tagName.toLowerCase() === "a") return false;
			const children = Array.from(el.children);
			if (children.length !== 1 || children[0].tagName.toLowerCase() !== "a") return false;
			return el.textContent.trim() === children[0].textContent.trim();
		}

		textTag(tag) {
			if (TEXT_TAGS.has(tag)) return tag;
			if (tag === "button") return "button";
			return "p";
		}

		containerTag(tag) {
			// Builder recognises section and div as containers; the rest still render
			// but lose the container affordances, so only meaningful semantics are kept.
			const keep = new Set([
				"section",
				"header",
				"footer",
				"nav",
				"main",
				"article",
				"aside",
				"form",
				"ul",
				"ol",
				"li",
				"a",
				"button",
				"label",
				"figure",
				"blockquote",
			]);
			return keep.has(tag) ? tag : "div";
		}

		attributesFor(el, kind) {
			const tag = el.tagName.toLowerCase();
			const attributes = {};

			if (kind === "image") {
				const img = tag === "picture" ? el.querySelector("img") : el;
				if (!img) return attributes;
				attributes.src = absoluteUrl(img.currentSrc || img.src || img.getAttribute("src"));
				if (img.alt) attributes.alt = img.alt;
			}
			if (kind === "video") {
				const source = el.querySelector("source");
				const src = el.getAttribute("src") || source?.getAttribute("src");
				if (src) attributes.src = absoluteUrl(src);
				if (el.poster) attributes.poster = absoluteUrl(el.poster);
				for (const flag of ["autoplay", "muted", "loop", "playsinline", "controls"]) {
					if (el.hasAttribute(flag)) attributes[flag] = "";
				}
			}
			if (kind === "input") {
				for (const name of ["type", "placeholder", "name", "value", "rows", "required", "checked"]) {
					const value = el.getAttribute(name);
					if (value !== null) attributes[name] = value;
				}
			}
			if (tag === "a") {
				const href = el.getAttribute("href");
				if (href) attributes.href = absoluteUrl(href);
				if (el.target) attributes.target = el.target;
			}
			if (tag === "button" && el.type) attributes.type = el.type;
			if (tag === "label" && el.htmlFor) attributes.for = el.htmlFor;

			const label = el.getAttribute("aria-label");
			if (label && !attributes.alt) attributes["aria-label"] = label;
			return attributes;
		}

		// Inline markup Builder's text editor understands, with everything the source
		// site hung off it (classes, inline styles, tracking attributes) removed.
		inlineHtml(el, onFont) {
			const clone = el.cloneNode(true);
			const inlineStyles = new Map();
			const collect = (selector, styleOf) => {
				const sources = el.querySelectorAll(selector);
				clone.querySelectorAll(selector).forEach((node, index) => {
					const style = styleOf(sources[index]);
					if (style) inlineStyles.set(node, style);
				});
			};
			collect("a", linkStyle);
			collect("span", (span) => spanStyle(span, onFont));

			this.cleanInline(clone, inlineStyles);
			const html = clone.innerHTML.replace(/\s+/g, " ").trim();
			return html === "" ? el.textContent.trim() : html;
		}

		cleanInline(node, inlineStyles) {
			for (const child of Array.from(node.children)) {
				const tag = child.tagName.toLowerCase();
				if (!KEEP_INLINE.has(tag)) {
					child.replaceWith(...Array.from(child.childNodes));
					continue;
				}
				this.cleanInline(child, inlineStyles);
				const style = inlineStyles.get(child);
				for (const attribute of Array.from(child.attributes)) {
					const keep = tag === "a" && ["href", "target"].includes(attribute.name);
					if (!keep) child.removeAttribute(attribute.name);
				}
				if (tag === "a" && child.getAttribute("href")) {
					child.setAttribute("href", absoluteUrl(child.getAttribute("href")));
				}
				if (style) child.setAttribute("style", style);
				if (tag === "span" && !child.attributes.length) {
					child.replaceWith(...Array.from(child.childNodes));
				}
			}
		}

		rawHtml(el) {
			const clone = el.cloneNode(true);
			clone.querySelectorAll("script, noscript").forEach((node) => node.remove());
			for (const node of [clone, ...clone.querySelectorAll("*")]) {
				for (const attribute of Array.from(node.attributes || [])) {
					if (attribute.name.startsWith("on")) node.removeAttribute(attribute.name);
				}
			}
			for (const attribute of ["src", "href", "poster"]) {
				const value = clone.getAttribute?.(attribute);
				if (value) clone.setAttribute(attribute, absoluteUrl(value));
			}
			return clone.outerHTML;
		}

		blockName(el, kind) {
			const tag = el.tagName.toLowerCase();
			if (kind === "text") return undefined;
			if (kind === "image") return trimText(el.getAttribute?.("alt") || "", 24) || "Image";
			if (kind === "svg") return "Icon";
			// A class hint beats a generic wrapper tag: article.card reads as Card.
			if (!STRONG_SEMANTICS.has(tag)) {
				const hint = classHint(el);
				if (hint) return hint;
			}
			if (SEMANTIC_NAMES[tag]) return SEMANTIC_NAMES[tag];

			const role = el.getAttribute("role");
			if (role && role !== "presentation") return titleCase(role);

			const hint = classHint(el);
			if (hint) return hint;
			if (tag === "a") return "Link";
			if (tag === "button") return "Button";
			return undefined;
		}
	}

	const STRONG_SEMANTICS = new Set(["header", "nav", "footer", "main", "form", "ul", "ol", "li"]);

	function classHint(el) {
		for (const className of el.classList || []) {
			const hint = NAME_HINTS.find((name) => className.toLowerCase().includes(name));
			if (hint) return titleCase(hint);
		}
		return undefined;
	}

	// Builder's reset styles links inside text blocks, so an inline link has to
	// state its own look or it will pick up Builder's underline and link colour.
	function linkStyle(anchor) {
		if (!anchor) return "";
		const computed = getComputedStyle(anchor);
		const parts = [`color: ${computed.color}`, `text-decoration: ${computed.textDecorationLine}`];
		if (Number(computed.fontWeight) >= 500) parts.push(`font-weight: ${computed.fontWeight}`);
		return parts.join("; ");
	}

	// A span inside a heading or paragraph often owes its look (a display face, an
	// italic, an accent colour) to a class that will not travel, so whatever differs
	// rides along as an inline style. The diff is against the span's own parent, so
	// the per-letter spans a text-split animation leaves behind stay attribute-less
	// and get unwrapped.
	function spanStyle(span, onFont) {
		if (!span || !span.parentElement) return "";
		const computed = getComputedStyle(span);
		const parent = getComputedStyle(span.parentElement);
		const parts = [];
		if (computed.fontFamily !== parent.fontFamily) {
			parts.push(`font-family: ${computed.fontFamily}`);
			onFont && onFont(ns.styles.firstFamily(computed.fontFamily));
		}
		if (computed.fontStyle !== parent.fontStyle) parts.push(`font-style: ${computed.fontStyle}`);
		if (computed.fontWeight !== parent.fontWeight) parts.push(`font-weight: ${computed.fontWeight}`);
		if (computed.color !== parent.color) parts.push(`color: ${ns.styles.toHex(computed.color)}`);
		return parts.join("; ");
	}

	ns.elements = new ElementReader();
})(window.BuilderCopy);
