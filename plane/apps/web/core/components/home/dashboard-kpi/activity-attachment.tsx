import { useEffect, useState } from "react";
import { resolveAssetSource } from "@plane/services";

/** The parent obtains this source only from authorized attachment metadata. */
export function ActivityAttachment({ source, name, fileType }: { source: string; name?: string; fileType?: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl("");
    setFailed(false);
    void resolveAssetSource(source)
      .then((value) => {
        if (!value) throw new Error("Missing file content");
        if (active) setUrl(value);
        return value;
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [source, attempt]);
  const isImage =
    /^data:image\//i.test(url) || fileType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(name || "");
  if (failed)
    return (
      <div className="mt-2 text-11 text-tertiary">
        Chưa tải được tệp gốc.{" "}
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline">
          Thử lại
        </button>
      </div>
    );
  if (!url) return <p className="mt-2 text-11 text-tertiary">Đang tải tệp...</p>;
  return (
    <div className="mt-2">
      {isImage && (
        <img
          src={url}
          alt={name || "Bằng chứng"}
          className="max-h-40 max-w-full rounded-md object-contain"
          onError={() => setFailed(true)}
        />
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={name}
        className="text-11 text-accent-primary underline"
      >
        Mở / tải tệp gốc
      </a>
    </div>
  );
}
