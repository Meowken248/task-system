/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios from "axios";
// api service
import { APIService } from "../api.service";
import { saveAttachment } from "./attachment-storage";

/**
 * Converts a File object to a Base64 string (without the data URL prefix)
 * Universal support for both modern browsers and Node environments
 */
async function fileToBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === "function") {
    const rawBuffer = await file.arrayBuffer();
    const nodeBuffer = (globalThis as any).Buffer;
    if (typeof nodeBuffer !== "undefined") {
      return nodeBuffer.from(rawBuffer).toString("base64");
    }
    const bytes = new Uint8Array(rawBuffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      return reject(new Error("FileReader is not available"));
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.addEventListener("load", () => {
      let encoded = reader.result?.toString() || "";
      const commaIdx = encoded.indexOf(",");
      if (commaIdx !== -1) {
        encoded = encoded.substring(commaIdx + 1);
      }
      resolve(encoded);
    });
    reader.addEventListener("error", (error) => reject(error));
  });
}

/**
 * Computes deterministic SHA-256 hash using the Web Crypto API
 */
async function computeSha256(file: File): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      console.warn("[Metanode] Web Crypto digest failed, using fallback:", e);
    }
  }
  return `${file.name.replace(/[^a-zA-Z0-9]/g, "_")}-${file.size}-${file.lastModified}`;
}

/**
 * Service class for handling file upload operations via File Processor and Metanode FiaiSDK
 *
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  /**
   * Uploads a file using File Processor / FiaiSDK with safe fallback
   * @param {string} _url - Ignored in DApp mode
   * @param {FormData} data - The form data to upload
   * @returns {Promise<any>} Promise resolving to upload result with asset hash
   * @throws {Error} If the request fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadFile(_url: string, data: FormData): Promise<any> {
    if (typeof window === "undefined") return;
    // oxlint-disable-next-line import/no-named-as-default-member -- Axios exposes this factory on its default value; its named CancelToken declaration is type-only.
    this.cancelSource = axios.CancelToken.source();

    // 1. Extract file from FormData
    const file = (data.get("asset") || data.get("file")) as File;
    if (!file) {
      throw new Error("No file found in FormData under 'asset' or 'file' key");
    }

    try {
      const [base64Data, hash] = await Promise.all([
        fileToBase64(file),
        computeSha256(file),
      ]);
      const ext = file.name.split(".").pop() || "";
      const mimeType = file.type || "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${base64Data}`;
      const providedAssetId = (data.get("asset_id") || data.get("id")) as string | null;
      const assetId = providedAssetId || hash;

      // 2. Persist to local IndexedDB attachment storage under both assetId and hash
      await saveAttachment(assetId, {
        name: file.name,
        base64: base64Data,
        type: mimeType,
        size: file.size,
      });
      if (providedAssetId && providedAssetId !== hash) {
        await saveAttachment(hash, {
          name: file.name,
          base64: base64Data,
          type: mimeType,
          size: file.size,
        });
      }

      return {
        asset: assetId,
        asset_id: assetId,
        id: assetId,
        asset_url: dataUrl,
        file_url: dataUrl,
        base64: base64Data,
        file_type: mimeType,
        attributes: {
          name: file.name,
          size: file.size,
        },
      };
    } catch (error: any) {
      console.error("[Metanode] File Upload Error:", error);
      throw error;
    }
  }

  /**
   * Cancels the upload
   */
  cancelUpload() {
    if (this.cancelSource) {
      this.cancelSource.cancel("Upload canceled");
    }
  }
}

