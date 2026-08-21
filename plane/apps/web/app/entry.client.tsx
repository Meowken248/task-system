/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// ── DApp Mode: Intercept native form POSTs to /auth/* ──────────────────
// Plane's login/signup forms use native form.submit() which bypasses Axios
// and standard submit events. We override the native submit method.
if (typeof document !== "undefined") {
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    const action = this.action || "";

    if (
      action.includes("/auth/sign-in") ||
      action.includes("/auth/sign-up") ||
      action.includes("/auth/magic-sign-in") ||
      action.includes("/auth/magic-sign-up")
    ) {
      const nextPathInput = this.querySelector('input[name="next_path"]') as HTMLInputElement | null;
      const nextPath = nextPathInput?.value;
      const emailInput = this.querySelector('input[name="email"]') as HTMLInputElement | null;
      const email = emailInput?.value || "admin@plane.so";

      // Look up or create user in localDB
      let parsedDB = { users: [] as any[] };
      try {
        const saved = localStorage.getItem("plane_dapp_db");
        if (saved) parsedDB = JSON.parse(saved);
      } catch {}

      let user = parsedDB.users?.find((u: any) => u.email === email);
      if (!user) {
        user = {
          id: `user-${Date.now()}`,
          email,
          first_name: email.split("@")[0],
          last_name: "",
          display_name: email.split("@")[0],
          avatar_url: "",
          is_bot: false,
          is_active: true,
          is_email_verified: true,
          is_password_autoset: false,
          is_tour_completed: true,
          mobile_number: null,
          last_workspace_id: "mock-workspace",
          user_timezone: "Asia/Ho_Chi_Minh",
          username: email.split("@")[0],
          last_login_medium: "email",
          cover_image_url: null,
          date_joined: new Date().toISOString(),
          theme: { theme: "dark" },
        };
        if (!parsedDB.users) parsedDB.users = [];
        parsedDB.users.push(user);
        localStorage.setItem("plane_dapp_db", JSON.stringify(parsedDB));
      }

      // Simulate successful login
      localStorage.setItem("plane_dapp_auth_user", user.id);
      window.location.href = nextPath || "/mock-workspace";
      return;
    }

    if (action.includes("/auth/sign-out")) {
      // Simulate successful logout
      localStorage.removeItem("plane_dapp_auth_user");
      window.location.href = "/";
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
