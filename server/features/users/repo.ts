import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../../db";
import {
  user,
  conversations,
  character_likes,
  character_favorites,
} from "../../db/schema";
import { ownerFilter, type Owner } from "../shared/owner";
import { isUserRole, type UserRole } from "./roles";

/**
 * Fetch a user's current role from the database. This is the canonical
 * role lookup for non-HTTP contexts (background workers, scripts, queue
 * enqueue paths). HTTP request handlers should read role from the JWT
 * claim via `c.get("user").role` — the `requireRole` middleware does
 * this for route gating.
 *
 * Also used inside `POST /api/auth/refresh` to pull a fresh role into
 * the new access token, bypassing better-auth's session cache so role
 * changes propagate within the access-token lifetime.
 *
 * Throws if the user does not exist — the caller should never be
 * dereferencing a dangling userId. Returns "user" as a defensive
 * fallback if the stored value is somehow not in the USER_ROLES union
 * (e.g. a rogue manual DB write); this fails closed toward minimal
 * privileges rather than granting unexpected access.
 */
export async function getUserRole(
  db: DB,
  userId: string,
): Promise<UserRole> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) throw new Error(`user not found: ${userId}`);
  return isUserRole(row.role) ? row.role : "user";
}

// ─── Profile (F5) ──────────────────────────────────────

/** Public profile view — the exact shape GET/PATCH /api/me/profile return. */
export interface ProfileView {
  name: string;
  handle: string | null;
  favorite_team: string | null;
  image: string | null;
}

/** Fields a user may patch on their own profile. `role` is intentionally absent. */
export interface ProfilePatch {
  handle?: string;
  favorite_team?: string;
}

/**
 * Thrown when a handle update collides with the `user_handle_unique` index.
 * The router maps this to 409 HANDLE_TAKEN. We catch the DB constraint error
 * rather than check-then-insert, so there's no read/write race window.
 */
export class HandleTakenError extends Error {
  constructor() {
    super("handle already taken");
    this.name = "HandleTakenError";
  }
}

/** Both better-sqlite3 and D1 surface the unique index breach in the message. */
function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(msg);
}

/** Read the caller's own profile (never exposes role). */
export async function getProfile(db: DB, userId: string): Promise<ProfileView | null> {
  const [row] = await db
    .select({
      name: user.name,
      handle: user.handle,
      favorite_team: user.favorite_team,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Patch handle / favorite_team. Only provided fields are written; `role` can
 * never be touched here. A duplicate handle throws HandleTakenError.
 * Timestamps are SQL-side (unixepoch seconds), per the repo timestamp rule.
 */
export async function updateProfile(
  db: DB,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileView> {
  const set: Record<string, unknown> = { updatedAt: sql`(unixepoch())` };
  if (patch.handle !== undefined) set.handle = patch.handle;
  if (patch.favorite_team !== undefined) set.favorite_team = patch.favorite_team;

  try {
    const [row] = await db
      .update(user)
      .set(set)
      .where(eq(user.id, userId))
      .returning({
        name: user.name,
        handle: user.handle,
        favorite_team: user.favorite_team,
        image: user.image,
      });
    if (!row) throw new Error(`user not found: ${userId}`);
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HandleTakenError();
    throw err;
  }
}

// ─── Stats (F5) ──────────────────────────────────────

/** Owner-scoped profile counters: conversations, favorites, likes given. */
export interface Stats {
  chats: number;
  favorites: number;
  likes: number;
}

type CountRow = { n: number };

/**
 * Three owner-scoped counts in one round trip: conversations, favorites, and
 * likes-given. On production D1 this is a single `db.batch()`; the test driver
 * (better-sqlite3) has no batch, so we fall back to serial awaits (same result).
 */
export async function getStats(db: DB, owner: Owner): Promise<Stats> {
  const chatsQ = db
    .select({ n: count() })
    .from(conversations)
    .where(ownerFilter(conversations, owner));
  const favoritesQ = db
    .select({ n: count() })
    .from(character_favorites)
    .where(ownerFilter(character_favorites, owner));
  const likesQ = db
    .select({ n: count() })
    .from(character_likes)
    .where(ownerFilter(character_likes, owner));

  const runner = db as unknown as {
    batch?: (queries: readonly unknown[]) => Promise<unknown[]>;
  };
  const [chats, favorites, likes] = (
    typeof runner.batch === "function"
      ? await runner.batch([chatsQ, favoritesQ, likesQ])
      : await Promise.all([chatsQ, favoritesQ, likesQ])
  ) as [CountRow[], CountRow[], CountRow[]];

  return {
    chats: chats[0]?.n ?? 0,
    favorites: favorites[0]?.n ?? 0,
    likes: likes[0]?.n ?? 0,
  };
}

// ─── Guest → account merge (F5) ──────────────────────────────────────

/**
 * Fold a guest's engagement + conversations onto a real account. Runs whenever
 * a signed-in request still carries a guest cookie (sign-up, sign-in, new
 * device). One batch, order matters:
 *
 *   1. Drop guest likes/favorites whose character_id the user ALREADY owns —
 *      otherwise step 2 would breach the partial unique (user_id, character_id)
 *      index. Conversations have no such constraint, so no collision delete.
 *   2. Re-point the remaining guest rows to the user (guest_id → NULL).
 *
 * Idempotent: after the first run the guest rows carry user_id (guest_id NULL),
 * so `WHERE guest_id = :guestId` matches zero rows on any later run.
 */
export async function mergeGuest(
  db: DB,
  guestId: string,
  userId: string,
): Promise<void> {
  const userLikeIds = db
    .select({ character_id: character_likes.character_id })
    .from(character_likes)
    .where(eq(character_likes.user_id, userId));
  const userFavoriteIds = db
    .select({ character_id: character_favorites.character_id })
    .from(character_favorites)
    .where(eq(character_favorites.user_id, userId));

  const deleteCollidingLikes = db
    .delete(character_likes)
    .where(
      and(
        eq(character_likes.guest_id, guestId),
        isNull(character_likes.user_id),
        inArray(character_likes.character_id, userLikeIds),
      ),
    );
  const deleteCollidingFavorites = db
    .delete(character_favorites)
    .where(
      and(
        eq(character_favorites.guest_id, guestId),
        isNull(character_favorites.user_id),
        inArray(character_favorites.character_id, userFavoriteIds),
      ),
    );

  const moveLikes = db
    .update(character_likes)
    .set({ user_id: userId, guest_id: null })
    .where(and(eq(character_likes.guest_id, guestId), isNull(character_likes.user_id)));
  const moveFavorites = db
    .update(character_favorites)
    .set({ user_id: userId, guest_id: null })
    .where(
      and(eq(character_favorites.guest_id, guestId), isNull(character_favorites.user_id)),
    );
  const moveConversations = db
    .update(conversations)
    .set({ user_id: userId, guest_id: null })
    .where(and(eq(conversations.guest_id, guestId), isNull(conversations.user_id)));

  const queries = [
    deleteCollidingLikes,
    deleteCollidingFavorites,
    moveLikes,
    moveFavorites,
    moveConversations,
  ];

  const runner = db as unknown as {
    batch?: (queries: readonly unknown[]) => Promise<unknown[]>;
  };
  if (typeof runner.batch === "function") {
    // D1 batch = one serial transaction; the collision deletes commit before
    // the moves, so the subqueries see the user's pre-merge rows.
    await runner.batch(queries as unknown as readonly [unknown, ...unknown[]]);
  } else {
    for (const q of queries) await q;
  }
}
