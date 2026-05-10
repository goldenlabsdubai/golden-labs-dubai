/**
 * Level Income Network: one horizontal tier per level (L1…L10), orthogonal SVG links.
 * Data: GET /referral/network — nested `children` on each node.
 * Tier rates: L1 = full `levelAmounts[0]`; L2+ = on-chain gross ÷ `minDirectReferralsRequired` (per seated direct when qualified), read from ReferralContract when possible.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { getAvatarUrl } from "../config";
import { USDT_DECIMALS } from "../constants/usdtDecimals";

const REF_TIER_READ_ABI = [
  { name: "levelAmounts", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "minDirectReferralsRequired", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
];

/** Fallback if RPC/ABI read fails — matches default ReferralContract constructor. */
function defaultTierPerTradeUsd() {
  const grossWei = [
    500000000000000000n,
    250000000000000000n,
    250000000000000000n,
    250000000000000000n,
    150000000000000000n,
    150000000000000000n,
    150000000000000000n,
    100000000000000000n,
    100000000000000000n,
    100000000000000000n,
  ];
  const div = [1n, 2n, 3n, 4n, 5n, 6n, 6n, 6n, 6n, 6n];
  const o = {};
  for (let i = 0; i < 10; i++) {
    const per = grossWei[i] / div[i];
    o[i + 1] = formatUnits(per, USDT_DECIMALS).replace(/\.?0+$/, "") || "0";
  }
  return o;
}

function fmtRateFromChain(grossWei, divWei) {
  const d = divWei > 0n ? divWei : 1n;
  const per = grossWei / d;
  return formatUnits(per, USDT_DECIMALS).replace(/\.?0+$/, "") || "0";
}

const MAX_L1_COLS = 48;
const ROOT_ID = "__root__";

const LEVEL_LINE = {
  1: "rgba(232, 197, 71, 0.9)",
  2: "rgba(212, 175, 55, 0.75)",
  3: "rgba(184, 200, 160, 0.55)",
  4: "rgba(184, 200, 160, 0.5)",
  5: "rgba(184, 200, 160, 0.45)",
  6: "rgba(160, 170, 190, 0.45)",
  7: "rgba(160, 170, 190, 0.42)",
  8: "rgba(160, 170, 190, 0.38)",
  9: "rgba(160, 170, 190, 0.35)",
  10: "rgba(160, 170, 190, 0.32)",
};

