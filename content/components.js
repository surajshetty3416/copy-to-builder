(function (ns) {
	const { hash, blockId } = ns.util;

	const MIN_GROUP = 3;
	const MIN_NODES = 3;
	const MAX_NODES = 80;
	const MAX_COMPONENTS = 8;

	// Cards, nav items and feature tiles are the same block repeated. Turning each
	// run into a Builder Component means one edit updates every instance, which is
	// how the page would have been built by hand.
	class ComponentExtractor {
		constructor(sourceUrl) {
			this.sourceUrl = sourceUrl;
			this.components = [];
			this.usedNames = new Map();
		}

		extract(rootBlock) {
			this.walk(rootBlock);
			return this.components;
		}

		walk(block) {
			const children = block.children || [];
			if (!children.length) return;

			const groups = groupSiblings(children);
			let replaced = false;
			for (const group of groups) {
				if (!this.qualifies(group)) continue;
				this.componentize(block, group);
				replaced = true;
			}
			if (replaced) return;
			children.forEach((child) => this.walk(child));
		}

		qualifies(group) {
			if (this.components.length >= MAX_COMPONENTS) return false;
			if (group.length < MIN_GROUP) return false;
			const size = nodeCount(group[0]);
			return size >= MIN_NODES && size <= MAX_NODES;
		}

		componentize(parent, group) {
			const template = deepCopy(group[0]);
			const id = this.componentId(template);
			const name = this.componentName(group[0], parent);
			this.components.push({
				name: id,
				component_id: id,
				component_name: name,
				block: JSON.stringify(template),
			});

			for (const member of group) {
				const index = parent.children.indexOf(member);
				if (index === -1) continue;
				parent.children[index] = this.instance(template, member, id);
			}
		}

		instance(template, member, id, isRoot = true) {
			const node = { blockId: blockId() };
			if (isRoot) node.extendedFromComponent = id;
			else {
				node.isChildOfComponent = id;
				node.referenceBlockId = template.blockId;
			}
			Object.assign(node, overridesOf(template, member));

			const children = member.children || [];
			const templateChildren = template.children || [];
			node.children = children.map((child, index) =>
				this.instance(templateChildren[index], child, id, false),
			);
			return node;
		}

		componentId(template) {
			return `imported-${hash(`${this.sourceUrl}:${JSON.stringify(template)}`)}`;
		}

		// "Div 3" tells nobody anything. The block's own name, its parent's, or the
		// heading it contains all read like something you would have named yourself.
		componentName(block, parent) {
			const base =
				block.blockName ||
				(parent?.blockName ? `${parent.blockName} Item` : "") ||
				headingOf(block) ||
				"Repeated Block";
			const seen = (this.usedNames.get(base) || 0) + 1;
			this.usedNames.set(base, seen);
			return seen === 1 ? base : `${base} ${seen}`;
		}
	}

	// Only what differs from the component travels with the instance, so editing the
	// component still flows through to every copy.
	function overridesOf(template, member) {
		const overrides = {};
		if (member.innerHTML !== undefined && member.innerHTML !== template.innerHTML) {
			overrides.innerHTML = member.innerHTML;
		}
		const attributes = diffMap(template.attributes, member.attributes);
		if (attributes) overrides.attributes = attributes;

		for (const key of ["baseStyles", "tabletStyles", "mobileStyles"]) {
			const styles = diffMap(template[key], member[key]);
			if (styles) overrides[key] = styles;
		}
		return overrides;
	}

	function diffMap(from = {}, to = {}) {
		const diff = {};
		for (const [key, value] of Object.entries(to || {})) {
			if ((from || {})[key] !== value) diff[key] = value;
		}
		return Object.keys(diff).length ? diff : null;
	}

	function groupSiblings(children) {
		const groups = [];
		let current = [];
		let signature = null;

		for (const child of children) {
			const childSignature = structureOf(child);
			if (childSignature === signature) {
				current.push(child);
				continue;
			}
			if (current.length) groups.push(current);
			current = [child];
			signature = childSignature;
		}
		if (current.length) groups.push(current);
		return groups;
	}

	function structureOf(block) {
		if (block.extendedFromComponent) return `component:${block.extendedFromComponent}`;
		const children = (block.children || []).map(structureOf).join(",");
		const marker = block.innerHTML ? "t" : "";
		return `${block.element || "div"}${marker}(${children})`;
	}

	function headingOf(block) {
		return findLabel(block, true) || findLabel(block, false);
	}

	function findLabel(block, headingsOnly) {
		const isHeading = /^h[1-6]$/.test(block.element || "");
		if (block.innerHTML && (isHeading || !headingsOnly)) {
			const text = stripTags(block.innerHTML).trim();
			if (text && text.length <= 24) return ns.util.titleCase(text);
		}
		for (const child of block.children || []) {
			const label = findLabel(child, headingsOnly);
			if (label) return label;
		}
		return "";
	}

	function stripTags(html) {
		return html.replace(/<[^>]*>/g, " ");
	}

	function nodeCount(block) {
		return 1 + (block.children || []).reduce((total, child) => total + nodeCount(child), 0);
	}

	function deepCopy(block) {
		return JSON.parse(JSON.stringify(block));
	}

	ns.ComponentExtractor = ComponentExtractor;
})(window.BuilderCopy);
