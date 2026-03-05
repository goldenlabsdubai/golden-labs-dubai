/**
 * First-time user profile setup. No auth required; wallet must be connected.
 * On "Save & continue" we trigger sign-in (SIWE) and send profile to backend; user is created in Firestore then.
 */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { useAuth } from "../hooks/useAuth";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { API, ASSET_IMAGE } from "../config";
import { getTransactionErrorMessage } from "../utils/transactionError";

const TOKEN_KEY = "gl_token";
const USER_KEY = "gl_user";

export default function ProfileSetup() {
  const navigate = useNavigate();
  const { token, setSession } = useAuth();
  const { openModal, isConnected, address } = useWalletConnect();
  const { chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [portalReady, setPortalReady] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage !== "undefined") {
      const ref = sessionStorage.getItem("gl_ref");
      if (ref && ref.trim()) setReferralCode(ref.trim());
    }
  }, []);

  // Already signed in → use main profile page
  useEffect(() => {
    if (token) navigate("/profile", { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!address || !chainId || !signMessageAsync) {
      setError("Wallet not connected");
      return;
    }
    const usernameVal = username.trim();
    if (!usernameVal || usernameVal.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    setLoading(true);
    setError("");
    setUploadError("");
    try {
      const nonceRes = await fetch(`${API}/auth/nonce/${address}`);
      const nonceData = await nonceRes.json().catch(() => ({}));
      const nonce = nonceData.nonce;
      if (!nonce) throw new Error(nonceData.error || "Failed to get sign-in nonce");

      const siweMsg = new SiweMessage({
        domain: typeof window !== "undefined" ? window.location.host : "",
        address,
        statement: "Welcome to Golden Labs! Sign this message to create your profile and continue.",
        uri: typeof window !== "undefined" ? window.location.origin : "",
        version: "1",
        chainId: Number(chainId),
        nonce,
      });
      const message = siweMsg.prepareMessage();
      const signature = await signMessageAsync({ message });

      const referrerRaw = referralCode.trim() || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("gl_ref") || "" : "");
      const referrer = referrerRaw.trim() || undefined;
      const profile = {
        username: usernameVal,
        name: null,
        bio: bio.trim() || null,
        avatar: null,
        websiteUrl: null,
        xUrl: xUrl.trim() || null,
        telegramUrl: telegramUrl.trim() || null,
      };

      const verifyRes = await fetch(`${API}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature,
          referrer: referrer?.trim() || undefined,
          profile,
        }),
      });
      const data = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(data.error || "Sign in failed");

      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("gl_ref");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setSession(data.token, data.user);

      if (pendingAvatarFile && address) {
        setUploadingAvatar(true);
        try {
          const formData = new FormData();
          formData.append("avatar", pendingAvatarFile);
          const uploadHeaders = { Authorization: `Bearer ${data.token}`, "X-Connected-Wallet": address };
          const uploadRes = await fetch(`${API}/user/avatar-upload`, {
            method: "POST",
            headers: uploadHeaders,
            body: formData,
          });
          const uploadData = await uploadRes.json();
          if (uploadRes.ok && uploadData.avatar) {
            const profileRes = await fetch(`${API}/user/profile`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
              body: JSON.stringify({
                username: usernameVal,
                name: null,
                bio: bio.trim() || null,
                avatar: uploadData.avatar,
                websiteUrl: null,
                xUrl: xUrl.trim() || null,
                telegramUrl: telegramUrl.trim() || null,
              }),
            });
            if (profileRes.ok) {
              const updated = await profileRes.json();
              if (updated?.user) {
                setSession(data.token, updated.user);
                localStorage.setItem(USER_KEY, JSON.stringify(updated.user));
              }
            }
          }
        } finally {
          setUploadingAvatar(false);
        }
      }

      navigate("/profile", { replace: true });
    } catch (e) {
      setError(getTransactionErrorMessage(e, "Save failed"));
    } finally {
      setLoading(false);
    }
  };

  const profileBg = (
    <div className="profile-modern__bg" aria-hidden="true">
      <div className="profile-modern__bg-image" />
      <div className="profile-modern__bg-overlay" />
    </div>
  );
  const portalContainer = typeof document !== "undefined" ? document.getElementById("profile-bg-layer") : null;

  const howtoSection = (
    <div className="profile-modern__panel-howto-wrap">
      <div className="profile-modern__panel-howto">
        <h3 className="profile-modern__panel-howto-title">How to create profile</h3>
        <ul className="profile-modern__panel-howto-list">
          <li>Upload your profile picture (JPEG, JPG or PNG, max 2MB)</li>
          <li>Choose a unique username (min 3 characters)</li>
          <li>Add your optional bio</li>
          <li>Add your X (Twitter) and Telegram links</li>
          <li>Click &quot;Save &amp; continue&quot; — you&apos;ll sign with your wallet once to save</li>
        </ul>
      </div>
    </div>
  );

  if (!isConnected || !address) {
    return (
      <div className="profile-modern">
        {portalReady && portalContainer && createPortal(profileBg, portalContainer)}
        <header className="profile-modern__header landing-v2__header">
          <Link to="/" className="landing-v2__logo">Golden Labs</Link>
          <div className="landing-v2__header-right">
            <button type="button" className="landing-v2__btn landing-v2__btn--primary" onClick={() => openModal?.()}>
              Connect Wallet
            </button>
          </div>
        </header>
        <div className="profile-modern__panel-top">
          <img src={ASSET_IMAGE} alt="Golden Labs DeFi Asset" className="profile-modern__panel-asset" />
          <h2 className="profile-modern__panel-title">Golden Labs</h2>
        </div>
        <main className="profile-modern__main">
          <div className="profile-modern__glass">
            <h1 className="profile-modern__headline">Create your profile</h1>
            <p className="profile-modern__subline">Connect your wallet to continue.</p>
            <button type="button" className="landing-v2__btn landing-v2__btn--primary profile-modern__submit" onClick={() => openModal?.()}>
              Connect Wallet
            </button>
          </div>
        </main>
        {howtoSection}
      </div>
    );
  }

  return (
    <div className="profile-modern">
      {portalReady && portalContainer && createPortal(profileBg, portalContainer)}
      <header className="profile-modern__header landing-v2__header">
        <Link to="/" className="landing-v2__logo">Golden Labs</Link>
        <div className="landing-v2__header-right">
          <span className="profile-modern__wallet-badge">{address.slice(0, 6)}…{address.slice(-4)}</span>
        </div>
      </header>
      <div className="profile-modern__panel-top">
        <img src={ASSET_IMAGE} alt="Golden Labs DeFi Asset" className="profile-modern__panel-asset" />
        <h2 className="profile-modern__panel-title">Golden Labs</h2>
      </div>
      <main className="profile-modern__main">
        <div className="profile-modern__glass">
          <span className="profile-modern__step">Step 1 · Profile</span>
          <h1 className="profile-modern__headline">Complete your profile</h1>
          <p className="profile-modern__subline">Set a username and optional details. You&apos;ll sign with your wallet once to save.</p>

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
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} alt="" className="profile-modern__avatar-img" />
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

          <form onSubmit={handleSubmit} className="profile-modern__form">
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
            <div className="profile-modern__block">
              <label className="profile-modern__field">
                <span className="profile-modern__field-label">Bio (optional)</span>
                <textarea
                  placeholder="Short bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="profile-modern__field-input"
                  rows={3}
                />
              </label>
            </div>
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
              </label>
            </div>
            <div className="profile-modern__block">
              <h3 className="profile-modern__block-title">Social links (optional)</h3>
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

            {error && <p className="profile-modern__error">{error}</p>}
            <div className="profile-modern__form-actions">
              <button type="submit" className="profile-modern__submit" disabled={loading}>
                {uploadingAvatar ? "Uploading…" : loading ? "Signing & saving…" : "Save & continue"}
              </button>
            </div>
          </form>
        </div>
      </main>
      {howtoSection}
    </div>
  );
}
