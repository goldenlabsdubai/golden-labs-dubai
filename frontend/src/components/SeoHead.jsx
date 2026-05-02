import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  SITE_ORIGIN,
  SEO_KEYWORDS,
  seoForLocation,
  canonicalUrl,
} from "../config/seo";

const OG_IMAGE = `${SITE_ORIGIN}/goldenlabslogo.png`;

function upsertMeta(selectorAttr, key, content) {
  let el = document.querySelector(`meta[${selectorAttr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(selectorAttr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

/**
 * Per-route title, description, canonical, and social tags for SPA SEO.
 * Crawlers that run JavaScript (including Google) see updates after hydration.
 */
export function SeoHead() {
  const { pathname } = useLocation();
  const { title, description } = seoForLocation(pathname);
  const canonical = canonicalUrl(pathname);

  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("name", "keywords", SEO_KEYWORDS);

    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:url", canonical);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:image", OG_IMAGE);
    upsertMeta("property", "og:image:alt", "Golden Labs logo");
    upsertMeta("property", "og:locale", "en_US");
    upsertMeta("property", "og:site_name", "Golden Labs");

    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", OG_IMAGE);

    setCanonical(canonical);
  }, [pathname, title, description, canonical]);

  return null;
}
