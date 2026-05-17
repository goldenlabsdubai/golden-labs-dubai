import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useReadContract, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { BSC_CHAIN_ID } from "../constants/chain";
import { USDT_DECIMALS } from "../constants/usdtDecimals";
import { formatUsdtTrim, readContractUint256 } from "../utils/formatUsdt";
import {
  REFERRAL_TIER_READ_ABI,
  getDefaultReferralSupportRows,
  perTradeUsdtStringFromTier,
  trimUsdtAmountString,
} from "../utils/referralTierConfig";

const TELEGRAM_CHANNEL_URL = "https://t.me/goldenlabschannel";
const SUPPORT_EMAIL = "goldenlabssupport@gmail.com";

const SUBSCRIPTION_ABI = [
  { name: "subscriptionPrice", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const NFT_MINT_PRICE_ABI = [
  { name: "mintPrice", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const REFERRAL_CHUNK_ABI = [
  { name: "referralWithdrawChunk", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

/** Golden Labs related keywords – if none match, may be off-topic */
const GL_TOPICS = [
  "golden",
  "labs",
  "wallet",
  "connect",
  "mint",
  "nft",
  "subscribe",
  "referral",
  "refer",
  "marketplace",
  "dashboard",
  "profile",
  "usdt",
  "bnb",
  "list",
  "buy",
  "sell",
  "trade",
  "asset",
  "price",
  "cost",
  "gas",
  "withdraw",
  "claim",
  "leaderboard",
  "suspended",
  "blocked",
  "sign in",
  "login",
  "metamask",
  "network",
  "chain",
  "bsc",
  "project",
  "about",
  "fee",
  "profit",
  "loss",
  "owner",
  "creator",
  "contact",
  "email",
  "telegram",
  "community",
  "activity",
  "owned",
  "delist",
  "level",
  "how to",
  "start",
];

/** Out-of-scope patterns – redirect to Golden Labs topics */
const OFF_TOPIC_PATTERNS =
  /\b(weather|joke|recipe|cook|movie|football|sport|politics|bitcoin|ethereum price|crypto price|who won|what time|tell me about yourself|random|jokes?)\b|^(hi|hey|ok|okay|cool|nice|yes|no|test|asdf|123)$/i;

/**
 * @param {object} ctx
 * @param {string|null} ctx.subPriceLabel  e.g. "10 USDT"
 * @param {string|null} ctx.mintPriceLabel
 * @param {string} ctx.withdrawChunkLabel e.g. "10 USDT"
 * @param {string} ctx.contactLine
 * @param {string} ctx.startFundsLine
 * @param {string} ctx.referralTableShort
 */
function getSupportReply(userText, ctx) {
  const {
    subPriceLabel,
    mintPriceLabel,
    withdrawChunkLabel,
    contactLine,
    startFundsLine,
    referralTableShort,
  } = ctx;

  const t = userText.toLowerCase().trim().replace(/\s+/g, " ");
  if (!t)
    return `Hello. I am the Golden Labs assistant. I can explain the platform, getting started, wallet connection, subscription, minting, trading, referrals, and your Dashboard. ${contactLine}`;

  // Contact / community
  if (
    t.includes("contact") ||
    t.includes("email") ||
    (t.includes("support") && (t.includes("human") || t.includes("staff") || t.includes("official"))) ||
    /reach\s+(you|us|out)/i.test(userText)
  )
    return `For support or other queries, please use “Support or Any Query” at the bottom of this chat. For our community, tap “Join now” next to Telegram Community.`;

  if (t.includes("telegram") || t.includes("community") || t.includes("channel") || t.includes("join"))
    return `Please use “Join now” under Telegram Community at the bottom of this chat. For private enquiries, use Support or Any Query (email) below.`;

  // Greetings
  if (/^(hi|hello|hey|hiya|good morning|good afternoon|good evening)\b/i.test(t))
    return `Hello, and thank you for visiting Golden Labs. I can help with how the platform works, connecting your wallet, subscribing, minting, trading, and referrals. How may I assist you today?`;

  if (t.includes("help") || /what can you do|who are you/i.test(t))
    return `I can guide you through Golden Labs: starting out, wallet connection, subscription (${subPriceLabel}), minting (${mintPriceLabel}), marketplace trading, your Dashboard, Leaderboard, referrals, and rewards. ${contactLine}`;

  // Project intro
  const hasProjectQ =
    (t.includes("what") && (t.includes("golden") || t.includes("labs") || t.includes("project") || t.includes("porject"))) ||
    (t.includes("about") && (t.includes("golden") || t.includes("labs") || t.includes("project"))) ||
    /what\s+(is|does)\s+(golden|labs|this)/i.test(t) ||
    /(this\s+)?project\s+about|about\s+this\s+project/i.test(t) ||
    /what\s+(do|does)\s+(you|this)\s+do/i.test(t) ||
    /explain\s+(golden|labs|project)/i.test(t) ||
    /tell\s+me\s+about\s+(golden|labs|this)/i.test(t);
  if (hasProjectQ)
    return `Golden Labs is a digital collectibles and trading experience on BNB Smart Chain. You complete a short profile, subscribe (${subPriceLabel}), mint your personal asset (${mintPriceLabel}, one per wallet), and may then use the Marketplace to list or buy. You can also grow a referral network and view rewards on your Dashboard. ${startFundsLine} ${contactLine}`;

  // Getting started / funds
  if (
    t.includes("how to start") ||
    t.includes("get started") ||
    t.includes("begin") ||
    (t.includes("start") && t.includes("platform")) ||
    (t.includes("need") && (t.includes("money") || t.includes("fund") || t.includes("usdt") || t.includes("pay")))
  )
    return `${startFundsLine} After subscribing and minting, keep a small amount of BNB in your wallet for network fees whenever you list, buy, or withdraw referral rewards. ${contactLine}`;

  const noListings =
    /\b(no|zero|empty|nothing|none)\b.*(list|lisit|listing)/i.test(t) ||
    /(list|lisit|listing)s?\s*(no|empty|zero|nothing|none|missing)/i.test(t) ||
    /theres?\s+no\s+(list|lisit|listing)/i.test(t) ||
    /there\s+are\s+no\s+(list|lisit|listing)/i.test(t) ||
    /wheres?\s+(the\s+)?(list|lisit|listing)/i.test(t) ||
    /\b(no|zero)\s+(list|lisit|listing)/i.test(t) ||
    /(list|lisit|listing)s?\s*(bro|man|dude|why)\s*[?!.]?\s*$/i.test(t);
  if (noListings)
    return "Listings are created by members who have minted and chosen to sell. If the Marketplace appears quiet, you may be among the first in your circle to list. After minting, you may list your asset from the Dashboard or Marketplace. The list refreshes regularly.";

  const isGlRelated = GL_TOPICS.some((kw) => t.includes(kw));
  if (!isGlRelated && (OFF_TOPIC_PATTERNS.test(t) || t.length < 4)) {
    return `I specialise in Golden Labs only: the platform, wallet, subscription, minting, trading, referrals, and your account areas. ${contactLine}`;
  }

  if (t.includes("creator") && (t.includes("fee") || t.includes("cut") || t.length < 20))
    return "A modest creator fee applies on Marketplace sales; the displayed sale price is the buyer’s price, and the fee is part of how the ecosystem operates. Sellers and eligible referrers receive their portions according to the platform rules.";

  if (t.includes("fee") || t.includes("fees"))
    return `Typical costs: subscription ${subPriceLabel}, minting ${mintPriceLabel}, plus a little BNB for network fees. Marketplace trades use USDT at the price shown on each listing. Referral rewards can be withdrawn in steps (commonly ${withdrawChunkLabel} per withdrawal when your claimable balance allows).`;

  if (t.includes("owner") || t.includes("who run") || t.includes("who owns") || t.includes("who made"))
    return "For ownership or partnership questions, please use Support or Any Query at the bottom of this chat. I am here to help you use the platform comfortably.";

  if ((t.includes("profit") || t.includes("earn")) && !t.includes("referral") && !t.includes("level"))
    return "Members may sell assets on the Marketplace and may receive referral rewards when qualifying activity occurs in their network. Past results do not guarantee future outcomes. I can explain how each feature works if you tell me which area interests you.";

  if (t.includes("loss") || t.includes("lose") || t.includes("risk"))
    return "Trading and digital collectibles carry risk. Prices and demand can change. Golden Labs does not provide investment advice. I can explain how the features work so you can decide what suits you.";

  if (t.includes("wallet") || t.includes("connect") || t.includes("metamask"))
    return "Please use Connect Wallet in the header. The application works with BNB Smart Chain; your wallet may ask you to approve the network. After connecting, sign the message when prompted to access your profile and the rest of the journey.";

  if (t.includes("sign in") || t.includes("login") || t.includes("log in"))
    return "After your wallet is connected, you confirm ownership with a short signed message. New members complete profile setup first; returning members sign in when prompted.";

  if (t.includes("profile") || t.includes("username") || t.includes("avatar") || t.includes("bio"))
    return "On your first visit, set up your profile with a username, optional photo, and details. You may add a referrer’s username if someone invited you. You can update your profile later from the Profile page.";

  if (t.includes("subscribe") || t.includes("subscription") || t.includes("resubscribe"))
    return `Open Subscribe to unlock minting and trading. The current subscription amount is ${subPriceLabel}. You pay in USDT and keep a little BNB for fees. If your access was paused for subscription rules, the same page allows you to continue again.`;

  if (t.includes("mint") || t.includes("minting"))
    return `After you are subscribed, open Mint to create your asset. The mint price is ${mintPriceLabel}. One wallet may mint once. You need USDT plus BNB for fees. If you already minted, the app will guide you to your Dashboard.`;

  if (t.includes("nft") || t.includes("asset") || t.includes("one per") || t.includes("1 wallet"))
    return `Each wallet may mint one Golden Labs asset. The mint price is ${mintPriceLabel} after subscription (${subPriceLabel}). Additional pieces may be purchased from other members on the Marketplace.`;

  if (
    t.includes("marketplace") ||
    (t.includes("buy") && !t.includes("referral")) ||
    (t.includes("sell") && !t.includes("referral")) ||
    (t.includes("trade") && !t.includes("referral"))
  )
    return "The Marketplace lists assets offered by members. To buy, choose a listing and follow the steps to pay in USDT. To list yours, approve the Marketplace if asked, then set your listing at the platform’s fixed listing terms. To remove a listing, use Delist from your listing card.";

  if (t.includes("delist") || t.includes("cancel listing"))
    return "You may cancel a listing at any time from the Marketplace or your Dashboard. Your asset returns to your ownership in the usual way once the cancellation completes.";

  if (t.includes("list") && (t.includes("how") || t.includes("nft") || t.includes("asset")))
    return "From the Dashboard or Marketplace, choose List on an asset you own, complete any approval step, and confirm. Your item appears for others to buy at the platform’s set listing price terms.";

  // Referral link
  if ((t.includes("referral") || t.includes("refer")) && (t.includes("link") || t.includes("code") || t.includes("share") || t.includes("ref=")))
    return `Your personal link uses your username: add ?ref=YourUsername to the site address, or share your username so friends enter it on their profile before they subscribe. Rewards depend on programme rules and qualifying activity. ${referralTableShort}`;

  // Referral levels deep dive
  if (
    t.includes("level") ||
    (t.includes("l1") || t.includes("l2") || t.includes("l10") || t.includes("tier")) ||
    (t.includes("referral") && (t.includes("how much") || t.includes("how many") || t.includes("income") || t.includes("earn")))
  )
    return referralTableShort;

  if (t.includes("withdraw") || t.includes("claim") || (t.includes("referral") && t.includes("earning")))
    return `Open Dashboard, then Referral earnings. When your claimable balance is sufficient, you may withdraw in steps of ${withdrawChunkLabel}. Each withdrawal uses a little BNB for the network fee.`;

  if (t.includes("why not sell") || t.includes("not selling") || t.includes("listing not sold"))
    return "Sales depend on buyers choosing your listing. Ensure your item is correctly listed and approved. Demand can vary; many members also share your Marketplace link with interested friends.";

  if (t.includes("price") || t.includes("cost") || t.includes("how much") || (t.includes("usdt") && !t.includes("referral")))
    return `At present, subscription is ${subPriceLabel} and minting is ${mintPriceLabel}. Marketplace listings use the standard list price shown in the app. Keep BNB for fees.`;

  if (t.includes("bnb") || t.includes("gas"))
    return "Transactions on BNB Smart Chain use a small amount of BNB for network fees. Your purchases and subscription payments are in USDT as shown in the app.";

  if (t.includes("suspended") || t.includes("blocked") || t.includes("can't access") || t.includes("cannot access"))
    return `If your account shows a subscription pause, please visit Subscribe and complete the step again (${subPriceLabel}) to restore full access where the rules allow.`;

  if (t.includes("can't mint") || t.includes("cannot mint"))
    return `Please confirm subscription is complete first. Remember one mint per wallet (${mintPriceLabel}). Further pieces come from the Marketplace.`;

  if (t.includes("insufficient") || t.includes("not enough") || (t.includes("balance") && t.includes("wallet")))
    return "Please ensure you hold enough USDT for the purchase or subscription step, and enough BNB for network fees. Small top-ups often resolve the message you saw.";

  if (t.includes("leaderboard") || t.includes("top seller"))
    return "The Leaderboard highlights members by trading activity. You can open it from the main navigation. It is a shared page for the community.";

  if (t.includes("dashboard"))
    return "Your Dashboard brings together Owned assets (list or manage items), Referral earnings (review and withdraw when eligible), and Activity (your history). It becomes central after you mint.";

  if (t.includes("owned") || (t.includes("asset") && t.includes("own")))
    return "Under Dashboard → Owned you see assets linked to your wallet. From there you may list on the Marketplace or open items you hold.";

  if (t.includes("activity") && !t.includes("trade"))
    return "Dashboard → Activity summarises actions connected to your account so you can review your history at a glance.";

  if (t.includes("referral earnings") || (t.includes("referral") && t.includes("tab")))
    return `Referral earnings on your Dashboard show rewards credited through the programme. You may withdraw in ${withdrawChunkLabel} steps when eligible. ${referralTableShort}`;

  if (t.includes("chain") || t.includes("network") || t.includes("bsc"))
    return "Golden Labs uses BNB Smart Chain. Please use USDT on that network as indicated in the app, and keep BNB for fees.";

  const short = t.replace(/[?!.\s/]+$/, "").trim();
  if (short.length <= 12) {
    if (/^(fee|fees)$/i.test(short))
      return `Subscription ${subPriceLabel}, mint ${mintPriceLabel}; Marketplace uses standard list pricing; referral withdrawals often in ${withdrawChunkLabel} steps.`;
    if (/^(profit|profits)$/i.test(short))
      return "Earnings may come from selling on the Marketplace and from referral rewards when rules are met. I can detail either path if you like.";
  }

  return `I can explain the platform, wallet connection, subscribing (${subPriceLabel}), minting (${mintPriceLabel}), Marketplace trading, Dashboard sections, referrals, or how to reach us. ${contactLine}`;
}

const SCROLL_DEBOUNCE_MS = 3000;
const TYPING_DELAY_MS = 600;

function buildReferralSummary(withdrawChunkLabel, tierRows, referralTotalUsdtLabel) {
  const rows = tierRows.map(
    (r) =>
      `Level ${r.level}: up to about ${r.perTradeUsdt} USDT per qualifying trade above you when you have at least ${r.directs} direct invitation${r.directs === 1 ? "" : "s"} (programme rules apply).`,
  ).join(" ");
  return (
    `Referral rewards come from a shared pool on each qualifying Marketplace trade (up to about ${referralTotalUsdtLabel} USDT per trade across all levels combined on-chain, subject to eligibility). ` +
    rows +
    ` Amounts follow the current on-chain programme; your Dashboard shows your own totals. Withdrawals are usually in ${withdrawChunkLabel} steps once you have enough claimable balance.`
  );
}

export default function SupportChat() {
  const publicClient = usePublicClient({ chainId: BSC_CHAIN_ID });
  const subAddr = (import.meta.env.VITE_SUBSCRIPTION_CONTRACT || "").trim();
  const subNorm = subAddr.startsWith("0x") ? subAddr : subAddr ? `0x${subAddr}` : "";
  const nftAddr = (import.meta.env.VITE_NFT_CONTRACT || "").trim();
  const nftNorm = nftAddr.startsWith("0x") ? nftAddr : nftAddr ? `0x${nftAddr}` : "";
  const refAddr = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
  const refNorm = refAddr.startsWith("0x") ? refAddr : refAddr ? `0x${refAddr}` : "";

  const [referralTiers, setReferralTiers] = useState(getDefaultReferralSupportRows);

  useEffect(() => {
    let cancelled = false;
    const addr = refNorm;
    if (!publicClient || !addr) {
      setReferralTiers(getDefaultReferralSupportRows());
      return undefined;
    }
    (async () => {
      try {
        const totalWei = await publicClient.readContract({
          address: addr,
          abi: REFERRAL_TIER_READ_ABI,
          functionName: "referralTotalAmount",
        });
        const levelReads = [];
        for (let i = 0; i < 10; i++) {
          levelReads.push(
            publicClient.readContract({
              address: addr,
              abi: REFERRAL_TIER_READ_ABI,
              functionName: "levelAmounts",
              args: [BigInt(i)],
            }),
            publicClient.readContract({
              address: addr,
              abi: REFERRAL_TIER_READ_ABI,
              functionName: "minDirectReferralsRequired",
              args: [BigInt(i)],
            })
          );
        }
        const levelResults = await Promise.all(levelReads);
        const rows = [];
        for (let i = 0; i < 10; i++) {
          const gross = levelResults[i * 2];
          const minD = levelResults[i * 2 + 1];
          const directs = minD > 0n ? Number(minD) : 1;
          rows.push({
            level: i + 1,
            directs,
            perTradeUsdt: perTradeUsdtStringFromTier(gross, minD, i),
          });
        }
        const totalUsdt = trimUsdtAmountString(formatUnits(totalWei, USDT_DECIMALS));
        if (!cancelled) setReferralTiers({ rows, totalUsdt });
      } catch {
        if (!cancelled) setReferralTiers(getDefaultReferralSupportRows());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, refNorm]);

  const { data: subPriceWei } = useReadContract({
    address: subNorm || undefined,
    abi: SUBSCRIPTION_ABI,
    functionName: "subscriptionPrice",
    chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(subNorm) },
  });
  const { data: mintPriceWei } = useReadContract({
    address: nftNorm || undefined,
    abi: NFT_MINT_PRICE_ABI,
    functionName: "mintPrice",
    chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(nftNorm) },
  });
  const { data: chunkWei } = useReadContract({
    address: refNorm || undefined,
    abi: REFERRAL_CHUNK_ABI,
    functionName: "referralWithdrawChunk",
    chainId: BSC_CHAIN_ID,
    query: { enabled: Boolean(refNorm) },
  });

  const pricingCtx = useMemo(() => {
    const subAmt = formatUsdtTrim(readContractUint256(subPriceWei) ?? subPriceWei);
    const mintAmt = formatUsdtTrim(readContractUint256(mintPriceWei) ?? mintPriceWei);
    const chunkAmt = formatUsdtTrim(readContractUint256(chunkWei) ?? chunkWei);

    const subPriceLabel = subAmt != null ? `${subAmt} USDT` : "shown on the Subscribe page (read from the app)";
    const mintPriceLabel = mintAmt != null ? `${mintAmt} USDT` : "shown on the Mint page (read from the app)";
    const withdrawChunkLabel = chunkAmt != null ? `${chunkAmt} USDT` : "10 USDT";

    const contactLine =
      "For official contact, use Support or Any Query and Telegram Community at the bottom of this chat window.";
    const startFundsLine = `To begin, plan for subscription (${subPriceLabel}), minting (${mintPriceLabel}), and a small extra amount of BNB for transaction fees.`;

    const referralTableShort = buildReferralSummary(
      withdrawChunkLabel,
      referralTiers.rows,
      referralTiers.totalUsdt
    );

    return {
      subPriceLabel,
      mintPriceLabel,
      withdrawChunkLabel,
      contactLine,
      startFundsLine,
      referralTableShort,
    };
  }, [subPriceWei, mintPriceWei, chunkWei, referralTiers]);

  const replyFor = useCallback((text) => getSupportReply(text, pricingCtx), [pricingCtx]);

  const [supportOpen, setSupportOpen] = useState(false);
  const [supportClosing, setSupportClosing] = useState(false);
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportInput, setSupportInput] = useState("");
  const [isScrolling, setIsScrolling] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const supportMessagesEndRef = useRef(null);
  const supportCloseTimeoutRef = useRef(null);
  const scrollEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollEndRef.current) clearTimeout(scrollEndRef.current);
      scrollEndRef.current = setTimeout(() => {
        setIsScrolling(false);
        scrollEndRef.current = null;
      }, SCROLL_DEBOUNCE_MS);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollEndRef.current) clearTimeout(scrollEndRef.current);
    };
  }, []);

  const handleSupportClose = () => {
    setSupportClosing(true);
    supportCloseTimeoutRef.current = setTimeout(() => {
      setSupportOpen(false);
      setSupportClosing(false);
      supportCloseTimeoutRef.current = null;
    }, 320);
  };

  useEffect(() => {
    return () => {
      if (supportCloseTimeoutRef.current) clearTimeout(supportCloseTimeoutRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const handleSupportSend = () => {
    const text = supportInput.trim();
    if (!text) return;
    setSupportInput("");
    setSupportMessages((prev) => [...prev, { role: "user", text }]);
    setIsTyping(true);
    typingTimeoutRef.current = setTimeout(() => {
      const reply = replyFor(text);
      setSupportMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setIsTyping(false);
      typingTimeoutRef.current = null;
    }, TYPING_DELAY_MS);
  };

  useEffect(() => {
    supportMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [supportMessages]);

  const placeholderSub = pricingCtx.subPriceLabel;
  const placeholderMint = pricingCtx.mintPriceLabel;

  return (
    <>
      <button
        type="button"
        className={`landing-v2__support-toggle${supportOpen ? " landing-v2__support-toggle--hidden" : ""}${isScrolling ? " landing-v2__support-toggle--scrolled" : ""}`}
        onClick={() => setSupportOpen(true)}
        aria-label="Open support chat"
        title="Support"
        aria-hidden={supportOpen}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {(supportOpen || supportClosing) && (
        <div className={`landing-v2__support-panel${supportOpen && !supportClosing ? " landing-v2__support-panel--open" : ""}${supportClosing ? " landing-v2__support-panel--closing" : ""}`}>
          <div className="landing-v2__support-header">
            <div>
              <h3 className="landing-v2__support-title">Golden Labs Support</h3>
              <p className="landing-v2__support-sub">Guidance for the platform · Subscribe {placeholderSub} · Mint {placeholderMint}</p>
            </div>
            <button type="button" className="landing-v2__support-close" onClick={handleSupportClose} aria-label="Close support">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="landing-v2__support-messages">
            {supportMessages.length === 0 && (
              <p className="landing-v2__support-placeholder">
                Ask about Golden Labs, your wallet, subscription ({placeholderSub}), minting ({placeholderMint}), trading, Dashboard, or referrals.
              </p>
            )}
            {supportMessages.map((msg, i) => (
              <div key={i} className={`landing-v2__support-msg landing-v2__support-msg--${msg.role}`}>
                <span className="landing-v2__support-msg-text">{msg.text}</span>
              </div>
            ))}
            {isTyping && (
              <div className="landing-v2__support-msg landing-v2__support-msg--assistant landing-v2__support-msg--typing">
                <span className="landing-v2__support-typing-dots">
                  <span></span><span></span><span></span>
                </span>
              </div>
            )}
            <div ref={supportMessagesEndRef} />
          </div>
          <div className="landing-v2__support-contact" aria-label="Contact and community">
            <div className="landing-v2__support-contact-inline">
              <span className="landing-v2__support-contact-part">
                <span className="landing-v2__support-contact-text">Support or Any Query: </span>
                <a href={`mailto:${SUPPORT_EMAIL}`} target="_blank" rel="noopener noreferrer">
                  {SUPPORT_EMAIL}
                </a>
              </span>
              <span className="landing-v2__support-contact-divider" aria-hidden="true" />
              <span className="landing-v2__support-contact-part">
                <span className="landing-v2__support-contact-text">Telegram Community: </span>
                <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
                  Join now
                </a>
              </span>
            </div>
          </div>
          <div className="landing-v2__support-input-wrap">
            <input
              type="text"
              className="landing-v2__support-input"
              placeholder="Type your question..."
              value={supportInput}
              onChange={(e) => setSupportInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSupportSend()}
            />
            <button type="button" className="landing-v2__support-send" onClick={handleSupportSend} aria-label="Send">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
