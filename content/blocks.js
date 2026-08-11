(function (ns) {
	const { blockId, isSkippedTag, isRendered } = ns.util;

	const MAX_NODES = 4000;
	const MAX_DEPTH = 32;
	const MAX_RAW_HTML = 24000;

	// Wrapper styles that carry no visual decision of their own, so the wrapper can
	// be folded into its only child instead of adding a layer to the tree. Inherited
	// properties belong here too: with a single child, moving one down to that child
	// renders identically.
	const MERGEABLE_OWN = [
		"display",
		"flexDirection",
		"boxSizing",
		"width",
		"height",
		"position",
		"flexShrink",
		"flexGrow",
	];

	function isMergeable(property) {
		return MERGEABLE_OWN.includes(property) || ns.styles.INHERITED_PROPERTIES.has(property);
	}

	class BlockBuilder {
		constructor(styleReader, options = {}) {
			this.styles = styleReader;
			this.options = options;
			this.count = 0;
			this.truncated = false;
			this.assets = new Set();
			this.fonts = new Set();
			this.animations = new Set();
			// only the classes the copied stylesheet needs; the rest would be dead weight
			this.keepClasses = options.keepClasses || new Set();
		}

		buildPage() {
			const body = document.body;
			const root = this.build(body, null, 0) || this.emptyRoot();
			root.blockId = "root";
			root.element = "div";
			root.originalElement = "body";
			delete root.blockName;
			this.applyPageBackground(root);
			return root;
		}

		buildElement(el) {
			return this.build(el, el.parentElement, 0);
		}

		build(el, inheritFrom, depth) {
			if (isSkippedTag(el) || depth > MAX_DEPTH || this.count > MAX_NODES) {
				this.truncated = this.truncated || this.count > MAX_NODES;
				return null;
			}
			const computed = getComputedStyle(el);
			if (!isRendered(el, computed)) return null;

			this.count++;
			const descriptor = ns.elements.classify(el);
			const block = this.baseBlock(el, descriptor, inheritFrom);

			if (descriptor.kind === "text") {
				block.innerHTML = ns.elements.inlineHtml(el, (family) => this.trackFont(family));
			} else if (descriptor.kind === "svg" || descriptor.kind === "raw") {
				this.fillRawBlock(block, el, descriptor);
			} else if (descriptor.kind === "container") {
				block.children = this.buildChildren(el, depth);
			}

			this.collectAssets(block);
			return this.simplify(block, descriptor);
		}

		baseBlock(el, descriptor, inheritFrom) {
			const baseStyles = this.styles.base(el, inheritFrom);
			const { tabletStyles, mobileStyles } = this.styles.responsive(el, baseStyles);
			this.trackFont(baseStyles.fontFamily);
			this.trackAnimation(baseStyles.animationName);
			pinFixedToTop(baseStyles);

			const block = {
				blockId: blockId(),
				element: descriptor.tag,
				baseStyles,
				attributes: ns.elements.attributesFor(el, descriptor.kind),
				children: [],
			};
			if (Object.keys(tabletStyles).length) block.tabletStyles = tabletStyles;
			if (Object.keys(mobileStyles).length) block.mobileStyles = mobileStyles;

			const classes = this.classesToKeep(el);
			if (classes.length) block.classes = classes;

			const name = ns.elements.blockName(el, descriptor.kind);
			if (name) block.blockName = name;
			return block;
		}

		classesToKeep(el) {
			if (!this.keepClasses.size) return [];
			return Array.from(el.classList).filter((className) => this.keepClasses.has(className));
		}

		buildChildren(el, depth) {
			const children = [];
			for (const node of Array.from(el.childNodes)) {
				if (node.nodeType === Node.TEXT_NODE) {
					const text = node.textContent.replace(/\s+/g, " ").trim();
					if (text) children.push(this.textNodeBlock(text, el));
					continue;
				}
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const child = this.build(node, el, depth + 1);
				if (child) children.push(child);
			}
			return children;
		}

		// Loose text between elements still needs a block of its own to survive.
		textNodeBlock(text, parent) {
			const styles = this.styles.base(parent, parent.parentElement);
			return {
				blockId: blockId(),
				element: "p",
				innerHTML: text,
				baseStyles: {
					fontSize: styles.fontSize,
					color: styles.color,
					width: "fit-content",
				},
				attributes: {},
				children: [],
			};
		}

		fillRawBlock(block, el, descriptor) {
			const html = descriptor.kind === "svg" ? inlineSvg(el, block.baseStyles) : ns.elements.rawHtml(el);
			if (!html || html.length > MAX_RAW_HTML) {
				this.count--;
				block.skip = true;
				return;
			}
			block.originalElement = "__raw_html__";
			block.innerHTML = html;
			block.element = "div";
		}

		simplify(block, descriptor) {
			if (block.skip) return null;
			if (!Object.keys(block.attributes).length) delete block.attributes;
			if (!block.children.length) delete block.children;

			if (descriptor.kind === "image" && !block.attributes?.src) return null;
			if (descriptor.kind === "container" && !block.children && !hasVisibleStyle(block.baseStyles)) {
				return null;
			}
			return foldSingleChild(block);
		}

		collectAssets(block) {
			const src = block.attributes?.src;
			if (src && /^https?:/.test(src)) this.assets.add(src);
			const background = block.baseStyles?.backgroundImage || "";
			for (const [, url] of background.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
				if (/^https?:/.test(url)) this.assets.add(url);
			}
		}

		trackFont(family) {
			if (family) this.fonts.add(family);
		}

		trackAnimation(name) {
			if (name && name !== "none") name.split(",").forEach((part) => this.animations.add(part.trim()));
		}

		applyPageBackground(root) {
			const html = getComputedStyle(document.documentElement);
			if (!root.baseStyles.backgroundColor) {
				const color = ns.styles.toHex(html.backgroundColor);
				if (color && color !== "transparent" && color !== "#000000") root.baseStyles.backgroundColor = color;
			}
			root.baseStyles.width = "100%";
			delete root.baseStyles.margin;
			delete root.baseStyles.marginTop;
			delete root.baseStyles.marginLeft;
		}

		emptyRoot() {
			return {
				blockId: "root",
				element: "div",
				originalElement: "body",
				baseStyles: {},
				children: [],
			};
		}
	}

	// A container that only wraps one child and adds nothing visual becomes an
	// extra layer to click through in the editor for no benefit.
	function foldSingleChild(block) {
		if (!block.children || block.children.length !== 1) return block;
		if (block.innerHTML || block.attributes || block.blockName || block.classes) return block;
		if (Object.keys(block.baseStyles).some((property) => !isMergeable(property))) return block;
		if (block.tabletStyles || block.mobileStyles) return block;

		const child = block.children[0];
		child.baseStyles = { ...block.baseStyles, ...child.baseStyles };
		return child;
	}

	function hasVisibleStyle(styles) {
		return Boolean(
			styles.backgroundColor ||
			styles.backgroundImage ||
			styles.borderWidth ||
			styles.borderTopWidth ||
			styles.borderBottomWidth ||
			styles.boxShadow ||
			styles.height ||
			styles.minHeight,
		);
	}

	// Fixed elements float over everything while editing; sticky keeps the intent
	// without hijacking the canvas.
	function pinFixedToTop(styles) {
		if (styles.position !== "fixed") return;
		styles.position = "sticky";
		if (styles.left === "0px" || styles.left === "0") delete styles.left;
		if (styles.right === "0px" || styles.right === "0") delete styles.right;
		if (!styles.width) styles.width = "100%";
	}

	function inlineSvg(el, styles) {
		const clone = el.cloneNode(true);
		const width = clone.getAttribute("width");
		const height = clone.getAttribute("height");
		if (width && !styles.width) styles.width = /^\d+$/.test(width) ? `${width}px` : width;
		if (height && !styles.height) styles.height = /^\d+$/.test(height) ? `${height}px` : height;
		clone.removeAttribute("width");
		clone.removeAttribute("height");
		clone.removeAttribute("class");
		if (clone.querySelector("image")) return "";
		return clone.outerHTML;
	}

	ns.BlockBuilder = BlockBuilder;
})(window.BuilderCopy);
