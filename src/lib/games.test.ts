import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllCategories,
    getAllGameIds,
    getAllPublishers,
    getGameById,
    getGames,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('filters games by one or more categories', async () => {
        await seedGames(db, 3);
        const [category] = await db.select({ id: categories.id }).from(categories);

        const filtered = await getGames(db, { categoryIds: [category.id] });

        expect(filtered).toHaveLength(3);
        expect(filtered.map((game) => game.title)).toEqual([
            'Game 01',
            'Game 02',
            'Game 03',
        ]);
    });

    it('filters games by publisher and category together', async () => {
        await seedGames(db, 2);
        const [otherPublisher] = await db
            .insert(publishers)
            .values({ name: 'Pub Two', description: 'pub' })
            .returning({ id: publishers.id });
        const [otherCategory] = await db
            .insert(categories)
            .values({ name: 'Puzzle', description: 'cat' })
            .returning({ id: categories.id });
        await db.insert(games).values({
            title: 'Puzzle Game',
            description: 'Description',
            starRating: 4.2,
            categoryId: otherCategory.id,
            publisherId: otherPublisher.id,
        });

        const filtered = await getGames(db, {
            categoryIds: [otherCategory.id],
            publisherId: otherPublisher.id,
        });

        expect(filtered.map((game) => game.title)).toEqual(['Puzzle Game']);
    });

    it('returns categories and publishers in alphabetical order', async () => {
        await seedGames(db, 1);
        await db.insert(categories).values({ name: 'Adventure', description: 'cat' });
        await db.insert(publishers).values({ name: 'Acme Games', description: 'pub' });

        expect((await getAllCategories(db)).map((item) => item.name)).toEqual([
            'Adventure',
            'Strategy',
        ]);
        expect((await getAllPublishers(db)).map((item) => item.name)).toEqual([
            'Acme Games',
            'Pub One',
        ]);
    });

    it('returns no games when filters do not match', async () => {
        await seedGames(db, 1);

        expect(await getGames(db, { publisherId: 99999 })).toEqual([]);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
