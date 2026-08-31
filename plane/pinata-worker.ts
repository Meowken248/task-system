/**
 * Cloudflare Worker for proxying IPFS uploads to Pinata securely.
 * 
 * Environment Variables required in Cloudflare Worker settings:
 * - PINATA_JWT: Your secret Pinata JWT token
 * - WORKER_API_KEY: A secret key to authenticate requests from your frontend
 */
import type { ExecutionContext } from "@cloudflare/workers-types";

export interface Env {
  PINATA_JWT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), { 
        status: 405, 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }

    if (!env.PINATA_JWT) {
      return new Response(JSON.stringify({ error: "Configuration Error" }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }

    try {
      // GIỚI HẠN SIZE: Tránh upload file quá to gây nghẽn băng thông
      const rawBody = await request.text();
      if (rawBody.length > 200 * 1024) { // Max 200KB limit for JSON config
        return new Response(JSON.stringify({ error: "Payload too large (max 200KB)" }), { 
          status: 413, 
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
        });
      }
      const requestData = JSON.parse(rawBody);

      // Forward to Pinata (jwt ONLY read from env, never returned)
      const pinataResponse = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.PINATA_JWT}`
        },
        body: JSON.stringify({
          pinataContent: requestData,
          pinataMetadata: { name: "OffchainDataRegistry_Upload" }
        })
      });

      const data = await pinataResponse.json();

      if (!pinataResponse.ok) {
        return new Response(JSON.stringify({ error: "Failed to upload to Pinata", details: data }), {
          status: pinataResponse.status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Trả về duy nhất CID, KHÔNG BAO GIỜ echo lại JWT hay thông tin nhạy cảm
      return new Response(JSON.stringify({ cid: data.IpfsHash }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (error: any) {
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
