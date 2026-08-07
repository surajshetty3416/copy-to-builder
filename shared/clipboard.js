// Writes the payload under the same custom clipboard type Builder's own copy uses
// (frontend/src/utils/builderBlockCopyPaste.ts), so Cmd+V on the canvas just works.
// Chrome keeps unknown clipboard types in a private format readable across origins
// within the same browser, which is what makes the cross-site paste possible.
(function (root) {
	const BUILDER_MIME = "builder-copied-blocks";

	function writeBuilderClipboard(payload) {
		const json = typeof payload === "string" ? payload : JSON.stringify(payload);
		let wrote = false;

		const onCopy = (e) => {
			e.preventDefault();
			e.clipboardData.setData(BUILDER_MIME, json);
			// Builder pastes text/plain as an extra block when it is present, so leave it empty.
			wrote = true;
		};

		document.addEventListener("copy", onCopy, true);
		const restore = holdSelection();
		try {
			document.execCommand("copy");
		} catch (error) {
			wrote = false;
		} finally {
			restore();
			document.removeEventListener("copy", onCopy, true);
		}
		return wrote;
	}

	// execCommand("copy") is a no-op without a selection, so borrow one from a throwaway node.
	function holdSelection() {
		const holder = document.createElement("textarea");
		holder.value = " ";
		holder.setAttribute("aria-hidden", "true");
		holder.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
		document.body.appendChild(holder);

		const selection = document.getSelection();
		const previous = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
		holder.select();

		return () => {
			holder.remove();
			if (previous && selection) {
				selection.removeAllRanges();
				selection.addRange(previous);
			}
		};
	}

	root.BuilderClipboard = { BUILDER_MIME, writeBuilderClipboard };
})(typeof window !== "undefined" ? window : self);
