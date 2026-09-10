/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// ── DApp Mode: Intercept native form POSTs to /auth/* ──────────────────
if (typeof document !== "undefined") {
  const handleAuthAction = (form: HTMLFormElement) => {
    const action = form.action || "";

    if (
      action.includes("/auth/sign-in") ||
      action.includes("/auth/sign-up") ||
      action.includes("/auth/magic-sign-in") ||
      action.includes("/auth/magic-sign-up")
    ) {
      const nextPathInput = form.querySelector('input[name="next_path"]') as HTMLInputElement | null;
      const nextPath = nextPathInput?.value;
      const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement | null;
      const email = (emailInput?.value || "").trim();

      if (email) {
        const userId = `user-${Date.now().toString(36)}`;
        localStorage.setItem("plane_dapp_auth_user", userId);
        localStorage.setItem("plane_dapp_auth_email", email);
      }
      window.location.href = nextPath || "/";
      return true;
    }

    if (action.includes("/auth/sign-out")) {
      localStorage.removeItem("plane_dapp_auth_user");
      localStorage.removeItem("plane_dapp_auth_email");
      window.location.href = "/";
      return true;
    }

    return false;
  };

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      if (form && handleAuthAction(form)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (handleAuthAction(this)) {
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
