/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { mergeAttributes } from "@tiptap/core";
import type { MentionOptions } from "@tiptap/extension-mention";
import Mention from "@tiptap/extension-mention";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as NodeType } from "@tiptap/pm/model";
// types
import type { TMentionHandler } from "@/types";
// local types
import type { TMentionComponentAttributes } from "./types";
import { EMentionComponentAttributeNames } from "./types";

export type TMentionExtensionOptions = MentionOptions & {
  renderComponent: TMentionHandler["renderComponent"];
  getMentionedEntityDetails: TMentionHandler["getMentionedEntityDetails"];
};

export const CustomMentionExtensionConfig = Mention.extend<TMentionExtensionOptions>({
  addAttributes() {
    return {
      [EMentionComponentAttributeNames.ID]: {
        default: null,
        parseHTML: (element) => element.getAttribute("id"),
        renderHTML: (attributes) => ({
          id: attributes[EMentionComponentAttributeNames.ID],
        }),
      },
      [EMentionComponentAttributeNames.ENTITY_IDENTIFIER]: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("entity_identifier") ||
          element.getAttribute("entity-identifier") ||
          element.getAttribute("id") ||
          element.textContent?.replace(/^@+/, "").trim() ||
          null,
        renderHTML: (attributes) => ({
          entity_identifier: attributes[EMentionComponentAttributeNames.ENTITY_IDENTIFIER],
          "entity-identifier": attributes[EMentionComponentAttributeNames.ENTITY_IDENTIFIER],
        }),
      },
      [EMentionComponentAttributeNames.ENTITY_NAME]: {
        default: "user_mention",
        parseHTML: (element) =>
          element.getAttribute("entity_name") ||
          element.getAttribute("entity-name") ||
          "user_mention",
        renderHTML: (attributes) => ({
          entity_name: attributes[EMentionComponentAttributeNames.ENTITY_NAME] ?? "user_mention",
          "entity-name": attributes[EMentionComponentAttributeNames.ENTITY_NAME] ?? "user_mention",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mention-component",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mention-component", mergeAttributes(HTMLAttributes)];
  },

  renderText({ node }) {
    return getMentionDisplayText(this.options, node);
  },

  addStorage() {
    const options = this.options;
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: NodeType) {
          state.write(getMentionDisplayText(options, node));
        },
      },
    };
  },
});

function getMentionDisplayText(options: TMentionExtensionOptions, node: NodeType): string {
  const attrs = node.attrs as TMentionComponentAttributes;
  const mentionEntityId = attrs[EMentionComponentAttributeNames.ENTITY_IDENTIFIER];
  const mentionEntityDetails = options.getMentionedEntityDetails?.(mentionEntityId ?? "");
  return `@${mentionEntityDetails?.display_name ?? attrs[EMentionComponentAttributeNames.ID] ?? mentionEntityId}`;
}