function IconCrown({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M5 16L3 8l5.5 3L12 5l3.5 6L21 8l-2 8H5z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
      <path d="M5 16h14v2H5v-2z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

function IconArrowUp({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 44V8M12 8l-5 5M12 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
    </svg>
  );
}

function IconPerson({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.12" />
      <path
        d="M6.5 19.5c0-3.2 2.35-5.25 5.5-5.25s5.5 2.05 5.5 5.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function shortWallet(w) {
  if (!w || typeof w !== "string") return "";
  const s = w.trim();
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmtPt(n) {
  return n.toFixed(1);
}

function manhattanPath(x1, y1, x2, y2) {
  const mid = (y1 + y2) / 2;
  return `M ${fmtPt(x1)} ${fmtPt(y1)} L ${fmtPt(x1)} ${fmtPt(mid)} L ${fmtPt(x2)} ${fmtPt(mid)} L ${fmtPt(x2)} ${fmtPt(y2)}`;
}

/** One SVG path per parent: shared trunk + horizontal bus + drops (no duplicate trunk = no stray stub). */
function buildGroupedWirePaths(container, edges, rootOutRef) {
  const cr = container.getBoundingClientRect();
  const relX = (gx) => gx - cr.left;
  const relY = (gy) => gy - cr.top;

  const findOut = (id) => {
    if (id === ROOT_ID) return rootOutRef.current;
    return container.querySelector(`[data-anchor-out="${CSS.escape(id)}"]`);
  };
  const findIn = (id) => container.querySelector(`[data-anchor-in="${CSS.escape(id)}"]`);

  const byFrom = new Map();
  for (const e of edges) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e);
  }

  const paths = [];
  for (const list of byFrom.values()) {
    const childLevel = list[0].childLevel;
    const stroke = LEVEL_LINE[childLevel] || LEVEL_LINE[1];

    const geoms = [];
    for (const e of list) {
      const fo = findOut(e.from);
      const ti = findIn(e.to);
      if (!fo || !ti) continue;
      const a = anchorCenter(fo);
      const b = anchorCenter(ti);
      if (!a || !b) continue;
      geoms.push({
        px: relX(a.x),
        py: relY(a.bottom),
        cx: relX(b.x),
        cy: relY(b.top),
      });
    }
    if (geoms.length === 0) continue;

    if (geoms.length === 1) {
      const g = geoms[0];
      paths.push({ d: manhattanPath(g.px, g.py, g.cx, g.cy), stroke });
      continue;
    }

    geoms.sort((u, v) => u.cx - v.cx);
    const { px, py } = geoms[0];
    const avgCy = geoms.reduce((s, g) => s + g.cy, 0) / geoms.length;
    const mid = (py + avgCy) / 2;
    const cxs = geoms.map((g) => g.cx);
    const busLeft = Math.min(px, ...cxs);
    const busRight = Math.max(px, ...cxs);

    let d = `M ${fmtPt(px)} ${fmtPt(py)} L ${fmtPt(px)} ${fmtPt(mid)} L ${fmtPt(busLeft)} ${fmtPt(mid)} L ${fmtPt(busRight)} ${fmtPt(mid)}`;
    for (const g of geoms) {
      d += ` M ${fmtPt(g.cx)} ${fmtPt(mid)} L ${fmtPt(g.cx)} ${fmtPt(g.cy)}`;
    }
    paths.push({ d, stroke });
  }

  return paths;
}

function anchorCenter(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom };
}

/** BFS tiers: row[d] = all nodes at depth d+1, left-to-right (parent order, then child order). */
function buildTiersAndEdges(l1Nodes) {
  const rows = [];
  const edges = [];
  if (!l1Nodes?.length) return { rows, edges };

  let frontier = l1Nodes.map((n) => ({ ...n, children: n.children ?? [] }));
  rows.push(frontier);
  for (const n of frontier) {
    edges.push({ from: ROOT_ID, to: n.wallet, childLevel: 1 });
  }

  let depth = 1;
  while (frontier.length && depth < 10) {
    const next = [];
    const nextFrontier = [];
    for (const n of frontier) {
      const ch = n.children ?? [];
      for (const c of ch) {
        edges.push({ from: n.wallet, to: c.wallet, childLevel: depth + 1 });
        next.push(c);
        nextFrontier.push(c);
      }
      const more = n.moreChildren ?? 0;
      if (more > 0) {
        const sid = `__more_${n.wallet}_${depth + 1}`;
        edges.push({ from: n.wallet, to: sid, childLevel: depth + 1 });
        next.push({
          wallet: sid,
          username: null,
          avatar: null,
          children: [],
          synthetic: true,
          moreLabel: more > 999 ? "999+" : String(more),
        });
      }
    }
    depth++;
    if (next.length) rows.push(next);
    frontier = nextFrontier;
  }
  return { rows, edges };
}

function PersonNode({ member, placeholder, size = "md", level = 1, anchorId }) {
  const resolvedUrl = useMemo(() => {
    if (placeholder) return "";
    return getAvatarUrl(member?.avatar);
  }, [placeholder, member?.avatar]);

  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [resolvedUrl]);

  const label = placeholder ? "···" : member?.username || shortWallet(member?.wallet) || "—";
  const line = LEVEL_LINE[level] || LEVEL_LINE[1];
  const aid = anchorId ?? member?.wallet ?? "";
  const showPhoto = Boolean(resolvedUrl) && !imgFailed;

  return (
    <div
      className={`ref-tree__person ref-tree__person--${size}${placeholder ? " ref-tree__person--ph" : ""}`}
      title={placeholder ? "Slot" : member?.wallet || ""}
      style={{ "--ref-line": line }}
    >
      {aid ? <span className="ref-tree__anchor ref-tree__anchor--in" data-anchor-in={aid} aria-hidden="true" /> : null}
      <div className="ref-tree__person-avatar">
        {showPhoto ? (
          <img src={resolvedUrl} alt="" className="ref-tree__person-img" onError={() => setImgFailed(true)} />
        ) : (
          <IconPerson className="ref-tree__person-icon" />
        )}
      </div>
      {aid ? <span className="ref-tree__anchor ref-tree__anchor--out" data-anchor-out={aid} aria-hidden="true" /> : null}
      <span className="ref-tree__person-name">{label}</span>
    </div>
  );
}

