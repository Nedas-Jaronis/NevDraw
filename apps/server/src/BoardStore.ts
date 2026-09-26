import { SqlClient } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { BoardEdge, BoardNode } from "@rtw/shared"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

/** Persistence for the committed layer only. Drafts and presence never touch it. */
export class BoardStore extends Context.Tag("BoardStore")<
  BoardStore,
  {
    readonly load: (roomId: string) => Effect.Effect<{ nodes: ReadonlyArray<BoardNode>; edges: ReadonlyArray<BoardEdge> }>
    readonly upsert: (roomId: string, nodes: ReadonlyArray<BoardNode>, edges?: ReadonlyArray<BoardEdge>) => Effect.Effect<void>
    readonly remove: (roomId: string, nodeIds: ReadonlyArray<string>, edgeIds?: ReadonlyArray<string>) => Effect.Effect<void>
  }
>() {}

/** In-memory store for tests. Share one instance across server restarts to simulate a disk. */
export const makeMemoryStore = () => {
  const data = new Map<string, { nodes: Map<string, BoardNode>; edges: Map<string, BoardEdge> }>()
  const room = (id: string) => data.get(id) ?? data.set(id, { nodes: new Map(), edges: new Map() }).get(id)!
  return Layer.succeed(BoardStore, {
    load: (roomId) => Effect.sync(() => ({ nodes: [...room(roomId).nodes.values()], edges: [...room(roomId).edges.values()] })),
    upsert: (roomId, nodes, edges = []) =>
      Effect.sync(() => {
        nodes.forEach((n) => room(roomId).nodes.set(n.id, n))
        edges.forEach((e) => room(roomId).edges.set(e.id, e))
      }),
    remove: (roomId, ids, edgeIds = []) =>
      Effect.sync(() => {
        ids.forEach((id) => room(roomId).nodes.delete(id))
        edgeIds.forEach((id) => room(roomId).edges.delete(id))
      }),
  })
}

const decodeNode = Schema.decodeUnknownSync(Schema.parseJson(BoardNode))
const encodeNode = Schema.encodeSync(Schema.parseJson(BoardNode))
const decodeEdge = Schema.decodeUnknownSync(Schema.parseJson(BoardEdge))
const encodeEdge = Schema.encodeSync(Schema.parseJson(BoardEdge))

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
    yield* sql`CREATE TABLE IF NOT EXISTS edges (
      room_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (room_id, id)
    )`

    return {
      load: (roomId) =>
        Effect.all({
          nodes: sql<{ data: string }>`SELECT data FROM nodes WHERE room_id = ${roomId} ORDER BY rowid`,
          edges: sql<{ data: string }>`SELECT data FROM edges WHERE room_id = ${roomId} ORDER BY rowid`,
        }).pipe(
          Effect.map((r) => ({ nodes: r.nodes.map((x) => decodeNode(x.data)), edges: r.edges.map((x) => decodeEdge(x.data)) })),
          Effect.orDie,
        ),
      upsert: (roomId, nodes, edges = []) =>
        Effect.all([
          Effect.forEach(
            nodes,
            (n) =>
              sql`INSERT INTO nodes (room_id, id, data) VALUES (${roomId}, ${n.id}, ${encodeNode(n)})
                  ON CONFLICT (room_id, id) DO UPDATE SET data = excluded.data`,
            { discard: true },
          ),
          Effect.forEach(
            edges,
            (e) =>
              sql`INSERT INTO edges (room_id, id, data) VALUES (${roomId}, ${e.id}, ${encodeEdge(e)})
                  ON CONFLICT (room_id, id) DO UPDATE SET data = excluded.data`,
            { discard: true },
          ),
        ]).pipe(sql.withTransaction, Effect.asVoid, Effect.orDie),
      remove: (roomId, ids, edgeIds = []) =>
        Effect.all([
          Effect.forEach(ids, (id) => sql`DELETE FROM nodes WHERE room_id = ${roomId} AND id = ${id}`, { discard: true }),
          Effect.forEach(edgeIds, (id) => sql`DELETE FROM edges WHERE room_id = ${roomId} AND id = ${id}`, { discard: true }),
        ]).pipe(sql.withTransaction, Effect.asVoid, Effect.orDie),
    }
  }),
)

export const sqliteStore = (filename: string) => {
  mkdirSync(dirname(filename), { recursive: true })
  return SqlStore.pipe(Layer.provide(SqliteClient.layer({ filename })), Layer.orDie)
}
