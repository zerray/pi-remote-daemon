import { createHash } from "node:crypto";
import { asRecord, readString } from "./transcript-message.js";
import type { TreeEntry, TreeSnapshot } from "./types.js";

export type SessionTreeNodeInput = {
  entry: unknown;
  children?: SessionTreeNodeInput[];
  label?: string;
  labelTimestamp?: string;
};

const TREE_PREVIEW_LIMIT = 500;
const TREE_FILTERS: TreeSnapshot["filters"] = ["default", "no-tools", "user-only", "labeled-only", "all"];

export function buildTreeSnapshot(input: {
  sessionId: string;
  roots: SessionTreeNodeInput[];
  leafId: string | null;
  generatedAt?: string;
}): TreeSnapshot {
  const rawEntries = flattenTree(input.roots);
  const parentById = new Map<string, string | null>();
  for (const rawEntry of rawEntries) parentById.set(rawEntry.id, rawEntry.parentId);
  const activeBranchIds = activeBranchPath(input.leafId, parentById);
  const entries = rawEntries.map<TreeEntry>((rawEntry) => toTreeEntry(rawEntry, input.leafId, activeBranchIds));
  const snapshotVersion = `treev_${hashJson(entries.map(({ isCurrentLeaf: _isCurrentLeaf, isOnActiveBranch: _isOnActiveBranch, ...entry }) => entry))}`;
  const branchVersion = `branchv_${hashJson({ leafId: input.leafId, snapshotVersion })}`;
  return {
    sessionId: input.sessionId,
    leafId: input.leafId,
    snapshotVersion,
    branchVersion,
    entries,
    defaultFilter: "default",
    filters: [...TREE_FILTERS],
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

type RawTreeEntry = {
  source: Record<string, unknown>;
  id: string;
  parentId: string | null;
  timestamp: string;
  label?: string;
};

function flattenTree(roots: SessionTreeNodeInput[]): RawTreeEntry[] {
  const entries: RawTreeEntry[] = [];
  const visit = (node: SessionTreeNodeInput) => {
    const source = asRecord(node.entry);
    const id = readString(source.id);
    if (!id) return;
    entries.push({
      source,
      id,
      parentId: readString(source.parentId) ?? null,
      timestamp: readString(source.timestamp) ?? new Date(0).toISOString(),
      label: node.label,
    });
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return entries;
}

function activeBranchPath(leafId: string | null, parentById: Map<string, string | null>): Set<string> {
  const ids = new Set<string>();
  let currentId = leafId;
  while (currentId) {
    ids.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return ids;
}

function toTreeEntry(rawEntry: RawTreeEntry, leafId: string | null, activeBranchIds: Set<string>): TreeEntry {
  const entryType = treeEntryType(rawEntry.source.type);
  const message = asRecord(rawEntry.source.message);
  const messageRole = readString(message.role);
  const role = publicRole(entryType, messageRole);
  const customType = readString(rawEntry.source.customType);
  const title = entryTitle(entryType, role, customType);
  const preview = boundedPreview(previewText(rawEntry.source, entryType));
  const isForkable = entryType === "message" && role === "user";
  const navigationBehavior = isForkable || entryType === "custom_message" ? "edit_prompt" : "navigate";
  const result: TreeEntry = {
    id: rawEntry.id,
    parentId: rawEntry.parentId,
    type: entryType,
    title,
    preview: preview.text,
    timestamp: rawEntry.timestamp,
    isCurrentLeaf: rawEntry.id === leafId,
    isOnActiveBranch: activeBranchIds.has(rawEntry.id),
    isForkable,
    navigationBehavior,
  };
  if (role) result.role = role;
  if (customType) result.customType = customType;
  if (rawEntry.label) result.label = rawEntry.label;
  if (preview.truncated) result.previewTruncated = true;
  return result;
}

function treeEntryType(value: unknown): TreeEntry["type"] {
  switch (value) {
    case "message":
    case "custom_message":
    case "branch_summary":
    case "compaction":
    case "model_change":
    case "thinking_level_change":
    case "label":
    case "session_info":
    case "custom":
      return value;
    default:
      return "other";
  }
}

function publicRole(entryType: TreeEntry["type"], role: string | undefined): TreeEntry["role"] | undefined {
  if (entryType === "custom_message") return "custom";
  if (role === "user" || role === "assistant" || role === "toolResult" || role === "system") return role;
  return undefined;
}

function entryTitle(type: TreeEntry["type"], role: TreeEntry["role"] | undefined, customType: string | undefined): string {
  if (type === "message") return role ?? "message";
  if (type === "custom_message") return customType ?? "custom";
  if (type === "branch_summary") return "branch summary";
  if (type === "thinking_level_change") return "thinking";
  if (type === "model_change") return "model";
  if (type === "session_info") return "title";
  if (type === "custom") return customType ?? "custom";
  return type;
}

function previewText(entry: Record<string, unknown>, type: TreeEntry["type"]): string {
  if (type === "message") return contentText(asRecord(entry.message).content);
  if (type === "custom_message") return contentText(entry.content);
  if (type === "branch_summary" || type === "compaction") return readString(entry.summary) ?? "";
  if (type === "model_change") return readString(entry.modelId) ?? "";
  if (type === "thinking_level_change") return readString(entry.thinkingLevel) ?? "";
  if (type === "label") return readString(entry.label) ?? "";
  if (type === "session_info") return readString(entry.name) ?? "";
  if (type === "custom") return readString(entry.customType) ?? "";
  return "";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((item) => {
    const record = asRecord(item);
    if (record.type === "text") return readString(record.text) ?? "";
    if (record.type === "thinking") return readString(record.thinking) ?? "";
    return [];
  }).join("");
}

function boundedPreview(text: string): { text: string; truncated: boolean } {
  if (text.length <= TREE_PREVIEW_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, TREE_PREVIEW_LIMIT), truncated: true };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
}
