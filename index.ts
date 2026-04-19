import { z } from 'zod'
import Dexie from 'dexie'
import type { DatabaseSchema, TableInterface } from 'asasvirtuais/interface'

/**
 * Creates a TableInterface adapter for IndexedDB using Dexie.js.
 * This allows the framework to be used in a client-side only context.
 *
 * @param dbName The name of the IndexedDB database.
 * @param schema The Zod schema definition for the database tables.
 * @returns A TableInterface implementation for Dexie.
 */
export function indexedInterface<Schema extends DatabaseSchema>(
    dbName: string,
    schema: Schema
): TableInterface<z.infer<Schema[keyof Schema]['readable']>, z.infer<Schema[keyof Schema]['writable']>> {

    const db = new Dexie(dbName)


    // Dynamically define the database schema for Dexie from the Zod schema.
    // It marks 'id' as the primary key and indexes all other top-level readable fields.
    const dexieSchema = Object.fromEntries(
        Object.keys(schema).map(tableName => {
            const fields = Object.keys(schema[tableName].readable.shape)
            // 'id' is the primary key, the rest are indexed fields.
            const indexedFields = fields.filter(f => f !== 'id').join(', ')
            return [tableName, `id, ${indexedFields}`]
        })
    )

    db.version(1).stores(dexieSchema)


    type GenericReadable = z.infer<Schema[keyof Schema]['readable']>
    type GenericWritable = z.infer<Schema[keyof Schema]['writable']>

    const methods = {
        async find({ table, id }) {
            if (!table) throw new Error('Table name must be provided.')
            const result = await db.table(table).get(id)
            if (!result) throw new Error(`Record with id ${id} not found in ${table}`)
            return result
        },

        async list({ table, query }) {
            if (!table) throw new Error('Table name must be provided.')
            let collection = db.table(table).toCollection()

            const { $limit, $skip, $sort, ...filters } = query ?? {}

            // Handle filtering
            if (Object.keys(filters).length > 0) {
                collection = collection.filter(item => {
                    return Object.entries(filters).every(([key, value]) => {
                        const itemValue = item[key as keyof typeof item]
                        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            return Object.entries(value).every(([op, opValue]) => {
                                switch (op) {
                                    case '$ne': return itemValue !== opValue
                                    case '$in': return Array.isArray(opValue) && opValue.includes(itemValue)
                                    case '$nin': return Array.isArray(opValue) && !opValue.includes(itemValue)
                                    case '$lt': return itemValue < (opValue as number)
                                    case '$lte': return itemValue <= (opValue as number)
                                    case '$gt': return itemValue > (opValue as number)
                                    case '$gte': return itemValue >= (opValue as number)
                                    default: return true // Ignore unknown operators
                                }
                            })
                        } else {
                            return itemValue === value
                        }
                    })
                })
            }

            // Handle sorting
            if ($sort) {
                const sortKey = Object.keys($sort)[0] as keyof GenericReadable
                const direction = $sort[sortKey] === -1 ? 'desc' : 'asc'
                if (direction === 'desc')
                    collection = collection.reverse()
                // @ts-expect-error
                collection = await collection.sortBy(sortKey)
            }

            // Handle pagination
            if ($skip) {
                collection = collection.offset($skip)
            }
            if ($limit) {
                collection = collection.limit($limit)
            }

            return collection.toArray()
        },

        async create({ table, data }) {
            if (!table) throw new Error('Table name must be provided.')
            // Use existing id or generate a new UUID
            const id = (data as any).id || crypto.randomUUID()
            const record = { ...data, id }
            await db.table(table).add(record)
            return record as GenericReadable
        },

        async update({ table, id, data }) {
            if (!table) throw new Error('Table name must be provided.')
            const updatedCount = await db.table(table).update(id, data)
            if (updatedCount === 0) {
                throw new Error(`Record with id ${id} not found in ${table}, cannot update.`)
            }
            const result = await methods.find({ table, id })
            return result as GenericReadable
        },

        async remove({ table, id }) {
            if (!table) throw new Error('Table name must be provided.')
            const record = await methods.find({ table, id })
            if (!record) {
                throw new Error(`Record with id ${id} not found in ${table}, cannot remove.`)
            }
            await db.table(table).delete(id)
            return record as GenericReadable
        },
    } as TableInterface<GenericReadable, GenericWritable>

    return methods
}

export default indexedInterface
