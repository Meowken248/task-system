/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorRefApi, CollaborationState } from "@plane/editor";
// plane editor
import { convertBinaryDataToBase64String, getBinaryDataFromDocumentEditorHTMLString } from "@plane/editor";
// plane types
import type { TDocumentPayload } from "@plane/types";
// hooks
import useAutoSave from "@/hooks/use-auto-save";
import type { TPageInstance } from "@/store/pages/base-page";
import { saveFallbackDocument } from "../helpers/page-fallback";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";

type TArgs = {
  editorRef: React.RefObject<EditorRefApi>;
  fetchPageDescription: () => Promise<ArrayBuffer>;
  collaborationState: CollaborationState | null;
  updatePageDescription: (data: TDocumentPayload) => Promise<void>;
  page: TPageInstance;
};

export const usePageFallback = (args: TArgs) => {
  const { editorRef, fetchPageDescription, collaborationState, updatePageDescription, page } = args;
  const hasShownFallbackToast = useRef(false);
  const revision = useRef(0);
  const hydrated = useRef(false);
  const mounted = useRef(true);
  const context = useRef({ pageId: page.id, generation: 0 });
  const flight = useRef<{ pageId: string; promise: Promise<void> } | null>(null);
  const lastError = useRef("");
  if (context.current.pageId !== page.id) {
    context.current = { pageId: page.id, generation: context.current.generation + 1 };
    revision.current = 0; hydrated.current = false; lastError.current = "";
  }

  const [isFetchingFallbackBinary, setIsFetchingFallbackBinary] = useState(false);

  // Derive connection failure from collaboration state
  const hasConnectionFailed = collaborationState?.stage.kind === "disconnected";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => editorRef.current?.onDocumentInfoChange(() => { revision.current++; }),
    [editorRef, page.id, collaborationState?.stage.kind]);

  const handleUpdateDescription = useCallback(async () => {
    const pageId = page.id;
    if (!pageId || !hasConnectionFailed || !page.isContentEditable) return;
    const editor = editorRef.current;
    if (!editor) return;
    const currentFlight = flight.current;
    if (currentFlight && currentFlight.pageId === page.id) return currentFlight.promise;
    const generation = context.current.generation;
    const isCurrent = () => mounted.current && context.current.generation === generation && editorRef.current === editor && page.isContentEditable;

    // Show toast notification when fallback mechanism kicks in (only once)
    if (!hasShownFallbackToast.current) {
      console.warn("Websocket Connection lost, your changes are being saved using backup mechanism.");
      hasShownFallbackToast.current = true;
    }

    if (!hydrated.current) setIsFetchingFallbackBinary(true);
    const promise = saveFallbackDocument({
      editor, knownHtml: page.description_html ?? "<p></p>", hydrate: !hydrated.current,
      revision: () => revision.current, isCurrent, fetchBinary: fetchPageDescription,
      fromHtml: () => getBinaryDataFromDocumentEditorHTMLString(page.description_html ?? "<p></p>", page.name ?? ""),
      encode: convertBinaryDataToBase64String, save: updatePageDescription,
    }).then(() => { if (isCurrent()) { hydrated.current = true; lastError.current = ""; } })
      .catch((error) => {
        if (!isCurrent()) return;
        const message = error?.response?.data?.error || error?.message || "Nội dung vẫn được giữ trong trình soạn thảo. Hãy thử lưu lại.";
        if (lastError.current !== message) setToast({ type: TOAST_TYPE.ERROR, title: "Chưa lưu được nội dung trang", message });
        lastError.current = message;
      }).finally(() => {
        if (flight.current?.promise === promise) flight.current = null;
        if (isCurrent()) setIsFetchingFallbackBinary(false);
      });
    flight.current = { pageId, promise };
    return promise;
  }, [editorRef, fetchPageDescription, hasConnectionFailed, updatePageDescription, page, page.id, page.description_html, page.name]);

  useEffect(() => {
    if (hasConnectionFailed) {
      handleUpdateDescription();
    } else {
      // Reset toast flag when connection is restored
      hasShownFallbackToast.current = false;
    }
  }, [handleUpdateDescription, hasConnectionFailed]);

  useAutoSave(handleUpdateDescription);

  return { isFetchingFallbackBinary };
};