function RootAvatar({ avatar, rootOutRef }) {
  const resolvedUrl = useMemo(() => getAvatarUrl(avatar), [avatar]);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [resolvedUrl]);

  const showPhoto = Boolean(resolvedUrl) && !imgFailed;

  return (
    <div className="ref-tree__root-avatar">
      {showPhoto ? (
        <img src={resolvedUrl} alt="" className="ref-tree__person-img ref-tree__root-avatar-img" onError={() => setImgFailed(true)} />
      ) : (
        <IconCrown className="ref-tree__root-crown" />
      )}
      <span className="ref-tree__anchor ref-tree__anchor--out ref-tree__anchor--root" ref={rootOutRef} aria-hidden="true" />
    </div>
  );
}

function SyntheticMoreNode({ label, level, anchorId }) {
  const line = LEVEL_LINE[level] || LEVEL_LINE[1];
  return (
    <div className="ref-tree__tier-synth" title="More referrals (list capped)" style={{ "--ref-line": line }}>
      <span className="ref-tree__anchor ref-tree__anchor--in" data-anchor-in={anchorId} aria-hidden="true" />
      <div className="ref-tree__more ref-tree__more--tier">{label}</div>
      <span className="ref-tree__anchor ref-tree__anchor--out" data-anchor-out={anchorId} aria-hidden="true" />
    </div>
  );
}

function LevelTag({ n, rate, header = false }) {
  return (
    <div className={`ref-tree__level-tag${header ? " ref-tree__level-tag--header" : ""}`}>
      <span className="ref-tree__level-tag-main">Level {n}</span>
      <span className="ref-tree__level-tag-rate">${rate} / trade</span>
    </div>
  );
}

function l1RowHasL2Visual(l1) {
  return (l1 ?? []).some((n) => (n.children?.length ?? 0) > 0 || (n.moreChildren ?? 0) > 0);
}

