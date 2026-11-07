/** The description endpoint returns Yjs bytes, never HTML masquerading as an ArrayBuffer. */
export function decodePageBinary(value: unknown): ArrayBuffer {
  if (value === undefined || value === null || value === "") return new ArrayBuffer(0);
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Dữ liệu nội dung trang không đúng định dạng binary.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
