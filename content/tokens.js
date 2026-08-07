(function (ns) {
	const { hash } = ns.util;

	const COLOR_PROPERTIES = [
		"color",
		"backgroundColor",
		"borderColor",
		"borderTopColor",
		"borderRightColor",
		"borderBottomColor",
		"borderLeftColor",
	];

	const MAX_COLORS = 14;
	const MAX_NEUTRALS = 4;
	const MAX_FONTS = 4;

	// The palette and typography a site repeats are exactly what Builder Tokens are
	// for: pasting them as tokens means retheming the copy is a one-value edit.
	class TokenExtractor {
		constructor(sourceUrl) {
			this.group = safeHost(sourceUrl);
			this.tokens = [];
		}

		extract(rootBlock) {
			const usage = {
				all: new Map(),
				text: new Map(),
				surface: new Map(),
				border: new Map(),
			};
			const fonts = new Map();
			eachBlock(rootBlock, (block) => {
				eachStyleMap(block, (styles) => {
					for (const property of COLOR_PROPERTIES) {
						const value = styles[property];
						if (!isTokenizableColor(value)) continue;
						count(usage.all, value.toLowerCase());
						count(usage[roleOf(property)], value.toLowerCase());
					}
					if (styles.fontFamily) count(fonts, styles.fontFamily);
				});
			});

			this.tokens = [...this.colorTokens(usage, rootBlock), ...this.fontTokens(fonts)];
			const map = new Map(this.tokens.map((token) => [token.value.toLowerCase(), token.name]));
			this.rewrite(rootBlock, map);
			return this.tokens;
		}

		// Named by the job each colour does on the page, so the token panel reads like
		// a design system rather than a list of hex codes.
		colorTokens(usage, rootBlock) {
			const pageBackground = (rootBlock.baseStyles?.backgroundColor || "").toLowerCase();
			const ranked = [...usage.all.entries()]
				.filter(([value, uses]) => uses > 1 || value === pageBackground)
				.sort((a, b) => b[1] - a[1])
				.map(([value]) => value)
				.slice(0, MAX_COLORS);

			const taken = new Set();
			const names = new Map();
			const claim = (value, name) => {
				if (!value || taken.has(value) || !ranked.includes(value)) return false;
				taken.add(value);
				names.set(value, name);
				return true;
			};

			claim(pageBackground, "Background");
			claim((rootBlock.baseStyles?.color || "").toLowerCase(), "Text") ||
				claim(top(usage.text, taken), "Text");
			claim(
				top(usage.surface, taken, (value) => !isNeutral(value)),
				"Primary",
			);
			claim(top(usage.text, taken), "Muted Text");
			claim(top(usage.border, taken), "Border");

			let accents = 0;
			let neutrals = 0;
			const tokens = [];
			for (const value of ranked) {
				let name = names.get(value);
				if (!name && isNeutral(value)) {
					// Past a handful, extra greys are noise in the token panel.
					if (++neutrals > MAX_NEUTRALS) continue;
					name = `Neutral ${neutrals}`;
				}
				tokens.push(this.token(name || `Accent ${++accents}`, value, "Color"));
			}
			return tokens;
		}

		fontTokens(fonts) {
			return [...fonts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, MAX_FONTS)
				.map(([family], index) => this.token(index === 0 ? "Body Font" : family, family, "Font"));
		}

		token(tokenName, value, type) {
			return {
				name: `imported-${slug(tokenName)}-${hash(`${this.group}:${value}`)}`,
				token_name: tokenName,
				value,
				type,
				group: this.group,
				is_standard: 0,
			};
		}

		rewrite(rootBlock, map) {
			eachBlock(rootBlock, (block) => {
				eachStyleMap(block, (styles) => {
					for (const property of COLOR_PROPERTIES) {
						const id = map.get(String(styles[property] || "").toLowerCase());
						if (id) styles[property] = `var(--${id})`;
					}
					const fontId = map.get(String(styles.fontFamily || "").toLowerCase());
					if (fontId) styles.fontFamily = `var(--${fontId})`;
				});
			});
		}
	}

	function eachBlock(block, visit) {
		if (!block) return;
		visit(block);
		(block.children || []).forEach((child) => eachBlock(child, visit));
	}

	function eachStyleMap(block, visit) {
		for (const key of ["baseStyles", "tabletStyles", "mobileStyles"]) {
			if (block[key]) visit(block[key]);
		}
	}

	function count(map, value) {
		map.set(value, (map.get(value) || 0) + 1);
	}

	function roleOf(property) {
		if (property === "color") return "text";
		if (property === "backgroundColor") return "surface";
		return "border";
	}

	function top(map, taken, extra = () => true) {
		return [...map.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([value]) => value)
			.find((value) => !taken.has(value) && extra(value));
	}

	function isTokenizableColor(value) {
		return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim());
	}

	function isNeutral(hex) {
		const { s, l } = toHsl(hex);
		return s < 0.25 || l < 0.12 || l > 0.94;
	}

	function toHsl(hex) {
		const clean = hex.replace("#", "");
		const full =
			clean.length === 3
				? clean
						.split("")
						.map((char) => char + char)
						.join("")
				: clean.slice(0, 6);
		const [r, g, b] = [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;
		const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
		return { s: Number.isNaN(s) ? 0 : s, l };
	}

	function slug(text) {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
	}

	function safeHost(url) {
		try {
			return new URL(url).hostname.replace(/^www\./, "") || "Imported";
		} catch (error) {
			return "Imported";
		}
	}

	ns.TokenExtractor = TokenExtractor;
})(window.BuilderCopy);
