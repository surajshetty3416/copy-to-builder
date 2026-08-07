(function (ns) {
	class Picker {
		constructor() {
			this.active = false;
			this.target = null;
			this.onPick = null;
			this.handlers = {
				move: (e) => this.highlight(e.target),
				click: (e) => this.pick(e),
				key: (e) => this.key(e),
				scroll: () => this.position(),
			};
		}

		start(onPick) {
			if (this.active) return;
			this.active = true;
			this.onPick = onPick;
			this.mount();
			document.addEventListener("mousemove", this.handlers.move, true);
			document.addEventListener("click", this.handlers.click, true);
			document.addEventListener("keydown", this.handlers.key, true);
			window.addEventListener("scroll", this.handlers.scroll, true);
		}

		stop() {
			if (!this.active) return;
			this.active = false;
			this.box?.remove();
			this.label?.remove();
			document.removeEventListener("mousemove", this.handlers.move, true);
			document.removeEventListener("click", this.handlers.click, true);
			document.removeEventListener("keydown", this.handlers.key, true);
			window.removeEventListener("scroll", this.handlers.scroll, true);
		}

		mount() {
			this.box = document.createElement("div");
			this.box.className = "bc-picker-box";
			this.label = document.createElement("div");
			this.label.className = "bc-picker-label";
			document.documentElement.append(this.box, this.label);
			ns.toast.show("Click an element to copy it. Arrow keys widen or narrow, Esc cancels.", "hint");
		}

		highlight(el) {
			if (!el || el === this.target || el.classList?.contains("bc-picker-box")) return;
			this.target = el;
			this.position();
		}

		position() {
			if (!this.target) return;
			const rect = this.target.getBoundingClientRect();
			Object.assign(this.box.style, {
				top: `${rect.top}px`,
				left: `${rect.left}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
			});
			this.label.textContent = describe(this.target, rect);
			this.label.style.top = `${Math.max(rect.top - 24, 4)}px`;
			this.label.style.left = `${Math.max(rect.left, 4)}px`;
		}

		key(e) {
			if (e.key === "Escape") {
				e.preventDefault();
				this.stop();
				ns.toast.show("Cancelled", "hint");
				return;
			}
			if (e.key === "ArrowUp" && this.target?.parentElement) {
				e.preventDefault();
				this.highlight(this.target.parentElement);
			}
			if (e.key === "ArrowDown" && this.target?.firstElementChild) {
				e.preventDefault();
				this.highlight(this.target.firstElementChild);
			}
			if (e.key === "Enter" && this.target) {
				e.preventDefault();
				this.finish(this.target);
			}
		}

		pick(e) {
			e.preventDefault();
			e.stopPropagation();
			this.finish(e.target);
		}

		// The click that picks is also the user gesture the clipboard write needs,
		// so the copy has to happen before this call stack unwinds.
		finish(el) {
			const picked = el;
			this.stop();
			this.onPick?.(picked);
		}
	}

	function describe(el, rect) {
		const tag = el.tagName.toLowerCase();
		const className = (el.classList[0] || "").slice(0, 24);
		const size = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
		return `${tag}${className ? `.${className}` : ""}  ${size}`;
	}

	class Toast {
		show(message, kind = "info", duration = 2600) {
			this.node?.remove();
			clearTimeout(this.timer);
			this.node = document.createElement("div");
			this.node.className = `bc-toast bc-toast-${kind}`;
			this.node.textContent = message;
			document.documentElement.appendChild(this.node);
			this.timer = setTimeout(() => this.node?.remove(), duration);
		}

		// Used when the clipboard needs a gesture the current entry point cannot give.
		action(message, label, onClick) {
			this.node?.remove();
			clearTimeout(this.timer);
			this.node = document.createElement("div");
			this.node.className = "bc-toast bc-toast-action";
			const text = document.createElement("span");
			text.textContent = message;
			const button = document.createElement("button");
			button.className = "bc-toast-button";
			button.textContent = label;
			button.addEventListener("click", () => {
				onClick();
				this.node?.remove();
			});
			this.node.append(text, button);
			document.documentElement.appendChild(this.node);
			this.timer = setTimeout(() => this.node?.remove(), 12000);
		}
	}

	ns.picker = new Picker();
	ns.toast = new Toast();
})(window.BuilderCopy);
