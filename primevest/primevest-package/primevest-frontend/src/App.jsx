import { useState, useEffect, useRef, useCallback } from "react";

// ─── Brand Colors ────────────────────────────────────────
// Navy: #1a2e4a  Gold: #b8933f  Light Gold: #d4a853

// ─── API Configuration ───────────────────────────────────
// In dev: Vite proxies /api → http://localhost:5000/api (see vite.config.js)
// In prod: set VITE_API_URL in your .env file
const BASE_URL = import.meta.env?.VITE_API_URL || "/api";

// ─── Token Storage ────────────────────────────────────────
const TOKEN_KEY = "pv_access_token";
const REFRESH_KEY = "pv_refresh_token";

const tokenStore = {
  getAccess: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access, refresh) => {
    if (access) localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

// ─── API Fetch Wrapper ────────────────────────────────────
let isRefreshing = false;
let refreshQueue = [];

async function apiFetch(endpoint, options = {}, retry = true) {
  const url = `${BASE_URL}${endpoint}`;
  const accessToken = tokenStore.getAccess();

  const config = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  };

  if (options.body && typeof options.body === "object") {
    config.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch {
    throw new Error("Network error. Please check your connection and ensure the server is running.");
  }

  if (response.status === 401 && retry) {
    const data = await response.json().catch(() => ({}));
    if (data.code === "TOKEN_EXPIRED") {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then(() => apiFetch(endpoint, options, false));
      }
      isRefreshing = true;
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) {
        tokenStore.clear();
        throw new Error("SESSION_EXPIRED");
      }
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const rd = await res.json();
        if (!res.ok || !rd.success) {
          tokenStore.clear();
          refreshQueue.forEach(({ reject }) => reject(new Error("SESSION_EXPIRED")));
          refreshQueue = [];
          throw new Error("SESSION_EXPIRED");
        }
        tokenStore.set(rd.data.accessToken, rd.data.refreshToken);
        refreshQueue.forEach(({ resolve }) => resolve());
        refreshQueue = [];
        return apiFetch(endpoint, options, false);
      } catch (err) {
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
    throw new Error(data.message || "Authentication required.");
  }

  const responseData = await response.json().catch(() => ({ success: false, message: "Invalid server response." }));
  if (!response.ok) {
    const err = new Error(responseData.message || `Request failed: ${response.status}`);
    err.statusCode = response.status;
    err.code = responseData.code;
    throw err;
  }
  return responseData;
}

// ─── Utility ─────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

// ─── Toast Component ──────────────────────────────────────
function EmailToast({ toasts, onClose }) {
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, maxWidth: 340, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.type === "success" ? "#0f2d1a" : t.type === "error" ? "#2d0f0f" : "#1a1f2e",
          border: `1px solid ${t.type === "success" ? "#2ecc71" : t.type === "error" ? "#e74c3c" : "#b8933f"}`,
          borderRadius: 10, padding: "14px 18px", color: "#fff", fontSize: 13,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "slideIn 0.3s ease",
          display: "flex", alignItems: "flex-start", gap: 12, pointerEvents: "all"
        }}>
          <span style={{ fontSize: 20, marginTop: -2 }}>
            {t.type === "success" ? "✅" : t.type === "error" ? "❌" : "📧"}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 3, color: t.type === "success" ? "#2ecc71" : t.type === "error" ? "#e74c3c" : "#d4a853" }}>{t.title}</div>
            <div style={{ opacity: 0.85, lineHeight: 1.4 }}>{t.message}</div>
          </div>
          <button onClick={() => onClose(t.id)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Logo Component ───────────────────────────────────────
function Logo({ size = "md" }) {
  const sizes = { sm: { text: 16, sub: 9 }, md: { text: 22, sub: 11 }, lg: { text: 30, sub: 14 } };
  const s = sizes[size];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: s.text * 2, height: s.text * 2, borderRadius: "50%", background: "linear-gradient(135deg, #1a2e4a, #b8933f)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: s.text * 0.7 }}>PV</div>
      <div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: s.text, color: "#1a2e4a", letterSpacing: "-0.5px", lineHeight: 1 }}>
          <span>Prime</span><span style={{ color: "#b8933f" }}>Vest</span>
        </div>
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: s.sub, color: "#1a2e4a", letterSpacing: 3, textTransform: "uppercase", opacity: 0.7 }}>Capital</div>
      </div>
    </div>
  );
}

