import type { TBlockchainTrackingRecord } from "@/services/blockchain/blockchain-tracking.service";
import type { TIssueAttachment, TIssueComment } from "@plane/types";

export type ResolvedActivityItem = {
  id: string;
  kind: "comment" | "evidence" | "attachment" | "other";
  kindLabel: string;
  recordedAt?: string;
  formattedTime: string;
  referenceId?: string;
  transactionHash?: string;
  isOnChain: boolean;
  contentTitle: string;
  contentBody?: string;
  metadata?: {
    fileName?: string;
    fileSize?: string;
    fileType?: string;
    previewUrl?: string;
    assetSource?: string;
    authorName?: string;
  };
};

export function formatVietnamDateTime(value?: string | number, fallback?: string): string {
  const time = value || fallback;
  if (!time) return "Chưa có thời gian";
  const date = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  if (Number.isNaN(date.getTime())) return String(time);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

export function formatByteSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${val.endsWith(".0") ? val.slice(0, -2) : val} ${units[i]}`;
}

export function resolveActivityRecords(
  contentRecords: TBlockchainTrackingRecord[],
  comments: TIssueComment[] = [],
  attachments: TIssueAttachment[] = []
): ResolvedActivityItem[] {
  const commentsById = new Map<string, TIssueComment>();
  comments.forEach((c) => {
    if (c.id) commentsById.set(c.id, c);
  });

  const attachmentsById = new Map<string, TIssueAttachment>();
  attachments.forEach((a) => {
    if (a.id) attachmentsById.set(a.id, a);
    if ((a as any).asset_id) attachmentsById.set((a as any).asset_id, a);
    if ((a as any).asset) attachmentsById.set((a as any).asset, a);
  });

  const items = contentRecords.map((rec, index) => {
    const rawKind = rec.content_kind || (rec.event_type === "task_content" ? "evidence" : "other");
    const isComment = rawKind === "comment";
    const ref = rec.content_reference?.trim();
    const txHash = rec.transaction_hash?.trim();

    const time = rec.recorded_at || (rec as any).created_at;
    const formattedTime = formatVietnamDateTime(time);

    if (isComment) {
      const matchedComment = ref ? commentsById.get(ref) : undefined;
      const commentText =
        matchedComment?.comment_stripped ||
        matchedComment?.comment_html?.replace(/<[^>]+>/g, " ").trim() ||
        "Chưa tải được nội dung bình luận gốc.";

      const author =
        matchedComment?.actor_detail?.display_name ||
        matchedComment?.actor_detail?.first_name ||
        (matchedComment?.actor_detail as any)?.email;

      return {
        id: rec.transaction_hash || `comment-${ref || index}`,
        kind: "comment" as const,
        kindLabel: "Bình luận",
        recordedAt: time,
        formattedTime,
        referenceId: ref,
        transactionHash: txHash,
        isOnChain: false,
        contentTitle: author ? `${author} đã bình luận` : "Bình luận",
        contentBody: commentText,
        metadata: {
          authorName: author,
        },
      };
    }

    // Evidence / Attachment
    const matchedAtt = ref ? attachmentsById.get(ref) || attachmentsById.get(ref.split(":")[0]) : undefined;
    const fileName =
      matchedAtt?.attributes?.name ||
      (matchedAtt?.asset_url && !matchedAtt.asset_url.startsWith("http") && !matchedAtt.asset_url.startsWith("asset_")
        ? matchedAtt.asset_url
        : undefined) ||
      (ref ? `Tệp bằng chứng (${ref})` : "Tệp bằng chứng");

    const fileSize = matchedAtt?.attributes?.size ? formatByteSize(matchedAtt.attributes.size) : undefined;
    const fileType = (matchedAtt?.attributes as any)?.type;

    const source = matchedAtt?.asset_url || matchedAtt?.id;
    const previewUrl =
      typeof source === "string" &&
        /^(https?:\/\/|data:|blob:)/i.test(source) &&
        !/\/api\/(?:public\/)?assets\//i.test(source)
        ? source
        : undefined;

    return {
      id: rec.transaction_hash || `evidence-${ref || index}`,
      kind: "evidence" as const,
      kindLabel: "Bằng chứng",
      recordedAt: time,
      formattedTime,
      referenceId: ref,
      transactionHash: txHash,
      isOnChain: false,
      contentTitle: fileName,
      contentBody: fileSize ? `Kích thước: ${fileSize}` : undefined,
      metadata: {
        fileName,
        fileSize,
        fileType,
        previewUrl,
        assetSource: typeof source === "string" ? source : undefined,
      },
    };
  });

  // Sắp xếp mới nhất trước theo yêu cầu review
  items.sort((a, b) => {
    const timeA = a.recordedAt ? Date.parse(a.recordedAt) : 0;
    const timeB = b.recordedAt ? Date.parse(b.recordedAt) : 0;
    return timeB - timeA;
  });

  return items;
}
