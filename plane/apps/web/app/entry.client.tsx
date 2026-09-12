/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// ── DApp Mode: Intercept native form POSTs to /auth/* ──────────────────
async function hashPassword(password: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder();
    const data = enc.encode(`plane_dapp_salt:${password}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fallback_${Math.abs(hash).toString(16)}`;
}

function isAuthAction(action: string): boolean {
  return (
    action.includes("/auth/sign-in") ||
    action.includes("/auth/sign-up") ||
    action.includes("/auth/magic-sign-in") ||
    action.includes("/auth/magic-sign-up") ||
    action.includes("/auth/sign-out")
  );
}

if (typeof document !== "undefined") {
  const handleAuthAction = async (form: HTMLFormElement) => {
    const action = form.action || "";

    if (action.includes("/auth/sign-out")) {
      localStorage.removeItem("plane_dapp_auth_user");
      localStorage.removeItem("plane_dapp_auth_email");
      window.location.href = "/";
      return;
    }

    const nextPathInput = form.querySelector('input[name="next_path"]') as HTMLInputElement | null;
    const nextPath = nextPathInput?.value;
    const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement | null;
    const email = (emailInput?.value || "").trim().toLowerCase();
    const passwordInput = form.querySelector('input[type="password"], input[name="password"]') as HTMLInputElement | null;
    const password = passwordInput?.value || "";

    if (!email) return;

    let creds: Record<string, string> = {};
    try {
      const rawCreds = localStorage.getItem("plane_dapp_credentials");
      if (rawCreds) creds = JSON.parse(rawCreds);
    } catch { }

    let localDB: any = {};
    try {
      const raw = localStorage.getItem("plane_dapp_local_db");
      if (raw) localDB = JSON.parse(raw);
    } catch { }
    if (!localDB || typeof localDB !== "object") localDB = {};
    if (!Array.isArray(localDB.users)) localDB.users = [];

    // ── Sign In ──────────────────────────────────────────────────────────
    if (action.includes("/auth/sign-in") || action.includes("/auth/magic-sign-in")) {
      let user = localDB.users.find((u: any) => (u?.email || "").toLowerCase() === email);
      const storedHash = creds[email] || user?.password_hash;

      if (!user && !storedHash) {
        if (localDB.users.length === 0) {
          // First user onboarding on a fresh database
          const passwordHash = password ? await hashPassword(password) : null;
          const newUser = {
            id: `user-${Date.now().toString(36)}`,
            email,
            password_hash: passwordHash,
            first_name: email.split("@")[0],
            last_name: "",
            display_name: email.split("@")[0],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (passwordHash) {
            creds[email] = passwordHash;
            try {
              localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
            } catch { }
          }
          localDB.users.push(newUser);
          user = newUser;
          try {
            localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
          } catch { }
        } else {
          alert("Tài khoản không tồn tại. Vui lòng kiểm tra lại email hoặc đăng ký tài khoản mới.");
          form.dispatchEvent(new Event("error", { bubbles: true }));
          const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
      }

      // Verify password
      if (storedHash) {
        const inputHash = await hashPassword(password);
        if (inputHash !== storedHash) {
          alert("Mật khẩu không chính xác. Vui lòng kiểm tra lại!");
          form.dispatchEvent(new Event("error", { bubbles: true }));
          const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
      } else if (password) {
        // Migration for legacy user account without password_hash:
        const newHash = await hashPassword(password);
        creds[email] = newHash;
        try {
          localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
        } catch { }
        if (user) {
          user.password_hash = newHash;
          try {
            localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
          } catch { }
        }
      }

      localStorage.setItem("plane_dapp_auth_user", user?.id || `user-${Date.now().toString(36)}`);
      localStorage.setItem("plane_dapp_auth_email", email);
      window.location.href = nextPath || "/";
      return;
    }

    // ── Sign Up ──────────────────────────────────────────────────────────
    if (action.includes("/auth/sign-up") || action.includes("/auth/magic-sign-up")) {
      const firstNameInput = form.querySelector('input[name="first_name"]') as HTMLInputElement | null;
      const lastNameInput = form.querySelector('input[name="last_name"]') as HTMLInputElement | null;

      let existingUser = localDB.users.find((u: any) => (u?.email || "").toLowerCase() === email);
      const storedHash = creds[email] || existingUser?.password_hash;
      if (storedHash) {
        alert("Email này đã được đăng ký. Vui lòng đăng nhập.");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      const passwordHash = password ? await hashPassword(password) : null;
      if (passwordHash) {
        creds[email] = passwordHash;
        try {
          localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
        } catch { }
      }
      if (existingUser) {
        existingUser.password_hash = passwordHash;
        if (firstNameInput?.value) existingUser.first_name = firstNameInput.value;
        if (lastNameInput?.value) existingUser.last_name = lastNameInput.value;
        existingUser.display_name = `${existingUser.first_name || ""} ${existingUser.last_name || ""}`.trim() || email.split("@")[0];
      } else {
        const newUser = {
          id: `user-${Date.now().toString(36)}`,
          email,
          password_hash: passwordHash,
          first_name: firstNameInput?.value || email.split("@")[0],
          last_name: lastNameInput?.value || "",
          display_name: `${firstNameInput?.value || email.split("@")[0]} ${lastNameInput?.value || ""}`.trim(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        localDB.users.push(newUser);
        existingUser = newUser;
      }

      try {
        localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
      } catch { }

      localStorage.setItem("plane_dapp_auth_user", existingUser.id);
      localStorage.setItem("plane_dapp_auth_email", existingUser.email);
      window.location.href = nextPath || "/";
      return;
    }
  };

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      if (form && isAuthAction(form.action || "")) {
        e.preventDefault();
        e.stopPropagation();
        void handleAuthAction(form);
      }
    },
    true
  );

  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (isAuthAction(this.action || "")) {
      void handleAuthAction(this);
      return;
    }
    originalSubmit.call(this);
  };
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