// ─── Mini Chart ───────────────────────────────────────────
function MiniChart({ data, color = "#b8933f" }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const w = 280, h = 80, pad = 6;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const areaBot = `${pad},${h - pad} ${pts} ${w - pad},${h - pad}`;
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaBot} fill="url(#chartGrad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return i === vals.length - 1 ? <circle key={i} cx={x} cy={y} r="4" fill={color} stroke="#fff" strokeWidth="2" /> : null;
      })}
    </svg>
  );
}

// ─── PIN Modal ────────────────────────────────────────────
function PinModal({ onConfirm, onCancel, amount, loading }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const inputs = useRef([]);

  const handleKey = (i, val) => {
    if (!/^\d?$/.test(val)) return;
    const arr = pin.split("");
    arr[i] = val;
    const newPin = arr.join("").slice(0, 4);
    setPin(newPin);
    setErr("");
    if (val && i < 3) inputs.current[i + 1]?.focus();
  };
  const handleBackspace = (i, e) => {
    if (e.key === "Backspace" && !pin[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", maxWidth: 360, width: "100%", textAlign: "center", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#fff8ec", border: "2px solid #b8933f", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24 }}>🔐</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#1a2e4a", marginBottom: 8 }}>Confirm Withdrawal</div>
        <div style={{ color: "#666", fontSize: 14, marginBottom: 8 }}>Withdrawing <strong style={{ color: "#1a2e4a" }}>${fmt(amount)}</strong></div>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 24 }}>Enter your 4-digit security PIN</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 20 }}>
          {[0, 1, 2, 3].map(i => (
            <input key={i} ref={el => inputs.current[i] = el}
              type="password" inputMode="numeric" maxLength={1}
              value={pin[i] || ""}
              onChange={e => handleKey(i, e.target.value)}
              onKeyDown={e => handleBackspace(i, e)}
              style={{
                width: 52, height: 56, textAlign: "center", fontSize: 22, fontWeight: 700,
                border: `2px solid ${err ? "#e74c3c" : pin[i] ? "#b8933f" : "#ddd"}`,
                borderRadius: 10, outline: "none", color: "#1a2e4a", transition: "border-color 0.2s"
              }} />
          ))}
        </div>
        {err && <div style={{ color: "#e74c3c", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button
          onClick={() => { if (pin.length === 4) onConfirm(pin); else setErr("Please enter all 4 digits"); }}
          disabled={loading}
          style={{ width: "100%", padding: "14px", background: loading ? "#ccc" : "linear-gradient(135deg, #1a2e4a, #2a4a70)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", marginBottom: 10 }}>
          {loading ? "Processing..." : "Confirm Withdrawal"}
        </button>
        <button onClick={onCancel} disabled={loading} style={{ width: "100%", padding: "12px", background: "transparent", color: "#888", border: "1px solid #ddd", borderRadius: 10, fontSize: 14, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Loading Spinner ──────────────────────────────────────
function Spinner({ size = 24, color = "#b8933f" }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        width: size, height: size, border: `3px solid ${color}20`, borderTop: `3px solid ${color}`,
        borderRadius: "50%", animation: "spin 0.8s linear infinite"
      }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// AUTH PAGE
// ════════════════════════════════════════════════════════
function AuthPage({ onLogin, toast }) {
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", pin: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleLogin = async () => {
    setErr("");
    if (!form.email || !form.password) { setErr("Email and password are required."); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/auth/login", { method: "POST", body: { email: form.email, password: form.password } });
      tokenStore.set(data.data.accessToken, data.data.refreshToken);
      onLogin(data.data.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setErr("");
    if (!form.name || !form.email || !form.password || !form.pin) { setErr("All fields are required."); return; }
    if (form.password !== form.confirm) { setErr("Passwords do not match."); return; }
    if (form.password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (!/^\d{4}$/.test(form.pin)) { setErr("PIN must be exactly 4 digits."); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: { name: form.name, email: form.email, password: form.password, pin: form.pin },
      });
      tokenStore.set(data.data.accessToken, data.data.refreshToken);
      toast("📧 Welcome Email Sent", `Welcome to PrimeVest Capital, ${form.name}! Your account is now active.`, "email");
      onLogin(data.data.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "13px 16px", border: "1.5px solid #e0e0e0", borderRadius: 10,
    fontSize: 14, color: "#1a2e4a", outline: "none", boxSizing: "border-box",
    fontFamily: "'Montserrat', sans-serif", background: "#fafafa"
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, display: "block" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0d1e33 0%, #1a2e4a 50%, #0d1e33 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, position: "relative", overflow: "hidden" }}>
      {[[-120, -80, 300], [350, 400, 200], [-50, 500, 150]].map(([x, y, s], i) => (
        <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: "50%", border: "1px solid rgba(184,147,63,0.15)", pointerEvents: "none" }} />
      ))}
      <div style={{ width: "100%", maxWidth: 420, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg, #1a2e4a, #b8933f)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 18, border: "2px solid rgba(184,147,63,0.4)" }}>PV</div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                Prime<span style={{ color: "#d4a853" }}>Vest</span>
              </div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: 4, textTransform: "uppercase" }}>Capital</div>
            </div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, letterSpacing: 0.5 }}>Secure Investment Management Platform</div>
        </div>

        <div style={{ background: "#fff", borderRadius: 20, padding: "36px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.4)" }}>
          <div style={{ display: "flex", background: "#f4f4f4", borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {["login", "register"].map(t => (
              <button key={t} onClick={() => { setTab(t); setErr(""); }}
                style={{ flex: 1, padding: "10px", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: 13, textTransform: "capitalize", transition: "all 0.2s", background: tab === t ? "#1a2e4a" : "transparent", color: tab === t ? "#fff" : "#888" }}>
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {tab === "login" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div><label style={labelStyle}>Email Address</label><input style={inputStyle} type="email" placeholder="you@example.com" value={form.email} onChange={e => set("email", e.target.value)} /></div>
              <div><label style={labelStyle}>Password</label><input style={inputStyle} type="password" placeholder="••••••••" value={form.password} onChange={e => set("password", e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></div>
              {err && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "10px 14px", color: "#c0392b", fontSize: 13 }}>{err}</div>}
              <button onClick={handleLogin} disabled={loading}
                style={{ width: "100%", padding: "14px", background: loading ? "#ccc" : "linear-gradient(135deg, #1a2e4a, #2a4a70)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", marginTop: 4, fontFamily: "'Montserrat', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {loading ? <><Spinner size={18} color="#fff" /> Signing in...</> : "Sign In →"}
              </button>
              <div style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: 4 }}>Demo: alex@example.com / Demo@1234</div>
              <div style={{ textAlign: "center", fontSize: 11, color: "#bbb" }}>Admin: admin@primevest.com / Admin@2024</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={labelStyle}>Full Name</label><input style={inputStyle} placeholder="John Doe" value={form.name} onChange={e => set("name", e.target.value)} /></div>
              <div><label style={labelStyle}>Email Address</label><input style={inputStyle} type="email" placeholder="you@example.com" value={form.email} onChange={e => set("email", e.target.value)} /></div>
              <div><label style={labelStyle}>Password</label><input style={inputStyle} type="password" placeholder="Min 8 characters" value={form.password} onChange={e => set("password", e.target.value)} /></div>
              <div><label style={labelStyle}>Confirm Password</label><input style={inputStyle} type="password" placeholder="Repeat password" value={form.confirm} onChange={e => set("confirm", e.target.value)} /></div>
              <div><label style={labelStyle}>Security PIN (4 digits)</label><input style={inputStyle} type="password" inputMode="numeric" maxLength={4} placeholder="e.g. 1234" value={form.pin} onChange={e => set("pin", e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
              {err && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "10px 14px", color: "#c0392b", fontSize: 13 }}>{err}</div>}
              <button onClick={handleRegister} disabled={loading}
                style={{ width: "100%", padding: "14px", background: loading ? "#ccc" : "linear-gradient(135deg, #b8933f, #d4a853)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", marginTop: 4, fontFamily: "'Montserrat', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {loading ? <><Spinner size={18} color="#fff" /> Creating Account...</> : "Create Account →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// USER DASHBOARD
// ════════════════════════════════════════════════════════
function UserDashboard({ user: initialUser, onLogout, toast }) {
  const [tab, setTab] = useState("overview");
  const [user, setUser] = useState(initialUser);
  const [showPin, setShowPin] = useState(false);
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [pendingWithdraw, setPendingWithdraw] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  // Refresh user data from API
  const refreshUser = useCallback(async () => {
    try {
      setDataLoading(true);
      const res = await apiFetch("/users/me");
      setUser(res.data);
    } catch (e) {
      if (e.message === "SESSION_EXPIRED") onLogout();
    } finally {
      setDataLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    refreshUser();
  }, []);

  const totalPortfolio = (user.balance || 0) + (user.profit || 0);
  const profitPct = user.balance > 0 ? ((user.profit / user.balance) * 100).toFixed(2) : "0.00";

  const initiateWithdraw = () => {
    const amt = parseFloat(withdrawAmt);
    if (!amt || amt <= 0) { toast("Error", "Enter a valid amount.", "error"); return; }
    if (amt > totalPortfolio) { toast("Error", `Insufficient funds. Available: $${fmt(totalPortfolio)}`, "error"); return; }
    setPendingWithdraw(amt);
    setShowPin(true);
  };

  const confirmWithdraw = async (pin) => {
    setWithdrawLoading(true);
    try {
      const res = await apiFetch("/users/withdraw", {
        method: "POST",
        body: { amount: pendingWithdraw, pin },
      });
      // Update local state
      setUser(prev => ({
        ...prev,
        balance: res.data.newBalance,
        profit: res.data.newProfit,
        transactions: [res.data.transaction, ...(prev.transactions || [])],
      }));
      toast("✅ Withdrawal Successful", `$${fmt(pendingWithdraw)} has been processed. Funds will arrive in 1–3 business days.`, "success");
      toast("📧 Email Sent", `Withdrawal confirmation sent to ${user.email}`, "email");
      setShowPin(false);
      setPendingWithdraw(null);
      setWithdrawAmt("");
      setTab("overview");
    } catch (e) {
      if (e.code === "WRONG_PIN") {
        toast("Wrong PIN", "Incorrect security PIN. Please try again.", "error");
        setShowPin(false);
        setPendingWithdraw(null);
      } else if (e.message === "SESSION_EXPIRED") {
        onLogout();
      } else {
        toast("Error", e.message, "error");
        setShowPin(false);
        setPendingWithdraw(null);
      }
    } finally {
      setWithdrawLoading(false);
    }
  };

  const navItems = [
    { id: "overview", icon: "📊", label: "Overview" },
    { id: "portfolio", icon: "💼", label: "Portfolio" },
    { id: "transactions", icon: "📋", label: "Transactions" },
    { id: "withdraw", icon: "💸", label: "Withdraw" },
  ];

  const cardStyle = (accent = false) => ({
    background: accent ? "linear-gradient(135deg, #1a2e4a, #2a4a70)" : "#fff",
    borderRadius: 16, padding: "24px",
    boxShadow: accent ? "0 12px 40px rgba(26,46,74,0.3)" : "0 2px 16px rgba(0,0,0,0.06)",
    border: accent ? "none" : "1px solid #f0f0f0",
    color: accent ? "#fff" : "#1a2e4a",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", fontFamily: "'Montserrat', sans-serif" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <Logo size="sm" />
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <div style={{ textAlign: "right", display: window.innerWidth < 480 ? "none" : "block" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e4a" }}>{user.name}</div>
              <div style={{ fontSize: 11, color: "#b8933f", fontWeight: 600 }}>{user.plan} Plan</div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, #1a2e4a, #b8933f)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }} onClick={() => setMenuOpen(p => !p)}>
              {user.name?.[0]}
            </div>
            {menuOpen && (
              <div style={{ position: "absolute", top: 48, right: 0, background: "#fff", borderRadius: 12, padding: "8px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", minWidth: 160, zIndex: 200 }}>
                <div style={{ padding: "12px 20px", fontSize: 13, color: "#666", borderBottom: "1px solid #f0f0f0" }}>{user.email}</div>
                <button onClick={() => { refreshUser(); setMenuOpen(false); }} style={{ width: "100%", padding: "12px 20px", background: "none", border: "none", textAlign: "left", color: "#1a2e4a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🔄 Refresh Data</button>
                <button onClick={onLogout} style={{ width: "100%", padding: "12px 20px", background: "none", border: "none", textAlign: "left", color: "#e74c3c", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "0 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 4, maxWidth: 1100, margin: "0 auto" }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              style={{ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: tab === n.id ? "#1a2e4a" : "#999", borderBottom: `2px solid ${tab === n.id ? "#b8933f" : "transparent"}`, whiteSpace: "nowrap", transition: "all 0.2s" }}>
              {n.icon} {n.label}
            </button>
          ))}
        </div>
      </nav>

      {dataLoading && (
        <div style={{ textAlign: "center", padding: "12px", background: "#fff8ec", fontSize: 13, color: "#b8933f", borderBottom: "1px solid #ffe0a0" }}>
          <Spinner size={14} /> Refreshing your data...
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>Welcome back, {user.name?.split(" ")[0]} 👋</h2>
              <p style={{ margin: "4px 0 0", color: "#888", fontSize: 13 }}>Member since {fmtDate(user.joinDate)} · {user.plan} Plan</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div style={cardStyle(true)}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Total Portfolio</div>
                <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 4, fontFamily: "'Playfair Display', serif" }}>${fmt(totalPortfolio)}</div>
                <div style={{ fontSize: 12, color: "#d4a853" }}>+{profitPct}% all time return</div>
              </div>
              <div style={cardStyle()}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Principal Balance</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#1a2e4a", marginBottom: 4 }}>${fmt(user.balance)}</div>
                <div style={{ fontSize: 12, color: "#888" }}>Invested capital</div>
              </div>
              <div style={cardStyle()}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Total Profits</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#27ae60", marginBottom: 4 }}>+${fmt(user.profit)}</div>
                <div style={{ fontSize: 12, color: "#27ae60" }}>↑ {profitPct}% growth</div>
              </div>
            </div>
            <div style={{ ...cardStyle(), marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e4a", marginBottom: 16 }}>Profit Growth (12 months)</div>
              <MiniChart data={user.profitHistory || []} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                  <span key={i} style={{ fontSize: 10, color: "#bbb" }}>{m}</span>
                ))}
              </div>
            </div>
            <div style={cardStyle()}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e4a", marginBottom: 14 }}>Recent Activity</div>
              {(user.transactions || []).slice(0, 4).map(tx => (
                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: tx.type === "deposit" ? "#e8f5e9" : tx.type === "profit" ? "#fff8e1" : "#fce4ec", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                      {tx.type === "deposit" ? "💵" : tx.type === "profit" ? "📈" : "💸"}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{tx.type}</div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>{fmtDate(tx.date)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: tx.type === "withdrawal" ? "#e74c3c" : "#27ae60" }}>
                    {tx.type === "withdrawal" ? "-" : "+"}${fmt(tx.amount)}
                  </div>
                </div>
              ))}
              {(!user.transactions || user.transactions.length === 0) && (
                <div style={{ color: "#bbb", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No transactions yet</div>
              )}
            </div>
          </div>
        )}

        {/* PORTFOLIO */}
        {tab === "portfolio" && (
          <div>
            <h2 style={{ margin: "0 0 24px", fontSize: 22, fontWeight: 700, color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>My Portfolio</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {[
                { label: "Investment Plan", value: user.plan, icon: "🏆" },
                { label: "Principal Invested", value: `$${fmt(user.balance)}`, icon: "💰" },
                { label: "Total Profit Earned", value: `$${fmt(user.profit)}`, icon: "📈" },
                { label: "Portfolio Value", value: `$${fmt(totalPortfolio)}`, icon: "💎" },
                { label: "ROI", value: `${profitPct}%`, icon: "📊" },
                { label: "Member Since", value: fmtDate(user.joinDate), icon: "📅" },
              ].map((item, i) => (
                <div key={i} style={cardStyle()}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>{item.icon}</div>
                  <div style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{item.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1a2e4a" }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle(), marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2e4a", marginBottom: 16 }}>Profit Growth Chart</div>
              <MiniChart data={user.profitHistory || []} />
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === "transactions" && (
          <div>
            <h2 style={{ margin: "0 0 24px", fontSize: 22, fontWeight: 700, color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>Transaction History</h2>
            <div style={cardStyle()}>
              {(!user.transactions || user.transactions.length === 0) && (
                <div style={{ textAlign: "center", color: "#bbb", padding: "40px 0" }}>No transactions found</div>
              )}
              {(user.transactions || []).map(tx => (
                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: tx.type === "deposit" ? "#e8f5e9" : tx.type === "profit" ? "#fff8e1" : "#fce4ec", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                      {tx.type === "deposit" ? "💵" : tx.type === "profit" ? "📈" : "💸"}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, textTransform: "capitalize", color: "#1a2e4a" }}>{tx.type}</div>
                      <div style={{ fontSize: 12, color: "#aaa" }}>{tx.note} · {fmtDate(tx.date)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: tx.type === "withdrawal" ? "#e74c3c" : "#27ae60" }}>
                      {tx.type === "withdrawal" ? "-" : "+"}${fmt(tx.amount)}
                    </div>
                    <div style={{ fontSize: 11, background: "#e8f5e9", color: "#27ae60", padding: "2px 8px", borderRadius: 20, display: "inline-block", fontWeight: 600 }}>✓ {tx.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WITHDRAW */}
        {tab === "withdraw" && (
          <div style={{ maxWidth: 480 }}>
            <h2 style={{ margin: "0 0 24px", fontSize: 22, fontWeight: 700, color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>Withdraw Funds</h2>
            <div style={{ ...cardStyle(true), marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 4 }}>Available Balance</div>
              <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "'Playfair Display', serif" }}>${fmt(totalPortfolio)}</div>
            </div>
            <div style={cardStyle()}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Withdrawal Amount (USD)</label>
                <input type="number" placeholder="0.00" value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)}
                  style={{ width: "100%", padding: "14px 16px", border: "1.5px solid #e0e0e0", borderRadius: 10, fontSize: 18, fontWeight: 700, color: "#1a2e4a", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setWithdrawAmt((totalPortfolio * pct / 100).toFixed(2))}
                    style={{ flex: 1, padding: "8px", background: "#f0f4f8", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1a2e4a" }}>{pct}%</button>
                ))}
              </div>
              <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#8a6d00" }}>
                🔐 A security PIN confirmation will be required to process your withdrawal.
              </div>
              <button onClick={initiateWithdraw}
                style={{ width: "100%", padding: "15px", background: "linear-gradient(135deg, #b8933f, #d4a853)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Request Withdrawal →
              </button>
            </div>
          </div>
        )}
      </div>

      {showPin && (
        <PinModal
          amount={pendingWithdraw}
          loading={withdrawLoading}
          onConfirm={confirmWithdraw}
          onCancel={() => { setShowPin(false); setPendingWithdraw(null); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════
function AdminDashboard({ onLogout, toast }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({ totalClients: 0, totalAUM: 0, totalProfit: 0 });
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [msgForm, setMsgForm] = useState({ userId: "all", subject: "", body: "" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, usersRes] = await Promise.all([
        apiFetch("/admin/dashboard"),
        apiFetch("/admin/users"),
      ]);
      setStats(dashRes.data.stats);
      setUsers(usersRes.data);
    } catch (e) {
      if (e.message === "SESSION_EXPIRED") onLogout();
      else toast("Error", e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [onLogout, toast]);

  useEffect(() => { loadData(); }, []);

  const openEdit = (u) => {
    setSelected(u.id);
    setEditForm({ balance: u.balance, profit: u.profit, plan: u.plan });
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaveLoading(true);
    try {
      const res = await apiFetch(`/admin/users/${selected}/portfolio`, {
        method: "PUT",
        body: { balance: editForm.balance, profit: editForm.profit, plan: editForm.plan },
      });
      toast("✅ Updated", "User investment details updated successfully.", "success");
      const targetUser = users.find(u => u.id === selected);
      toast("📧 Email Sent", `Balance update notification sent to ${targetUser?.email}`, "email");
      // Refresh user list
      await loadData();
      setSelected(null);
    } catch (e) {
      toast("Error", e.message, "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const sendNotification = async () => {
    if (!msgForm.subject || !msgForm.body) { toast("Error", "Subject and message are required.", "error"); return; }
    setNotifyLoading(true);
    try {
      const res = await apiFetch("/admin/notify", {
        method: "POST",
        body: { userId: msgForm.userId === "all" ? "all" : msgForm.userId, subject: msgForm.subject, body: msgForm.body },
      });
      toast("📧 Notification Sent", res.message, "email");
      setMsgForm({ userId: "all", subject: "", body: "" });
    } catch (e) {
      toast("Error", e.message, "error");
    } finally {
      setNotifyLoading(false);
    }
  };

  const inputStyle = { width: "100%", padding: "11px 14px", border: "1.5px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#1a2e4a", outline: "none", boxSizing: "border-box" };
  const totalAUM = stats.totalAUM || users.reduce((s, u) => s + (u.balance || 0) + (u.profit || 0), 0);
  const totalProfit = stats.totalProfit || users.reduce((s, u) => s + (u.profit || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'Montserrat', sans-serif" }}>
      <header style={{ background: "linear-gradient(135deg, #0d1e33, #1a2e4a)", padding: "0 20px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #b8933f, #d4a853)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>PV</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "'Playfair Display', serif" }}>Prime<span style={{ color: "#d4a853" }}>Vest</span></div>
              <div style={{ color: "#d4a853", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>ADMIN PANEL</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={loadData} disabled={loading} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "7px 14px", color: "#fff", cursor: "pointer", fontSize: 12 }}>
              {loading ? <Spinner size={14} color="#fff" /> : "🔄 Refresh"}
            </button>
            <div style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(p => !p)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "8px 16px", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Admin ▾
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", right: 0, top: 44, background: "#fff", borderRadius: 10, padding: "8px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", minWidth: 140, zIndex: 200 }}>
                  <button onClick={onLogout} style={{ width: "100%", padding: "12px 20px", background: "none", border: "none", textAlign: "left", color: "#e74c3c", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign Out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <nav style={{ background: "#fff", borderBottom: "1px solid #e0e0e0", padding: "0 20px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 4, overflowX: "auto" }}>
          {[["users", "👥 Clients"], ["update", "✏️ Update Portfolio"], ["notify", "📧 Notifications"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: "14px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: tab === id ? "#1a2e4a" : "#999", borderBottom: `2px solid ${tab === id ? "#b8933f" : "transparent"}`, whiteSpace: "nowrap" }}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Clients", value: stats.totalClients || users.length, icon: "👥", color: "#1a2e4a" },
            { label: "Assets Under Mgmt", value: `$${fmt(totalAUM)}`, icon: "💰", color: "#b8933f" },
            { label: "Total Profits Paid", value: `$${fmt(totalProfit)}`, icon: "📈", color: "#27ae60" },
          ].map((s, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* CLIENTS TAB */}
        {tab === "users" && (
          <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1a2e4a" }}>All Clients ({users.length})</div>
            </div>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center" }}><Spinner size={32} /></div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8f9fa" }}>
                      {["Client", "Email", "Plan", "Balance", "Profit", "Portfolio", "Actions"].map(h => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #1a2e4a, #b8933f)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{u.name?.[0]}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2e4a" }}>{u.name}</div>
                          </div>
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: 13, color: "#666" }}>{u.email}</td>
                        <td style={{ padding: "14px 16px" }}><span style={{ background: "#e8f0fe", color: "#1a2e4a", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{u.plan}</span></td>
                        <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, color: "#1a2e4a" }}>${fmt(u.balance)}</td>
                        <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, color: "#27ae60" }}>+${fmt(u.profit)}</td>
                        <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 700, color: "#b8933f" }}>${fmt(u.portfolio)}</td>
                        <td style={{ padding: "14px 16px" }}>
                          <button onClick={() => { setTab("update"); openEdit(u); }}
                            style={{ background: "#1a2e4a", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div style={{ padding: "40px", textAlign: "center", color: "#bbb" }}>No clients found</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* UPDATE TAB */}
        {tab === "update" && (
          <div style={{ maxWidth: 560 }}>
            <h3 style={{ margin: "0 0 20px", color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>Update Client Portfolio</h3>
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)", marginBottom: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Select Client</label>
                <select value={selected || ""} onChange={e => { const u = users.find(x => x.id === e.target.value); if (u) openEdit(u); }}
                  style={{ ...inputStyle, appearance: "none" }}>
                  <option value="">-- Choose a client --</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </select>
              </div>
              {selected && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Balance (USD)</label>
                      <input type="number" value={editForm.balance} onChange={e => setEditForm(p => ({ ...p, balance: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Profit (USD)</label>
                      <input type="number" value={editForm.profit} onChange={e => setEditForm(p => ({ ...p, profit: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Investment Plan</label>
                    <select value={editForm.plan} onChange={e => setEditForm(p => ({ ...p, plan: e.target.value }))} style={{ ...inputStyle, appearance: "none" }}>
                      {["Starter", "Growth", "Premium", "Platinum"].map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{ background: "#f0f4ff", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#3a5a9a" }}>
                    📧 An email notification will be sent to the client automatically upon saving.
                  </div>
                  <button onClick={saveEdit} disabled={saveLoading}
                    style={{ width: "100%", padding: "14px", background: saveLoading ? "#ccc" : "linear-gradient(135deg, #1a2e4a, #2a4a70)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: saveLoading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {saveLoading ? <><Spinner size={18} color="#fff" /> Saving...</> : "Save Changes & Notify Client"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* NOTIFY TAB */}
        {tab === "notify" && (
          <div style={{ maxWidth: 560 }}>
            <h3 style={{ margin: "0 0 20px", color: "#1a2e4a", fontFamily: "'Playfair Display', serif" }}>Send Email Notification</h3>
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px", boxShadow: "0 2px 16px rgba(0,0,0,0.06)" }}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Recipient</label>
                <select value={msgForm.userId} onChange={e => setMsgForm(p => ({ ...p, userId: e.target.value }))} style={{ ...inputStyle, appearance: "none" }}>
                  <option value="all">📢 All Clients</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Subject</label>
                <input placeholder="Email subject..." value={msgForm.subject} onChange={e => setMsgForm(p => ({ ...p, subject: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 8 }}>Message</label>
                <textarea placeholder="Write your message here..." value={msgForm.body} onChange={e => setMsgForm(p => ({ ...p, body: e.target.value }))}
                  style={{ ...inputStyle, height: 120, resize: "vertical" }} />
              </div>
              <button onClick={sendNotification} disabled={notifyLoading}
                style={{ width: "100%", padding: "14px", background: notifyLoading ? "#ccc" : "linear-gradient(135deg, #b8933f, #d4a853)", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: notifyLoading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {notifyLoading ? <><Spinner size={18} color="#fff" /> Sending...</> : "📧 Send Notification"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ROOT APP
// ════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [bootstrapping, setBootstrapping] = useState(true);

  const toast = useCallback((title, message, type = "email") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(p => [...p, { id, title, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);

  const removeToast = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);

  // Auto-restore session on mount
  useEffect(() => {
    const tryRestore = async () => {
      const accessToken = tokenStore.getAccess();
      if (!accessToken) { setBootstrapping(false); return; }
      try {
        const res = await apiFetch("/users/me");
        setSession(res.data);
      } catch (e) {
        if (e.message !== "SESSION_EXPIRED") {
          // Try admin check
          try {
            const adminRes = await apiFetch("/admin/dashboard");
            if (adminRes.success) setSession({ role: "admin" });
          } catch {
            tokenStore.clear();
          }
        } else {
          tokenStore.clear();
        }
      } finally {
        setBootstrapping(false);
      }
    };
    tryRestore();
  }, []);

  const handleLogin = useCallback((userData) => {
    setSession(userData);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      const refreshToken = tokenStore.getRefresh();
      await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
    } catch (_) {}
    tokenStore.clear();
    setSession(null);
  }, []);

  if (bootstrapping) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0d1e33, #1a2e4a)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #1a2e4a, #b8933f)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 20 }}>PV</div>
        <Spinner size={32} color="#b8933f" />
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "'Montserrat', sans-serif" }}>Loading PrimeVest Capital...</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Montserrat:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        body { margin: 0; font-family: 'Montserrat', sans-serif; }
        @keyframes slideIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input:focus, select:focus, textarea:focus { border-color: #b8933f !important; box-shadow: 0 0 0 3px rgba(184,147,63,0.1); }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; }
        ::-webkit-scrollbar-thumb { background: #c0c0c0; border-radius: 3px; }
      `}</style>

      <EmailToast toasts={toasts} onClose={removeToast} />

      {!session && <AuthPage onLogin={handleLogin} toast={toast} />}
      {session?.role === "admin" && <AdminDashboard onLogout={handleLogout} toast={toast} />}
      {session && session.role !== "admin" && (
        <UserDashboard user={session} onLogout={handleLogout} toast={toast} />
      )}
    </>
  );
}
