/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";

/**
 * @description combine the file path with the base URL
 * @param {string} path
 * @returns {string} final URL with the base URL
 */
export const getFileURL = (path: string): string | undefined => {
  if (!path) return undefined;
  const isValidURL = path.startsWith("http");
  if (isValidURL) return path;
  return `${API_BASE_URL}${path}`;
};

/**
 * @description this function returns the assetId from the asset source
 * @param {string} src
 * @returns {string} assetId
 */
export const getAssetIdFromUrl = (src: string): string => {
  // remove the last char if it is a slash
  if (src.charAt(src.length - 1) === "/") src = src.slice(0, -1);
  const sourcePaths = src.split("/");
  const assetUrl = sourcePaths[sourcePaths.length - 1];
  return assetUrl;
};

/**
 * @description encode image via URL to base64
 * @param {string} url
 * @returns
 */
export const getBase64Image = async (url: string): Promise<string> => {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid URL provided");
  }

  // Try to create a URL object to validate the URL
  try {
    new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }

  const response = await fetch(url);
  // check if the response is OK
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (reader.result) {
        resolve(reader.result as string);
      } else {
        reject(new Error("Failed to convert image to base64."));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read the image file."));
    };

    reader.readAsDataURL(blob);
  });
};

/**
 * @description downloads a CSV file
 * @param {Array<Array<string>> | { [key: string]: string }} data - The data to be exported to CSV
 * @param {string} name - The name of the file to be downloaded
 */
export const csvDownload = (data: Array<Array<string>> | { [key: string]: string }, name: string) => {
  const rows = Array.isArray(data) ? [...data] : [Object.keys(data), Object.values(data)];

  const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);

  const link = document.createElement("a");
  link.href = encodedUri;
  link.download = `${name}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * @description triggers browser download for a Blob
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  if (typeof window === "undefined") return;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1000);
};

/**
 * @description converts a base64 string to a Blob
 */
export const base64ToBlob = (base64: string, mimeType = "application/octet-stream"): Blob => {
  const commaIdx = base64.indexOf(",");
  const cleanBase64 = commaIdx !== -1 ? base64.substring(commaIdx + 1) : base64;
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteNumbers.buffer as ArrayBuffer], { type: mimeType });
};

/**
 * @description triggers browser download for a base64 file
 */
export const downloadBase64File = (base64: string, filename: string, mimeType = "application/octet-stream"): void => {
  const blob = base64ToBlob(base64, mimeType);
  downloadBlob(blob, filename);
};

const DB_NAME = "plane_attachment_storage";
const STORE_NAME = "files";
const DB_VERSION = 1;

function openAttachmentDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB not available"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @description persists an uploaded attachment into local IndexedDB
 */
export async function saveAttachmentToStorage(
  key: string,
  data: { name: string; base64: string; type?: string; size?: number }
): Promise<void> {
  if (!key || !data.base64) return;
  try {
    const db = await openAttachmentDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, ...data, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    try {
      if (data.base64.length < 2000000) {
        sessionStorage.setItem(`plane_att_${key}`, JSON.stringify(data));
      }
    } catch {
      // Ignore storage quota errors
    }
  }
}

/**
 * @description retrieves an attachment from local IndexedDB
 */
export async function getAttachmentFromStorage(
  key: string
): Promise<{ name: string; base64: string; type?: string; size?: number } | null> {
  if (!key) return null;
  try {
    const db = await openAttachmentDB();
    const result = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (result && result.base64) return result;
  } catch {
    // fallback
  }

  try {
    const item = sessionStorage.getItem(`plane_att_${key}`);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

