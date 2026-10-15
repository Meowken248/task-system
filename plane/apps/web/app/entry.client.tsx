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

function resolveAppPath(path?: string | null): string {
  const routerBase = (typeof process !== "undefined" && process.env?.VITE_ROUTER_BASENAME) || "/plane";
  const cleanBase = routerBase === "/" ? "" : routerBase.replace(/\/+$/, "");
  const rootPath = cleanBase ? `${cleanBase}/` : "/";

  if (!path || path === "/") {
    return rootPath;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (cleanBase && (normalizedPath === cleanBase || normalizedPath.startsWith(`${cleanBase}/`))) {
    return normalizedPath;
  }

  return cleanBase ? `${cleanBase}${normalizedPath}` : normalizedPath;
}

if (typeof document !== "undefined") {
  const handleAuthAction = async (form: HTMLFormElement) => {
    const action = form.action || "";

    if (action.includes("/auth/sign-out")) {
      localStorage.removeItem("plane_dapp_auth_user");
      localStorage.removeItem("plane_dapp_auth_email");
      sessionStorage.removeItem("plane_dapp_auth_user");
      sessionStorage.removeItem("plane_dapp_auth_email");
      localStorage.removeItem("plane_active_wallet_address");
      sessionStorage.removeItem("plane_active_wallet_address");
      localStorage.removeItem("last_workspace_slug");
      sessionStorage.removeItem("last_workspace_slug");
      document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      window.location.href = resolveAppPath("/");
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
        alert("Tài khoản không tồn tại. Vui lòng kiểm tra lại email hoặc đăng ký tài khoản mới.");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (!storedHash) {
        alert("Tài khoản chưa thiết lập mật khẩu. Vui lòng sử dụng tính năng quên mật khẩu hoặc đăng ký lại.");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (!password) {
        alert("Vui lòng nhập mật khẩu.");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      const inputHash = await hashPassword(password);
      if (inputHash !== storedHash) {
        alert("Mật khẩu không chính xác. Vui lòng kiểm tra lại!");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (user) user.password_hash = storedHash;
      creds[email] = storedHash;
      try {
        localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
      } catch { }

      const authUserId = user?.id || `user-${Date.now().toString(36)}`;
      localStorage.setItem("plane_dapp_auth_user", authUserId);
      localStorage.setItem("plane_dapp_auth_email", email);
      sessionStorage.setItem("plane_dapp_auth_user", authUserId);
      sessionStorage.setItem("plane_dapp_auth_email", email);
      // Clean up previous user's active wallet from session so new user doesn't inherit it
      localStorage.removeItem("plane_active_wallet_address");
      sessionStorage.removeItem("plane_active_wallet_address");

      // Auto-resolve target workspace from user, membership, or invitations
      const memberEntry = (localDB.workspace_members || []).find((m: any) =>
        (m.email && m.email.toLowerCase().trim() === email) ||
        (m.member && (m.member === authUserId || m.member === user?.id))
      );
      const invEntry = (localDB.invitations || []).find((i: any) =>
        (i.email && i.email.toLowerCase().trim() === email)
      );

      // Restore this user's existing wallet if already linked in user profile, membership, or storage
      const existingUserWallet =
        user?.metanode_wallet_address ||
        memberEntry?.wallet_address ||
        invEntry?.wallet_address ||
        localStorage.getItem(`plane:metanode-wallet:${authUserId}`) ||
        "";
      if (/^0x[a-fA-F0-9]{40}$/i.test(existingUserWallet.trim())) {
        const norm = existingUserWallet.trim().toLowerCase();
        localStorage.setItem("plane_active_wallet_address", norm);
        sessionStorage.setItem("plane_active_wallet_address", norm);
        localStorage.setItem(`plane:metanode-wallet:${authUserId}`, norm);
      }

      const targetWsSlug = user?.last_workspace_slug || memberEntry?.workspace || memberEntry?.workspace_id || invEntry?.workspace?.slug || invEntry?.workspace_slug || invEntry?.workspace;

      if (targetWsSlug) {
        if (user) {
          user.last_workspace_slug = targetWsSlug;
          user.is_onboarded = true;
        }
        localStorage.setItem("last_workspace_slug", targetWsSlug);
        sessionStorage.setItem("last_workspace_slug", targetWsSlug);
        document.cookie = `last_workspace_slug=${targetWsSlug}; path=/; max-age=31536000; SameSite=Lax`;
        try {
          localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
        } catch { }
      } else {
        localStorage.removeItem("last_workspace_slug");
        sessionStorage.removeItem("last_workspace_slug");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }

      const destinationPath = (!nextPath || nextPath === "/" || nextPath === "/plane" || nextPath.includes("onboarding")) && targetWsSlug
        ? `/${targetWsSlug}`
        : nextPath;
      window.location.href = resolveAppPath(destinationPath);
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

      if (!password) {
        alert("Vui lòng nhập mật khẩu.");
        form.dispatchEvent(new Event("error", { bubbles: true }));
        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      const passwordHash = await hashPassword(password);
      creds[email] = passwordHash;
      try {
        localStorage.setItem("plane_dapp_credentials", JSON.stringify(creds));
      } catch { }

      let userRecord = existingUser;
      if (!userRecord) {
        userRecord = {
          id: `user-${Date.now().toString(36)}`,
          email,
          password_hash: passwordHash,
          first_name: firstNameInput?.value || email.split("@")[0],
          last_name: lastNameInput?.value || "",
          display_name: `${firstNameInput?.value || email.split("@")[0]} ${lastNameInput?.value || ""}`.trim(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        localDB.users.push(userRecord);
      } else {
        userRecord.password_hash = passwordHash;
        if (firstNameInput?.value) userRecord.first_name = firstNameInput.value;
        if (lastNameInput?.value) userRecord.last_name = lastNameInput.value;
        userRecord.display_name = `${userRecord.first_name || email.split("@")[0]} ${userRecord.last_name || ""}`.trim();
        userRecord.updated_at = new Date().toISOString();
      }

      // Check if this user belongs to any workspace or has invitations
      const memberEntry = (localDB.workspace_members || []).find((m: any) =>
        (m.email && m.email.toLowerCase().trim() === email) ||
        (m.member && m.member === userRecord.id)
      );
      const invEntry = (localDB.invitations || []).find((i: any) =>
        (i.email && i.email.toLowerCase().trim() === email)
      );

      const targetWsSlug = memberEntry?.workspace || memberEntry?.workspace_id || invEntry?.workspace?.slug || invEntry?.workspace_slug || invEntry?.workspace;

      if (memberEntry || invEntry) {
        userRecord.is_onboarded = true;
        userRecord.is_tour_completed = true;
        userRecord.onboarding_step = {
          profile_complete: true,
          workspace_join: true,
          workspace_create: true,
          workspace_invite: true,
        };
        if (memberEntry && memberEntry.member !== userRecord.id) {
          memberEntry.member = userRecord.id;
          memberEntry.email = email;
        }
      }

      if (targetWsSlug) {
        userRecord.last_workspace_slug = targetWsSlug;
        localStorage.setItem("last_workspace_slug", targetWsSlug);
        sessionStorage.setItem("last_workspace_slug", targetWsSlug);
        document.cookie = `last_workspace_slug=${targetWsSlug}; path=/; max-age=31536000; SameSite=Lax`;
      } else {
        localStorage.removeItem("last_workspace_slug");
        sessionStorage.removeItem("last_workspace_slug");
        document.cookie = "last_workspace_slug=; path=/; max-age=0; SameSite=Lax";
      }

      try {
        localStorage.setItem("plane_dapp_local_db", JSON.stringify(localDB));
      } catch { }

      localStorage.setItem("plane_dapp_auth_user", userRecord.id);
      localStorage.setItem("plane_dapp_auth_email", userRecord.email);
      sessionStorage.setItem("plane_dapp_auth_user", userRecord.id);
      sessionStorage.setItem("plane_dapp_auth_email", userRecord.email);
      localStorage.removeItem("plane_active_wallet_address");
      sessionStorage.removeItem("plane_active_wallet_address");

      const existingUserWallet =
        userRecord?.metanode_wallet_address ||
        memberEntry?.wallet_address ||
        invEntry?.wallet_address ||
        localStorage.getItem(`plane:metanode-wallet:${userRecord.id}`) ||
        "";
      if (/^0x[a-fA-F0-9]{40}$/i.test(existingUserWallet.trim())) {
        const norm = existingUserWallet.trim().toLowerCase();
        localStorage.setItem("plane_active_wallet_address", norm);
        sessionStorage.setItem("plane_active_wallet_address", norm);
        localStorage.setItem(`plane:metanode-wallet:${userRecord.id}`, norm);
      }

      const destinationPath = (!nextPath || nextPath === "/" || nextPath === "/plane" || nextPath.includes("onboarding")) && targetWsSlug
        ? `/${targetWsSlug}`
        : nextPath;
      window.location.href = resolveAppPath(destinationPath);
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
