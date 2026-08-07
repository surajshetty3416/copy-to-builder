(function (ns) {
	const { absoluteUrl, trimText } = ns.util;

	const MAX_HEAD_HTML = 20000;

	class PageReader {
		settings(fontFaces) {
			const title = (document.title || location.hostname).trim();
			const settings = {
				page_name: trimText(title, 120) || "Imported Page",
				page_title: trimText(title, 140),
				// A copy of someone else's page should not compete with it in search.
				disable_indexing: 1,
			};

			const description = meta("description") || meta("og:description");
			if (description) settings.meta_description = trimText(description, 300);

			const image = meta("og:image") || meta("twitter:image");
			if (image) settings.meta_image = absoluteUrl(image);

			const favicon = document.querySelector("link[rel~='icon']")?.getAttribute("href");
			if (favicon) settings.favicon = absoluteUrl(favicon);

			const head = this.fontHtml(fontFaces);
			if (head) settings.head_html = head;
			return settings;
		}

		// Webfonts are the one part of the page that cannot travel as block styles.
		// Google families are re-linked, self-hosted faces keep their original URLs.
		fontHtml(fontFaces = []) {
			const parts = [];
			for (const link of document.querySelectorAll("link[rel='stylesheet'], link[rel='preconnect']")) {
				const href = link.getAttribute("href") || "";
				if (!href.includes("fonts.googleapis.com") && !href.includes("fonts.gstatic.com")) continue;
				parts.push(`<link rel="${link.getAttribute("rel")}" href="${absoluteUrl(href)}" crossorigin>`);
			}
			if (fontFaces.length) {
				parts.push(`<style>\n${fontFaces.join("\n")}\n</style>`);
			}
			const html = parts.join("\n");
			return html.length > MAX_HEAD_HTML ? html.slice(0, MAX_HEAD_HTML) : html;
		}
	}

	function meta(name) {
		const node =
			document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
		return node?.getAttribute("content")?.trim() || "";
	}

	ns.page = new PageReader();
})(window.BuilderCopy);
