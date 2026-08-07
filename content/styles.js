(function (ns) {
	const { camel, absolutizeCssUrls } = ns.util;

	// Sampled at Builder's own breakpoint widths so the copy lands on the same
	// three style buckets the editor edits.
	const BREAKPOINT_WIDTH = { desktop: 1400, tablet: 800, mobile: 420 };

	const LAYOUT_PROPS = [
		"display",
		"flex-direction",
		"flex-wrap",
		"justify-content",
		"align-items",
		"align-self",
		"align-content",
		"justify-items",
		"justify-self",
		"order",
		"flex-grow",
		"flex-shrink",
		"flex-basis",
		"gap",
		"row-gap",
		"column-gap",
		"grid-template-columns",
		"grid-template-rows",
		"grid-auto-flow",
		"grid-auto-columns",
		"grid-auto-rows",
		"grid-column",
		"grid-row",
	];

	const BOX_PROPS = [
		"width",
		"height",
		"min-width",
		"min-height",
		"max-width",
		"max-height",
		"box-sizing",
		"aspect-ratio",
		"margin-top",
		"margin-right",
		"margin-bottom",
		"margin-left",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"position",
		"top",
		"right",
		"bottom",
		"left",
		"z-index",
		"float",
	];

	const TYPOGRAPHY_PROPS = [
		"color",
		"font-family",
		"font-size",
		"font-weight",
		"font-style",
		"line-height",
		"letter-spacing",
		"text-align",
		"text-transform",
		"text-decoration-line",
		"text-decoration-color",
		"text-shadow",
		"white-space",
		"word-break",
		"text-wrap",
		"vertical-align",
		"list-style-type",
	];

	const PAINT_PROPS = [
		"background-color",
		"background-image",
		"background-size",
		"background-position",
		"background-repeat",
		"background-clip",
		"background-attachment",
		"background-blend-mode",
		"border-top-width",
		"border-right-width",
		"border-bottom-width",
		"border-left-width",
		"border-top-style",
		"border-right-style",
		"border-bottom-style",
		"border-left-style",
		"border-top-color",
		"border-right-color",
		"border-bottom-color",
		"border-left-color",
		"border-top-left-radius",
		"border-top-right-radius",
		"border-bottom-right-radius",
		"border-bottom-left-radius",
		"box-shadow",
		"opacity",
		"overflow-x",
		"overflow-y",
		"object-fit",
		"object-position",
		"filter",
		"backdrop-filter",
		"mix-blend-mode",
		"transform",
		"transform-origin",
		"rotate",
		"transition-property",
		"transition-duration",
		"transition-timing-function",
		"animation-name",
		"animation-duration",
		"animation-timing-function",
		"animation-delay",
		"animation-iteration-count",
		"animation-direction",
		"animation-fill-mode",
		"cursor",
	];

	const TRACKED = new Set([...LAYOUT_PROPS, ...BOX_PROPS, ...TYPOGRAPHY_PROPS, ...PAINT_PROPS]);

	// getComputedStyle resolves these to used pixel values, which would freeze the
	// layout at the width the copy was taken. The Typed OM keeps auto, %, and calc().
	const TYPED = new Set([
		"width",
		"height",
		"min-width",
		"min-height",
		"max-width",
		"max-height",
		"margin-top",
		"margin-right",
		"margin-bottom",
		"margin-left",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"top",
		"right",
		"bottom",
		"left",
		"flex-basis",
		"line-height",
		"gap",
		"row-gap",
		"column-gap",
		"grid-template-columns",
		"grid-template-rows",
		"aspect-ratio",
	]);

	const VIEWPORT_UNIT = /\d(vh|vw|vmin|vmax|svh|svw|lvh|lvw|dvh|dvw)\b/;

	const INHERITED = new Set([
		"color",
		"font-family",
		"font-size",
		"font-weight",
		"font-style",
		"line-height",
		"letter-spacing",
		"text-align",
		"text-transform",
		"white-space",
		"word-break",
		"text-wrap",
		"list-style-type",
		"cursor",
		"visibility",
	]);

	// Emitting one of these would make Builder request a Google font that does not exist.
	const SYSTEM_FAMILIES = new Set([
		"-apple-system",
		"blinkmacsystemfont",
		"segoe ui",
		"system-ui",
		"ui-sans-serif",
		"ui-serif",
		"ui-monospace",
		"sans-serif",
		"serif",
		"monospace",
		"cursive",
		"fantasy",
		"helvetica",
		"helvetica neue",
		"arial",
		"apple color emoji",
		"segoe ui emoji",
		"inherit",
		"initial",
	]);

	class StyleReader {
		constructor(cascade, baselineCss) {
			this.cascade = cascade;
			// the live reset from the Builder site when one is configured, so this
			// stays right when Builder's reset changes
			this.baselineCss = baselineCss || ns.BUILDER_BASELINE_CSS;
			this.rawCache = new WeakMap();
			this.specifiedCache = new WeakMap();
			this.defaults = new Map();
			this.sandbox = null;
		}

		base(el, inheritFrom) {
			const raw = this.raw(el);
			const defaults = this.defaultsFor(el.tagName.toLowerCase());
			const inherited = inheritFrom ? this.raw(inheritFrom) : null;
			const styles = {};

			for (const property of TRACKED) {
				const value = this.viewportValue(el, property) || raw[property];
				if (value === "" || value === undefined) continue;
				if (this.isRedundant(property, value, defaults, inherited)) continue;
				const normalized = normalizeValue(property, value, el);
				if (normalized === null) continue;
				styles[camel(property)] = normalized;
			}
			return prune(collapseShorthands(styles));
		}

		// An inherited property has no meaningful per-tag default: what the probe
		// reports is only what the blank frame handed down, not something the tag asks
		// for. Comparing against it drops black text that sits inside a white-on-dark
		// section, which then inherits the section's colour and disappears. What such a
		// property has to be measured against is the ancestor the block will inherit
		// from, and only when there is one.
		isRedundant(property, value, defaults, inherited) {
			if (!INHERITED.has(property)) return value === defaults[property];
			if (inherited) return inherited[property] === value;
			return value === defaults[property];
		}

		// Viewport units are absolute by the time they are computed, which would nail
		// a 100vh hero to the height of the window the copy was taken in.
		viewportValue(el, property) {
			if (!TYPED.has(property)) return "";
			const inline = el.style?.getPropertyValue(property);
			if (VIEWPORT_UNIT.test(inline || "")) return inline.trim();
			const specified = this.specified(el)?.get(camel(property));
			return VIEWPORT_UNIT.test(specified || "") ? resolveVars(specified, el) : "";
		}

		specified(el) {
			if (!this.cascade) return null;
			if (!this.specifiedCache.has(el)) {
				this.specifiedCache.set(el, this.cascade.resolveAtWidth(el, BREAKPOINT_WIDTH.desktop));
			}
			return this.specifiedCache.get(el);
		}

		responsive(el, baseStyles) {
			if (!this.cascade?.hasMediaRules) return { tabletStyles: {}, mobileStyles: {} };

			const desktop = this.specified(el);
			const tablet = this.cascade.resolveAtWidth(el, BREAKPOINT_WIDTH.tablet);
			const mobile = this.cascade.resolveAtWidth(el, BREAKPOINT_WIDTH.mobile);

			const defaults = this.defaultsFor(el.tagName.toLowerCase());
			const tabletStyles = collapseShorthands(diffDeclarations(tablet, desktop, baseStyles, el, defaults));
			const mobileStyles = collapseShorthands(
				diffDeclarations(mobile, tablet, { ...baseStyles, ...tabletStyles }, el, defaults),
			);
			return { tabletStyles, mobileStyles };
		}

		raw(el) {
			if (this.rawCache.has(el)) return this.rawCache.get(el);
			const values = readRaw(el);
			this.rawCache.set(el, values);
			return values;
		}

		// A bare element in a frame carrying Builder's own reset tells us exactly what
		// Builder needs to be told: anything the site relies on the browser default
		// for (h1 sizes, list markers, paragraph margins) is a real difference there.
		defaultsFor(tag) {
			if (this.defaults.has(tag)) return this.defaults.get(tag);
			let values = {};
			const doc = this.sandboxDocument();
			if (doc) {
				const probe = doc.createElement(tag);
				if (tag === "img") probe.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
				if (tag === "a") probe.href = "#";
				probe.textContent = "x";
				doc.body.appendChild(probe);
				values = readRaw(probe);
				probe.remove();
			}
			this.defaults.set(tag, values);
			return values;
		}

		sandboxDocument() {
			if (this.sandbox === null) {
				try {
					const frame = document.createElement("iframe");
					frame.setAttribute("aria-hidden", "true");
					frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;";
					document.documentElement.appendChild(frame);
					const doc = frame.contentDocument;
					if (doc) {
						const style = doc.createElement("style");
						style.textContent = this.baselineCss;
						doc.head.appendChild(style);
					}
					this.sandbox = doc || false;
				} catch (error) {
					this.sandbox = false;
				}
			}
			return this.sandbox || null;
		}
	}

	function readRaw(el) {
		const computed = getComputedStyle(el);
		const typed = typedMap(el);
		const values = {};
		for (const property of TRACKED) {
			values[property] =
				(TYPED.has(property) && typed ? typedValue(typed, property) : "") ||
				computed.getPropertyValue(property);
		}
		return values;
	}

	function typedMap(el) {
		try {
			return el.computedStyleMap ? el.computedStyleMap() : null;
		} catch (error) {
			return null;
		}
	}

	function typedValue(map, property) {
		try {
			const value = map.get(property);
			return value ? String(value) : "";
		} catch (error) {
			return "";
		}
	}

	function diffDeclarations(target, reference, base, el, defaults) {
		const styles = {};
		for (const [property, rawValue] of target) {
			if (reference.get(property) === rawValue) continue;
			const value = normalizeValue(kebab(property), resolveVars(rawValue, el), el);
			if (value === null || value === base[property]) continue;
			styles[property] = value;
		}
		addReverts(styles, target, reference, base, el, defaults);
		return styles;
	}

	// With min-width breakpoints (how Tailwind and most frameworks work) the
	// narrow view is the one with NO rule: sm:flex simply stops applying. Nothing
	// shows up in the narrow declarations, so the block would keep the wide value
	// unless the property is explicitly put back to its default.
	function addReverts(styles, target, reference, base, el, defaults) {
		for (const property of reference.keys()) {
			if (target.has(property) || styles[property] !== undefined) continue;
			const cssProperty = kebab(property);
			// an inherited property with no rule takes its parent's value, which is
			// not knowable from this element alone, so it is left as it is
			if (INHERITED.has(cssProperty)) continue;
			if (base[property] === undefined) continue;
			const fallback = defaults[cssProperty];
			if (!fallback || fallback === base[property]) continue;
			const value = normalizeValue(cssProperty, fallback, el);
			if (value !== null && value !== base[property]) styles[property] = value;
		}
	}

	// Media rules hold specified values, so a var() that only exists on the source
	// site has to be swapped for what it resolves to there.
	function resolveVars(value, el, depth = 0) {
		if (depth > 3 || !value.includes("var(")) return value;
		const resolved = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (match, name, fallback) => {
			const custom = getComputedStyle(el).getPropertyValue(name).trim();
			return custom || (fallback || "").trim() || match;
		});
		return resolved === value ? value : resolveVars(resolved, el, depth + 1);
	}

	function normalizeValue(property, value, el) {
		let normalized = String(value).trim();
		if (!normalized || (normalized === "none" && property === "background-image")) return null;
		if (normalized.includes("url(")) normalized = absolutizeCssUrls(normalized, document.baseURI);

		if (property === "transform") return relativeTranslate(normalized, el);
		if (property === "font-family") return firstFamily(normalized);
		if (property.endsWith("color") || property === "color") return toHex(normalized);
		if (property === "background-image" || property === "box-shadow" || property === "text-shadow") {
			return toHexInside(normalized);
		}
		if (property === "transition-property" && normalized === "all") return null;
		return simplifyCalc(normalized);
	}

	// A carousel is a flex track shifted by whole viewport widths, and the browser
	// reports that shift in pixels measured at the width the copy was taken at. On a
	// canvas of any other width every slide lands askew, showing a sliver of the next
	// one. A translate percentage is relative to the element's own box, so the same
	// shift keeps its meaning at any width.
	function relativeTranslate(value, el) {
		const numbers = value.match(/^matrix(3d)?\(([^)]+)\)$/);
		if (!numbers) return value;

		const parts = numbers[2].split(",").map((part) => parseFloat(part));
		const is3d = Boolean(numbers[1]);
		const identity = is3d ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] : [1, 0, 0, 1];
		const head = parts.slice(0, identity.length);
		// anything rotated or scaled cannot be restated as a percentage
		if (head.some((part, index) => part !== identity[index])) return value;

		const [x, y] = is3d ? [parts[12], parts[13]] : [parts[4], parts[5]];
		const width = el.offsetWidth;
		const height = el.offsetHeight;
		if (!x && !y) return "none";
		if ((x && !width) || (y && !height)) return value;

		const toPercent = (offset, size) => (offset ? `${round((offset / size) * 100)}%` : "0");
		return `translate(${toPercent(x, width)}, ${toPercent(y, height)})`;
	}

	// Utility frameworks compute spacing as calc(.25rem * 6). Builder's inputs can
	// only edit a plain length, so collapse the arithmetic when it is this simple.
	function simplifyCalc(value) {
		const match = value.match(/^calc\(\s*([\d.]+)(px|rem)?\s*([*/])\s*([\d.]+)(px|rem)?\s*\)$/);
		if (!match) return value;
		const [, left, leftUnit, operator, right, rightUnit] = match;
		if (leftUnit && rightUnit) return value;
		const scalar = operator === "*" ? Number(left) * Number(right) : Number(left) / Number(right);
		if (!Number.isFinite(scalar)) return value;
		const unit = leftUnit || rightUnit;
		if (!unit) return String(round(scalar));
		const px = unit === "rem" ? scalar * rootFontSize() : scalar;
		return `${round(px)}px`;
	}

	function round(value) {
		return Math.round(value * 1000) / 1000;
	}

	let rootSize = 0;

	function rootFontSize() {
		if (!rootSize) rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		return rootSize;
	}

	function firstFamily(stack) {
		const first = (stack.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
		if (!first || SYSTEM_FAMILIES.has(first.toLowerCase())) return null;
		return first;
	}

	function toHex(value) {
		const match = value.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/);
		if (!match) return value;
		const alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
		if (alpha === 0) return "transparent";
		const hex = [match[1], match[2], match[3]]
			.map((part) => Number(part).toString(16).padStart(2, "0"))
			.join("");
		return alpha === 1 ? `#${hex}` : value;
	}

	function toHexInside(value) {
		return value.replace(/rgba?\([^)]+\)/g, (color) => toHex(color));
	}

	// Values the browser reports for every element because they resolve from
	// something else (currentColor, the element's own box) rather than from a
	// decision the site made.
	function prune(styles) {
		// an origin only matters for a rotation or a scale, and the reported one is a
		// pixel pair measured at the size the copy was taken at
		const spins = styles.rotate || /rotate|scale|skew|matrix/.test(styles.transform || "");
		if (!spins) delete styles.transformOrigin;
		if (!styles.textDecorationLine || styles.textDecorationLine === "none") {
			delete styles.textDecorationColor;
		}
		pruneBorders(styles);
		if (styles.display && !/inline|table-cell/.test(styles.display)) delete styles.verticalAlign;
		if (styles.rowGap === styles.columnGap && styles.gap) {
			delete styles.rowGap;
			delete styles.columnGap;
		}
		if (styles.gap && styles.rowGap && styles.rowGap !== styles.columnGap) delete styles.gap;
		return styles;
	}

	// A side with no width still reports a colour and a style, and those inherit from
	// the text colour, which is how every block ends up claiming a border it has not got.
	function pruneBorders(styles) {
		const uniform = isWidth(styles.borderWidth);
		for (const side of ["Top", "Right", "Bottom", "Left"]) {
			if (uniform || isWidth(styles[`border${side}Width`])) continue;
			delete styles[`border${side}Color`];
			delete styles[`border${side}Style`];
		}
		if (uniform) return;
		if (!["Top", "Right", "Bottom", "Left"].some((side) => isWidth(styles[`border${side}Width`]))) {
			delete styles.borderColor;
			delete styles.borderStyle;
		}
	}

	function isWidth(value) {
		return Boolean(value) && value !== "0px" && value !== "0";
	}

	function collapseShorthands(styles) {
		collapseGap(styles);
		collapseSides(styles, "margin", ["marginTop", "marginRight", "marginBottom", "marginLeft"]);
		collapseSides(styles, "padding", ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
		collapseBorder(styles);
		collapseRadius(styles);
		return styles;
	}

	function collapseGap(styles) {
		if (styles.rowGap && styles.rowGap === styles.columnGap) {
			styles.gap = styles.rowGap;
			delete styles.rowGap;
			delete styles.columnGap;
		}
	}

	function collapseSides(styles, shorthand, sides) {
		const values = sides.map((side) => styles[side]);
		if (values.some((value) => value === undefined)) return;
		if (new Set(values).size !== 1) return;
		sides.forEach((side) => delete styles[side]);
		styles[shorthand] = values[0];
	}

	function collapseBorder(styles) {
		for (const part of ["Width", "Style", "Color"]) {
			const sides = ["Top", "Right", "Bottom", "Left"].map((side) => `border${side}${part}`);
			const values = sides.map((side) => styles[side]);
			if (values.some((value) => value === undefined) || new Set(values).size !== 1) continue;
			sides.forEach((side) => delete styles[side]);
			styles[`border${part}`] = values[0];
		}
		// A width with no style paints nothing, and a style with no width is invisible.
		if (styles.borderWidth && !styles.borderStyle) styles.borderStyle = "solid";
		if (styles.borderStyle && !styles.borderWidth) delete styles.borderStyle;
	}

	function collapseRadius(styles) {
		const corners = [
			"borderTopLeftRadius",
			"borderTopRightRadius",
			"borderBottomRightRadius",
			"borderBottomLeftRadius",
		];
		const values = corners.map((corner) => styles[corner]);
		if (values.some((value) => value === undefined) || new Set(values).size !== 1) return;
		corners.forEach((corner) => delete styles[corner]);
		styles.borderRadius = values[0];
	}

	function kebab(property) {
		return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	}

	ns.styles = {
		StyleReader,
		BREAKPOINT_WIDTH,
		isTrackedProperty: (property) => TRACKED.has(property),
		INHERITED_PROPERTIES: new Set([...INHERITED].map(camel)),
		toHex,
		resolveVars,
	};
})(window.BuilderCopy);
