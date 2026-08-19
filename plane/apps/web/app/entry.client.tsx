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
    
    if (action.includes("/auth/sign-in") || action.includes("/auth/sign-up") ||
        action.includes("/auth/magic-sign-in") || action.includes("/auth/magic-sign-up")) {
      
      const nextPathInput = this.querySelector('input[name="next_path"]') as HTMLInputElement | null;
      const nextPath = nextPathInput?.value;
      
      // Simulate successful login
      localStorage.setItem("plane_dapp_auth", "true");
      window.location.href = nextPath || "/mock-workspace";
      return;
    }
    
    if (action.includes("/auth/sign-out")) {
      // Simulate successful logout
      localStorage.removeItem("plane_dapp_auth");
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
