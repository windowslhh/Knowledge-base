export { openDb, closeDb, getDb, getConfig, setConfig } from "./db";
export { getPage, putPage, deletePage, listPages, countPages } from "./pages";
export { searchFts, rebuildFtsIndex } from "./fts";
export {
  storeEmbedding,
  getEmbeddings,
  deleteEmbeddings,
  cosineSimilarity,
  searchByVector,
} from "./embeddings";
export {
  addLink,
  removeLink,
  getLinks,
  getBacklinks,
  updateLinksFromContent,
  getAllLinks,
} from "./links";
export {
  getTagsForPage,
  setTagsForPage,
  addTag,
  removeTag,
  listAllTags,
  getPagesByTag,
} from "./tags";
export {
  addTimelineEntry,
  getTimeline,
  deleteTimelineEntry,
  getRecentTimeline,
} from "./timeline";
export { logIngest, getIngestLog, storeRawData, getRawData } from "./ingest-log";
export { pageToMarkdown, markdownToPage, extractWikiLinks } from "./markdown";
export {
  syncPageToFile,
  syncFileToDbAsync,
  sync,
  exportAll,
  getWikiDir,
  setWikiDir,
} from "./sync";
