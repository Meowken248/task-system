/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane web imports
import type { TEditorMentionComponentProps } from "@/plane-web/components/editor/embeds/mentions";
import { EditorAdditionalMentionsRoot } from "@/plane-web/components/editor/embeds/mentions";
// local imports
import { EditorUserMention } from "./user";

export function EditorMentionsRoot(props: TEditorMentionComponentProps) {
  const { entity_identifier, entity_name } = props;
  const id = entity_identifier || (props as any).id || (props as any)["entity-identifier"] || "";

  switch (entity_name) {
    case "user_mention":
      return <EditorUserMention id={id} />;
    default:
      return <EditorAdditionalMentionsRoot {...props} />;
  }
}
