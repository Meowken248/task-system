/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export abstract class IndexedDBService {
  private dbName: string;
  private version: number;
  private db: IDBDatabase | null = null;

  constructor(dbName: string, version: number) {
    this.dbName = dbName;
    this.version = version;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("success", () => {
        this.db = request.result;
        resolve();
      });

      request.addEventListener("upgradeneeded", (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("workspaces")) {
          db.createObjectStore("workspaces", { keyPath: "id" });
        }
      });
    });
  }

  async save(workspaces: any[]): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const transaction = this.db.transaction("workspaces", "readwrite");
    const store = transaction.objectStore("workspaces");

    return new Promise((resolve, reject) => {
      // Clear existing data
      store.clear();

      // Add new workspaces
      workspaces.forEach((workspace) => {
        store.add(workspace);
      });

      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", () => reject(transaction.error));
    });
  }

  async query(): Promise<any[]> {
    if (!this.db) throw new Error("Database not initialized");

    const transaction = this.db.transaction("workspaces", "readonly");
    const store = transaction.objectStore("workspaces");

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }
}
