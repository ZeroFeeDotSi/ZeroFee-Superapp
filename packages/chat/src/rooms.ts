// NEAR rooms beside the city places (J3 part 2). A room is `near:<account>` (an account's room; a Sputnik DAO's room is
// its account's room) or `token:<SYMBOL>` (core chat-near.ts). Its messages are Nostr events on Chat's own message
// servers, tagged with the room (kind 9, ["h", room]); BitChat users don't see them. Places are unchanged.
import { isAccountId, isRoomId } from "@zerofee/core/chat-near";
import { isDaoName } from "@zerofee/core/chat-reads";
import { readPlace } from "./geohash.ts";
import { placeName } from "./places.ts";
import { accountWords } from "./names.ts";

export interface Dao {
  dao: string;
  roles: string[];
}

/** Where Chat can be: a place (a geohash) or a NEAR room. */
export const isWhere = (s: string): boolean => readPlace(s) === s || isRoomId(s);

/** The account a `near:` room is for, or null. */
export const roomAccount = (room: string): string | null => (room.startsWith("near:") && isAccountId(room.slice(5)) ? room.slice(5) : null);

/** A DAO's short name: "marketing" for marketing.sputnik-dao.near. */
export const daoShort = (dao: string): string => dao.split(".")[0] ?? dao;

/** A room's or place's title: a city's name, a DAO's short name, an account, a coin. */
export function whereName(where: string): string {
  if (where.startsWith("token:")) return where.slice(6);
  const account = roomAccount(where);
  if (account) return isDaoName(account) ? daoShort(account) : accountWords(account);
  return placeName(where);
}

/** "Your DAOs" as kept on this device: well-formed rows only. */
export function readDaos(raw: string | null): Dao[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((d): d is Dao => !!d && typeof d.dao === "string" && isDaoName(d.dao) && Array.isArray(d.roles))
      .map((d) => ({ dao: d.dao, roles: d.roles.filter((r: unknown): r is string => typeof r === "string").slice(0, 3) }))
      .slice(0, 30);
  } catch {
    return [];
  }
}

/** A kept list of NEAR names. */
export function readNames(raw: string | null): string[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isAccountId(x)).slice(0, 20) : [];
  } catch {
    return [];
  }
}
