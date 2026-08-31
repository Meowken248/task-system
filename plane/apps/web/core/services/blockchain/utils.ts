export async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage = "Operation timed out"): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, ms);
  });
  
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export function blockchainErrorMessage(error: any): string {
  const str = typeof error === "string" ? error : (error?.message || "");
  if (typeof error === "object") {
    try {
      return JSON.stringify(error) + " " + str;
    } catch {
      return str;
    }
  }
  return str;
}
