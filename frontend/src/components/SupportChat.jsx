import { useState, useEffect, useRef } from "react";

/** Golden Labs related keywords – if none match, may be off-topic */
const GL_TOPICS = ["golden", "labs", "wallet", "connect", "mint", "nft", "subscribe", "referral", "refer", "marketplace", "dashboard", "profile", "usdt", "bnb", "list", "buy", "sell", "asset", "price", "cost", "gas", "withdraw", "claim", "leaderboard", "suspended", "blocked", "sign in", "login", "metamask", "network", "chain", "bsc", "project", "about", "fee", "profit", "loss", "owner", "creator"];

/** Out-of-scope patterns – redirect to Golden Labs topics */
const OFF_TOPIC_PATTERNS = /\b(weather|joke|recipe|cook|movie|football|sport|politics|bitcoin|ethereum price|crypto price|who won|what time|tell me about yourself|random|jokes?)\b|^(hi|hey|ok|okay|cool|nice|yes|no|test|asdf|123)$/i;

function getSupportReply(userText) {
  const t = userText.toLowerCase().trim().replace(/\s+/g, " ");
  if (!t) return "Hey! 👋 I'm here to help with anything Golden Labs — just drop your question and I'll get right to it.";

  // Greetings first
  if (/^(hi|hello|hey|hiya|yo|sup|how are you)\b/i.test(t))
    return "Hey! 👋 I'm your Golden Labs support assistant. I can help with wallet connection, minting, subscribing, trading, referrals — you name it. What's on your mind?";

  if (t.includes("help") || t.includes("support") || /what can you do|who are you|what you do/i.test(t))
    return "I'm your Golden Labs support assistant! I can answer questions about connecting your wallet, signing in, subscribing (~10 USDT), minting (1 NFT per wallet), marketplace trading, referrals, pricing, and more. What do you need help with?";

  // Project intro – BEFORE other handlers (catches "what is golden labs", "what is this project", "what you do", typos like "porject")
  const hasProjectQ = (t.includes("what") && (t.includes("golden") || t.includes("labs") || t.includes("project") || t.includes("porject"))) ||
    (t.includes("about") && (t.includes("golden") || t.includes("labs") || t.includes("project"))) ||
    /what\s+(is|does)\s+(golden|labs|this)/i.test(t) ||
    /(this\s+)?project\s+about|about\s+this\s+project/i.test(t) ||
    /what\s+(do|does)\s+(you|this)\s+do/i.test(t) ||
    /explain\s+(golden|labs|project)/i.test(t) ||
    /tell\s+me\s+about\s+(golden|labs|this)/i.test(t);
  if (hasProjectQ)
    return "Golden Labs is an NFT subscription trading platform on BSC Mainnet. You subscribe (~10 USDT), mint 1 NFT per wallet (10 USDT), then trade on the marketplace — list yours or buy others. You can also earn via referrals. Want to know more about any specific part?";

  // No listings / empty marketplace – MUST be before marketplace "list" check (listings contains "list")
  const noListings = /\b(no|zero|empty|nothing|none)\b.*(list|lisit|listing)/i.test(t) ||
    /(list|lisit|listing)s?\s*(no|empty|zero|nothing|none|missing)/i.test(t) ||
    /theres?\s+no\s+(list|lisit|listing)/i.test(t) ||
    /there\s+are\s+no\s+(list|lisit|listing)/i.test(t) ||
    /wheres?\s+(the\s+)?(list|lisit|listing)/i.test(t) ||
    /\b(no|zero)\s+(list|lisit|listing)/i.test(t) ||
    /(list|lisit|listing)s?\s*(bro|man|dude|why)\s*[?!.]?\s*$/i.test(t);
  if (noListings)
    return "Listings come from users who mint and list their NFTs. If the Marketplace looks empty, it means nobody's listed yet — you could be one of the first! Mint your NFT, then list it from Dashboard or Marketplace. Listings refresh every few seconds.";

  // Off-topic – redirect
  const isGlRelated = GL_TOPICS.some((kw) => t.includes(kw));
  if (!isGlRelated && (OFF_TOPIC_PATTERNS.test(t) || t.length < 4)) {
    return "I'm your Golden Labs support assistant, so I can only help with questions about our platform — things like connecting your wallet, minting, subscribing, trading, referrals, or pricing. Anything else you'd like to know about Golden Labs?";
  }

  // Fees – before marketplace (fees, creator fee, creator)
  if (t.includes("creator") && (t.includes("fee") || t.includes("cut") || t.length < 20))
    return "A 1% creator fee applies on each marketplace sale — the rest goes to the seller, referral payouts when applicable, and the reserve. You set your own price when listing.";
  if (t.includes("fee") || t.includes("fees"))
    return "Subscribe ~10 USDT, Mint 10 USDT. Marketplace: you set your price (typical 20–40 USDT); a small creator fee applies on sales. Referral earnings go to referrers. Gas is paid in BNB.";

  // Owner / who runs / team
  if (t.includes("owner") || t.includes("who run") || t.includes("who owns") || t.includes("who made") || t.includes("who create"))
    return "For team or official inquiries, reach out through our official channels. I'm here to help with platform use — wallet, minting, subscribing, trading, referrals. What do you need?";

  // Profits / earnings
  if (t.includes("profit") || (t.includes("earn") && !t.includes("referral")))
    return "You can profit by selling your NFT on the marketplace (set your price) and by referral earnings — when people you refer subscribe, mint, or buy, you earn. Withdraw from Dashboard → Referral earnings.";

  // Loss / risk
  if (t.includes("loss") || t.includes("lose") || t.includes("risk"))
    return "NFT and trading involve risk — prices can go up or down. You pay to subscribe and mint; marketplace prices are set by sellers. I can't give financial advice, but I can help with how the platform works. Anything specific?";

  // Wallet & Connect
  if (t.includes("wallet") || t.includes("connect") || t.includes("metamask"))
    return "Sure thing! Hit the 'Connect Wallet' button in the header — we're on BSC Mainnet, so the app will prompt you to switch if needed. Once connected, sign in and you're good to go for Subscribe, Mint, and Dashboard.";

  // Sign in / Login
  if (t.includes("sign in") || t.includes("login") || t.includes("log in"))
    return "After connecting, you'll need to sign a message (SIWE) to prove you own the wallet. New users go to Profile Setup first; existing users get a sign-in popup. Quick and secure!";

  // Profile
  if (t.includes("profile") || t.includes("username") || t.includes("avatar") || t.includes("bio"))
    return "First time: head to Profile Setup and set your username (min 3 chars), bio, avatar (max 2MB), and socials. You can edit anytime from the Profile page — and add your referrer's username there if you have a referral code.";

  // Subscribe
  if (t.includes("subscribe") || t.includes("subscription") || t.includes("resubscribe"))
    return "Subscribe from the Subscribe page for ~10 USDT. You'll need USDT in your wallet plus some BNB for gas. If your account was SUSPENDED, just resubscribe from that same page to restore access.";

  // Mint
  if (t.includes("mint") || t.includes("minting"))
    return "After subscribing, go to Mint — each wallet can mint 1 NFT (lifetime) for 10 USDT. Make sure you've got USDT approved and BNB for gas. Already minted? You'll be redirected to the Dashboard.";

  // NFT / Asset
  if (t.includes("nft") || t.includes("asset") || t.includes("one per") || t.includes("1 wallet"))
    return "Golden Labs is 1 wallet = 1 NFT. Mint costs 10 USDT after subscribing. Want more? Grab them from the Marketplace. You can also list your minted NFT there.";

  // Marketplace
  if (t.includes("marketplace") || t.includes("buy") || t.includes("list") || t.includes("sell"))
    return "Head to the Marketplace to browse and buy NFTs — prices are in USDT, set by sellers. To list yours: approve the marketplace for your NFT, then list with your price. Typical range is around 20–40 USDT.";

  if (t.includes("delist") || t.includes("cancel listing"))
    return "You can cancel your listing anytime from the Marketplace or Dashboard. Your NFT will go back to your wallet straight away.";

  // Referral
  if (t.includes("referral") || t.includes("refer") || t.includes("ref="))
    return "Share your link: yoursite.com/?ref=YOUR_USERNAME. New users enter your username in Profile before subscribing — that's key. You earn when they subscribe, mint, or buy. View and withdraw in Dashboard → Referral earnings.";
  if (t.includes("withdraw") || t.includes("claim") || t.includes("referral earnings"))
    return "Go to Dashboard → Referral earnings and hit Withdraw. Your claimable USDT goes to your wallet — you'll sign an on-chain tx with a small gas fee.";

  // Listing not selling / why not selling (no bot mention)
  if (t.includes("why not sell") || t.includes("not selling") || t.includes("listing not sold") || t.includes("cant sell"))
    return "Check your price — 20–40 USDT is the typical range. Listings can take time to sell depending on demand. Make sure your NFT is approved for the marketplace.";

  // Pricing
  if (t.includes("price") || t.includes("cost") || t.includes("how much") || t.includes("usdt"))
    return "Quick rundown: Subscribe ~10 USDT, Mint 10 USDT, Marketplace buys depend on the seller (usually 20–40 USDT). You'll also need a bit of BNB for gas.";

  if (t.includes("bnb") || t.includes("gas"))
    return "We're on BSC Mainnet — gas is paid in BNB. Marketplace payments are in USDT, not BNB.";

  // User states
  if (t.includes("suspended") || t.includes("blocked") || t.includes("can't access") || t.includes("cannot access"))
    return "If your account is SUSPENDED (inactivity or profit threshold hit), go to Subscribe and resubscribe (~10 USDT). That'll restore your access right away.";

  if (t.includes("can't mint") || t.includes("cannot mint") || t.includes("mint not working"))
    return "Make sure you've subscribed first (10 USDT). If you've already minted, remember it's 1 NFT per wallet — grab more from the Marketplace if you want.";

  if (t.includes("insufficient") || t.includes("balance") || t.includes("not enough"))
    return "You'll need enough USDT for the action (subscribe/mint/buy) plus some BNB for gas. Top up both and you should be good to go.";

  // Dashboard & Leaderboard
  if (t.includes("leaderboard") || t.includes("top seller"))
    return "The Leaderboard shows top sellers by volume — accessible from the nav after you mint. Public page, no sign-in needed to check it out.";

  if (t.includes("dashboard"))
    return "Your Dashboard has: Owned NFTs (list/buy from there too), Referral earnings (withdraw USDT), and Activity (full history). It unlocks after you mint.";

  // Chain / Network
  if (t.includes("chain") || t.includes("network") || t.includes("bsc"))
    return "We run on BSC Mainnet. The app will auto-switch you to BSC if needed. Use USDT (BEP20) on BSC for all payments.";

  // Short GL-related (with optional punctuation)
  const short = t.replace(/[?!.\s\/]+$/, "").trim();
  if (short.length <= 12) {
    if (/^(owner|creator|team)$/i.test(short))
      return "For team or official inquiries, reach out through our official channels. I'm here to help with platform use. What do you need?";
    if (/^(fee|fees)$/i.test(short))
      return "Subscribe ~10 USDT, Mint 10 USDT. Marketplace: you set your price (typical 20–40 USDT); a small creator fee on sales. Gas in BNB.";
    if (/^(profit|profits)$/i.test(short))
      return "Sell your NFT on the marketplace or earn from referrals when people you refer subscribe, mint, or buy. Withdraw from Dashboard.";
  }

  // Fallback
  return "I can help with wallet connection, signing in, subscribing, minting, marketplace trading, referrals, fees, or pricing. Which one do you need help with?";
}

const SCROLL_DEBOUNCE_MS = 3000;
const TYPING_DELAY_MS = 600; // Simulate agent "typing" for more realistic feel

export default function SupportChat() {
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
      const reply = getSupportReply(text);
      setSupportMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setIsTyping(false);
      typingTimeoutRef.current = null;
    }, TYPING_DELAY_MS);
  };

  useEffect(() => {
    supportMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [supportMessages]);

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
              <h3 className="landing-v2__support-title">Golden Labs Support Chat</h3>
              <p className="landing-v2__support-sub">Ask your questions with our Golden Labs AI</p>
            </div>
            <button type="button" className="landing-v2__support-close" onClick={handleSupportClose} aria-label="Close support">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="landing-v2__support-messages">
            {supportMessages.length === 0 && (
              <p className="landing-v2__support-placeholder">Ask anything about Golden Labs: wallet, minting, subscribing, or trading.</p>
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
