import { GOLDEN_LABS_LOGO } from "../constants/brand";

export default function AdminLogin({ error, signingIn, isConnected, onConnect }) {
  return (
    <div className="login">
      <div className="login__bg" aria-hidden="true" />
      <div className="login__card">
        <div className="login__brand">
          <img className="login__brand-logo" src={GOLDEN_LABS_LOGO} alt="Golden Labs" width={56} height={56} />
          <div>
            <p className="login__eyebrow">Golden Labs</p>
            <h1 className="login__title">Admin console</h1>
          </div>
        </div>
        <p className="login__hint">Connect your admin wallet to manage bots, users, contracts, and platform maintenance.</p>
        <button type="button" className="login__btn btn--gold" onClick={onConnect} disabled={signingIn}>
          {signingIn ? "Signing in…" : isConnected ? "Sign in with wallet" : "Connect wallet"}
        </button>
        {error ? <p className="login__error">{error}</p> : null}
        <p className="login__secure">Secured with Sign-In with Ethereum (SIWE)</p>
      </div>
    </div>
  );
}
