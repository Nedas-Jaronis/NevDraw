import { SqlClient } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { BoardNode } from "@rtw/shared"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

/** Persistence for the committed layer only. Drafts and presence never touch it. */
export class BoardStore extends Context.Tag("BoardStore")<
  BoardStore,
  {
    readonly load: (roomId: string) => Effect.Effect<ReadonlyArray<BoardNode>>
    readonly upsert: (roomId: string, nodes: ReadonlyArray<BoardNode>) => Effect.Effect<void>
    readonly remove: (roomId: string, ids: ReadonlyArray<string>) => Effect.Effect<void>
  }
>() {}

/** In-memory store for tests. Share one instance across server restarts to simulate a disk. */
export const makeMemoryStore = () => {
  const data = new Map<string, Map<string, BoardNode>>()
  const room = (id: string) => data.get(id) ?? data.set(id, new Map()).get(id)!
  return Layer.succeed(BoardStore, {
    load: (roomId) => Effect.sync(() => [...room(roomId).values()]),
    upsert: (roomId, nodes) => Effect.sync(() => nodes.forEach((n) => room(roomId).set(n.id, n))),
    remove: (roomId, ids) => Effect.sync(() => ids.forEach((id) => room(roomId).delete(id))),
  })
}

const decodeNode = Schema.decodeUnknownSync(Schema.parseJson(BoardNode))
const encodeNode = Schema.encodeSync(Schema.parseJson(BoardNode))

const SqlStore = Layer.effect(
  BoardStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE IF NOT EXISTS nodes (
      room_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (room_id, id)
    )`

    return {
      load: (roomId) =>
        sql<{ data: string }>`SELECT data FROM nodes WHERE room_id = ${roomId} ORDER BY rowid`.pipe(
          Effect.map((rows) => rows.map((r) => decodeNode(r.data))),
          Effect.orDie,
        ),
      upsert: (roomId, nodes) =>
        Effect.forEach(
          nodes,
          (n) =>
            sql`INSERT INTO nodes (room_id, id, data) VALUES (${roomId}, ${n.id}, ${encodeNode(n)})
                ON CONFLICT (room_id, id) DO UPDATE SET data = excluded.data`,
          { discard: true },
        ).pipe(sql.withTransaction, Effect.orDie),
      remove: (roomId, ids) =>
        Effect.forEach(ids, (id) => sql`DELETE FROM nodes WHERE room_id = ${roomId} AND id = ${id}`, {
          discard: true,
        }).pipe(sql.withTransaction, Effect.orDie),
    }
  }),
)

export const sqliteStore = (filename: string) => {
  mkdirSync(dirname(filename), { recursive: true })
  return SqlStore.pipe(Layer.provide(SqliteClient.layer({ filename })), Layer.orDie)
}
