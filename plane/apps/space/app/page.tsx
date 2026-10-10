/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useSearchParams, useRouter } from "next/navigation";
// plane imports
import { isValidNextPath } from "@plane/utils";
// components
import { UserLoggedIn } from "@/components/account/user-logged-in";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { AuthView } from "@/components/views";
import { PublishedAnchorView } from "@/components/issues/published-anchor-view";
// hooks
import { useUser } from "@/hooks/store/use-user";
import type { Route } from "./+types/page";

const HomePage = observer(function HomePage() {
  const { data: currentUser, isAuthenticated, isInitializing } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const nextPath = searchParams.get("next_path");
  const anchor = searchParams.get("anchor");

  useEffect(() => {
    if (anchor) return;
    if (currentUser && isAuthenticated && nextPath && isValidNextPath(nextPath)) {
      router.replace(nextPath);
    }
  }, [anchor, currentUser, isAuthenticated, nextPath, router]);

  if (anchor) {
    return <PublishedAnchorView anchor={anchor} />;
  }

  if (isInitializing)
    return (
      <div className="flex h-screen min-h-[500px] w-full items-center justify-center bg-surface-1">
        <LogoSpinner />
      </div>
    );

  if (currentUser && isAuthenticated) {
    if (nextPath && isValidNextPath(nextPath)) {
      return (
        <div className="flex h-screen min-h-[500px] w-full items-center justify-center bg-surface-1">
          <LogoSpinner />
        </div>
      );
    }
    return <UserLoggedIn />;
  }

  return <AuthView />;
});

export default HomePage;
