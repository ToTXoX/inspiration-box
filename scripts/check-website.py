#!/usr/bin/env python3
"""Check the static site's local URLs and accessible feature-panel references."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parent.parent / "website"


class WebsiteParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.references = []
        self.tabs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs["id"])
        for name in ("src", "href"):
            if attrs.get(name):
                self.references.append(attrs[name])
        for name in ("aria-controls", "aria-labelledby"):
            if attrs.get(name):
                self.references.extend("#" + item for item in attrs[name].split())
        if tag == "img":
            assert "alt" in attrs, "Image missing alt text"
        if attrs.get("role") == "tab":
            self.tabs.append(attrs)


parser = WebsiteParser()
parser.feed((root / "index.html").read_text())
for reference in parser.references:
    url = urlsplit(reference)
    if url.scheme or url.netloc:
        assert url.scheme == "https", f"Non-HTTPS external URL: {reference}"
        continue
    if url.path:
        path = (root / unquote(url.path)).resolve()
        assert path.is_relative_to(root), f"URL escapes site root: {reference}"
        assert path.exists(), f"Missing file: {reference}"
    if url.fragment:
        assert url.fragment in parser.ids, f"Missing fragment: {reference}"
assert len(parser.tabs) == 3
assert sum(tab.get("aria-selected") == "true" for tab in parser.tabs) == 1
print(f"PASS: {len(parser.references)} URLs/references, image descriptions and feature tabs")
