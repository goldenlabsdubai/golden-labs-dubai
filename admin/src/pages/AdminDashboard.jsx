import { config } from "../config";

export default function AdminDashboard() {
  return (
    <div className="admin">
      <h1>Admin Panel</h1>
      <div className="admin-grid">
        <div className="admin-card"><h3>Users</h3><p>—</p></div>
        <div className="admin-card"><h3>Subscriptions</h3><p>—</p></div>
        <div className="admin-card"><h3>NFTs</h3><p>—</p></div>
        <div className="admin-card"><h3>Marketplace</h3><p>—</p></div>
        <div className="admin-card"><h3>Reserve Pool</h3><p>—</p></div>
        <div className="admin-card"><h3>Referrals</h3><p>—</p></div>
        <div className="admin-card"><h3>Bots</h3><p>—</p></div>
      </div>
      <section>
        <h2>System Settings</h2>
        <p style={{ color: "#888", marginTop: "0.5rem" }}>API: {config.apiUrl}</p>
      </section>
      <section style={{ marginTop: "2rem" }}>
        <h2>Emergency Controls</h2>
        <p style={{ color: "#888", marginTop: "0.5rem" }}>Pause contracts, emergency withdrawals</p>
      </section>
    </div>
  );
}
