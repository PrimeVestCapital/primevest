// src/services/api.js – Centralised API service with auto token refresh
"use strict";

const BASE_URL = import.meta?.env?.VITE_API_URL || "http://localhost:5000/api";

// ─── Token Storage ──────────────────────────────────────────────────
const TOKEN_KEY = "pv_access_token";
const REFRESH_KEY = "pv_refresh_token";

export const tokenStore = {
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

// ─── Core Fetch Wrapper ─────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue = [];

async function processQueue(error, token) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  refreshQueue = [];
}

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
  } catch (networkErr) {
    throw new Error("Network error. Please check your connection.");
  }

  // Handle 401 with token refresh
  if (response.status === 401 && retry) {
    const data = await response.json().catch(() => ({}));
    if (data.code === "TOKEN_EXPIRED") {
      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then((newToken) => {
          config.headers.Authorization = `Bearer ${newToken}`;
          return apiFetch(endpoint, options, false);
        });
      }

      isRefreshing = true;
      const refreshToken = tokenStore.getRefresh();

      if (!refreshToken) {
        tokenStore.clear();
        window.dispatchEvent(new CustomEvent("auth:logout"));
        throw new Error("Session expired. Please sign in again.");
      }

      try {
        const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });

        const refreshData = await refreshResponse.json();

        if (!refreshResponse.ok || !refreshData.success) {
          tokenStore.clear();
          processQueue(new Error("Session expired"), null);
          window.dispatchEvent(new CustomEvent("auth:logout"));
          throw new Error("Session expired. Please sign in again.");
        }

        const { accessToken: newAccess, refreshToken: newRefresh } = refreshData.data;
        tokenStore.set(newAccess, newRefresh);
        processQueue(null, newAccess);
        config.headers.Authorization = `Bearer ${newAccess}`;
        return apiFetch(endpoint, options, false);
      } catch (err) {
        processQueue(err, null);
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

// ─── Auth API ────────────────────────────────────────────────────────
export const authApi = {
  register: (data) => apiFetch("/auth/register", { method: "POST", body: data }),
  login: (data) => apiFetch("/auth/login", { method: "POST", body: data }),
  logout: (refreshToken) => apiFetch("/auth/logout", { method: "POST", body: { refreshToken } }),
  refresh: (refreshToken) => apiFetch("/auth/refresh", { method: "POST", body: { refreshToken } }),
};

// ─── User API ────────────────────────────────────────────────────────
export const userApi = {
  getMe: () => apiFetch("/users/me"),
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/users/transactions${qs ? `?${qs}` : ""}`);
  },
  withdraw: (data) => apiFetch("/users/withdraw", { method: "POST", body: data }),
  updateProfile: (data) => apiFetch("/users/profile", { method: "PUT", body: data }),
};

// ─── Admin API ───────────────────────────────────────────────────────
export const adminApi = {
  getDashboard: () => apiFetch("/admin/dashboard"),
  getUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/admin/users${qs ? `?${qs}` : ""}`);
  },
  getUser: (id) => apiFetch(`/admin/users/${id}`),
  updatePortfolio: (id, data) => apiFetch(`/admin/users/${id}/portfolio`, { method: "PUT", body: data }),
  deposit: (id, data) => apiFetch(`/admin/users/${id}/deposit`, { method: "POST", body: data }),
  creditProfit: (id, data) => apiFetch(`/admin/users/${id}/credit-profit`, { method: "POST", body: data }),
  notify: (data) => apiFetch("/admin/notify", { method: "POST", body: data }),
  getNotifications: () => apiFetch("/admin/notifications"),
  setUserStatus: (id, isActive) => apiFetch(`/admin/users/${id}/status`, { method: "PUT", body: { isActive } }),
};
