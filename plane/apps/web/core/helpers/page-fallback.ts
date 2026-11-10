import type { EditorRefApi } from "@plane/editor";
import type { TDocumentPayload } from "@plane/types";

type FallbackArgs = {
  editor: Pick<EditorRefApi, "getDocument" | "setProviderDocument">;
  knownHtml: string;
  hydrate: boolean;
  revision: () => number;
  isCurrent: () => boolean;
  fetchBinary: () => Promise<ArrayBuffer>;
  fromHtml: () => Uint8Array;
  encode: (bytes: Uint8Array) => string;
  save: (payload: TDocumentPayload) => Promise<void>;
};
const sameBytes = (a?: Uint8Array | null, b?: Uint8Array | null) =>
  a?.byteLength === b?.byteLength && (!a || a.every((value, index) => value === b?.[index]));

/** Hydrate only a pristine document; an old fetch must never replace local typing. */
export async function saveFallbackDocument(args: FallbackArgs): Promise<void> {
  const { editor, revision, isCurrent } = args;
  const initialRevision = revision();
  const before = editor.getDocument();
  const pristine = initialRevision === 0 && (!before.html || before.html === "<p></p>" || before.html === args.knownHtml);
  if (args.hydrate && pristine) {
    const binary = await args.fetchBinary();
    if (!isCurrent()) return;
    const current = editor.getDocument();
    if (revision() === initialRevision && current.html === before.html && sameBytes(current.binary, before.binary)) {
      editor.setProviderDocument(binary.byteLength ? new Uint8Array(binary) : args.fromHtml());
    }
  }
  if (!isCurrent()) return;
  const { binary, html, json } = editor.getDocument();
  if (!binary || !json) return;
  await args.save({ description_binary: args.encode(binary), description_html: html, description_json: json });
}
