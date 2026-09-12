/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios from "axios";
// api service
import { APIService } from "../api.service";

/**
 * Converts a File object to a Base64 string (without the data URL prefix)
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      let encoded = reader.result?.toString() || "";
      // SystemCore APIs expect pure base64 without the data URL prefix
      const commaIdx = encoded.indexOf(",");
      if (commaIdx !== -1) {
        encoded = encoded.substring(commaIdx + 1);
      }
      resolve(encoded);
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Service class for handling file upload operations via @metanodejs/system-core
 *
 * Uses SystemCore native bridge (WebKit / Electron / postMessage) directly,
 * which does NOT require any iframe frame (file-processor, crypto-vault, etc.)
 * to be ready. This eliminates the "No frame found for action" error.
 *
 * @extends {APIService}
 */
export class FileUploadService extends APIService {
  private cancelSource: any;

  constructor() {
    super("");
  }

  /**
   * Uploads a file using @metanodejs/system-core
   * @param {string} _url - Ignored in DApp mode
   * @param {FormData} data - The form data to upload
   * @returns {Promise<any>} Promise resolving to upload result with asset hash
   * @throws {Error} If the request fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadFile(_url: string, data: FormData): Promise<any> {
    if (typeof window === "undefined") return;
    this.cancelSource = axios.CancelToken.source();

    // 1. Extract file from FormData
    const file = (data.get("asset") || data.get("file")) as File;
    if (!file) {
      throw new Error("No file found in FormData under 'asset' or 'file' key");
    }

    try {
      const base64Data = await fileToBase64(file);
      const ext = file.name.split(".").pop() || "";

      console.log("[Metanode] Processing file via SystemCore:", file.name);

      // Dynamically import @metanodejs/system-core to use native bridge
      const systemCore = await import("@metanodejs/system-core");

      // Step 1: Create hash of the file content for on-chain reference
      const hash = await systemCore.createHash(base64Data, false);
      console.log("[Metanode] File hash created:", hash);

      // Step 2: Persist file via SystemCore (createFileWithBase64)
      let savedPath: string | undefined;
      try {
        const fileResult = await systemCore.createFileWithBase64({
          base64: base64Data,
          name: file.name.replace(/\.[^/.]+$/, ""), // filename without extension
          ext: ext,
        });
        savedPath = (fileResult as any)?.path || fileResult;
        console.log("[Metanode] File saved at:", savedPath);
      } catch (saveErr) {
        // File persistence is optional; hash is what matters for on-chain
        console.warn("[Metanode] createFileWithBase64 not available, using hash only:", saveErr);
      }

      const assetId = typeof hash === "string" ? hash : (hash as any)?.hash || file.name;
      const dataUrl = `data:${file.type || "application/octet-stream"};base64,${base64Data}`;

      return {
        asset: assetId,
        id: assetId,
        asset_url: dataUrl,
        base64: base64Data,
        file_type: file.type || "application/octet-stream",
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
