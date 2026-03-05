import { useState, useEffect, useRef } from "react";
import { API, ASSET_VIDEO } from "../config";

const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function getIpfsGateway() {
  const g = (import.meta.env.VITE_IPFS_GATEWAY || "").trim().replace(/\/+$/, "");
  return g ? `${g}/` : DEFAULT_IPFS_GATEWAY;
}

/** Collapse multiple ipfs:// prefixes to one (e.g. ipfs://ipfs://CID -> ipfs://CID). */
function normalizeIpfsUri(uri) {
  if (!uri || typeof uri !== "string") return "";
  return uri.trim().replace(/^(ipfs:\/\/)+/i, "ipfs://");
}

function ipfsToGateway(uri) {
  if (!uri || typeof uri !== "string") return null;
  const trimmed = uri.trim();
  const gateway = getIpfsGateway();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.replace(/^(ipfs:\/\/)+/i, "").replace(/^\/+/, "");
    return `${gateway}${path}`;
  }
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return `${gateway}${trimmed.replace(/^\/+/, "")}`;
}

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".ogg") || lower.includes("video/");
}

/**
 * Renders NFT asset from tokenURI (IPFS metadata). Fetches metadata JSON, resolves image/animation_url,
 * and shows <video> for .mp4 (or video type) else <img>. Fallback: ASSET_VIDEO (same as minted NFT).
 */
export default function NFTMedia({ tokenURI, tokenId, className, alt: altProp, ...rest }) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [failed, setFailed] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  const objectUrlRef = useRef(null);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);

  useEffect(() => {
    setVideoLoadFailed(false);
    if (!tokenURI || !tokenURI.trim()) {
      setFailed(true);
      return;
    }
    setFailed(false);
    const gatewayUrl = ipfsToGateway(tokenURI);
    if (!gatewayUrl) {
      setFailed(true);
      return;
    }
    const gatewayKey = (import.meta.env.VITE_IPFS_GATEWAY_KEY || "").trim();
    const headers = gatewayKey ? { "x-pinata-gateway-token": gatewayKey } : {};
    // Prefer backend proxy to avoid CORS with Pinata
    const proxyUrl = tokenURI.startsWith("ipfs://") ? `${API}/marketplace/ipfs-proxy?uri=${encodeURIComponent(tokenURI)}` : null;
    const fetchMeta = () =>
      proxyUrl
        ? fetch(proxyUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not ok"))))
        : fetch(gatewayUrl, { headers }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not ok"))));
    fetchMeta()
      .then((data) => {
        const raw = data?.image ?? data?.animation_url ?? data?.image_url ?? null;
        if (!raw) {
          setFailed(true);
          return;
        }
        let resolved;
        if (raw.startsWith("ipfs://") || raw.startsWith("http://") || raw.startsWith("https://")) {
          resolved = raw.startsWith("ipfs://") ? ipfsToGateway(raw) : raw;
        } else {
          const base = gatewayUrl.replace(/\/[^/]*$/, "/");
          resolved = base + raw.replace(/^\//, "");
        }
        setMediaUrl(resolved);
        // Treat as video if URL has video extension OR metadata has animation_url (NFT standard for video)
        setIsVideo(isVideoUrl(resolved) || !!(data?.animation_url));
      })
      .catch(() =>
        fetch(gatewayUrl, { headers })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Not ok"))))
          .then((data) => {
            const raw = data?.image ?? data?.animation_url ?? data?.image_url ?? null;
            if (!raw) {
              setFailed(true);
              return;
            }
            let resolved;
            if (raw.startsWith("ipfs://") || raw.startsWith("http://") || raw.startsWith("https://")) {
              resolved = raw.startsWith("ipfs://") ? ipfsToGateway(raw) : raw;
            } else {
              const base = gatewayUrl.replace(/\/[^/]*$/, "/");
              resolved = base + raw.replace(/^\//, "");
            }
            setMediaUrl(resolved);
            setIsVideo(isVideoUrl(resolved) || !!(data?.animation_url));
          })
          .catch(() => setFailed(true))
      );
  }, [tokenURI]);

  // When gateway key is set, fetch media with key and use object URL (for access-controlled gateways)
  useEffect(() => {
    if (!mediaUrl || !(import.meta.env.VITE_IPFS_GATEWAY_KEY || "").trim()) return;
    const gateway = getIpfsGateway();
    if (!mediaUrl.startsWith(gateway)) return;
    const gatewayKey = (import.meta.env.VITE_IPFS_GATEWAY_KEY || "").trim();
    const headers = { "x-pinata-gateway-token": gatewayKey };
    let cancelled = false;
    fetch(mediaUrl, { headers })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("Not ok"))))
      .then((blob) => {
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [mediaUrl]);

  const alt = altProp ?? (tokenId != null ? `GLFA #${tokenId}` : "NFT");
  // Use backend proxy for IPFS media to avoid CORS when loading video/img
  const gateway = getIpfsGateway();
  const useProxyForMedia = mediaUrl && (mediaUrl.startsWith(gateway) || mediaUrl.startsWith("ipfs://"));
  const mediaUriForProxy = mediaUrl && (mediaUrl.startsWith("ipfs://") ? normalizeIpfsUri(mediaUrl) : "ipfs://" + mediaUrl.replace(gateway, "").replace(/^\/+/, ""));
  const proxyMediaUrl =
    useProxyForMedia && mediaUriForProxy
      ? `${API}/marketplace/ipfs-proxy?uri=${encodeURIComponent(mediaUriForProxy)}`
      : null;
  const displayUrl = objectUrl || proxyMediaUrl || mediaUrl;
  const showFallbackVideo = failed || !displayUrl || videoLoadFailed;

  // Fallback: show local NFT asset video (public/nft asset.mp4) when no metadata, failed, or remote video fails to load
  if (showFallbackVideo) {
    return (
      <video
        src={ASSET_VIDEO}
        className={className}
        alt={alt}
        muted
        loop
        playsInline
        autoPlay
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        {...rest}
      />
    );
  }

  if (isVideo) {
    return (
      <video
        src={displayUrl}
        className={className}
        alt={alt}
        muted
        loop
        playsInline
        autoPlay
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        onError={() => setVideoLoadFailed(true)}
        {...rest}
      />
    );
  }

  return <img src={displayUrl} alt={alt} className={className} onError={() => setVideoLoadFailed(true)} {...rest} />;
}
