import { z } from 'zod';
import { AttachmentKindSchema } from '../enums';

/** One search hit the user can choose to attach. Nothing here is persisted
 *  until the user picks a candidate — search results are ephemeral. */
export interface ManualCandidateDto {
  title: string;
  url: string;
  host: string;
  snippet: string | null;
  /** True when the URL itself ends in .pdf — a strong hint, not a guarantee;
   *  the download endpoint re-validates the actual bytes. */
  isPdf: boolean;
  /** Heuristic relevance score (higher first); exposed for debugging/tuning. */
  score: number;
}

export interface ManualSearchResultDto {
  query: string;
  provider: string;
  candidates: ManualCandidateDto[];
}

export const ManualSearchQuerySchema = z.object({
  /** Override the auto-built query ("<manufacturer> <model> manual"). */
  q: z.string().max(300).optional(),
});
export type ManualSearchQueryDto = z.infer<typeof ManualSearchQuerySchema>;

/** Attach a file by having the server fetch it from a URL (manual-lookup
 *  pick, or a URL the user pasted). Only PDFs are accepted for kind=manual;
 *  the server validates the real content, not just the extension. */
export const AttachFromUrlSchema = z.object({
  url: z.url().max(2000),
  kind: AttachmentKindSchema.default('manual'),
  title: z.string().max(300).nullish(),
});
export type AttachFromUrlDto = z.infer<typeof AttachFromUrlSchema>;
