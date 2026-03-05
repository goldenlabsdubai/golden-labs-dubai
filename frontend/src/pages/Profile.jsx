import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useBalance, useDisconnect, useWriteContract, usePublicClient } from "wagmi";
import { formatEther } from "viem";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, getAvatarUrl, ASSET_IMAGE } from "../config";
import { getTransactionErrorMessage } from "../utils/transactionError";

const REFERRAL_ABI = [
  { name: "setMyReferrer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "referrer", type: "address" }], outputs: [] },
];

const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io",
  56: "https://bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
};

export default function Profile() {
  const { user, token, setSession, refreshUser, connect, logout } = useAuth();
  const navigate = useNavigate();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { data: balanceData } = useBalance({ address: address ?? undefined });
  const { disconnect: disconnectWallet } = useDisconnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const referralAddress = (import.meta.env.VITE_REFERRAL_CONTRACT || "").trim();
  const referralAddressNormalized = referralAddress?.startsWith("0x") ? referralAddress : referralAddress ? `0x${referralAddress}` : "";
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [error, setError] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [portalReady, setPortalReady] = useState(false);
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const menuRef = useRef(null);

  const displayAddress = (token && user?.wallet) ? user.wallet : (isConnected && address) ? address : null;
  const explorerUrl = chainId && EXPLORER_BY_CHAIN[chainId] && displayAddress
    ? `${EXPLORER_BY_CHAIN[chainId]}/address/${displayAddress}`
    : null;

  const handleConnect = () => {
    if (openModal) openModal();
  };

  const handleDisconnect = () => {
    setAddressMenuOpen(false);
    disconnectWallet();
    logout();
    navigate("/", { replace: true });
  };

  const handleCopyAddress = async () => {
    if (!displayAddress) return;
    try {
      await navigator.clipboard.writeText(displayAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  useEffect(() => {
    setPortalReady(true);
  }, []);

  // Auto-fill referral code from ref link (?ref=username) as soon as profile page loads
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    const ref = sessionStorage.getItem("gl_ref");
    if (ref && ref.trim()) setReferralCode(ref.trim());
  }, []);

  useEffect(() => {
    if (token) refreshUser();
  }, [token, refreshUser]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setAddressMenuOpen(false);
    }
    if (addressMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [addressMenuOpen]);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setUsername(user.username || "");
      setBio(user.bio || "");
      setAvatar(user.avatar || "");
      setWebsiteUrl(user.websiteUrl || "");
      setXUrl(user.xUrl || "");
      setTelegramUrl(user.telegramUrl || "");
      if (!user.referrer && typeof sessionStorage !== "undefined") {
        const ref = sessionStorage.getItem("gl_ref");
        if (ref && ref.trim()) setReferralCode(ref.trim());
      }
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please select an image (JPEG, JPG or PNG)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image must be under 2MB");
      return;
    }
    setUploadError("");
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setPendingAvatarFile(file);
    e.target.value = "";
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!token) {
      setError("Please sign in to save your profile.");
      return;
    }
    if (!username.trim() || username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    setLoading(true);
    setError("");
    setUploadError("");
    try {
      let avatarUrl = avatar.trim() || null;
      if (pendingAvatarFile) {
        setUploadingAvatar(true);
        try {
          const formData = new FormData();
          formData.append("avatar", pendingAvatarFile);
          const uploadHeaders = { Authorization: `Bearer ${token}` };
          if (address) uploadHeaders["X-Connected-Wallet"] = address;
          const uploadRes = await fetch(`${API}/user/avatar-upload`, {
            method: "POST",
            headers: uploadHeaders,
            body: formData,
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok) throw new Error(uploadData.error || "Avatar upload failed");
          avatarUrl = uploadData.avatar || null;
        } finally {
          setUploadingAvatar(false);
        }
      }
      const res = await fetch(`${API}/user/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim() || null,
          username: username.trim(),
          bio: bio.trim() || null,
          avatar: avatarUrl ?? null,
          websiteUrl: websiteUrl.trim() || null,
          xUrl: xUrl.trim() || null,
          telegramUrl: telegramUrl.trim() || null,
          referralCode: referralCode.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSession(token, data.user);
      await refreshUser();
      // If user just set a referrer (referral code), have them sign setMyReferrer on-chain so L2–L5 payouts work
      if (data.user?.referrer && referralAddressNormalized && writeContractAsync && address) {
        try {
          const referrerAddr = (data.user.referrer.startsWith("0x") ? data.user.referrer : `0x${data.user.referrer}`).toLowerCase();
          const hash = await writeContractAsync({
            address: referralAddressNormalized,
            abi: REFERRAL_ABI,
            functionName: "setMyReferrer",
            args: [referrerAddr],
          });
          if (publicClient && hash) await publicClient.waitForTransactionReceipt({ hash });
        } catch (_) {
          // User rejected tx or it failed; profile is already saved, on-chain referrer can be set later
        }
      }
      if (user?.username?.trim()) {
        setIsEditing(false);
      } else {
        const target = data.redirect ? `/${data.redirect}` : "/subscription";
        navigate(target, { replace: true });
      }
    } catch (e) {
      setError(getTransactionErrorMessage(e, "Save failed"));
    } finally {
      setLoading(false);
    }
  };

  const hasProfile = Boolean(user?.username?.trim());
  const showForm = !hasProfile || isEditing;

  const displayReferrer = (() => {
    const code = referralCode?.trim() || user?.referrer;
    if (!code) return null;
    if (user?.referrerUsername) {
      return { label: "Referral code", value: `@${user.referrerUsername}` };
    }
    if (code.startsWith("0x") && code.length >= 40) {
      return { label: "Referral code", value: `${code.slice(0, 6)}…${code.slice(-4)}` };
    }
    return { label: "Referral code", value: code.includes("0x") ? code : `@${code}` };
  })();

  const profileBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );

  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  return (
    <div className="profile-modern">
      {portalReady && portalContainer && createPortal(profileBg, portalContainer)}

      <header className="profile-modern__header landing-v2__header">
        <Link to="/" className="landing-v2__logo">
          Golden Labs
        </Link>
        {hasProfile && (user?.state === "MINTED" || user?.state === "ACTIVE_TRADER") && (
          <nav className="marketplace-page__links" aria-label="Main">
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/leaderboard">Leaderboard</Link>
            <Link to="/dashboard">My Dashboard</Link>
          </nav>
        )}
        <div className="landing-v2__header-right">
          {displayAddress ? (
            <div className="landing-v2__address-wrap" ref={menuRef}>
              <button
                type="button"
                className="landing-v2__address"
                title={displayAddress}
                onClick={() => setAddressMenuOpen((o) => !o)}
                aria-expanded={addressMenuOpen}
                aria-haspopup="true"
              >
                {displayAddress.slice(0, 6)}…{displayAddress.slice(-4)}
              </button>
              {addressMenuOpen && (
                <div className="landing-v2__address-menu">
                  {balanceData && (
                    <div className="landing-v2__address-menu-balance">
                      <span className="landing-v2__address-menu-balance-label">Balance</span>
                      <span className="landing-v2__address-menu-balance-value">
                        {Number(formatEther(balanceData.value ?? 0n)).toFixed(4)} {balanceData.symbol ?? "BNB"}
                      </span>
                    </div>
                  )}
                  <button type="button" className="landing-v2__address-menu-item" onClick={handleCopyAddress}>
                    {copied ? "Copied!" : "Copy address"}
                  </button>
                  {explorerUrl && (
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="landing-v2__address-menu-item landing-v2__address-menu-item--link">
                      View on explorer
                    </a>
                  )}
                  <div className="landing-v2__address-menu-divider" />
                  <button type="button" className="landing-v2__address-menu-item landing-v2__address-menu-item--danger" onClick={handleDisconnect}>
                    Disconnect wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="landing-v2__btn landing-v2__btn--primary" onClick={handleConnect}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <div className="profile-modern__panel-top">
        <img src={ASSET_IMAGE} alt="Golden Labs DeFi Asset" className="profile-modern__panel-asset" />
        <h2 className="profile-modern__panel-title">Golden Labs</h2>
      </div>

      <main className="profile-modern__main">
        <div className="profile-modern__glass">
          {!showForm ? (
            <>
              <div className="profile-modern__view-head">
                <h1 className="profile-modern__headline">Your profile</h1>
                <button type="button" className="profile-modern__edit-btn" onClick={() => setIsEditing(true)} aria-label="Edit profile">
                  <svg className="profile-modern__edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  <span>Edit</span>
                </button>
              </div>
              <div className="profile-modern__view-card">
                <div className="profile-modern__view-avatar-wrap">
                  {(avatar || user?.avatar) ? (
                    <img src={avatar ? getAvatarUrl(avatar) : getAvatarUrl(user.avatar)} alt="" className="profile-modern__view-avatar" />
                  ) : (
                    <span className="profile-modern__view-avatar profile-modern__view-avatar--placeholder">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
                    </span>
                  )}
                </div>
                <dl className="profile-modern__view-dl">
                  <div className="profile-modern__view-row">
                    <dt>Username</dt>
                    <dd>@{username || user?.username || "—"}</dd>
                  </div>
                  {name || user?.name ? (
                    <div className="profile-modern__view-row">
                      <dt>Name</dt>
                      <dd>{name || user?.name || "—"}</dd>
                    </div>
                  ) : null}
                  {bio || user?.bio ? (
                    <div className="profile-modern__view-row">
                      <dt>Bio</dt>
                      <dd>{bio || user?.bio || "—"}</dd>
                    </div>
                  ) : null}
                  {websiteUrl || user?.websiteUrl ? (
                    <div className="profile-modern__view-row">
                      <dt>Website</dt>
                      <dd><a href={websiteUrl || user?.websiteUrl} target="_blank" rel="noopener noreferrer">{websiteUrl || user?.websiteUrl}</a></dd>
                    </div>
                  ) : null}
                  {xUrl || user?.xUrl ? (
                    <div className="profile-modern__view-row">
                      <dt>X (Twitter)</dt>
                      <dd><a href={xUrl || user?.xUrl} target="_blank" rel="noopener noreferrer">{xUrl || user?.xUrl}</a></dd>
                    </div>
                  ) : null}
                  {telegramUrl || user?.telegramUrl ? (
                    <div className="profile-modern__view-row">
                      <dt>Telegram</dt>
                      <dd><a href={telegramUrl || user?.telegramUrl} target="_blank" rel="noopener noreferrer">{telegramUrl || user?.telegramUrl}</a></dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              {(user?.state !== "MINTED" && user?.state !== "ACTIVE_TRADER") && (
                <div className="profile-modern__view-actions">
                  {user?.state === "SUBSCRIBED" ? (
                    <button type="button" className="landing-v2__btn landing-v2__btn--primary profile-modern__submit" onClick={() => navigate("/mint")}>
                      Continue to Mint
                    </button>
                  ) : (
                    <button type="button" className="landing-v2__btn landing-v2__btn--primary profile-modern__submit" onClick={() => navigate("/subscription")}>
                      Continue
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
          <span className="profile-modern__step">Step 1 · Profile</span>
          <h1 className="profile-modern__headline">{hasProfile ? "Edit your profile" : "Complete your profile"}</h1>
          <p className="profile-modern__subline">{hasProfile ? "Update your details below" : "One step closer to minting & trading"}</p>

          <div className="profile-modern__avatar-wrap">
            <label className="profile-modern__avatar-label">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png"
                onChange={handleAvatarChange}
                disabled={uploadingAvatar}
                className="profile-modern__avatar-input"
              />
              <span className="profile-modern__avatar-ring">
                {(avatarPreviewUrl || avatar) ? (
                  <img src={avatarPreviewUrl || getAvatarUrl(avatar)} alt="" className="profile-modern__avatar-img" />
                ) : (
                  <span className="profile-modern__avatar-placeholder">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </span>
                )}
              </span>
              <span className="profile-modern__avatar-action">
                {uploadingAvatar ? "Uploading…" : "Upload your profile picture"}
              </span>
            </label>
            {uploadError && <p className="profile-modern__avatar-error">{uploadError}</p>}
            <p className="profile-modern__avatar-hint">JPEG, JPG or PNG · max 2MB</p>
          </div>

          <form onSubmit={handleSave} className="profile-modern__form">
            <div className="profile-modern__block">
              <label className="profile-modern__field">
                <span className="profile-modern__field-label">Username</span>
                <input
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="profile-modern__field-input"
                  minLength={3}
                  required
                />
                <span className="profile-modern__field-hint">Must be unique · min 3 characters</span>
              </label>
            </div>

            {displayReferrer ? (
              <div className="profile-modern__block profile-modern__referral-display">
                <div className="profile-modern__referral-code-box">
                  <span className="profile-modern__referral-code-label">{displayReferrer.label}</span>
                  <span className="profile-modern__referral-code-value">{displayReferrer.value}</span>
                </div>
                <span className="profile-modern__field-hint">You were referred by this user</span>
              </div>
            ) : (
              <div className="profile-modern__block">
                <label className="profile-modern__field">
                  <span className="profile-modern__field-label">Referral code (optional)</span>
                  <input
                    type="text"
                    placeholder="Friend's username or code"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    className="profile-modern__field-input"
                  />
                  <span className="profile-modern__field-hint">Enter a friend's referral code or username if someone invited you</span>
                </label>
              </div>
            )}

            <div className="profile-modern__block">
              <h3 className="profile-modern__block-title">Social links</h3>
              <label className="profile-modern__field">
                <span className="profile-modern__field-label">X (Twitter)</span>
                <input
                  type="url"
                  placeholder="https://x.com/..."
                  value={xUrl}
                  onChange={(e) => setXUrl(e.target.value)}
                  className="profile-modern__field-input"
                />
              </label>
              <label className="profile-modern__field">
                <span className="profile-modern__field-label">Telegram</span>
                <input
                  type="url"
                  placeholder="https://t.me/..."
                  value={telegramUrl}
                  onChange={(e) => setTelegramUrl(e.target.value)}
                  className="profile-modern__field-input"
                />
              </label>
            </div>

            {user && (
              <div className="profile-modern__block profile-modern__stats">
                <h3 className="profile-modern__block-title">Your data</h3>
                <div className="profile-modern__stats-grid">
                  <div className="profile-modern__stat">
                    <span className="profile-modern__stat-label">Status</span>
                    <span className="profile-modern__stat-value">{user.state || "—"}</span>
                  </div>
                  <div className="profile-modern__stat">
                    <span className="profile-modern__stat-label">Total trades</span>
                    <span className="profile-modern__stat-value">{user.totalTrades ?? 0}</span>
                  </div>
                  {user.createdAt && (
                    <div className="profile-modern__stat profile-modern__stat--full">
                      <span className="profile-modern__stat-label">Member since</span>
                      <span className="profile-modern__stat-value">
                        {new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <p className="profile-modern__error">{error}</p>}
            <div className="profile-modern__form-actions">
              {hasProfile && (
                <button type="button" className="profile-modern__cancel" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              )}
              <button type="submit" className="profile-modern__submit" disabled={loading}>
                {loading ? "Saving…" : hasProfile ? "Save changes" : "Save & continue"}
              </button>
            </div>
          </form>
            </>
          )}
        </div>
      </main>

      <div className="profile-modern__panel-howto-wrap">
        <div className="profile-modern__panel-howto">
          <h3 className="profile-modern__panel-howto-title">How to create profile</h3>
          <ul className="profile-modern__panel-howto-list">
            <li>Choose a unique username (min 3 characters)</li>
            <li>Upload your profile picture (JPEG, JPG or PNG, max 2MB)</li>
            <li>Add your X (Twitter) and Telegram links</li>
            <li>Click &quot;Save &amp; continue&quot; to proceed</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