export default function ReferralPyramidTree({ referralStats, user, referralNetwork, formatUsdt, rootLabel = "You" }) {
  const publicClient = usePublicClient();
  const [tierUsd, setTierUsd] = useState(() => defaultTierPerTradeUsd());

  useEffect(() => {
    let cancelled = false;
    const raw = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
    const addr = raw.startsWith("0x") ? raw : raw ? `0x${raw}` : "";
    if (!publicClient || !addr) return undefined;

    (async () => {
      try {
        const reads = [];
        for (let i = 0; i < 10; i++) {
          reads.push(
            publicClient.readContract({ address: addr, abi: REF_TIER_READ_ABI, functionName: "levelAmounts", args: [BigInt(i)] })
          );
          reads.push(
            publicClient.readContract({
              address: addr,
              abi: REF_TIER_READ_ABI,
              functionName: "minDirectReferralsRequired",
              args: [BigInt(i)],
            })
          );
        }
        const all = await Promise.all(reads);
        const next = {};
        for (let level = 1; level <= 10; level++) {
          const idx = level - 1;
          const gross = all[idx * 2];
          const div = all[idx * 2 + 1];
          next[level] = level === 1 ? fmtRateFromChain(gross, 1n) : fmtRateFromChain(gross, div);
        }
        if (!cancelled) setTierUsd(next);
      } catch {
        if (!cancelled) setTierUsd(defaultTierPerTradeUsd());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  const getCount = (lvl) => (referralStats != null ? referralStats[`referralCountL${lvl}`] ?? 0 : user?.[`referralCountL${lvl}`] ?? 0);
  const getEarningsWei = (lvl) =>
    referralStats != null ? referralStats[`referralEarningsL${lvl}`] || "0" : user?.[`referralEarningsL${lvl}`] || "0";

  const l1Count = getCount(1);
  const l1FromApi = referralNetwork?.l1 ?? [];

  const { tierSlots, rows, edges } = useMemo(() => {
    if (l1FromApi.length > 0) {
      const slots = [];
      for (const u of l1FromApi) {
        const w = (u.wallet || "").toLowerCase();
        slots.push({ kind: "user", key: w, node: { ...u, children: u.children ?? [], moreChildren: u.moreChildren } });
      }
      if (l1Count > l1FromApi.length) {
        slots.push({ kind: "more-l1", key: "more-l1", n: l1Count - l1FromApi.length });
      }
      const { rows: r, edges: e } = buildTiersAndEdges(l1FromApi);
      return { tierSlots: slots, rows: r, edges: e };
    }

    if (l1Count > 0) {
      const slots = [];
      const n = Math.min(l1Count, MAX_L1_COLS);
      for (let i = 0; i < n; i++) {
        slots.push({ kind: "placeholder", key: `ph-${i}` });
      }
      if (l1Count > n) {
        slots.push({ kind: "more-l1", key: "more-l1", n: l1Count - n });
      }
      return { tierSlots: slots, rows: [], edges: [] };
    }

    return { tierSlots: [], rows: [], edges: [] };
  }, [l1FromApi, l1Count]);

  const wrapRef = useRef(null);
  const rootOutRef = useRef(null);
  const [wirePaths, setWirePaths] = useState([]);

  const edgeKey = useMemo(() => JSON.stringify(edges), [edges]);

  useLayoutEffect(() => {
    const container = wrapRef.current;
    if (!container || edges.length === 0) {
      setWirePaths([]);
      return;
    }

    const measure = () => {
      setWirePaths(buildGroupedWirePaths(container, edges, rootOutRef));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
    };
  }, [edgeKey, rows.length, tierSlots.length]);

  const showL2SyncHint = getCount(2) > 0 && !l1RowHasL2Visual(l1FromApi) && l1FromApi.length > 0;

  const l1TierCountClass = `ref-tree__tier-nodes--count-${Math.min(Math.max(tierSlots.length, 1), 12)}`;

  const renderTierNode = (node, depth) => {
    const id = node.wallet;
    if (node.synthetic) {
      return <SyntheticMoreNode key={id} label={node.moreLabel} level={depth} anchorId={id} />;
    }
    const size = depth >= 3 ? "sm" : "md";
    return <PersonNode key={id} member={node} size={size} level={depth} anchorId={id} />;
  };

  return (
    <div className="referral-pyramid">
      <div className="referral-pyramid__frame">
        <aside className="referral-pyramid__rail referral-pyramid__rail--left" aria-hidden="true">
          <IconArrowUp className="referral-pyramid__rail-arrow" />
          <span className="referral-pyramid__rail-text">Volume flows up</span>
        </aside>

        <div className="referral-pyramid__main referral-pyramid__main--tree">
          <div className="ref-tree ref-tree--tiered" ref={wrapRef}>
            {edges.length > 0 && (
              <svg className="ref-tree__wires" aria-hidden="true">
                {wirePaths.map((p, i) => (
                  <path
                    key={i}
                    d={p.d}
                    stroke={p.stroke}
                    fill="none"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="butt"
                    vectorEffect="nonScalingStroke"
                  />
                ))}
              </svg>
            )}

            <div className="ref-tree__root">
              <div className="ref-tree__root-inner">
                <span className="ref-tree__root-name">{rootLabel}</span>
                <div className="ref-tree__root-hero">
                  <div className="ref-tree__root-halo" aria-hidden="true" />
                  <RootAvatar avatar={user?.avatar} rootOutRef={rootOutRef} />
                </div>
              </div>
            </div>

            {tierSlots.length === 0 && (
              <span className="ref-tree__root-stem" style={{ background: LEVEL_LINE[1] }} aria-hidden="true" />
            )}

            {tierSlots.length === 0 ? (
              <p className="ref-tree__empty">No Level 1 referrals yet.</p>
            ) : (
              <>
                {/* Level 1 row — slots may include placeholders / +more */}
                <section className="ref-tree__generation ref-tree__tier-section" style={{ "--ref-line": LEVEL_LINE[1] }}>
                  <div className="ref-tree__generation-main">
                    <div className="ref-tree__tier-head">
                      <div className="ref-tree__tier-head-fill">
                        <LevelTag n={1} rate={tierUsd[1]} header />
                        <p className="ref-tree__gen-meta ref-tree__gen-meta--in-head">
                          <strong>{getCount(1)}</strong> in tier · <strong>{formatUsdt(getEarningsWei(1))}</strong> USDT
                          <img src="/USDT_BEP20.png" alt="" className="ref-tree__usdt-ico" aria-hidden="true" />
                        </p>
                      </div>
                    </div>
                    <div className="ref-tree__scroll">
                      <div className="ref-tree__tier-bundle" style={{ "--ref-line": LEVEL_LINE[1] }}>
                        <div className={`ref-tree__tier-nodes ${l1TierCountClass}`}>
                          {tierSlots.map((col) => {
                            if (col.kind === "more-l1") {
                              return (
                                <div key={col.key} className="ref-tree__tier-slot">
                                  <div className="ref-tree__more ref-tree__more--tier">+{col.n > 999 ? "999+" : col.n}</div>
                                  <span className="ref-tree__more-cap">more</span>
                                </div>
                              );
                            }
                            if (col.kind === "placeholder") {
                              return (
                                <div key={col.key} className="ref-tree__tier-slot">
                                  <PersonNode placeholder size="md" level={1} anchorId={col.key} />
                                </div>
                              );
                            }
                            return (
                              <div key={col.key} className="ref-tree__tier-slot">
                                {renderTierNode(col.node, 1)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {showL2SyncHint && (
                      <p className="ref-tree__aggregate-note ref-tree__aggregate-note--inline">
                        Level 2 count is non-zero but no rows loaded under L1 — check referrer links in the database.
                      </p>
                    )}
                  </div>
                </section>

                {/* Levels 2..N: only tiers that exist in the downline tree (rows from API) */}
                {rows.length > 1 &&
                  rows.slice(1).map((nodes, idx) => {
                    const depth = idx + 2;
                    return (
                      <section key={depth} className="ref-tree__generation ref-tree__tier-section" style={{ "--ref-line": LEVEL_LINE[depth] }}>
                        <div className="ref-tree__generation-main">
                          <div className="ref-tree__tier-head">
                            <div className="ref-tree__tier-head-fill">
                              <LevelTag n={depth} rate={tierUsd[depth]} header />
                              <p className="ref-tree__gen-meta ref-tree__gen-meta--in-head">
                                <strong>{getCount(depth)}</strong> in tier · <strong>{formatUsdt(getEarningsWei(depth))}</strong> USDT
                                <img src="/USDT_BEP20.png" alt="" className="ref-tree__usdt-ico" aria-hidden="true" />
                              </p>
                            </div>
                          </div>
                          <div className="ref-tree__scroll">
                            <div className="ref-tree__tier-bundle" style={{ "--ref-line": LEVEL_LINE[depth] }}>
                              <div className={`ref-tree__tier-nodes ref-tree__tier-nodes--count-${Math.min(Math.max(nodes.length, 1), 12)}`}>
                                {nodes.map((node) => (
                                  <div key={node.wallet} className="ref-tree__tier-slot">
                                    {renderTierNode(node, depth)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}
              </>
            )}
          </div>
        </div>

        <aside className="referral-pyramid__rail referral-pyramid__rail--right" aria-hidden="true">
          <IconArrowUp className="referral-pyramid__rail-arrow" />
          <span className="referral-pyramid__rail-text">Upline rewards</span>
        </aside>
      </div>
    </div>
  );
}
