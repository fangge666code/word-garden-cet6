import { WORDS as CET6_WORDS } from "./cet6-words.js";
import { KAOYAN_WORDS } from "./kaoyan-words.js";

export const DEFAULT_BOOK_ID = "cet6";
export const BOOKS = Object.freeze({
  cet6: Object.freeze({ id: "cet6", shortName: "六级", name: "大学英语六级", englishName: "CET-6", words: CET6_WORDS }),
  kaoyan: Object.freeze({ id: "kaoyan", shortName: "考研", name: "考研英语", englishName: "KAOYAN ENGLISH", words: KAOYAN_WORDS }),
});

export function getBook(bookId) {
  return BOOKS[bookId] ?? BOOKS[DEFAULT_BOOK_ID];
}

export function moduleStorageKey(prefix, userId, bookId) {
  const owner = userId ? `:${userId}` : "";
  return `${prefix}${owner}:${getBook(bookId).id}`;
}
